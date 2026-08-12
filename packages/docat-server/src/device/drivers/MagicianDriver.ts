/**
 * MagicianDriver — Dobot Magician（4 轴，串口控制）
 *
 * 通过 MagicianSerialTransport 按 Dobot V1.1.5 二进制协议通信。
 * 协议命令见 protocol/magicianProtocol.ts（参考 find-docs/magician-controller）。
 *
 * 支持：位姿/报警轮询、连续点动(JOG)、步进点动(增量 PTP)、PTP 移动、
 * 回零/停止/急停/清报警、速度比例(JOG/PTP Common)、吸盘/夹爪。
 * Magician 固件无上电/下电/使能/模式切换等命令，相关方法为空实现。
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
import { MagicianSerialTransport } from '../transport/MagicianSerialTransport.js'
import {
  cmdGetPose,
  cmdGetAlarms,
  cmdClearAlarms,
  cmdHome,
  cmdJog,
  cmdPtp,
  cmdJogCommon,
  cmdPtpCommon,
  cmdSuction,
  cmdGripper,
  cmdQueueStart,
  cmdQueueClear,
  cmdQueueStop,
  cmdEstop,
  parsePose,
  parseAlarms,
  JOG_IDLE,
  JOG_AP_DOWN,
  JOG_BP_DOWN,
  JOG_CP_DOWN,
  JOG_DP_DOWN,
  PTP_MOVJ_XYZ,
  PTP_MOVL_XYZ,
  PTP_MOVJ_ANGLE,
  PTP_MOVL_ANGLE,
  PTP_MOVJ_INC,
  PTP_MOVJ_XYZ_INC,
} from '../protocol/magicianProtocol.js'
import type {
  CartesianPose,
  JointPose,
  DeviceState,
  DeviceStatus,
  FirmwareVersion,
  JogParams,
  MoveParams,
} from 'docat-shared/types'

/** JOG 轴命令：X/J1→A, Y/J2→B, Z/J3→C, R/J4→D（'+' 为 AP/BP/CP/DP，'-' +1） */
const JOG_AXIS_CMD: Record<string, number> = {
  x: JOG_AP_DOWN, y: JOG_BP_DOWN, z: JOG_CP_DOWN,
  r: JOG_DP_DOWN, rx: JOG_DP_DOWN, // r 兼容旧别名 → RX 位置
  j1: JOG_AP_DOWN, j2: JOG_BP_DOWN, j3: JOG_CP_DOWN, j4: JOG_DP_DOWN,
}

