/**
 * StubDriver — 最小可用设备驱动实现
 * 后续由 DeviceFactory 创建 CRDriver/NovaDriver/MG6Driver 替换
 */
import {
  DeviceDriver,
  type LoadParams,
  type CustomPosture,
  type SystemTime,
  type UserList,
  type UserPermissionConfig,
  type CoordinateData,
  type DeviceTypeName,
} from './DeviceDriver.js'
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

  // ─── 模式切换 ──────────────────────────────────

  async setAutoManualSwitch(value: boolean): Promise<void> {
    const reply = await this.http.send({
      method: 'post', url: '/settings/function/autoManualSwitch', portName: this.ip,
      params: { value }, timeout: 10000,
    })
    if (!reply.status) throw new Error(`Set autoManualSwitch failed: ${reply.message}`)
  }

  async getAutoManualSwitch(): Promise<boolean> {
    const reply = await this.http.send({
      method: 'get', url: '/settings/function/autoManualSwitch', portName: this.ip, timeout: 5000,
    })
    if (reply.status && reply.data) return !!(reply.data as Record<string, unknown>).value
    return false
  }

  async setAutoManualMode(mode: 'auto' | 'manual'): Promise<void> {
    const reply = await this.http.send({
      method: 'post', url: '/settings/function/autoManual', portName: this.ip,
      params: { autoManual: mode }, timeout: 10000,
    })
    if (!reply.status) throw new Error(`Set auto/manual mode failed: ${reply.message}`)
  }

  async setRemoteSwitch(value: boolean): Promise<void> {
    const reply = await this.http.send({
      method: 'post', url: '/settings/function/remoteSwitch', portName: this.ip,
      params: { value }, timeout: 10000,
    })
    if (!reply.status) throw new Error(`Set remoteSwitch failed: ${reply.message}`)
  }

  async getRemoteSwitch(): Promise<boolean> {
    const reply = await this.http.send({
      method: 'get', url: '/settings/function/remoteSwitch', portName: this.ip, timeout: 5000,
    })
    if (reply.status && reply.data) return !!(reply.data as Record<string, unknown>).value
    return false
  }

  // ─── 负载参数 ──────────────────────────────────

  async getLoadParams(): Promise<LoadParams> {
    try {
      const reply = await this.http.send({
        method: 'get',
        url: '/settings/function/loadParams',
        portName: this.ip,
        timeout: 5000,
      })
      if (reply.status && reply.data) {
        const data = reply.data as Record<string, unknown>
        return {
          name: String(data.name ?? ''),
          centerX: Number(data.centerX ?? 0),
          centerY: Number(data.centerY ?? 0),
          centerZ: Number(data.centerZ ?? 0),
          loadValue: Number(data.loadValue ?? 0),
        }
      }
    } catch { /* ignore */ }
    return { name: '', centerX: 0, centerY: 0, centerZ: 0, loadValue: 0 }
  }

  async setLoadParams(params: LoadParams): Promise<void> {
    const reply = await this.http.send({
      method: 'post',
      url: '/settings/function/loadParams',
      portName: this.ip,
      params,
      timeout: 10000,
    })
    if (!reply.status) throw new Error(`Set loadParams failed: ${reply.message}`)
  }

  async getLoadConfig(): Promise<LoadParams[]> {
    try {
      const reply = await this.http.send({
        method: 'get',
        url: '/settings/function/loadConfig',
        portName: this.ip,
        timeout: 5000,
      })
      if (reply.status && Array.isArray(reply.data)) {
        return (reply.data as Array<Record<string, unknown>>).map(item => ({
          name: String(item.name ?? ''),
          centerX: Number(item.centerX ?? 0),
          centerY: Number(item.centerY ?? 0),
          centerZ: Number(item.centerZ ?? 0),
          loadValue: Number(item.loadValue ?? 0),
        }))
      }
    } catch { /* ignore */ }
    return []
  }

  async setLoadConfig(config: LoadParams[]): Promise<void> {
    const reply = await this.http.send({
      method: 'post',
      url: '/settings/function/loadConfig',
      portName: this.ip,
      params: config,
      timeout: 10000,
    })
    if (!reply.status) throw new Error(`Set loadConfig failed: ${reply.message}`)
  }

  // ─── 自定义姿态 ────────────────────────────────

  async getCustomPostures(): Promise<CustomPosture[]> {
    try {
      const reply = await this.http.send({ method: 'get', url: '/settings/function/customPose', portName: this.ip, timeout: 5000 })
      if (reply.status && Array.isArray(reply.data)) {
        return (reply.data as Array<Record<string, unknown>>).map(item => ({
          name: String(item.name ?? ''),
          joint: Array.isArray(item.joint) ? item.joint.map(Number) : [],
        }))
      }
    } catch { /* ignore */ }
    return []
  }

  async setCustomPostures(postures: CustomPosture[]): Promise<void> {
    const reply = await this.http.send({ method: 'post', url: '/settings/function/customPose', portName: this.ip, params: postures, timeout: 10000 })
    if (!reply.status) throw new Error(`Set customPose failed: ${reply.message}`)
  }

  // ─── 系统设置 ──────────────────────────────────

  async getSystemTime(): Promise<SystemTime> {
    try {
      const reply = await this.http.send({ method: 'get', url: '/settings/systemTime', portName: this.ip, timeout: 5000 })
      if (reply.status && reply.data) {
        const d = reply.data as Record<string, unknown>
        return { date: String(d.date ?? ''), time: String(d.time ?? ''), timeZone: String(d.timeZone ?? '') }
      }
    } catch { /* ignore */ }
    return {}
  }

  async setSystemTime(time: SystemTime): Promise<void> {
    const reply = await this.http.send({ method: 'post', url: '/settings/systemTime', portName: this.ip, params: time, timeout: 10000 })
    if (!reply.status) throw new Error(`Set systemTime failed: ${reply.message}`)
  }

  async setDeviceAlias(alias: string): Promise<void> {
    const reply = await this.http.send({ method: 'post', url: '/settings/function/robotAlias', portName: this.ip, params: { alias }, timeout: 10000 })
    if (!reply.status) throw new Error(`Set robotAlias failed: ${reply.message}`)
  }

  // ─── 用户管理 ──────────────────────────────────

  async getUserList(): Promise<UserList> {
    try {
      const reply = await this.http.send({ method: 'get', url: '/settings/permission/userList', portName: this.ip, timeout: 5000 })
      if (reply.status && reply.data) return reply.data as UserList
    } catch { /* ignore */ }
    return { defaultLevel: 1, list: [] }
  }

  async setUserList(list: UserList): Promise<void> {
    const reply = await this.http.send({ method: 'post', url: '/settings/permission/userList', portName: this.ip, params: list, timeout: 10000 })
    if (!reply.status) throw new Error(`Set userList failed: ${reply.message}`)
  }

  async getUserConfig(): Promise<UserPermissionConfig[]> {
    try {
      const reply = await this.http.send({ method: 'get', url: '/settings/permission/config', portName: this.ip, timeout: 5000 })
      if (reply.status && reply.data) {
        const d = reply.data as Record<string, unknown>
        return (d.list as UserPermissionConfig[]) ?? []
      }
    } catch { /* ignore */ }
    return []
  }

  async setUserConfig(config: UserPermissionConfig[]): Promise<void> {
    const reply = await this.http.send({ method: 'post', url: '/settings/permission/config', portName: this.ip, params: { list: config }, timeout: 10000 })
    if (!reply.status) throw new Error(`Set userConfig failed: ${reply.message}`)
  }

  // ─── 坐标系管理 ────────────────────────────────

  async getUserCoordinate(): Promise<CoordinateData> {
    try {
      const reply = await this.http.send({ method: 'get', url: '/settings/coordinate/user', portName: this.ip, timeout: 5000 })
      if (reply.status && Array.isArray(reply.data)) {
        return { coordList: (reply.data as Array<Record<string, unknown>>).map(normalizeCoordStub) }
      }
    } catch { /* ignore */ }
    return { coordList: [] }
  }

  async setUserCoordinate(data: CoordinateData): Promise<void> {
    const reply = await this.http.send({ method: 'post', url: '/settings/coordinate/user', portName: this.ip, params: data.coordList, timeout: 10000 })
    if (!reply.status) throw new Error(`Set userCoordinate failed: ${reply.message}`)
  }

  async getToolCoordinate(): Promise<CoordinateData> {
    try {
      const reply = await this.http.send({ method: 'get', url: '/settings/coordinate/tool', portName: this.ip, timeout: 5000 })
      if (reply.status && Array.isArray(reply.data)) {
        return { coordList: (reply.data as Array<Record<string, unknown>>).map(normalizeCoordStub) }
      }
    } catch { /* ignore */ }
    return { coordList: [] }
  }

  async setToolCoordinate(data: CoordinateData): Promise<void> {
    const reply = await this.http.send({ method: 'post', url: '/settings/coordinate/tool', portName: this.ip, params: data.coordList, timeout: 10000 })
    if (!reply.status) throw new Error(`Set toolCoordinate failed: ${reply.message}`)
  }

  // ─── 运动参数 ──────────────────────────────────

  async getPlaybackJointParams(): Promise<Record<string, unknown>> {
    const reply = await this.http.send({ method: 'get', url: '/settings/playback/joint', portName: this.ip, timeout: 5000 })
    return (reply.status && reply.data) ? (reply.data as Record<string, unknown>) : {}
  }

  async setPlaybackJointParams(params: Record<string, unknown>): Promise<void> {
    const reply = await this.http.send({ method: 'post', url: '/settings/playback/joint', portName: this.ip, params, timeout: 10000 })
    if (!reply.status) throw new Error(`Set playback/joint failed: ${reply.message}`)
  }

  async getPlaybackCoordinateParams(): Promise<Record<string, unknown>> {
    const reply = await this.http.send({ method: 'get', url: '/settings/playback/coordinate', portName: this.ip, timeout: 5000 })
    return (reply.status && reply.data) ? (reply.data as Record<string, unknown>) : {}
  }

  async setPlaybackCoordinateParams(params: Record<string, unknown>): Promise<void> {
    const reply = await this.http.send({ method: 'post', url: '/settings/playback/coordinate', portName: this.ip, params, timeout: 10000 })
    if (!reply.status) throw new Error(`Set playback/coordinate failed: ${reply.message}`)
  }

  async getTeachJointParams(): Promise<Record<string, unknown>> {
    const reply = await this.http.send({ method: 'get', url: '/settings/teach/joint', portName: this.ip, timeout: 5000 })
    return (reply.status && reply.data) ? (reply.data as Record<string, unknown>) : {}
  }

  async setTeachJointParams(params: Record<string, unknown>): Promise<void> {
    const reply = await this.http.send({ method: 'post', url: '/settings/teach/joint', portName: this.ip, params, timeout: 10000 })
    if (!reply.status) throw new Error(`Set teach/joint failed: ${reply.message}`)
  }

  async getTeachCoordinateParams(): Promise<Record<string, unknown>> {
    const reply = await this.http.send({ method: 'get', url: '/settings/teach/coordinate', portName: this.ip, timeout: 5000 })
    return (reply.status && reply.data) ? (reply.data as Record<string, unknown>) : {}
  }

  async setTeachCoordinateParams(params: Record<string, unknown>): Promise<void> {
    const reply = await this.http.send({ method: 'post', url: '/settings/teach/coordinate', portName: this.ip, params, timeout: 10000 })
    if (!reply.status) throw new Error(`Set teach/coordinate failed: ${reply.message}`)
  }

  // ─── Dobot+ 插件系统 ──────────────────────────

  async listDobotPlus(): Promise<string[]> {
    try {
      const reply = await this.http.send({ method: 'get', url: '/dobotPlus/list', portName: this.ip, timeout: 5000 })
      if (reply.status && Array.isArray(reply.data)) return reply.data.map(String)
    } catch { /* ignore */ }
    return []
  }

  async installDobotPlus(name: string): Promise<void> {
    const reply = await this.http.send({ method: 'post', url: '/dobotPlus/install', portName: this.ip, params: { name }, timeout: 60000 })
    if (!reply.status) throw new Error(`DobotPlus install failed: ${reply.message}`)
  }

  async uninstallDobotPlus(name: string): Promise<void> {
    const reply = await this.http.send({ method: 'post', url: '/dobotPlus/uninstall', portName: this.ip, params: { name }, timeout: 30000 })
    if (!reply.status) throw new Error(`DobotPlus uninstall failed: ${reply.message}`)
  }

  async getDobotPlusPorts(): Promise<Record<string, unknown>> {
    try {
      const reply = await this.http.send({ method: 'get', url: '/dobotPlus/getPorts', portName: this.ip, timeout: 5000 })
      return (reply.status && reply.data) ? (reply.data as Record<string, unknown>) : {}
    } catch { return {} }
  }

  // ─── 通讯设置 ──────────────────────────────────

  async setBus(params: Record<string, unknown>): Promise<void> {
    const reply = await this.http.send({ method: 'post', url: '/interface/bus', portName: this.ip, params, timeout: 10000 })
    if (!reply.status) throw new Error(`Set bus failed: ${reply.message}`)
  }

  async getWiFi(): Promise<Record<string, unknown>> {
    try {
      const reply = await this.http.send({ method: 'get', url: '/interface/setAP', portName: this.ip, timeout: 5000 })
      return (reply.status && reply.data) ? (reply.data as Record<string, unknown>) : {}
    } catch { return {} }
  }

  async setWiFi(params: Record<string, unknown>): Promise<void> {
    const reply = await this.http.send({ method: 'post', url: '/interface/setAP', portName: this.ip, params, timeout: 10000 })
    if (!reply.status) throw new Error(`Set WiFi failed: ${reply.message}`)
  }

  async getEthernet(): Promise<Record<string, unknown>> {
    try {
      const reply = await this.http.send({ method: 'get', url: '/interface/ethernet', portName: this.ip, timeout: 5000 })
      return (reply.status && reply.data) ? (reply.data as Record<string, unknown>) : {}
    } catch { return {} }
  }

  async setEthernet(params: Record<string, unknown>): Promise<void> {
    const reply = await this.http.send({ method: 'post', url: '/interface/ethernet', portName: this.ip, params, timeout: 10000 })
    if (!reply.status) throw new Error(`Set Ethernet failed: ${reply.message}`)
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

  async moveCartesian(params: { x: number; y: number; z: number; rx: number; ry: number; rz: number; user?: number; tool?: number }): Promise<Record<string, unknown>> {
    const reply = await this.http.send({
      method: 'post', url: '/interface/movL', portName: this.ip,
      params: { x: params.x, y: params.y, z: params.z, rx: params.rx, ry: params.ry, rz: params.rz, user: params.user ?? -1, tool: params.tool ?? -1 },
      timeout: 30000,
    })
    return { status: reply.status, message: reply.message, data: reply.data }
  }

  async forwardKinematics(params: { joint: number[]; user?: number; tool?: number }): Promise<{ coordinate: number[]; errID: number; errMsg?: string }> {
    const reply = await this.http.send({
      method: 'post', url: '/interface/forwardCal', portName: this.ip,
      params: { joint: params.joint, user: params.user ?? 0, tool: params.tool ?? 0 }, timeout: 5000,
    })
    if (reply.status && reply.data) {
      const d = reply.data as Record<string, unknown>
      return { coordinate: (d.coordinate as number[]) || [], errID: (d.errID as number) ?? -1, errMsg: d.errMsg as string | undefined }
    }
    return { coordinate: [], errID: -1, errMsg: reply.message || 'FK request failed' }
  }

  async inverseKinematics(params: { coordinate: number[]; jointNear: number[]; user?: number; tool?: number }): Promise<{ joint: number[]; errID: number; errMsg?: string }> {
    const reply = await this.http.send({
      method: 'post', url: '/interface/inverseCal', portName: this.ip,
      params: { useJointNear: true, jointNear: params.jointNear, coordinate: params.coordinate, user: params.user ?? 0, tool: params.tool ?? 0 },
      timeout: 10000,
    })
    if (reply.status && reply.data) {
      const d = reply.data as Record<string, unknown>
      return { joint: (d.joint as number[]) || [], errID: (d.errID as number) ?? -1, errMsg: d.errMsg as string | undefined }
    }
    return { joint: [], errID: -1, errMsg: reply.message || 'IK request failed' }
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

function normalizeCoordStub(item: Record<string, unknown>) {
  return {
    name: String(item.name ?? ''),
    enable: Boolean(item.enable),
    x: Number(item.x ?? 0),
    y: Number(item.y ?? 0),
    z: Number(item.z ?? 0),
    r: Number(item.r ?? 0),
    rx: Number(item.rx ?? 0),
    ry: Number(item.ry ?? 0),
    rz: Number(item.rz ?? 0),
  }
}
