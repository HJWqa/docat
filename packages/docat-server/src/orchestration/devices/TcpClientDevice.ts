/**
 * TCP Client 编排设备 — 连接远程 ip:port
 * 入站数据按行解析；断线由 manager 处理（autoReconnect）
 */
import { connect, type Socket } from 'node:net'
import type { OrchDeviceBackend } from './DeviceBackend.js'

export interface TcpClientEvents {
  onIncoming: (text: string) => void
  onError: (message: string) => void
  onClientChange: (connected: boolean) => void
}

export class TcpClientDevice implements OrchDeviceBackend {
  readonly id: string
  private host: string
  private port: number
  private events: TcpClientEvents
  private socket: Socket | null = null

  constructor(id: string, host: string, port: number, events: TcpClientEvents) {
    this.id = id
    this.host = host
    this.port = port
    this.events = events
  }

  connect(): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      if (this.socket) return resolve({ ok: true })
      const socket = connect({ host: this.host, port: this.port })
      let settled = false
      socket.setEncoding('utf-8')
      let buffer = ''
      socket.on('connect', () => {
        settled = true
        this.socket = socket
        this.events.onClientChange(true)
        resolve({ ok: true })
      })
      socket.on('data', (chunk: Buffer | string) => {
        buffer += String(chunk)
        let idx: number
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx).replace(/\r$/, '')
          buffer = buffer.slice(idx + 1)
          if (line.trim() !== '') this.events.onIncoming(line)
        }
      })
      socket.on('error', (err) => {
        this.events.onError(err.message)
        if (!settled) {
          settled = true
          resolve({ ok: false, error: err.message })
        }
      })
      socket.on('close', () => {
        if (this.socket === socket) {
          this.socket = null
          this.events.onClientChange(false)
        }
      })
    })
  }

  async disconnect(): Promise<void> {
    this.socket?.destroy()
    this.socket = null
  }

  async send(text: string): Promise<boolean> {
    if (!this.socket) return false
    this.socket.write(`${text}\n`)
    return true
  }

  dispose(): void {
    this.socket?.destroy()
    this.socket = null
  }
}
