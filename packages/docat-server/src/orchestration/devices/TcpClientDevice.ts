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
  /** 半行 flush：设备不回换行时（如应答 pong;），静默 120ms 后按整条处理 */
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  /** 连接超时（ms）：黑洞 IP 等场景避免无限挂起，超时按失败处理 */
  private readonly connectTimeoutMs: number

  constructor(id: string, host: string, port: number, events: TcpClientEvents, connectTimeoutMs = 5000) {
    this.id = id
    this.host = host
    this.port = port
    this.events = events
    this.connectTimeoutMs = connectTimeoutMs
  }

  connect(): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      if (this.socket) return resolve({ ok: true })
      const socket = connect({ host: this.host, port: this.port })
      let settled = false
      socket.setEncoding('utf-8')
      let buffer = ''
      const timeoutTimer = setTimeout(() => {
        if (settled) return
        settled = true
        socket.destroy()
        resolve({ ok: false, error: '连接超时' })
      }, this.connectTimeoutMs)
      socket.on('connect', () => {
        clearTimeout(timeoutTimer)
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
        // 缓冲剩余内容：无换行消息兜底
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
      socket.on('error', (err) => {
        clearTimeout(timeoutTimer)
        this.events.onError(err.message)
        if (!settled) {
          settled = true
          resolve({ ok: false, error: err.message })
        }
      })
      socket.on('close', () => {
        clearTimeout(timeoutTimer)
        if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null }
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
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null }
    this.socket?.destroy()
    this.socket = null
  }
}
