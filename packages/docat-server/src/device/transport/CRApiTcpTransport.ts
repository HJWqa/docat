/**
 * CR系列 API TCP 传输层 — 对接 Dobot TCP/IP 协议
 * 端口 29999: Dashboard 命令 (文本协议)
 * 端口 30004: 实时反馈 (二进制协议)
 * @see /home/bzsc/TCP-IP-Python-V4/dobot_api.py
 */
import * as net from 'node:net'
import { EventEmitter } from 'node:events'

const FEEDBACK_STRUCT_SIZE = 1440 // MyType 结构体大小

export interface CRFeedBackData {
  robotMode: number
  DigitalInputs: number
  DigitalOutputs: number
  SpeedScaling: number
  ProgramState: number
  QActual: number[]       // 实际关节位置 [6]
  QTarget: number[]        // 目标关节位置 [6]
  ToolVectorActual: number[] // 实际工具位姿 [6]
  TCPSpeedActual: number[]  // TCP 速度 [6]
  TCPForce: number[]        // TCP 力 [6]
  MotorTemperatures: number[] // 电机温度 [6]
  VActual: number[]         // 实际电压 [6]
  Load: number
  CenterX: number
  CenterY: number
  CenterZ: number
  EnableStatus: number
  DragStatus: number
  RunningStatus: number
  ErrorStatus: number
  BrakeStatus: number
  CollisionState: number
  AutoManualMode: number
}

export interface CRApiTcpEvents {
  'dashboard-connected': []
  'dashboard-disconnected': []
  'feed-connected': []
  'feed-disconnected': []
  'feedback': [CRFeedBackData]
  'error': [{ port: number; error: Error }]
}

export class CRApiTcpTransport extends EventEmitter {
  private ip: string
  private dashboardSocket: net.Socket | null = null
  private feedSocket: net.Socket | null = null
  private feedBuffer = Buffer.alloc(0)
  private dashboardBuf = ''
  private _autoReconnect = false

  // Dashboard 回复回调队列
  private replyResolve: ((value: string) => void) | null = null

  constructor(ip: string) {
    super()
    this.ip = ip
  }

  get autoReconnect(): boolean { return this._autoReconnect }
  set autoReconnect(v: boolean) { this._autoReconnect = v }

  /** 连接 Dashboard 端口 (29999) */
  connectDashboard(): void {
    if (this.dashboardSocket) return
    const sock = new net.Socket()
    this.dashboardSocket = sock
    sock.connect(29999, this.ip)

    sock.on('connect', () => {
      console.log(`[CR-TCP] Dashboard connected ${this.ip}:29999`)
      this.emit('dashboard-connected')
    })

    sock.on('data', (data: Buffer) => {
      this.dashboardBuf += data.toString('utf-8')
      // 检查是否有等待回复的 Promise
      if (this.replyResolve) {
        const resolve = this.replyResolve
        this.replyResolve = null
        const reply = this.dashboardBuf
        this.dashboardBuf = ''
        resolve(reply)
      }
    })

    sock.on('error', (err: Error) => {
      console.error(`[CR-TCP] Dashboard error ${this.ip}:29999:`, err.message)
      this.emit('error', { port: 29999, error: err })
    })

    sock.on('close', () => {
      console.log(`[CR-TCP] Dashboard disconnected ${this.ip}:29999`)
      this.dashboardSocket = null
      this.emit('dashboard-disconnected')
      if (this._autoReconnect) setTimeout(() => this.connectDashboard(), 5000)
    })
  }

  /** 连接反馈端口 (30004) */
  connectFeed(): void {
    if (this.feedSocket) return
    const sock = new net.Socket()
    this.feedSocket = sock
    sock.connect(30004, this.ip)
    sock.setKeepAlive(true)

    sock.on('connect', () => {
      console.log(`[CR-TCP] Feedback connected ${this.ip}:30004`)
      this.emit('feed-connected')
    })

    sock.on('data', (data: Buffer) => {
      this.feedBuffer = Buffer.concat([this.feedBuffer, data])
      this.parseFeedBuffer()
    })

    sock.on('error', (err: Error) => {
      console.error(`[CR-TCP] Feedback error ${this.ip}:30004:`, err.message)
      this.emit('error', { port: 30004, error: err })
    })

    sock.on('close', () => {
      console.log(`[CR-TCP] Feedback disconnected ${this.ip}:30004`)
      this.feedSocket = null
      this.feedBuffer = Buffer.alloc(0)
      if (this._autoReconnect) setTimeout(() => this.connectFeed(), 5000)
    })
  }

