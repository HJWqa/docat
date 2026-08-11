/**
 * TCP Server 编排设备 — 监听 ip:port，接受一个客户端
 * 入站数据按行解析并交给 manager；manager.send 写入当前客户端
 */
import { createServer, type Server, type Socket } from 'node:net'
import type { OrchDeviceBackend } from './DeviceBackend.js'

export interface TcpServerEvents {
  onIncoming: (text: string) => void
  onError: (message: string) => void
  onClientChange: (connected: boolean) => void
}

export class TcpServerDevice implements OrchDeviceBackend {
  readonly id: string
  private host: string
  private port: number
  private events: TcpServerEvents
  private server: Server | null = null
  private client: Socket | null = null
  private listening = false
  /** 半行 flush：设备不回换行时（如应答 pong;），静默 120ms 后按整条处理 */
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  constructor(id: string, host: string, port: number, events: TcpServerEvents) {
    this.id = id
    this.host = host
    this.port = port
    this.events = events
  }

  connect(): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      if (this.listening) return resolve({ ok: true })
      const server = createServer((socket) => {
        if (this.client) {
          socket.destroy()
          return
        }
        this.client = socket
        this.events.onClientChange(true)
        socket.setEncoding('utf-8')
        let buffer = ''
        socket.on('data', (chunk: Buffer | string) => {
          buffer += String(chunk)
          let idx: number
          while ((idx = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, idx).replace(/\r$/, '')
            buffer = buffer.slice(idx + 1)
            if (line.trim() !== '') this.events.onIncoming(line)
          }
          if (buffer.trim() !== '') {
            if (this.flushTimer) clearTimeout(this.flushTimer)
            this.flushTimer = setTimeout(() => {
              this.flushTimer = null
              if (buffer.trim() !== '') {
                const rest = buffer
                buffer = ''
                this.events.onIncoming(rest)
              }
            }, 120)
          }
        })
        socket.on('close', () => {
          if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null }
          if (this.client === socket) {
            this.client = null
            this.events.onClientChange(false)
          }
        })
        socket.on('error', (err) => this.events.onError(err.message))
      })
      server.on('error', (err) => {
        this.listening = false
        resolve({ ok: false, error: err.message })
      })
      server.listen(this.port, this.host, () => {
        this.listening = true
        this.server = server
        resolve({ ok: true })
      })
    })
  }

  async disconnect(): Promise<void> {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null }
    this.client?.destroy()
    this.client = null
    if (this.server) {
      await new Promise<void>((resolve) => this.server?.close(() => resolve()))
      this.server = null
    }
    this.listening = false
  }

  async send(text: string): Promise<boolean> {
    if (!this.client) return false
    this.client.write(`${text}\n`)
    return true
  }

  dispose(): void {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null }
    this.client?.destroy()
    this.client = null
    try {
      this.server?.close()
    } catch {
      // ignore
    }
    this.server = null
    this.listening = false
  }
}
