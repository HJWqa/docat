/**
 * StubDriver — 最小可用设备驱动实现
 * 后续由 DeviceFactory 创建 CRDriver/NovaDriver/MG6Driver 替换
 */
import { DeviceDriver, type DeviceTypeName } from './DeviceDriver.js'
import { HttpTransport } from './transport/HttpTransport.js'
import type {
  CartesianPose, JointPose, DeviceState, DeviceStatus,
  FirmwareVersion, JogParams, MoveParams,
} from 'docat-shared/types'

export class StubDriver extends DeviceDriver {
  readonly id: string
  readonly type: DeviceTypeName = 'CR'
  readonly ip: string
  readonly deviceTypeName: string

  status: DeviceStatus = {
    connected: false,
    running: false,
    paused: false,
    emergencyStopped: false,
    error: false,
    mode: 'manual',
  }

  state: DeviceState = {
    pose: { x: 0, y: 0, z: 0, r: 0 },
    joints: { j1: 0, j2: 0, j3: 0, j4: 0, j5: 0, j6: 0 },
    io: {},
    alarm: [],
    status: this.status,
    timestamp: Date.now(),
  }

  private http: HttpTransport

  constructor(id: string, ip: string, deviceTypeName: string) {
    super()
    this.id = id
    this.ip = ip
    this.deviceTypeName = deviceTypeName
    this.http = new HttpTransport(ip, 22000)
  }

  async connect(): Promise<void> {
    this.status.connected = true
    this.state.timestamp = Date.now()
  }

  async disconnect(): Promise<void> {
    this.status.connected = false
    this.state.timestamp = Date.now()
  }

  async powerOn(): Promise<void> {
    // StubDriver: 通用上电
    try {
      await this.http.send({
        method: 'post',
        url: '/interface/powerControl',
        portName: this.ip,
        params: { value: true },
        timeout: 180000,
      })
    } catch { /* 非关键 */ }
  }

  async powerOff(): Promise<void> {
    try {
      await this.http.send({
        method: 'post',
        url: '/interface/powerControl',
        portName: this.ip,
        params: { value: false },
        timeout: 180000,
      })
    } catch { /* 非关键 */ }
  }

  async enable(): Promise<void> {
    const reply = await this.http.send({
      method: 'post',
      url: '/settings/controlMode',
      portName: this.ip,
      params: { controlMode: 'enable' },
      timeout: 30000,
    })
    if (!reply.status) throw new Error(`Enable failed: ${reply.message}`)
  }

  async disable(): Promise<void> {
    await this.http.send({
      method: 'post',
      url: '/settings/controlMode',
      portName: this.ip,
      params: { controlMode: 'disable' },
      timeout: 30000,
    })
  }

  async getAlarms(): Promise<Array<{ id: number; level: number; description: string; solution: string; date: string; time: string }>> {
    const reply = await this.http.send({ method: 'get', url: '/protocol/getAlarm', portName: this.ip, timeout: 5000 })
    if (reply.status && reply.data) {
      const data = reply.data as { errMsg?: Array<Record<string, unknown>> }
      return (data.errMsg || []).map((a: Record<string, unknown>) => ({
        id: a.id as number, level: a.level as number,
        description: (a.description as string) || '', solution: (a.solution as string) || '',
        date: (a.date as string) || '', time: (a.time as string) || '',
      }))
    }
    return []
  }

  async getWarnings(): Promise<Array<{ id: number; level: number; description: string; solution: string; date: string; time: string }>> {
    const reply = await this.http.send({ method: 'get', url: '/protocol/getWarning', portName: this.ip, timeout: 5000 })
    if (reply.status && reply.data) {
      const data = reply.data as { warnMsg?: Array<Record<string, unknown>> }
      return (data.warnMsg || []).map((a: Record<string, unknown>) => ({
        id: a.id as number, level: a.level as number,
        description: (a.description as string) || '', solution: (a.solution as string) || '',
        date: (a.date as string) || '', time: (a.time as string) || '',
      }))
    }
    return []
  }

  async clearAlarm(): Promise<void> {
    await this.http.send({
      method: 'post',
      url: '/interface/clearAlarms',
      portName: this.ip,
      timeout: 10000,
    })
  }

  async resetCollision(): Promise<void> {
    await this.http.send({
      method: 'post',
      url: '/interface/resetCollision',
      portName: this.ip,
      params: {},
      timeout: 10000,
    })
  }

  async setJogMode(_mode: 'jog' | 'step'): Promise<void> {
    // TODO: POST /interface/jogMode
  }

  async setTeachInch(_distance: number): Promise<void> {
    // TODO: POST + GET /settings/teach/inch
  }

  async jog(_params: JogParams): Promise<void> {
    // TODO: POST /motion/jog
  }

  async moveTo(_pose: MoveParams): Promise<void> {
    // TODO: POST /motion/move
  }

  async moveJoints(_joints: number[]): Promise<void> {
    // TODO: POST /interface/movJ
  }

  async moveJointsCommand(_joints: number[], _value: boolean): Promise<Record<string, unknown>> {
    return { status: true }
  }

  async home(): Promise<void> {
    // TODO: POST /motion/home
  }

  async stop(): Promise<void> {
    // TODO: POST /motion/stop
  }

  async emergencyStop(): Promise<void> {
    this.status.emergencyStopped = true
    // TODO: POST /motion/emergencyStop
  }

  async getPose(): Promise<CartesianPose> {
    return this.state.pose
  }

  async getJoints(): Promise<JointPose> {
    return this.state.joints
  }

  async getStatus(): Promise<DeviceStatus> {
    return { ...this.status }
  }

  async getVersion(): Promise<FirmwareVersion> {
    try {
      const reply = await this.http.send({
        method: 'get',
        url: '/settings/version',
        portName: this.ip,
      })
      if (reply.status && reply.data) {
        return reply.data as FirmwareVersion
      }
    } catch { /* ignore */ }
    return { controller: 'unknown', servo: 'unknown', version: '0.0.0', controllerTypeExt: '' }
  }

  async pollState(): Promise<DeviceState> {
    try {
      const reply = await this.http.send({
        method: 'get',
        url: '/protocol/exchange',
        portName: this.ip,
        needBaseUrl: true,
        timeout: 1000,
      })
      if (reply.status && reply.data) {
        const raw = reply.data as Record<string, unknown>
        this.state = {
          pose: (raw.pose as CartesianPose) || this.state.pose,
          joints: (raw.joints as JointPose) || this.state.joints,
          io: (raw.io as DeviceState['io']) || this.state.io,
          alarm: (raw.alarm as DeviceState['alarm']) || this.state.alarm,
          status: { ...this.status },
          timestamp: Date.now(),
        }
      }
    } catch {
      // 设备离线，标记断开
      this.status.connected = false
    }
    this.state.timestamp = Date.now()
    return { ...this.state }
  }

  async runScript(_script: string): Promise<void> {
    // TODO
  }

  async stopScript(): Promise<void> {
    // TODO
  }

  async uploadScript(_name: string, _content: string): Promise<void> {
    // TODO: SFTP upload
  }

  async listProjects(): Promise<string[]> {
    return []
  }

  async runProject(_name: string): Promise<void> {
    // TODO
  }

  async deleteProject(_name: string): Promise<void> {
    // TODO
  }
}
