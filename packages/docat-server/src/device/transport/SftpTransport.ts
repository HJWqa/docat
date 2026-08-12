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

// ─── 连接池 ──────────────────────────────────────
// 每次 SFTP 操作都重新建连（SSH 握手+认证）在控制器弱 CPU 上开销很大，
// 列表扫描等场景会产生 2N+1 次握手。改为每设备小池+常驻复用：
// 操作成功归还，失败销毁并移除（下次操作自动重连），池满则排队等待空位。

/** 每个设备（host）的连接池大小 */
const POOL_SIZE = 2

/** 握手超时（弱 CPU 控制器 DH 密钥交换在负载下可能超过 5s） */
const DEFAULT_READY_TIMEOUT_MS = 15000

/** 建立连接的最大尝试次数（握手超时等瞬时故障可重试） */
const CONNECT_RETRY_ATTEMPTS = 3
const CONNECT_RETRY_BACKOFF_MS = 800

/** 操作因连接层错误失败时的整体重试次数（换新连接再跑一次） */
const OPERATION_RETRY_ATTEMPTS = 2

interface PooledConnection {
  client: SftpClient
  inUse: boolean
  dead: boolean
}

const connectionPools = new Map<string, PooledConnection[]>()
const poolWaiters = new Map<string, Array<() => void>>()

function poolKey(host: string, port: number, username: string): string {
  return `${username}@${host}:${port}`
}

function notifyPoolWaiters(key: string): void {
  const list = poolWaiters.get(key)
  if (list && list.length) {
    const waiter = list.shift()
    if (waiter) waiter()
    if (!list.length) poolWaiters.delete(key)
  }
}

/** 淘汰连接：标记失效、移出池并关闭，同时唤醒等待者 */
function evictPooled(key: string, entry: PooledConnection): void {
  if (entry.dead) return
  entry.dead = true
  const pool = connectionPools.get(key)
  if (pool) {
    const idx = pool.indexOf(entry)
    if (idx >= 0) pool.splice(idx, 1)
  }
  entry.client.end().catch(() => undefined)
  notifyPoolWaiters(key)
}

function releasePooled(key: string, entry: PooledConnection): void {
  entry.inUse = false
  notifyPoolWaiters(key)
}

async function checkoutPooledClient(
  key: string,
  create: () => Promise<SftpClient>
): Promise<PooledConnection> {
  for (;;) {
    let pool = connectionPools.get(key)
    if (!pool) {
      pool = []
      connectionPools.set(key, pool)
    }
    const free = pool.find(entry => !entry.inUse && !entry.dead)
    if (free) {
      free.inUse = true
      return free
    }
    if (pool.length < POOL_SIZE) {
      const entry: PooledConnection = { client: await create(), inUse: true, dead: false }
      entry.client.on('close', () => evictPooled(key, entry))
      entry.client.on('error', () => evictPooled(key, entry))
      pool.push(entry)
      return entry
    }
    await new Promise<void>(resolve => {
      const list = poolWaiters.get(key) ?? []
      list.push(resolve)
      poolWaiters.set(key, list)
    })
  }
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
    this.readyTimeout = options.readyTimeout ?? DEFAULT_READY_TIMEOUT_MS
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

  /** 批量读取文本（单连接往返）；单个文件读取失败时记为空串，不拖垮整体 */
  async readTextsLoose(remotePaths: string[]): Promise<Map<string, string>> {
    return this.withClient(async client => {
      const files = new Map<string, string>()
      for (const remotePath of remotePaths) {
        try {
          files.set(remotePath, await this.readTextWithClient(client, remotePath))
        } catch (err) {
          // 连接层故障交给 withClient 换连接重试，避免整批文件被记为空串
          if (isConnectionError(err)) throw err
          files.set(remotePath, '')
        }
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
    const key = poolKey(this.host, this.port, this.username)
    for (let attempt = 0; attempt < OPERATION_RETRY_ATTEMPTS; attempt++) {
      const entry = await checkoutPooledClient(key, () => this.createClientWithRetry())
      try {
        const result = await fn(entry.client)
        releasePooled(key, entry)
        return result
      } catch (err) {
        if (isConnectionError(err)) {
          // 连接层故障（握手超时/被服务端静默回收）：淘汰旧连接，换新连接重试一次
          evictPooled(key, entry)
          releasePooled(key, entry)
          if (attempt < OPERATION_RETRY_ATTEMPTS - 1) continue
        } else {
          releasePooled(key, entry)
        }
        throw err
      }
    }
    throw new Error('unreachable: withClient retry exhausted')
  }

  private async createClientWithRetry(): Promise<SftpClient> {
    let lastErr: unknown
    for (let attempt = 0; attempt < CONNECT_RETRY_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(CONNECT_RETRY_BACKOFF_MS * attempt)
      try {
        return await this.createClient()
      } catch (err) {
        lastErr = err
      }
    }
    throw lastErr
  }

  private async createClient(): Promise<SftpClient> {
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
      return client
    } catch (err) {
      await client.end().catch(() => undefined)
      throw err
    }
  }

  private async readTextWithClient(client: SftpClient, remotePath: string): Promise<string> {
    const data = await client.get(toControllerPath(remotePath))
    if (Buffer.isBuffer(data)) return data.toString('utf8')
    if (typeof data === 'string') return data
    // ssh2-sftp-client 空文件经 concat-stream 返回空数组 []，等价于空串
    if (Array.isArray(data) && data.length === 0) return ''
    throw new Error(`unexpected return type from sftp.get: ${typeof data}`)
  }

  private async writeTextWithClient(client: SftpClient, remotePath: string, content: string): Promise<void> {
    await client.put(Buffer.from(content, 'utf8'), toControllerPath(remotePath))
  }
}

function joinRemotePath(base: string, name: string): string {
  return `${base.replace(/\/+$/, '')}/${name.replace(/^\/+/, '')}`
}

/**
 * 判断是否为连接层错误：
 * ssh2-sftp-client 的 SFTP 协议错误（文件不存在等）带数字状态码，
 * 连接层错误（握手超时、socket 断开、连接被服务端回收）无数字状态码。
 */
function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return typeof (err as NodeJS.ErrnoException).code !== 'number'
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function toControllerPath(path: string): string {
  if (path.startsWith('/root')) return `/${path.replace(/^\/root\/?/, '')}`

  const developOnly = /^\/developOnly\/(.+)$/.exec(path)
  if (developOnly) return `/dobot/userdata/project/${developOnly[1]}`

  return path
}
