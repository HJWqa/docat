/**
 * 串口编排设备 — serialport
 * 按行解析（readline 风格，本地实现兼容 \r\n）；send 写入并追加换行
 */
import { SerialPort } from 'serialport'
import type { OrchDeviceBackend } from './DeviceBackend.js'

export interface SerialEvents {
  onIncoming: (text: string) => void
  onError: (message: string) => void
  onClientChange: (connected: boolean) => void
}

export class SerialDevice implements OrchDeviceBackend {
  readonly id: string
  private path: string
  private baudRate: number
  private events: SerialEvents
  private port: SerialPort | null = null

  constructor(id: string, path: string, baudRate: number, events: SerialEvents) {
    this.id = id
    this.path = path
    this.baudRate = baudRate
    this.events = events
  }

  connect(): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      if (this.port?.isOpen) return resolve({ ok: true })
      const port = new SerialPort(
        { path: this.path, baudRate: this.baudRate, autoOpen: false },
        (err) => {
          if (err) resolve({ ok: false, error: err.message })
        }
      )
      let buffer = ''
      port.on('open', () => {
        this.port = port
        this.events.onClientChange(true)
        resolve({ ok: true })
      })
      port.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf-8')
        let idx: number
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx).replace(/\r$/, '')
          buffer = buffer.slice(idx + 1)
          if (line.trim() !== '') this.events.onIncoming(line)
        }
      })
      port.on('error', (err) => this.events.onError(err.message))
      port.on('close', () => {
        if (this.port === port) {
          this.port = null
          this.events.onClientChange(false)
        }
      })
      port.open((err) => {
        if (err && !this.port) resolve({ ok: false, error: err.message })
      })
    })
  }

  async disconnect(): Promise<void> {
    if (this.port?.isOpen) {
      this.port.close()
    }
    this.port = null
  }

  async send(text: string): Promise<boolean> {
    if (!this.port?.isOpen) return false
    return new Promise((resolve) => {
      this.port!.write(`${text}\n`, (err) => resolve(!err))
    })
  }

  dispose(): void {
    if (this.port?.isOpen) {
      try {
        this.port.close()
      } catch {
        // ignore
      }
    }
    this.port = null
  }
}
