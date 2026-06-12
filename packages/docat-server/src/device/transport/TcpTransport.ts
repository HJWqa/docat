/**
 * TCP 传输层 — 封装与设备 TCP 端口的实时通信
 * 从 OpenDobot46 tcp/client.ts 提取，去单例化
 * @see OpenDobot46/src.dobotlink/tcp/client.ts
 */
import { EventEmitter } from 'node:events'
import * as net from 'node:net'

export interface TcpClientEvents {
  connected: []
  disconnected: []
  error: [Error]
  notify: [string]
}

export class TcpClient extends EventEmitter {
  private host: string
  private port: number
  private socket: net.Socket | null = null
  private _isConnected = false
  private isManual = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(host: string, port: number) {
    super()
    this.host = host
    this.port = port
  }

  get isConnected(): boolean {
    return this._isConnected
  }

  connect(): void {
    if (this._isConnected) {
      this.emit('connected')
      return
    }

    const socket = new net.Socket({ readable: true, writable: true })
    this.isManual = false

    socket.connect(this.port, this.host)

    socket.on('connect', () => {
      console.log(`[TCP] Connected to ${this.host}:${this.port}`)
      this._isConnected = true
      socket.setKeepAlive(true)
      this.emit('connected')
    })

    socket.on('error', (err: Error) => {
      console.error(`[TCP] Error ${this.host}:${this.port}:`, err.message)
      this.emit('error', err)
    })

    socket.on('close', () => {
      console.log(`[TCP] Disconnected from ${this.host}:${this.port}`)
      this._isConnected = false
      this.emit('disconnected')

      // 自动重连（非手动断开时）
      if (!this.isManual) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null
          this.connect()
        }, 3000) // 3s 重连间隔，避免频繁重连
      }
    })

    socket.on('data', (data: Buffer) => {
      this.emit('notify', data.toString())
    })

    this.socket = socket
  }

  disconnect(): void {
    console.log(`[TCP] Manual disconnect ${this.host}:${this.port}`)
    this.isManual = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.socket?.destroy()
    this.socket = null
  }
}

/** 设备 TCP 端口管理器 — 管理 4 个 TCP 连接 */
export class TcpManager extends EventEmitter {
  private clients: Map<number, TcpClient> = new Map()
  private host: string

  static readonly PORTS = [65501, 65502, 65503, 65525] as const

  constructor(host: string) {
    super()
    this.host = host
  }

  /** 已连接的 TCP 端口数 */
  get connectedCount(): number {
    let count = 0
    for (const client of this.clients.values()) {
      if (client.isConnected) count++
    }
    return count
  }

  /** 所有 TCP 端口都已连接 */
  get isAllConnected(): boolean {
    if (this.clients.size === 0) return false
    for (const client of this.clients.values()) {
      if (!client.isConnected) return false
    }
    return true
  }

  /** 所有 TCP 端口都已断开 */
  get isAllDisconnected(): boolean {
    if (this.clients.size === 0) return true
    for (const client of this.clients.values()) {
      if (client.isConnected) return false
    }
    return true
  }

  /** 创建并连接所有 TCP 客户端 */
  connectAll(): void {
    for (const port of TcpManager.PORTS) {
      const client = new TcpClient(this.host, port)
      this.clients.set(port, client)

      client.on('notify', (data: string) => {
        // 透传给上层，标记来源端口
        this.emit('notify', { port, data })
      })

      client.on('error', (err: Error) => {
        this.emit('error', { port, error: err })
      })

      client.on('connected', () => {
        this.emit('client-connected', { port })
      })

      client.on('disconnected', () => {
        this.emit('client-disconnected', { port })
      })

      client.connect()
    }
  }

  /** 断开所有 TCP 连接 */
  disconnectAll(): void {
    for (const [port, client] of this.clients) {
      client.removeAllListeners()
      client.disconnect()
    }
    this.clients.clear()
  }

  /** 获取特定端口的 TCP 客户端 */
  getClient(port: number): TcpClient | undefined {
    return this.clients.get(port)
  }
}