  /** 发送 Dashboard 命令并等待回复 */
  async sendDashboard(cmd: string): Promise<string> {
    if (!this.dashboardSocket || this.dashboardSocket.destroyed) {
      throw new Error('Dashboard not connected')
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.replyResolve = null
        reject(new Error('Dashboard command timeout (5s)'))
      }, 5000)

      this.replyResolve = (reply: string) => {
        clearTimeout(timeout)
        resolve(reply)
      }

      this.dashboardSocket!.write(cmd + '\n', (err) => {
        if (err) {
          clearTimeout(timeout)
          this.replyResolve = null
          reject(err)
        }
      })
    })
  }

  /** 解析二进制反馈数据 */
  private parseFeedBuffer(): void {
    while (this.feedBuffer.length >= FEEDBACK_STRUCT_SIZE) {
      const chunk = this.feedBuffer.subarray(0, FEEDBACK_STRUCT_SIZE)
      this.feedBuffer = this.feedBuffer.subarray(FEEDBACK_STRUCT_SIZE)

      try {
        const offset = 0
        const readUInt16 = (o: number) => chunk.readUInt16LE(o)
        const readUInt64 = (o: number) => Number(chunk.readBigUInt64LE(o))
        const readBigUInt64 = (o: number) => chunk.readBigUInt64LE(o)
        const readFloat64 = (o: number) => chunk.readDoubleLE(o)
        const readFloat64Arr = (o: number, n: number) => {
          const arr: number[] = []
          for (let i = 0; i < n; i++) arr.push(chunk.readDoubleLE(o + i * 8))
          return arr
        }

        const testValue = readBigUInt64(offset + 32)
        // 检查魔术数 0x123456789abcdef
        if (testValue !== 0x123456789abcdefn) {
          console.warn('[CR-TCP] Invalid feedback magic')
          continue
        }

        const data: CRFeedBackData = {
          robotMode: readUInt64(offset + 24),
          DigitalInputs: readUInt64(offset + 8),
          DigitalOutputs: readUInt64(offset + 16),
          SpeedScaling: readFloat64(offset + 56),
          ProgramState: readFloat64(offset + 96),
          QActual: readFloat64Arr(offset + 280, 6),
          QTarget: readFloat64Arr(offset + 232, 6),
          ToolVectorActual: readFloat64Arr(offset + 376, 6),
          TCPSpeedActual: readFloat64Arr(offset + 424, 6),
          TCPForce: readFloat64Arr(offset + 472, 6),
          MotorTemperatures: readFloat64Arr(offset + 520, 6),
          VActual: readFloat64Arr(offset + 640, 6),
          Load: readFloat64(offset + 864),
          CenterX: readFloat64(offset + 872),
          CenterY: readFloat64(offset + 880),
          CenterZ: readFloat64(offset + 888),
          EnableStatus: chunk.readUInt8(offset + 700),
          DragStatus: chunk.readUInt8(offset + 702),
          RunningStatus: chunk.readUInt8(offset + 703),
          ErrorStatus: chunk.readUInt8(offset + 704),
          BrakeStatus: chunk.readUInt8(offset + 697),
          CollisionState: chunk.readUInt8(offset + 725),
          AutoManualMode: readUInt16(offset + 1152),
        }

        this.emit('feedback', data)
      } catch (err) {
        console.error('[CR-TCP] Feedback parse error:', err)
      }
    }
  }

  /** 断开所有连接 */
  disconnect(): void {
    if (this.dashboardSocket) {
      this.dashboardSocket.destroy()
      this.dashboardSocket = null
    }
    if (this.feedSocket) {
      this.feedSocket.destroy()
      this.feedSocket = null
    }
  }

  get isDashboardConnected(): boolean {
    return !!this.dashboardSocket && !this.dashboardSocket.destroyed
  }

  get isFeedConnected(): boolean {
    return !!this.feedSocket && !this.feedSocket.destroyed
  }
}
