/**
 * MG6Driver — MG6 / Magician E6 设备驱动
 * 从 OpenDobot46 mg6Method.ts 提取适配
 * @see OpenDobot46/src.vm/dobotvm/device/mg6/mg6Method.ts
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
} from '../DeviceDriver.js'
import { HttpTransport } from '../transport/HttpTransport.js'
import type {
  CartesianPose, JointPose, DeviceState, DeviceStatus,
  FirmwareVersion, JogParams, MoveParams,
} from 'docat-shared/types'

interface MG6ExchangeData {
  cartesianCoordinate: number[]
  jointCoordinate: number[]
  auxJoint: number[]
  rdnCoordinate: number[]
  controlMode: number | string
  alarms: unknown[]
  isCollision: boolean
  skinCollison: boolean
  inputs: number[]
  outputs: number[]
  endDI: number[]
  endDO: number[]
  extendDO: number[][]
  extendDI: number[][]
  gpioAI: number[]
  endAI: number[]
  gpioAO: number[]
  prjState: unknown
  powerState: string
  controlParams: unknown
  jointCurrent: number[]
  jointVoltage: number[]
  jointTemp: number[]
  dragMode: boolean
  isSafeRun: boolean
  isSafeSuspend: boolean
  safeDO: unknown
  safeDI: unknown
  userCoordinate: Record<string, number>
  toolCoordinate: Record<string, number>
  jogMode: number
  dragPlayback: boolean
  dragTrack: boolean
  emergencyStop: boolean
  warning: unknown[]
  speedRatio: number
  remoteRun: boolean
  jointBrake: boolean[]
  coordinate: number
  pointSignal: boolean
  autoManual: number
  ledStatus: unknown
  skinValue: number
  recoveryMode: boolean
  pastSkinCollison: boolean
  forceSensorSwitch: boolean
  forceSensorData: number[]
  forceSensorStatus: unknown
  dragTeach: boolean
  isMotion: boolean
  toolMode: unknown
  remoteControl: unknown
  reducedMode: boolean
  protectiveStop: boolean
  safeCheck: unknown
  skinProximity: unknown
  isAlarmUpdate: boolean
  isWarningUpdate: boolean
  warningList: unknown[]
  isFCCollision: boolean
  backgroundScriptStatus: unknown
  backgroundScriptError: unknown
  threeStateEnable: boolean
}

export class MG6Driver extends DeviceDriver {
  readonly id: string
  readonly type: DeviceTypeName = 'MG6'
  readonly ip: string
  readonly modelName: string

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

  /** MG6 扩展状态 */
  rawExchange: Partial<MG6ExchangeData> = {}

  private http: HttpTransport
  private isPoweringOn = false

  constructor(id: string, ip: string, modelName: string = 'MG6') {
    super()
    this.id = id
    this.ip = ip
    this.modelName = modelName
    this.http = new HttpTransport(ip, 22000)
  }

  // ─── 连接 ──────────────────────────────────────

  async connect(): Promise<void> {
    this.status.connected = true
    this.state.timestamp = Date.now()
  }

  async disconnect(): Promise<void> {
    this.status.connected = false
    this.state.timestamp = Date.now()
  }

  // ─── 运动控制 ──────────────────────────────────

  async setJogMode(mode: 'jog' | 'step'): Promise<void> {
    const reply = await this.http.send({
      method: 'post',
      url: '/interface/jogMode',
      portName: this.ip,
      params: { mode },
      timeout: 3000,
    })
    if (!reply.status) throw new Error(`Set jog mode failed: ${reply.message}`)
  }

  async setTeachInch(distance: number): Promise<void> {
    const setReply = await this.http.send({
      method: 'post',
      url: '/settings/teach/inch',
      portName: this.ip,
      params: { distance },
      timeout: 3000,
    })
    if (!setReply.status) throw new Error(`Set teach inch failed: ${setReply.message}`)

    const getReply = await this.http.send({
      method: 'get',
      url: '/settings/teach/inch',
      portName: this.ip,
      timeout: 3000,
    })
    if (!getReply.status) throw new Error(`Get teach inch failed: ${getReply.message}`)
  }

  async jog(params: JogParams): Promise<void> {
    const axisMap: Record<string, number> = {
      x: 0, y: 1, z: 2, r: 3, rx: 4, ry: 5,
      j1: 0, j2: 1, j3: 2, j4: 3, j5: 4, j6: 5,
    }
    const idx = axisMap[params.axis] ?? 0
    const posBtns = [false, false, false, false, false, false]
    const negBtns = [false, false, false, false, false, false]

    if (params.direction === '+') {
      posBtns[idx] = true
    } else {
      negBtns[idx] = true
    }

    await this.http.send({
      method: 'post',
      url: '/panel/jog',
      portName: this.ip,
      params: { posBtns, negBtns },
      timeout: 5000,
    })
  }

  async moveTo(pose: MoveParams): Promise<void> {
    // MG6 joint target movement uses repeated /interface/jointMovJ start checks.
    // If pose contains joint angles, use them directly
    const joints = (pose as unknown as Record<string, unknown>).joints as number[] | undefined
      || [pose.x, pose.y, pose.z, pose.r ?? 0, 0, 0]
    await this.moveJoints(joints)
  }

  async moveCartesian(params: { x: number; y: number; z: number; rx: number; ry: number; rz: number; user?: number; tool?: number }): Promise<Record<string, unknown>> {
    const reply = await this.http.send({
      method: 'post',
      url: '/interface/movL',
      portName: this.ip,
      params: {
        x: params.x, y: params.y, z: params.z,
        rx: params.rx, ry: params.ry, rz: params.rz,
        user: params.user ?? -1,
        tool: params.tool ?? -1,
      },
      timeout: 30000,
    })
    return { status: reply.status, message: reply.message, data: reply.data }
  }

  async forwardKinematics(params: { joint: number[]; user?: number; tool?: number }): Promise<{ coordinate: number[]; errID: number; errMsg?: string }> {
    const reply = await this.http.send({
      method: 'post', url: '/interface/forwardCal', portName: this.ip,
      params: { joint: params.joint, user: params.user ?? 0, tool: params.tool ?? 0 },
      timeout: 5000,
    })
    if (reply.status && reply.data) {
      const d = reply.data as Record<string, unknown>
      return { coordinate: (d.coordinate as number[]) || [], errID: (d.errID as number) ?? -1, errMsg: d.errMsg as string | undefined }
    }
    return { coordinate: [], errID: -1, errMsg: reply.message || 'FK request failed' }
  }

  async inverseKinematics(params: { coordinate: number[]; jointNear: number[]; user?: number; tool?: number }): Promise<{ joint: number[]; errID: number; errMsg?: string }> {
    const reply = await this.http.send({
      method: 'post',
      url: '/interface/inverseCal',
      portName: this.ip,
      params: {
        useJointNear: true,
        jointNear: params.jointNear,
        coordinate: params.coordinate,
        user: params.user ?? 0,
        tool: params.tool ?? 0,
      },
      timeout: 10000,
    })
    if (reply.status && reply.data) {
      const d = reply.data as Record<string, unknown>
      return {
        joint: (d.joint as number[]) || [],
        errID: (d.errID as number) ?? -1,
        errMsg: d.errMsg as string | undefined,
      }
    }
    return { joint: [], errID: -1, errMsg: reply.message || 'IK request failed' }
  }

  /** 关节空间移动 */
  async moveJoints(joints: number[]): Promise<void> {
    const start = Date.now()
    try {
      while (Date.now() - start < 30000) {
        const result = await this.moveJointsCommand(joints, true)
        if (result.value === true || result.isAlarms === true) return
        await new Promise(resolve => setTimeout(resolve, 200))
      }
      throw new Error('Move joints timed out')
    } finally {
      await this.moveJointsCommand(joints, false).catch(() => {})
    }
  }

  async moveJointsCommand(joints: number[], value: boolean): Promise<Record<string, unknown>> {
    const targetJoints = joints.map(j => Number(j.toFixed(6)))
    const reply = await this.http.send({
      method: 'post',
      url: '/interface/jointMovJ',
      portName: this.ip,
      params: { value, joint: targetJoints },
      timeout: 3000,
    })
    if (!reply.status) throw new Error(`Move joints failed: ${reply.message}`)

    const data = (reply.data as Record<string, unknown> | undefined) || {}
    if (data.status === false) {
      throw new Error(`Move joints failed: ${(data.message as string) || (data.errorMsg as string) || 'device rejected command'}`)
    }
    return data
  }

  async home(): Promise<void> {
    await this.http.send({
      method: 'post',
      url: '/motion/home',
      portName: this.ip,
      params: {},
      timeout: 60000,
    })
  }

  async stop(): Promise<void> {
    // Stop all jog
    await this.http.send({
      method: 'post',
      url: '/panel/jog',
      portName: this.ip,
      params: {
        posBtns: [false, false, false, false, false, false],
        negBtns: [false, false, false, false, false, false],
      },
      timeout: 3000,
    }).catch(() => {})
  }

  async emergencyStop(): Promise<void> {
    this.status.emergencyStopped = true
    await this.http.send({
      method: 'post',
      url: '/motion/emergencyStop',
      portName: this.ip,
      params: {},
      timeout: 3000,
    }).catch(() => {})
  }

  // ─── 伺服电源 ──────────────────────────────────

  async powerOn(): Promise<void> {
    this.isPoweringOn = true
    try {
      await this.http.send({
        method: 'post',
        url: '/interface/powerControl',
        portName: this.ip,
        params: { value: true },
        timeout: 180000,
      })
    } finally {
      this.isPoweringOn = false
    }
  }

  async powerOff(): Promise<void> {
    await this.http.send({
      method: 'post',
      url: '/interface/powerControl',
      portName: this.ip,
      params: { value: false },
      timeout: 180000,
    })
  }

  // ─── 使能控制 ──────────────────────────────────

  async enable(): Promise<void> {
    const reply = await this.http.send({
      method: 'post',
      url: '/settings/controlMode',
      portName: this.ip,
      params: { controlMode: 'enable' },
      timeout: 30000,
    })
    if (!reply.status) {
      throw new Error(`Enable failed: ${reply.message}`)
    }
    // 轮询等待 controlMode 变为 enable（需要三态使能开关配合）
    const start = Date.now()
    while (Date.now() - start < 12000) {
      await new Promise(r => setTimeout(r, 300))
      await this.pollState()
      const cm = this.rawExchange.controlMode
      // controlMode: 'enable' (手动使能) 或 1/'auto' (自动模式) 表示已使能
      if (cm === 1 || cm === 'enable' || cm === 'auto') break
    }
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
      method: 'post',
      url: '/settings/function/autoManualSwitch',
      portName: this.ip,
      params: { value },
      timeout: 10000,
    })
    if (!reply.status) throw new Error(`Set autoManualSwitch failed: ${reply.message}`)
  }

  async getAutoManualSwitch(): Promise<boolean> {
    const reply = await this.http.send({
      method: 'get',
      url: '/settings/function/autoManualSwitch',
      portName: this.ip,
      timeout: 5000,
    })
    if (reply.status && reply.data) return !!(reply.data as Record<string, unknown>).value
    return false
  }

  async setAutoManualMode(mode: 'auto' | 'manual'): Promise<void> {
    const reply = await this.http.send({
      method: 'post',
      url: '/settings/function/autoManual',
      portName: this.ip,
      params: { autoManual: mode },
      timeout: 10000,
    })
    if (!reply.status) throw new Error(`Set auto/manual mode failed: ${reply.message}`)
  }

  get autoManualMode(): boolean {
    return this.rawExchange.autoManual === 1
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

  async setRemoteControl(mode: 'tp' | 'tcp'): Promise<void> {
    const reply = await this.http.send({
      method: 'post', url: '/settings/function/remoteControl', portName: this.ip,
      params: { mode }, timeout: 10000,
    })
    if (!reply.status) throw new Error(`Set remoteControl failed: ${reply.message}`)
  }

  async getRemoteControl(): Promise<'tp' | 'tcp'> {
    const reply = await this.http.send({
      method: 'get', url: '/settings/function/remoteControl', portName: this.ip, timeout: 5000,
    })
    if (reply.status && reply.data) {
      const mode = (reply.data as Record<string, unknown>).mode
      return mode === 'tcp' ? 'tcp' : 'tp'
    }
    return 'tp'
  }

  // ─── 负载参数 ──────────────────────────────────

  async getLoadParams(): Promise<LoadParams> {
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
    if (!reply.status) {
      throw new Error(`Set loadParams failed: ${reply.message}`)
    }
  }

  async getLoadConfig(): Promise<LoadParams[]> {
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
    if (!reply.status) {
      throw new Error(`Set loadConfig failed: ${reply.message}`)
    }
  }

  // ─── 自定义姿态 ────────────────────────────────

  async getCustomPostures(): Promise<CustomPosture[]> {
    try {
      const reply = await this.http.send({
        method: 'get',
        url: '/settings/function/customPose',
        portName: this.ip,
        timeout: 5000,
      })
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
    const reply = await this.http.send({
      method: 'post',
      url: '/settings/function/customPose',
      portName: this.ip,
      params: postures,
      timeout: 10000,
    })
    if (!reply.status) {
      throw new Error(`Set customPose failed: ${reply.message}`)
    }
  }

  // ─── 系统设置 ──────────────────────────────────

  async getSystemTime(): Promise<SystemTime> {
    const reply = await this.http.send({
      method: 'get',
      url: '/settings/systemTime',
      portName: this.ip,
      timeout: 5000,
    })
    if (reply.status && reply.data) {
      const d = reply.data as Record<string, unknown>
      return { date: String(d.date ?? ''), time: String(d.time ?? ''), timeZone: String(d.timeZone ?? '') }
    }
    return {}
  }

  async setSystemTime(time: SystemTime): Promise<void> {
    const reply = await this.http.send({
      method: 'post',
      url: '/settings/systemTime',
      portName: this.ip,
      params: time,
      timeout: 10000,
    })
    if (!reply.status) {
      throw new Error(`Set systemTime failed: ${reply.message}`)
    }
  }

  async setDeviceAlias(alias: string): Promise<void> {
    const reply = await this.http.send({
      method: 'post',
      url: '/settings/function/robotAlias',
      portName: this.ip,
      params: { alias },
      timeout: 10000,
    })
    if (!reply.status) {
      throw new Error(`Set robotAlias failed: ${reply.message}`)
    }
  }

  // ─── 用户管理 ──────────────────────────────────

  async getUserList(): Promise<UserList> {
    const reply = await this.http.send({
      method: 'get',
      url: '/settings/permission/userList',
      portName: this.ip,
      timeout: 5000,
    })
    if (reply.status && reply.data) {
      return reply.data as UserList
    }
    return { defaultLevel: 1, list: [] }
  }

  async setUserList(list: UserList): Promise<void> {
    const reply = await this.http.send({
      method: 'post',
      url: '/settings/permission/userList',
      portName: this.ip,
      params: list,
      timeout: 10000,
    })
    if (!reply.status) {
      throw new Error(`Set userList failed: ${reply.message}`)
    }
  }

  async getUserConfig(): Promise<UserPermissionConfig[]> {
    const reply = await this.http.send({
      method: 'get',
      url: '/settings/permission/config',
      portName: this.ip,
      timeout: 5000,
    })
    if (reply.status && reply.data) {
      const d = reply.data as Record<string, unknown>
      return (d.list as UserPermissionConfig[]) ?? []
    }
    return []
  }

  async setUserConfig(config: UserPermissionConfig[]): Promise<void> {
    const reply = await this.http.send({
      method: 'post',
      url: '/settings/permission/config',
      portName: this.ip,
      params: { list: config },
      timeout: 10000,
    })
    if (!reply.status) {
      throw new Error(`Set userConfig failed: ${reply.message}`)
    }
  }

  // ─── 坐标系管理 ────────────────────────────────

  async getUserCoordinate(): Promise<CoordinateData> {
    const reply = await this.http.send({
      method: 'get',
      url: '/settings/coordinate/user',
      portName: this.ip,
      timeout: 5000,
    })
    if (reply.status && reply.data) {
      return { coordList: (reply.data as CoordinateItemRaw[]).map(normalizeCoord) }
    }
    return { coordList: [] }
  }

  async setUserCoordinate(data: CoordinateData): Promise<void> {
    const reply = await this.http.send({
      method: 'post',
      url: '/settings/coordinate/user',
      portName: this.ip,
      params: data.coordList,
      timeout: 10000,
    })
    if (!reply.status) {
      throw new Error(`Set userCoordinate failed: ${reply.message}`)
    }
  }

  async getToolCoordinate(): Promise<CoordinateData> {
    const reply = await this.http.send({
      method: 'get',
      url: '/settings/coordinate/tool',
      portName: this.ip,
      timeout: 5000,
    })
    if (reply.status && reply.data) {
      return { coordList: (reply.data as CoordinateItemRaw[]).map(normalizeCoord) }
    }
    return { coordList: [] }
  }

  async setToolCoordinate(data: CoordinateData): Promise<void> {
    const reply = await this.http.send({
      method: 'post',
      url: '/settings/coordinate/tool',
      portName: this.ip,
      params: data.coordList,
      timeout: 10000,
    })
    if (!reply.status) {
      throw new Error(`Set toolCoordinate failed: ${reply.message}`)
    }
  }

  // ─── 运动参数 ──────────────────────────────────

  async getPlaybackJointParams(): Promise<Record<string, unknown>> {
    const reply = await this.http.send({
      method: 'get',
      url: '/settings/playback/joint',
      portName: this.ip,
      timeout: 5000,
    })
    return (reply.status && reply.data) ? (reply.data as Record<string, unknown>) : {}
  }

  async setPlaybackJointParams(params: Record<string, unknown>): Promise<void> {
    const reply = await this.http.send({
      method: 'post',
      url: '/settings/playback/joint',
      portName: this.ip,
      params,
      timeout: 10000,
    })
    if (!reply.status) throw new Error(`Set playback/joint failed: ${reply.message}`)
  }

  async getPlaybackCoordinateParams(): Promise<Record<string, unknown>> {
    const reply = await this.http.send({
      method: 'get',
      url: '/settings/playback/coordinate',
      portName: this.ip,
      timeout: 5000,
    })
    return (reply.status && reply.data) ? (reply.data as Record<string, unknown>) : {}
  }

  async setPlaybackCoordinateParams(params: Record<string, unknown>): Promise<void> {
    const reply = await this.http.send({
      method: 'post',
      url: '/settings/playback/coordinate',
      portName: this.ip,
      params,
      timeout: 10000,
    })
    if (!reply.status) throw new Error(`Set playback/coordinate failed: ${reply.message}`)
  }

  async getTeachJointParams(): Promise<Record<string, unknown>> {
    const reply = await this.http.send({
      method: 'get',
      url: '/settings/teach/joint',
      portName: this.ip,
      timeout: 5000,
    })
    return (reply.status && reply.data) ? (reply.data as Record<string, unknown>) : {}
  }

  async setTeachJointParams(params: Record<string, unknown>): Promise<void> {
    const reply = await this.http.send({
      method: 'post',
      url: '/settings/teach/joint',
      portName: this.ip,
      params,
      timeout: 10000,
    })
    if (!reply.status) throw new Error(`Set teach/joint failed: ${reply.message}`)
  }

  async getTeachCoordinateParams(): Promise<Record<string, unknown>> {
    const reply = await this.http.send({
      method: 'get',
      url: '/settings/teach/coordinate',
      portName: this.ip,
      timeout: 5000,
    })
    return (reply.status && reply.data) ? (reply.data as Record<string, unknown>) : {}
  }

  async setTeachCoordinateParams(params: Record<string, unknown>): Promise<void> {
    const reply = await this.http.send({
      method: 'post',
      url: '/settings/teach/coordinate',
      portName: this.ip,
      params,
      timeout: 10000,
    })
    if (!reply.status) throw new Error(`Set teach/coordinate failed: ${reply.message}`)
  }

  // ─── Dobot+ 插件系统 ──────────────────────────

  async listDobotPlus(): Promise<string[]> {
    try {
      const reply = await this.http.send({
        method: 'get',
        url: '/dobotPlus/list',
        portName: this.ip,
        timeout: 5000,
      })
      if (reply.status && Array.isArray(reply.data)) {
        return reply.data.map(String)
      }
    } catch { /* ignore */ }
    return []
  }

  async installDobotPlus(name: string): Promise<void> {
    const reply = await this.http.send({
      method: 'post',
      url: '/dobotPlus/install',
      portName: this.ip,
      params: { name },
      timeout: 60000,
    })
    if (!reply.status) throw new Error(`DobotPlus install failed: ${reply.message}`)
  }

  async uninstallDobotPlus(name: string): Promise<void> {
    const reply = await this.http.send({
      method: 'post',
      url: '/dobotPlus/uninstall',
      portName: this.ip,
      params: { name },
      timeout: 30000,
    })
    if (!reply.status) throw new Error(`DobotPlus uninstall failed: ${reply.message}`)
  }

  async getDobotPlusPorts(): Promise<Record<string, unknown>> {
    const reply = await this.http.send({
      method: 'get',
      url: '/dobotPlus/getPorts',
      portName: this.ip,
      timeout: 5000,
    })
    return (reply.status && reply.data) ? (reply.data as Record<string, unknown>) : {}
  }

  // ─── 通讯设置 ──────────────────────────────────

  async setBus(params: Record<string, unknown>): Promise<void> {
    const reply = await this.http.send({
      method: 'post',
      url: '/interface/bus',
      portName: this.ip,
      params,
      timeout: 10000,
    })
    if (!reply.status) throw new Error(`Set bus failed: ${reply.message}`)
  }

  async getWiFi(): Promise<Record<string, unknown>> {
    const reply = await this.http.send({
      method: 'get',
      url: '/interface/setAP',
      portName: this.ip,
      timeout: 5000,
    })
    return (reply.status && reply.data) ? (reply.data as Record<string, unknown>) : {}
  }

  async setWiFi(params: Record<string, unknown>): Promise<void> {
    const reply = await this.http.send({
      method: 'post',
      url: '/interface/setAP',
      portName: this.ip,
      params,
      timeout: 10000,
    })
    if (!reply.status) throw new Error(`Set WiFi failed: ${reply.message}`)
  }

  async getEthernet(): Promise<Record<string, unknown>> {
    const reply = await this.http.send({
      method: 'get',
      url: '/interface/ethernet',
      portName: this.ip,
      timeout: 5000,
    })
    return (reply.status && reply.data) ? (reply.data as Record<string, unknown>) : {}
  }

  async setEthernet(params: Record<string, unknown>): Promise<void> {
    const reply = await this.http.send({
      method: 'post',
      url: '/interface/ethernet',
      portName: this.ip,
      params,
      timeout: 10000,
    })
    if (!reply.status) throw new Error(`Set Ethernet failed: ${reply.message}`)
  }

  // ─── 告警 ──────────────────────────────────────

  async getAlarms(): Promise<Array<{ id: number; level: number; description: string; solution: string; date: string; time: string }>> {
    const reply = await this.http.send({
      method: 'get',
      url: '/protocol/getAlarm',
      portName: this.ip,
      timeout: 5000,
    })
    if (reply.status && reply.data) {
      const data = reply.data as { errMsg?: Array<Record<string, unknown>> }
      return (data.errMsg || []).map((a: Record<string, unknown>) => ({
        id: a.id as number,
        level: a.level as number,
        description: (a.description as string) || '',
        solution: (a.solution as string) || '',
        date: (a.date as string) || '',
        time: (a.time as string) || '',
      }))
    }
    return []
  }

  async getWarnings(): Promise<Array<{ id: number; level: number; description: string; solution: string; date: string; time: string }>> {
    const reply = await this.http.send({
      method: 'get',
      url: '/protocol/getWarning',
      portName: this.ip,
      timeout: 5000,
    })
    if (reply.status && reply.data) {
      const data = reply.data as { warnMsg?: Array<Record<string, unknown>> }
      return (data.warnMsg || []).map((a: Record<string, unknown>) => ({
        id: a.id as number,
        level: a.level as number,
        description: (a.description as string) || '',
        solution: (a.solution as string) || '',
        date: (a.date as string) || '',
        time: (a.time as string) || '',
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

  // ─── 状态查询 ──────────────────────────────────

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
        const d = reply.data as Record<string, string>
        return {
          controller: d.controllerVersion || d.controller || 'unknown',
          servo: d.servoVersion || d.servo || 'unknown',
          version: d.version || d.controllerVersion || '0.0.0',
          controllerTypeExt: d.controllerTypeExt || '',
        }
      }
    } catch { /* offline */ }
    return { controller: 'unknown', servo: 'unknown', version: '0.0.0', controllerTypeExt: '' }
  }

  /** 轮询设备实时状态 — 解析 MG6 protocol/exchange */
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
        const raw = reply.data as MG6ExchangeData
        this.rawExchange = raw

        // 解析位姿 — MG6 返回 cartesianCoordinate [x,y,z,rx,ry,rz]
        const cc = raw.cartesianCoordinate || [0, 0, 0, 0, 0, 0]
        const jc = raw.jointCoordinate || [0, 0, 0, 0, 0, 0]

        this.state = {
          pose: {
            x: cc[0] ?? 0,
            y: cc[1] ?? 0,
            z: cc[2] ?? 0,
            r: cc[3] ?? 0,
            rx: cc[3] ?? 0,
            ry: cc[4] ?? 0,
            rz: cc[5] ?? 0,
          },
          joints: {
            j1: jc[0] ?? 0,
            j2: jc[1] ?? 0,
            j3: jc[2] ?? 0,
            j4: jc[3] ?? 0,
            j5: jc[4] ?? 0,
            j6: jc[5] ?? 0,
          },
          io: {
            input: raw.inputs ? raw.inputs.map((v, i) => ({ address: i, value: v })) : [],
            output: raw.outputs ? raw.outputs.map((v, i) => ({ address: i, value: v })) : [],
            endInput: raw.endDI ? raw.endDI.map((v, i) => ({ address: i, value: v })) : [],
            endOutput: raw.endDO ? raw.endDO.map((v, i) => ({ address: i, value: v })) : [],
            extendDO: raw.extendDO || [],
            extendDI: raw.extendDI || [],
            ioAI: raw.gpioAI || [],
            endAI: raw.endAI || [],
            gpioAO: raw.gpioAO || [],
          },
          alarm: (raw.alarms || []).flat().filter((c): c is number => typeof c === 'number' && c !== 0).map((code) => ({
            id: code,
            level: 'error' as const,
            message: `Alarm ${code}`,
            timestamp: Date.now(),
          })),
          status: {
            connected: true,
            running: raw.prjState === 1,
            paused: false,
            emergencyStopped: raw.emergencyStop || false,
            error: false,
            mode: (raw.controlMode === 1 || raw.controlMode === 'enable' || raw.controlMode === 'auto')
              ? 'auto' : 'manual',
          },
          timestamp: Date.now(),
        }

        this.status = this.state.status
        this.status.connected = true
      }
    } catch {
      this.status.connected = false
    }

    this.state.timestamp = Date.now()
    return { ...this.state }
  }

  // ─── 脚本/项目 ─────────────────────────────────

  async runScript(_script: string): Promise<void> {
    // TODO: POST to script execution endpoint
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

/** 控制器返回的原始坐标项 */
interface CoordinateItemRaw {
  name?: string
  enable?: boolean
  x?: number; y?: number; z?: number; r?: number
  rx?: number; ry?: number; rz?: number
  [key: string]: unknown
}

function normalizeCoord(item: CoordinateItemRaw) {
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
