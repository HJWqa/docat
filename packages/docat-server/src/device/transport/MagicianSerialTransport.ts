/**
 * Magician 串口传输层 — serialport (115200 8N1)
 *
 * 后台读线程按 Dobot 二进制帧（AA AA 帧头 + 校验和）解析，
 * 通过 onFrame(fid, ctrl, params) 回调分发。
 * 固件会回显指令帧（rw 位=1），只有响应帧（rw 位=0）才会回调。
 */
import { SerialPort } from 'serialport'
import { parseFrame } from '../protocol/magicianProtocol.js'
import { MAGICIAN_MAX_FRAME } from '../protocol/magicianProtocol.js'

export const MAGICIAN_SERIAL_BAUD = 115200

export type MagicianOnFrame = (fid: number, ctrl: number, params: Buffer) => void

export class MagicianSerialTransport {
  private port: SerialPort | null = null
  private recv: Buffer = Buffer.alloc(0)
  private alive = false

  constructor(
    private readonly path: string,
    private readonly baudRate: number,
    private readonly onFrame: MagicianOnFrame,
    private readonly onError: (message: string) => void,
  ) {}

  open(timeoutMs = 10000): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.port?.isOpen) {
        resolve()
        return
      }
      let settled = false
      const settleError = (message: string) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        reject(new Error(`打开串口 ${this.path} 失败: ${message}`))
      }
      const timer = setTimeout(() => settleError('超时（端口无响应或被占用）'), timeoutMs)
      const port = new SerialPort(
        { path: this.path, baudRate: this.baudRate, autoOpen: false },
        (err) => {
          if (err) settleError(err.message)
        }
      )
      port.on('open', () => {
        if (settled) {
          port.close()
          return
        }
        settled = true
        clearTimeout(timer)
        this.port = port
        this.alive = true
        resolve()
      })
      port.on('data', (chunk: Buffer) => this.feed(chunk))
      port.on('error', (err) => {
        this.onError(err.message)
        this.alive = false
        // open 阶段错误（如权限/被占用）也必须结束等待，否则连接请求挂死
        if (!this.port) settleError(err.message)
      })
      port.on('close', () => {
        this.alive = false
      })
      port.open()
    })
  }

  /** 帧缓冲解析；回显帧（rw 位=1）跳过，只回调响应帧 */
  private feed(data: Buffer): void {
    if (!data.length) return
    this.recv = this.recv.length ? Buffer.concat([this.recv, data]) : data
    while (this.recv.length >= 6) {
      if (this.recv[0] !== 0xaa || this.recv[1] !== 0xaa) {
        this.recv = this.recv.subarray(1) // 等待帧头
        continue
      }
      const length = this.recv[2]
      if (length < 2 || length > MAGICIAN_MAX_FRAME) {
        this.recv = this.recv.subarray(1) // 非法长度，重新同步
        continue
      }
      const total = 4 + length
      if (this.recv.length < total) break // 数据不完整，等待更多
      let parsed
      try {
        parsed = parseFrame(this.recv)
      } catch {
        this.recv = this.recv.subarray(1) // 校验失败，重新同步
        continue
      }
      if (!parsed) break
      this.recv = this.recv.subarray(parsed.total)
      const { fid, ctrl, params } = parsed.frame
      // rw 位=0 才是响应帧；固件回显（rw=1）忽略
      if ((ctrl & 0x01) === 0) {
        try {
          this.onFrame(fid, ctrl, params)
        } catch {
          // 回调异常不能杀死读流程
        }
      }
    }
  }

  send(frame: Buffer): void {
    if (!this.port?.isOpen) return
    try {
      this.port.write(frame)
    } catch (err) {
      this.onError((err as Error).message)
    }
  }

  close(): void {
    this.alive = false
    const port = this.port
    this.port = null
    if (port?.isOpen) {
      try {
        port.close()
      } catch {
        // ignore
      }
    }
  }

  get isOpen(): boolean {
    return !!this.port?.isOpen
  }
}

/** 枚举可用串口（ttyUSB/ttyACM/ttyS/ttyAMA/ttyTHS/ttyXRUSB/ttySC/cu.*） */
export async function listSerialPorts(): Promise<string[]> {
  try {
    const ports = await SerialPort.list()
    return ports
      .map((p) => p.path)
      .filter((p) => /(ttyUSB|ttyACM|ttyS\d|ttyAMA|ttyTHS|ttyXRUSB|ttySC|cu\.)/.test(p))
  } catch {
    return []
  }
}
