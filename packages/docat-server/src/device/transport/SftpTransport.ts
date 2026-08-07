import SftpClient from 'ssh2-sftp-client'
import { DEVICE_PORTS } from 'docat-shared/protocol'

export interface SftpFileEntry {
  path: string
  name: string
  type: string
  size: number
  modifyTime: number
  accessTime: number
  rights?: {
    user?: string
    group?: string
    other?: string
  }
}

export interface SftpTransportOptions {
  username?: string
  password?: string
  port?: number
  readyTimeout?: number
}

type SftpClientWithMode = SftpClient & {
  chmod(path: string, mode: number): Promise<void>
  rename(from: string, to: string): Promise<void>
}

export class SftpTransport {
  private host: string
  private username: string
  private password: string
  private port: number
  private readyTimeout: number

  constructor(host: string, options: SftpTransportOptions = {}) {
    this.host = host
    this.username = options.username ?? process.env.DOCAT_SFTP_USER ?? 'root'
    this.password = options.password ?? process.env.DOCAT_SFTP_PASSWORD ?? 'dobot'
    this.port = options.port ?? DEVICE_PORTS.SFTP
    this.readyTimeout = options.readyTimeout ?? 5000
  }

  async list(remotePath: string): Promise<SftpFileEntry[]> {
    return this.withClient(async client => {
      const entries = await client.list(toControllerPath(remotePath))
      return entries.map(entry => ({
        path: joinRemotePath(remotePath, entry.name),
        name: entry.name,
        type: entry.type,
        size: entry.size,
        modifyTime: entry.modifyTime,
        accessTime: entry.accessTime,
        rights: entry.rights,
      }))
    })
  }

  async readText(remotePath: string): Promise<string> {
    return this.withClient(async client => {
      return this.readTextWithClient(client, remotePath)
    })
  }

  async readTexts(remotePaths: string[]): Promise<Map<string, string>> {
    return this.withClient(async client => {
      const files = new Map<string, string>()
      for (const remotePath of remotePaths) {
        files.set(remotePath, await this.readTextWithClient(client, remotePath))
      }
      return files
    })
  }

  async ensureDir(remotePath: string): Promise<void> {
    await this.withClient(async client => {
      const modeClient = client as SftpClientWithMode
      await client.mkdir(toControllerPath(remotePath), true)
      await modeClient.chmod(toControllerPath(remotePath), 0o777).catch(() => undefined)
    })
  }

  async writeText(remotePath: string, content: string, mode = 0o777): Promise<void> {
    await this.withClient(async client => {
      const modeClient = client as SftpClientWithMode
      await this.writeTextWithClient(client, remotePath, content)
      await modeClient.chmod(toControllerPath(remotePath), mode).catch(() => undefined)
    })
  }

  async writeBuffer(remotePath: string, content: Buffer, mode = 0o777): Promise<void> {
    await this.withClient(async client => {
      const modeClient = client as SftpClientWithMode
      await client.put(content, toControllerPath(remotePath))
      await modeClient.chmod(toControllerPath(remotePath), mode).catch(() => undefined)
    })
  }

  async writeTexts(files: Array<{ path: string; content: string; mode?: number }>): Promise<void> {
    await this.withClient(async client => {
      const modeClient = client as SftpClientWithMode
      const dirs = new Set(files.map(file => file.path.replace(/\/[^/]*$/, '')))
      for (const dir of dirs) {
        await client.mkdir(toControllerPath(dir), true)
        await modeClient.chmod(toControllerPath(dir), 0o777).catch(() => undefined)
      }
      for (const file of files) {
        await this.writeTextWithClient(client, file.path, file.content)
        await modeClient.chmod(toControllerPath(file.path), file.mode ?? 0o777).catch(() => undefined)
      }
    })
  }

  async deleteFile(remotePath: string): Promise<void> {
    await this.withClient(async client => {
      await client.delete(toControllerPath(remotePath))
    })
  }

  async deleteDir(remotePath: string): Promise<void> {
    await this.withClient(async client => {
      await client.rmdir(toControllerPath(remotePath), true)
    })
  }

  async rename(oldRemotePath: string, newRemotePath: string): Promise<void> {
    await this.withClient(async client => {
      const modeClient = client as SftpClientWithMode
      await modeClient.rename(toControllerPath(oldRemotePath), toControllerPath(newRemotePath))
      await modeClient.chmod(toControllerPath(newRemotePath), 0o777).catch(() => undefined)
    })
  }

  private async withClient<T>(fn: (client: SftpClient) => Promise<T>): Promise<T> {
    const client = new SftpClient('docat-device-sftp', {
      error: () => undefined,
      end: () => undefined,
      close: () => undefined,
    })

    try {
      await client.connect({
        host: this.host,
        port: this.port,
        username: this.username,
        password: this.password,
        readyTimeout: this.readyTimeout,
      })
      return await fn(client)
    } finally {
      await client.end().catch(() => undefined)
    }
  }

  private async readTextWithClient(client: SftpClient, remotePath: string): Promise<string> {
    const data = await client.get(toControllerPath(remotePath))
    if (Buffer.isBuffer(data)) return data.toString('utf8')
    if (typeof data === 'string') return data
    const chunks: Buffer[] = []
    for await (const chunk of data) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
    }
    return Buffer.concat(chunks).toString('utf8')
  }

  private async writeTextWithClient(client: SftpClient, remotePath: string, content: string): Promise<void> {
    await client.put(Buffer.from(content, 'utf8'), toControllerPath(remotePath))
  }
}

function joinRemotePath(base: string, name: string): string {
  return `${base.replace(/\/+$/, '')}/${name.replace(/^\/+/, '')}`
}

function toControllerPath(path: string): string {
  if (path.startsWith('/root')) return `/${path.replace(/^\/root\/?/, '')}`

  const developOnly = /^\/developOnly\/(.+)$/.exec(path)
  if (developOnly) return `/dobot/userdata/project/${developOnly[1]}`

  return path
}
