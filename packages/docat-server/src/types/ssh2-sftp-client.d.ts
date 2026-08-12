declare module 'ssh2-sftp-client' {
  export interface SftpClientEntry {
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

  export interface SftpClientConnectOptions {
    host: string
    port: number
    username: string
    password: string
    readyTimeout?: number
  }

  export default class SftpClient {
    constructor(name?: string, config?: unknown)
    connect(options: SftpClientConnectOptions): Promise<unknown>
    list(path: string): Promise<SftpClientEntry[]>
    get(path: string): Promise<Buffer | string | NodeJS.ReadableStream>
    put(input: Buffer | string | NodeJS.ReadableStream, path: string): Promise<unknown>
    mkdir(path: string, recursive?: boolean): Promise<unknown>
    rmdir(path: string, recursive?: boolean): Promise<unknown>
    delete(path: string): Promise<unknown>
    chmod(path: string, mode: number): Promise<unknown>
    rename(from: string, to: string): Promise<unknown>
    end(): Promise<unknown>
    /** 监听连接事件（close/error 等，运行时为 EventEmitter） */
    on(event: string, listener: (...args: unknown[]) => void): unknown
  }
}