export class MagicianDriver extends DeviceDriver {
  readonly id: string
  readonly type: DeviceTypeName = 'Magician'
  readonly ip: string
  readonly serialPort: string
  readonly baudRate: number

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
    joints: { j1: 0, j2: 0, j3: 0, j4: 0 },
    io: {},
    alarm: [],
    status: this.status,
    timestamp: Date.now(),
  }

  private serial: MagicianSerialTransport | null = null
  private poseTimer: ReturnType<typeof setInterval> | null = null
  private alarmTimer: ReturnType<typeof setInterval> | null = null
  private alarmCount = 0
  private speedRatio = 100
  private teachInch = 1
  /** JOG 串行化：后到的 jog 等前一个完成；stopJog 抬高 seq 作废过期 jog */
  private jogSeq = 0
  private jogQueue: Promise<void> = Promise.resolve()
  /** PTP 移动代数：stop/急停时抬高，作废进行中的到达等待 */
  private moveSeq = 0

  constructor(id: string, ip: string, deviceTypeName: string, serialPort: string, baudRate = 115200) {
    super()
    this.id = id
    this.ip = ip
    this.serialPort = serialPort
    this.baudRate = baudRate
  }

  // ─── 生命周期 ──────────────────────────────────

  async connect(): Promise<void> {
    // TODO(预留)：「服务器」模式（DobotServer 中转）时此处改用 DobotServerTransport，
    //  其余逻辑（帧命令/轮询/等待到达）不变，见 transport/DobotServerTransport.ts
    this.serial = new MagicianSerialTransport(
      this.serialPort,
      this.baudRate,
      (fid, _ctrl, params) => this.onSerialFrame(fid, params),
      (message) => console.warn(`[MagicianDriver] ${this.serialPort}: ${message}`),
    )
    await this.serial.open()
    // 清空队列并开始执行
    this.serial.send(cmdQueueClear())
    this.serial.send(cmdQueueStart())

    this.status.connected = true
    this.state.timestamp = Date.now()

    this.poseTimer = setInterval(() => {
      this.serial?.send(cmdGetPose())
    }, 100)
    this.alarmTimer = setInterval(() => {
      this.serial?.send(cmdGetAlarms())
    }, 1000)
  }

  async disconnect(): Promise<void> {
    if (this.poseTimer) clearInterval(this.poseTimer)
    if (this.alarmTimer) clearInterval(this.alarmTimer)
    this.poseTimer = null
    this.alarmTimer = null
    this.serial?.close()
    this.serial = null
    this.status.connected = false
    this.state.timestamp = Date.now()
  }

  // ─── 伺服电源 / 使能（固件无此命令）──────────────

  async powerOn(): Promise<void> { /* no-op */ }
  async powerOff(): Promise<void> { /* no-op */ }
  async enable(): Promise<void> { /* no-op */ }
  async disable(): Promise<void> { /* no-op */ }

  // ─── 模式切换（固件无此命令，返回默认值）─────────

  async setAutoManualSwitch(_value: boolean): Promise<void> { /* no-op */ }
  async getAutoManualSwitch(): Promise<boolean> { return true }
  async setAutoManualMode(_mode: 'auto' | 'manual'): Promise<void> { /* no-op */ }
  async setRemoteSwitch(_value: boolean): Promise<void> { /* no-op */ }
  async getRemoteSwitch(): Promise<boolean> { return true }
  async setRemoteControl(_mode: 'online' | 'tcp'): Promise<void> { /* no-op */ }
  async getRemoteControl(): Promise<'online' | 'tcp'> { return 'online' }

  // ─── 告警 ──────────────────────────────────────

  async getAlarms(): Promise<Array<{ id: number; level: number; description: string; solution: string; date: string; time: string }>> {
    return Array.from({ length: this.alarmCount }, (_, i) => ({
      id: i + 1,
      level: 1,
      description: 'Magician 报警',
      solution: '请检查机器人状态后清除报警',
      date: '',
      time: '',
    }))
  }

  async getWarnings(): Promise<Array<{ id: number; level: number; description: string; solution: string; date: string; time: string }>> {
    return []
  }

  async clearAlarm(): Promise<void> {
    this.serial?.send(cmdClearAlarms())
  }

  async resetCollision(): Promise<void> { /* no-op */ }

  // ─── 运动控制 ──────────────────────────────────

  async setJogMode(_mode: 'jog' | 'step'): Promise<void> { /* 步进走增量 PTP，无需下发 */ }

  async setTeachInch(distance: number): Promise<void> {
    this.teachInch = distance
  }

  async setJogCoordinate(_mode: 'joint' | 'cartesian' | 'tool'): Promise<void> { /* 串口 JOG 自带坐标系区分 */ }

  async jog(params: JogParams): Promise<void> {
    if (!this.serial) return
    const base = JOG_AXIS_CMD[params.axis]
    if (base === undefined) return
    const cmd = params.direction === '+' ? base : base + 1
    const isJoint = params.axis.startsWith('j')

    // 步进：增量 PTP（关节 J1..J4 / 坐标 X Y Z R），一步一动
    if (params.mode === 'step') {
      const step = Math.abs(params.stepValue ?? this.teachInch) * (params.direction === '+' ? 1 : -1)
      const [p1, p2, p3, p4] = [0, 0, 0, 0]
      const idx = isJoint ? Number(params.axis[1]) - 1 : 'xyzr'.indexOf(params.axis === 'r' ? 'r' : params.axis[0])
      const vals = [p1, p2, p3, p4]
      if (idx >= 0 && idx < 4) vals[idx] = step
      this.serial.send(cmdPtp(isJoint ? PTP_MOVJ_INC : PTP_MOVJ_XYZ_INC, vals[0], vals[1], vals[2], vals[3]))
      return
    }

    // 连续：JOG 持续运动（queued 帧），停止走立即帧
    const seq = ++this.jogSeq
    const run = this.jogQueue.then(async () => {
      if (seq !== this.jogSeq) return
      this.serial?.send(cmdJog(isJoint, cmd))
    }).catch(() => { /* 错误吞掉，避免队列卡死 */ })
    this.jogQueue = run.then(() => undefined, () => undefined)
    await run
  }

  async stopJog(): Promise<void> {
    this.jogSeq++
    const seq = this.jogSeq
    const run = this.jogQueue.then(async () => {
      if (seq !== this.jogSeq) return
      this.serial?.send(cmdJog(false, JOG_IDLE))
    }).catch(() => { /* ignore */ })
    this.jogQueue = run.then(() => undefined, () => undefined)
    await run
  }

  async moveTo(pose: MoveParams): Promise<void> {
    const mode = pose.mode === 'move' ? PTP_MOVL_XYZ : PTP_MOVJ_XYZ
    this.serial?.send(cmdPtp(mode, pose.x, pose.y, pose.z, pose.r ?? 0))
  }

  async moveJoints(joints: number[]): Promise<void> {
    const seq = ++this.moveSeq
    this.serial?.send(cmdPtp(PTP_MOVJ_ANGLE, joints[0] ?? 0, joints[1] ?? 0, joints[2] ?? 0, joints[3] ?? 0))
    await this.waitArrival(seq, joints, true)
  }

  async moveJointsCommand(joints: number[], value: boolean): Promise<Record<string, unknown>> {
    if (value) {
      await this.moveJoints(joints)
      return { value: true }
    }
    // value=false 仅打断等待（停止由 /stop 统一处理）
    this.moveSeq++
    return { value: false }
  }

  async movePoint(params: {
    path?: 'MovJ' | 'MovL'
    joint?: number[]
    pose?: number[]
    user?: number
    tool?: number
  }): Promise<Record<string, unknown>> {
    const movL = params.path === 'MovL'
    const seq = ++this.moveSeq
    if (params.joint && params.joint.length >= 4) {
      this.serial?.send(cmdPtp(
        movL ? PTP_MOVL_ANGLE : PTP_MOVJ_ANGLE,
        params.joint[0], params.joint[1], params.joint[2], params.joint[3],
      ))
      const ok = await this.waitArrival(seq, params.joint, true)
      return ok ? { value: true } : { value: false, stopped: true }
    }
    if (params.pose && params.pose.length >= 3) {
      const target = [params.pose[0], params.pose[1], params.pose[2], params.pose[3] ?? 0]
      this.serial?.send(cmdPtp(
        movL ? PTP_MOVL_XYZ : PTP_MOVJ_XYZ,
        target[0], target[1], target[2], target[3],
      ))
      const ok = await this.waitArrival(seq, target, false)
      return ok ? { value: true } : { value: false, stopped: true }
    }
    return { value: false }
  }

  /**
   * 等待到达目标（固件无运动状态查询，用 10Hz 位姿缓存判定）。
   * 被 stop/急停打断返回 false；超时视为已完成。
   */
  private async waitArrival(seq: number, target: number[], isJoint: boolean, timeoutMs = 30000): Promise<boolean> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (seq !== this.moveSeq) return false // 被 stop/急停打断
      const p = this.state.pose
      const j = this.state.joints
      const close = isJoint
        ? Math.abs((j.j1 ?? 0) - (target[0] ?? 0)) < 1
          && Math.abs((j.j2 ?? 0) - (target[1] ?? 0)) < 1
          && Math.abs((j.j3 ?? 0) - (target[2] ?? 0)) < 1
          && Math.abs((j.j4 ?? 0) - (target[3] ?? 0)) < 1
        : Math.abs((p.x ?? 0) - (target[0] ?? 0)) < 1
          && Math.abs((p.y ?? 0) - (target[1] ?? 0)) < 1
          && Math.abs((p.z ?? 0) - (target[2] ?? 0)) < 1
          && Math.abs((p.r ?? 0) - (target[3] ?? 0)) < 1
      if (close) return true
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    return true
  }

  /** @deprecated 请用 movePoint({ path:'MovL', pose })；保留兼容 */
  async moveCartesian(params: {
    x: number; y: number; z: number
    rx: number; ry: number; rz: number
    user?: number; tool?: number
    jointNear?: number[]
    path?: 'MovJ' | 'MovL'
  }): Promise<Record<string, unknown>> {
    const movL = params.path !== 'MovJ'
    const seq = ++this.moveSeq
    this.serial?.send(cmdPtp(
      movL ? PTP_MOVL_XYZ : PTP_MOVJ_XYZ,
      params.x, params.y, params.z, params.rx ?? params.rz ?? 0,
    ))
    const ok = await this.waitArrival(seq, [params.x, params.y, params.z, params.rx ?? params.rz ?? 0], false)
    return ok ? { value: true } : { value: false, stopped: true }
  }

  async inverseKinematics(_params: { coordinate: number[]; jointNear: number[]; user?: number; tool?: number }): Promise<{ joint: number[]; errID: number; errMsg?: string }> {
    return { joint: [], errID: 1, errMsg: 'Magician 不支持逆运动学' }
  }

  async forwardKinematics(_params: { joint: number[]; user?: number; tool?: number }): Promise<{ coordinate: number[]; errID: number; errMsg?: string }> {
    return { coordinate: [], errID: 1, errMsg: 'Magician 不支持正运动学' }
  }

  async home(): Promise<void> {
    this.serial?.send(cmdHome())
  }

  async stop(): Promise<void> {
    this.jogSeq++
    this.moveSeq++
    this.serial?.send(cmdJog(false, JOG_IDLE))
    this.serial?.send(cmdQueueStop())
  }

  async emergencyStop(): Promise<void> {
    this.jogSeq++
    this.moveSeq++
    this.serial?.send(cmdEstop())
  }

  // ─── 状态查询 ──────────────────────────────────

  async getPose(): Promise<CartesianPose> {
    return { ...this.state.pose }
  }

  async getJoints(): Promise<JointPose> {
    return { ...this.state.joints }
  }

  async getStatus(): Promise<DeviceStatus> {
    return { ...this.status }
  }

  async getVersion(): Promise<FirmwareVersion> {
    return { controller: '', servo: '', version: 'Magician', controllerTypeExt: 'Magician' }
  }

  async pollState(): Promise<DeviceState> {
    this.status.connected = this.serial?.isOpen ?? false
    this.state.timestamp = Date.now()
    this.state.status = this.status
    this.state.alarm = Array.from({ length: this.alarmCount }, (_, i) => ({
      id: i + 1,
      level: 'error' as const,
      message: 'Magician 报警',
      timestamp: Date.now(),
    }))
    return this.state
  }

  // ─── 速度 ──────────────────────────────────────

  async setSpeed(ratio: number): Promise<void> {
    this.speedRatio = ratio
    this.serial?.send(cmdJogCommon(ratio, ratio))
    this.serial?.send(cmdPtpCommon(ratio, ratio))
  }

  async getSpeed(): Promise<number> {
    return this.speedRatio
  }

  // ─── 末端执行器（吸盘 / 夹爪）──────────────────

  async suction(on: boolean): Promise<void> {
    this.serial?.send(cmdSuction(true, on))
  }

  async gripper(on: boolean): Promise<void> {
    this.serial?.send(cmdGripper(true, on))
  }

  // ─── 负载参数（固件无）─────────────────────────

  async getLoadParams(): Promise<LoadParams> {
    return { name: '', centerX: 0, centerY: 0, centerZ: 0, loadValue: 0 }
  }

  async setLoadParams(_params: LoadParams): Promise<void> { /* no-op */ }

  async getLoadConfig(): Promise<LoadParams[]> { return [] }

  async setLoadConfig(_config: LoadParams[]): Promise<void> { /* no-op */ }

  // ─── 自定义姿态（固件无，前端本地存储兜底）──────

  async getCustomPostures(): Promise<CustomPosture[]> { return [] }

  async setCustomPostures(_postures: CustomPosture[]): Promise<void> { /* no-op */ }

  // ─── 系统设置 ──────────────────────────────────

  async getSystemTime(): Promise<SystemTime> { return {} }

  async setSystemTime(_time: SystemTime): Promise<void> { /* no-op */ }

  async setDeviceAlias(_alias: string): Promise<void> { /* no-op */ }

  // ─── 用户管理 ──────────────────────────────────

  async getUserList(): Promise<UserList> { return { defaultLevel: 0, list: [] } }

  async setUserList(_list: UserList): Promise<void> { /* no-op */ }

  async getUserConfig(): Promise<UserPermissionConfig[]> { return [] }

  async setUserConfig(_config: UserPermissionConfig[]): Promise<void> { /* no-op */ }

  // ─── 坐标系管理 ────────────────────────────────

  async getUserCoordinate(): Promise<CoordinateData> { return { coordList: [] } }

  async setUserCoordinate(_data: CoordinateData): Promise<void> { /* no-op */ }

  async getToolCoordinate(): Promise<CoordinateData> { return { coordList: [] } }

  async setToolCoordinate(_data: CoordinateData): Promise<void> { /* no-op */ }

  // ─── 运动参数（固件无）─────────────────────────

  async getPlaybackJointParams(): Promise<Record<string, unknown>> { return {} }

  async setPlaybackJointParams(_params: Record<string, unknown>): Promise<void> { /* no-op */ }

  async getPlaybackCoordinateParams(): Promise<Record<string, unknown>> { return {} }

  async setPlaybackCoordinateParams(_params: Record<string, unknown>): Promise<void> { /* no-op */ }

  async getTeachJointParams(): Promise<Record<string, unknown>> { return {} }

  async setTeachJointParams(_params: Record<string, unknown>): Promise<void> { /* no-op */ }

  async getTeachCoordinateParams(): Promise<Record<string, unknown>> { return {} }

  async setTeachCoordinateParams(_params: Record<string, unknown>): Promise<void> { /* no-op */ }

  // ─── 轨迹录制 / 复现（固件无）──────────────────

  async setThreeSwitch(_value: boolean): Promise<void> { /* no-op */ }

  async setRecurrentTrack(_value: boolean): Promise<Record<string, unknown>> { return { value: true } }

  async getRecurrentTrackStatus(): Promise<{ isFinish: boolean; result: boolean }> {
    return { isFinish: true, result: true }
  }

  async getRetraceParams(): Promise<{ multi: number; const: number; loop: number }> {
    return { multi: 1, const: 0, loop: 1 }
  }

  async setRetraceParams(_params: { multi: number; const: number; loop: number }): Promise<void> { /* no-op */ }

  async setDebugReTrace(_cmd: 'start' | 'stop', _addr: string): Promise<void> { /* no-op */ }

  async getDebugReTrace(): Promise<{
    addr: string; currentTimes: number; isDone: boolean; percent: number; result: boolean
  }> {
    return { addr: '', currentTimes: 0, isDone: true, percent: 100, result: true }
  }

  // ─── Dobot+ 插件（固件无）──────────────────────

  async listDobotPlus(): Promise<string[]> { return [] }

  async installDobotPlus(_name: string): Promise<void> { /* no-op */ }

  async uninstallDobotPlus(_name: string): Promise<void> { /* no-op */ }

  async getDobotPlusPorts(): Promise<Record<string, unknown>> { return {} }

  async callDobotPlus(_pluginName: string, _fn: string, _data?: unknown): Promise<unknown> {
    return null
  }

  async controlDobotES01(_action: 'grip' | 'release' | 'clearAlarm' | 'status'): Promise<unknown> {
    return null
  }

  // ─── 通讯设置（固件无）─────────────────────────

  async getBus(): Promise<Record<string, unknown>> { return {} }

  async getMotionDefaults(): Promise<Record<string, unknown>> { return {} }

  async setBus(_params: Record<string, unknown>): Promise<void> { /* no-op */ }

  async getWiFi(): Promise<Record<string, unknown>> { return {} }

  async setWiFi(_params: Record<string, unknown>): Promise<void> { /* no-op */ }

  async getEthernet(): Promise<Record<string, unknown>> { return {} }

  async setEthernet(_params: Record<string, unknown>): Promise<void> { /* no-op */ }

  // ─── 按键设置（固件无）─────────────────────────

  async getButtonMode(): Promise<Record<string, unknown>> { return { mode: 'playback' } }

  async setButtonMode(_params: Record<string, unknown>): Promise<void> { /* no-op */ }

  // ─── 电源设置（固件无）─────────────────────────

  async getCCBoxVoltage(): Promise<Record<string, unknown>> { return { min: 0, max: 0 } }

  async setCCBoxVoltage(_params: Record<string, unknown>): Promise<void> { /* no-op */ }

  // ─── 拖动设置（固件无）─────────────────────────

  async getDragSensivity(): Promise<Record<string, unknown>> {
    return { j1: 50, j2: 50, j3: 50, j4: 50, j5: 50, j6: 50 }
  }

  async setDragSensivity(_params: Record<string, unknown>): Promise<void> { /* no-op */ }

  // ─── 远程控制（固件无）─────────────────────────

  async getRemoteIOCtrl(): Promise<Record<string, unknown>> { return {} }

  async setRemoteIOCtrl(_params: Record<string, unknown>): Promise<void> { /* no-op */ }

  async getRemoteModbus(): Promise<Record<string, unknown>> { return {} }

  async setRemoteModbus(_params: Record<string, unknown>): Promise<void> { /* no-op */ }

  // ─── 脚本 / 项目（走 SFTP/HTTP，串口不支持）─────

  async runScript(_script: string): Promise<void> { /* no-op */ }

  async stopScript(): Promise<void> { /* no-op */ }

  async uploadScript(_name: string, _content: string): Promise<void> { /* no-op */ }

  async listProjects(): Promise<string[]> { return [] }

  async runProject(_name: string): Promise<void> { /* no-op */ }

  async deleteProject(_name: string): Promise<void> { /* no-op */ }

  /**
   * 供 DevicePool 从响应帧更新位姿/报警缓存。
   * MagicianSerialTransport 已过滤回显帧，只回调响应帧。
   */
  onSerialFrame(fid: number, params: Buffer): void {
    if (fid === 10) {
      try {
        const pose = parsePose(params)
        this.state.pose = { x: pose.x, y: pose.y, z: pose.z, r: pose.r }
        this.state.joints = { j1: pose.j1, j2: pose.j2, j3: pose.j3, j4: pose.j4 }
        this.state.timestamp = Date.now()
      } catch {
        // 解析失败忽略
      }
    } else if (fid === 20) {
      this.alarmCount = parseAlarms(params)
    }
  }
}
