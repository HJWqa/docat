/**
 * UDP 编排设备 — 绑定本地端口收发数据报
 * 入站按行解析（数据报内可能含多行，逐行分发）；send 发往最后来源地址
 */
import { createSocket, type Socket, type RemoteInfo } from 'node:dgram'
import type { OrchDeviceBackend } from './DeviceBackend.js'

export interface UdpEvents {
  onIncoming: (text: string) => void
  onError: (message: string) => void
}

export class UdpDevice implements OrchDeviceBackend {
  readonly id: string
  private host: string
  private port: number
  private events: UdpEvents
  private socket: Socket | null = null
  private peer: RemoteInfo | null = null

  constructor(id: string, host: string, port: number, events: UdpEvents) {
    this.id = id
    this.host = host
    this.port = port
    this.events = events
  }

  connect(): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      if (this.socket) return resolve({ ok: true })
      const socket = createSocket('udp4')
      socket.on('message', (msg, rinfo) => {
        this.peer = rinfo
        const text = msg.toString('utf-8')
        for (const line of text.split('\n')) {
          if (line.trim() !== '') this.events.onIncoming(line.replace(/\r$/, ''))
        }
      })
      socket.on('error', (err) => this.events.onError(err.message))
      socket.bind(this.port, this.host === '' ? '0.0.0.0' : this.host, () => {
        this.socket = socket
        resolve({ ok: true })
      })
    })
  }

  async disconnect(): Promise<void> {
    this.socket?.close()
    this.socket = null
  }

  async send(text: string): Promise<boolean> {
    if (!this.socket) return false
    if (this.peer) {
      this.socket.send(text, this.peer.port, this.peer.address)
      return true
    }
    // 无来源时发往配置的 ip:port（模拟模式下便于回环测试）
    if (this.host && this.port) {
      this.socket.send(text, this.port, this.host)
      return true
    }
    return false
  }

  dispose(): void {
    try {
      this.socket?.close()
    } catch {
      // ignore
    }
    this.socket = null
  }
}
