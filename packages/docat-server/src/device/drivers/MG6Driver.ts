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
  type CoordinateItem,
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
    dragPlayback: false,
    dragTrack: false,
    dragTeach: false,
  }

  /** MG6 扩展状态 */
  rawExchange: Partial<MG6ExchangeData> = {}

  private http: HttpTransport
  /** Dobot+ 管理通道（list/install/ports） */
  private httpPlus: HttpTransport
  private isPoweringOn = false
  /** 插件名 → 动态 HTTP 端口缓存 */
  private pluginPortCache = new Map<string, number>()
  /**
   * 点动命令串行队列：避免 WS 并发 fire-and-forget 把设备 HTTP 打成排队卡顿。
   * 官方 IntervalWorker 虽不 await，但间隔 200ms；我们经 server 更需要串行。
   */
  private jogQueue: Promise<void> = Promise.resolve()
  private jogSeq = 0

  constructor(id: string, ip: string, modelName: string = 'MG6') {
    super()
    this.id = id
    this.ip = ip
    this.modelName = modelName
    this.http = new HttpTransport(ip, 22000)
    this.httpPlus = new HttpTransport(ip, 22001)
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

  async setJogCoordinate(mode: 'joint' | 'cartesian' | 'tool'): Promise<void> {
    const reply = await this.http.send({
      method: 'post',
      url: '/interface/coordinate',
      portName: this.ip,
      params: { mode },
      timeout: 3000,
    })
    if (!reply.status) throw new Error(`Set jog coordinate failed: ${reply.message}`)
  }

  async jog(params: JogParams): Promise<void> {
    // 对齐 OpenDobot KEYWORD_2_INDEX：
    // X/Y/Z/RX/RY/RZ → 0..5；J1..J6 → 0..5
    const axisMap: Record<string, number> = {
      x: 0, y: 1, z: 2, rx: 3, ry: 4, rz: 5,
      r: 3, // 兼容旧别名 → RX
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

    const seq = ++this.jogSeq
    // 串行化：后到的 jog 等前一个完成；若中途 stopJog 抬高了 seq，则丢弃过期 jog
    // 错误吞掉，避免一次失败永久卡死队列
    const run = this.jogQueue.then(async () => {
      if (seq !== this.jogSeq) return
      const reply = await this.http.send({
        method: 'post',
        url: '/panel/jog',
        portName: this.ip,
        params: { posBtns, negBtns },
        timeout: 800,
      })
      if (!reply.status && seq === this.jogSeq) {
        throw new Error(`Jog failed: ${reply.message}`)
      }
    }).catch((err) => {
      if (seq === this.jogSeq) console.warn('[MG6Driver] jog error:', (err as Error).message)
    })
    this.jogQueue = run.then(() => undefined, () => undefined)
    await run
  }

  async stopJog(): Promise<void> {
    // 抬高 seq，使队列中尚未发出的 jog 全部作废
    this.jogSeq++
    const seq = this.jogSeq
    const run = this.jogQueue.then(async () => {
      if (seq !== this.jogSeq) return
      await this.http.send({
        method: 'post',
        url: '/panel/jog',
        portName: this.ip,
        params: {
          posBtns: [false, false, false, false, false, false],
          negBtns: [false, false, false, false, false, false],
        },
        timeout: 500,
      })
    }).catch((err) => {
      console.warn('[MG6Driver] stopJog error:', (err as Error).message)
    })
    this.jogQueue = run.then(() => undefined, () => undefined)
    await run
  }

  async moveTo(pose: MoveParams): Promise<void> {
    // 兼容旧接口：joints 优先，否则按 pose 走 MovL
    const extra = pose as unknown as Record<string, unknown>
    const joints = extra.joints as number[] | undefined
    if (Array.isArray(joints) && joints.length >= 6) {
      await this.moveJoints(joints)
      return
    }
    await this.moveCartesian({
      x: pose.x,
      y: pose.y,
      z: pose.z,
      rx: pose.r ?? Number(extra.rx ?? 0),
      ry: Number(extra.ry ?? 0),
      rz: Number(extra.rz ?? 0),
      user: pose.user,
      tool: pose.tool,
      path: 'MovL',
    })
  }

  /**
   * 统一点到点（官方 /interface/movJ | /interface/movL）
   *
   * 文档（dobot-docs Motion.md）明确：
   * - MovJ / MovL 描述的是**路径类型**（关节插补 vs 直线）
   * - 目标点既可以是 {joint=...} 也可以是 {pose=...}
   * 因此 path 与目标表示正交，不能把 “笛卡尔目标” 绑死成 MovL。
   *
   * HTTP 侧官方 runto 载荷：
   *   { value, joint, pose?, user, tool }
   * 持续 value=true 直到到位，最后 value=false。
   */
  async movePoint(params: {
    path?: 'MovJ' | 'MovL'
    joint?: number[]
    pose?: number[]
    user?: number
    tool?: number
  }): Promise<Record<string, unknown>> {
    const path = params.path === 'MovJ' ? 'MovJ' : 'MovL'
    const url = path === 'MovJ' ? '/interface/movJ' : '/interface/movL'
    const user = params.user ?? 0
    const tool = params.tool ?? 0

    const currentJoint = [
      this.state.joints.j1 ?? 0,
      this.state.joints.j2 ?? 0,
      this.state.joints.j3 ?? 0,
      this.state.joints.j4 ?? 0,
      this.state.joints.j5 ?? 0,
      this.state.joints.j6 ?? 0,
    ]

    let joint = (params.joint && params.joint.length >= 6)
      ? params.joint.slice(0, 6).map(j => Number(j))
      : [...currentJoint]

    let pose = (params.pose && params.pose.length >= 6)
      ? params.pose.slice(0, 6).map(n => Number(n))
      : undefined

    // 仅给了 pose：IK 求 joint（就近选解），与官方同时带 joint+pose 的 runto 对齐
    if (pose && !(params.joint && params.joint.length >= 6)) {
      const ik = await this.inverseKinematics({
        coordinate: pose,
        jointNear: currentJoint,
        user,
        tool,
      })
      if (ik.errID !== 0) {
        throw new Error(ik.errMsg || `目标不可达 (errID=${ik.errID})`)
      }
      if (ik.joint.length >= 6) joint = ik.joint.slice(0, 6).map(Number)
    }

    // 仅给了 joint：补一份 pose（可选，movJ/movL 都接受）
    if (!pose && params.joint && params.joint.length >= 6) {
      try {
        const fk = await this.forwardKinematics({ joint, user, tool })
        if (fk.errID === 0 && fk.coordinate.length >= 6) {
          pose = fk.coordinate.slice(0, 6).map(Number)
        }
      } catch { /* FK 失败不阻断，仅 joint 也能跑 */ }
    }

    if (!params.joint && !params.pose) {
      throw new Error('movePoint 需要 joint 或 pose')
    }

    const bodyBase: Record<string, unknown> = {
      joint,
      user,
      tool,
    }
    if (pose) bodyBase.pose = pose

    const start = Date.now()
    let last: Record<string, unknown> = {}
    try {
      while (Date.now() - start < 30000) {
        const reply = await this.http.send({
          method: 'post',
          url,
          portName: this.ip,
          params: { ...bodyBase, value: true },
          timeout: 3000,
        })
        if (!reply.status) {
          throw new Error(`${path} failed: ${reply.message}`)
        }
        last = (reply.data as Record<string, unknown> | undefined) || {}
        if (last.status === false) {
          throw new Error(String(last.message || last.errormessage || `${path} rejected by controller`))
        }
        if (last.value === true || last.isAlarms === true) break
        await new Promise(resolve => setTimeout(resolve, 200))
      }
      if (Date.now() - start >= 30000 && last.value !== true) {
        throw new Error(`${path} timed out`)
      }
      return last
    } finally {
      await this.http.send({
        method: 'post',
        url,
        portName: this.ip,
        params: { ...bodyBase, value: false },
        timeout: 3000,
      }).catch(() => {})
    }
  }

  /**
   * 兼容旧 API：按笛卡尔坐标运动。
   * 默认 MovL（直线）；可传 path:'MovJ' 做“到笛卡尔目标的关节插补”。
   */
  async moveCartesian(params: {
    x: number; y: number; z: number
    rx: number; ry: number; rz: number
    user?: number; tool?: number
    jointNear?: number[]
    path?: 'MovJ' | 'MovL'
  }): Promise<Record<string, unknown>> {
    return this.movePoint({
      path: params.path ?? 'MovL',
      pose: [params.x, params.y, params.z, params.rx, params.ry, params.rz],
      joint: params.jointNear,
      user: params.user,
      tool: params.tool,
    })
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

  /**
   * 关节空间移动 — 服务端一次完成
   * 官方 jointMovJ / runto：持续 POST value=true（~200ms），直到 value=true（到位）。
   * value=false 只用于结束，不能用来轮询，否则会立刻停住。
   */
  async moveJoints(joints: number[]): Promise<void> {
    const targetJoints = joints.map(j => Number(Number(j).toFixed(6)))
    const start = Date.now()
    try {
      while (Date.now() - start < 30000) {
        const result = await this.moveJointsCommand(targetJoints, true)
        if (result.isAlarms === true) throw new Error('因告警停止运动')
        if (result.value === true) return
        await new Promise(resolve => setTimeout(resolve, 200))
      }
      throw new Error('Move joints timed out')
    } finally {
      await this.moveJointsCommand(targetJoints, false).catch(() => {})
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
    // 通用停止：至少清掉点动按钮
    await this.stopJog().catch(() => {})
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

  // ─── 远程控制模式 (Online vs TCP) ──────────────────
  // 对应机器人 /settings/function/remoteControl 端点
  // 参考 OpenDobot46: RemoteModeType.Online = 'tp', RemoteModeType.TCP = 'tcp'

  async setRemoteControl(mode: 'online' | 'tcp'): Promise<void> {
    const reply = await this.http.send({
      method: 'post', url: '/settings/function/remoteControl', portName: this.ip,
      params: { mode: mode === 'tcp' ? 'tcp' : 'tp' }, timeout: 10000,
    })
    if (!reply.status) throw new Error(`Set remoteControl failed: ${reply.message}`)
  }

  async getRemoteControl(): Promise<'online' | 'tcp'> {
    const reply = await this.http.send({
      method: 'get', url: '/settings/function/remoteControl', portName: this.ip, timeout: 5000,
    })
    if (reply.status && reply.data) {
      const mode = (reply.data as Record<string, unknown>).mode
      return mode === 'tcp' ? 'tcp' : 'online'
    }
    return 'online'
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
    const reply = await this.http.send({
      method: 'get',
      url: '/settings/function/customPose',
      portName: this.ip,
      timeout: 5000,
    })
    // E6 等机型返回 405 Unsupported method — 由上层回退本地存储
    if (!reply.status) {
      if (/Unsupported method/i.test(reply.message ?? '') || reply.code === 4002) {
        throw new Error(`Get customPose failed: Unsupported method`)
      }
      return []
    }
    if (Array.isArray(reply.data)) {
      return (reply.data as Array<Record<string, unknown>>).map(item => ({
        name: String(item.name ?? ''),
        joint: Array.isArray(item.joint) ? item.joint.map(Number) : [],
      }))
    }
    return []
  }

  async setCustomPostures(postures: CustomPosture[]): Promise<void> {
    // 控制器 customPose 只接受关节姿态；笛卡尔由 docat 本地库保存
    const payload = postures
      .filter(p => (p.type ?? 'joint') === 'joint')
      .map((p, i) => ({
        name: String(p.name ?? '').trim() || `P${i + 1}`,
        joint: (Array.isArray(p.joint) ? p.joint : []).slice(0, 6).map(Number),
      }))
    const reply = await this.http.send({
      method: 'post',
      url: '/settings/function/customPose',
      portName: this.ip,
      params: payload,
      timeout: 10000,
    })
    if (!reply.status) {
      // 保留原始 errormessage，便于上层识别 Unsupported method 并回退
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
      params: data.coordList.map(denormalizeCoord),
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
      params: data.coordList.map(denormalizeCoord),
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

  // ─── 轨迹录制 / 复现（控制器端）────────────────

  async setThreeSwitch(value: boolean): Promise<void> {
    const reply = await this.http.send({
      method: 'post',
      url: '/panel/threeSwitch',
      portName: this.ip,
      params: { value },
      timeout: 5000,
    })
    if (!reply.status) throw new Error(`Set threeSwitch failed: ${reply.message}`)
  }

  async setRecurrentTrack(value: boolean): Promise<Record<string, unknown>> {
    const reply = await this.http.send({
      method: 'post',
      url: '/interface/recurrentTrack',
      portName: this.ip,
      params: { getpos: value },
      timeout: 5000,
    })
    if (!reply.status) throw new Error(`Set recurrentTrack failed: ${reply.message}`)
    return (reply.data ?? {}) as Record<string, unknown>
  }

  async getRecurrentTrackStatus(): Promise<{ isFinish: boolean; result: boolean }> {
    const reply = await this.http.send({
      method: 'get',
      url: '/interface/recurrentTrack',
      portName: this.ip,
      timeout: 5000,
    })
    if (!reply.status) throw new Error(`Get recurrentTrack failed: ${reply.message}`)
    const data = (reply.data ?? {}) as { isFinish?: boolean; result?: boolean }
    return { isFinish: !!data.isFinish, result: data.result === undefined ? true : !!data.result }
  }

  async getRetraceParams(): Promise<{ multi: number; const: number; loop: number }> {
    const reply = await this.http.send({
      method: 'get',
      url: '/settings/function/reTraceParams',
      portName: this.ip,
      timeout: 5000,
    })
    if (!reply.status) throw new Error(`Get reTraceParams failed: ${reply.message}`)
    const data = (reply.data ?? {}) as Partial<{ multi: number; const: number; loop: number }>
    return { multi: data.multi ?? 1, const: data.const ?? 0, loop: data.loop ?? 1 }
  }

  async setRetraceParams(params: { multi: number; const: number; loop: number }): Promise<void> {
    const reply = await this.http.send({
      method: 'post',
      url: '/settings/function/reTraceParams',
      portName: this.ip,
      params,
      timeout: 5000,
    })
    if (!reply.status) throw new Error(`Set reTraceParams failed: ${reply.message}`)
  }

  async setDebugReTrace(cmd: 'start' | 'stop', addr: string): Promise<void> {
    const reply = await this.http.send({
      method: 'post',
      url: '/interface/debugReTrace',
      portName: this.ip,
      params: { cmd: cmd === 'start' ? 'start' : 'stop', addr },
      timeout: 5000,
    })
    if (!reply.status) throw new Error(`Set debugReTrace failed: ${reply.message}`)
  }

  async getDebugReTrace(): Promise<{
    addr: string
    currentTimes: number
    isDone: boolean
    percent: number
    result: boolean
  }> {
    const reply = await this.http.send({
      method: 'get',
      url: '/interface/debugReTrace',
      portName: this.ip,
      timeout: 5000,
    })
    if (!reply.status) throw new Error(`Get debugReTrace failed: ${reply.message}`)
    const data = (reply.data ?? {}) as Partial<{
      addr: string
      currentTimes: number
      isDone: boolean
      percent: number
      result: boolean
    }>
    return {
      addr: data.addr ?? '',
      currentTimes: data.currentTimes ?? 0,
      isDone: !!data.isDone,
      percent: data.percent ?? 0,
      result: data.result === undefined ? true : !!data.result,
    }
  }

  // ─── Dobot+ 插件系统 ──────────────────────────
  // 管理接口在 22001；插件业务 API 在 getPorts 分配的动态端口（如 22100）

  async listDobotPlus(): Promise<string[]> {
    try {
      const reply = await this.httpPlus.send({
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
    const reply = await this.httpPlus.send({
      method: 'post',
      url: '/dobotPlus/install',
      portName: this.ip,
      params: { name },
      timeout: 60000,
    })
    if (!reply.status) throw new Error(`DobotPlus install failed: ${reply.message}`)
  }

  async uninstallDobotPlus(name: string): Promise<void> {
    const reply = await this.httpPlus.send({
      method: 'post',
      url: '/dobotPlus/uninstall',
      portName: this.ip,
      params: { name },
      timeout: 30000,
    })
    if (!reply.status) throw new Error(`DobotPlus uninstall failed: ${reply.message}`)
    this.pluginPortCache.delete(name)
  }

  async getDobotPlusPorts(): Promise<Record<string, unknown>> {
    const reply = await this.httpPlus.send({
      method: 'get',
      url: '/dobotPlus/getPorts',
      portName: this.ip,
      timeout: 5000,
    })
    if (reply.status && reply.data && typeof reply.data === 'object') {
      const ports = reply.data as Record<string, unknown>
      for (const [name, port] of Object.entries(ports)) {
        const n = Number(port)
        if (Number.isFinite(n) && n > 0) this.pluginPortCache.set(name, n)
      }
      return ports
    }
    return {}
  }

  private async resolvePluginPort(pluginName: string): Promise<number> {
    const cached = this.pluginPortCache.get(pluginName)
    if (cached) return cached
    const ports = await this.getDobotPlusPorts()
    const raw = ports[pluginName]
    const port = Number(raw)
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error(`插件 "${pluginName}" 未分配端口（可能未安装或未启动）`)
    }
    this.pluginPortCache.set(pluginName, port)
    return port
  }

  /**
   * 调用插件 HTTP API。
   * 官方路径：POST http://{ip}:{pluginPort}/dobotPlus/{pluginName}/{fn}
   * body 为 JSON 数组（Lua 变参）
   */
  async callDobotPlus(pluginName: string, fn: string, data: unknown = []): Promise<unknown> {
    const port = await this.resolvePluginPort(pluginName)
    const transport = new HttpTransport(this.ip, port)
    const payload = Array.isArray(data) ? data : (data === undefined || data === null ? [] : [data])
    const reply = await transport.send({
      method: 'post',
      url: `/dobotPlus/${pluginName}/${fn}`,
      portName: this.ip,
      params: payload,
      timeout: 10000,
    })
    if (!reply.status) {
      throw new Error(`Dobot+ ${pluginName}/${fn} failed: ${reply.message}`)
    }
    return reply.data
  }

  /** 解析已安装列表中的 DobotES01 完整包名 */
  private async findDobotES01Plugin(): Promise<string | null> {
    const list = await this.listDobotPlus()
    const hit = list.find(n => /^DobotES01/i.test(n))
    return hit ?? null
  }

  /** 吸盘最近一次指令状态：DI 反馈不可靠时作为状态回退 */
  private es01CmdState: 'grip' | 'release' | null = null

  /**
   * DobotES01 吸盘控制
   * - grip: ToolDO(1,1) 吸取
   * - release: ToolDO(1,0) 释放
   * - clearAlarm: ToolDO(2) 脉冲清错
   * - status: 优先用 exchange endDI 推断 0=吸附 1=释放 2=异常/未知；
   *           真实状态本应由 daemon 经 MQTT 推送（此处未接入），DI 未反映吸盘时回退到最近一次指令状态，
   *           避免“刚吸取就显示已释放”。
   */
  async controlDobotES01(action: 'grip' | 'release' | 'clearAlarm' | 'status'): Promise<unknown> {
    if (action === 'status') {
      // daemon 通过 MQTT 推送；这里用末端 DI 做即时状态
      // ToolDI1=1 → 吸附(0), ToolDI1=0 → 释放(1), ToolDI2=1 → 异常(2)
      const endDI = this.state.io?.endInput
      const di1 = Array.isArray(endDI) ? Number(endDI[0]?.value ?? 0) : 0
      const di2 = Array.isArray(endDI) ? Number(endDI[1]?.value ?? 0) : 0
      // raw exchange 可能有更直接的 endDI 数组
      const rawEndDI = (this.rawExchange as { endDI?: number[] }).endDI
      const t1 = Array.isArray(rawEndDI) ? Number(rawEndDI[0] ?? di1) : di1
      const t2 = Array.isArray(rawEndDI) ? Number(rawEndDI[1] ?? di2) : di2
      let status = 1
      if (t2 === 1) status = 2
      else if (t1 === 1) status = 0
      // DI 没反映吸盘（常见：ES01 经 485/插件通讯，末端 DI 恒为 0）时，跟随最近一次指令
      else status = this.es01CmdState === 'grip' ? 0 : 1
      return { status, toolDI1: t1, toolDI2: t2, source: t1 === 1 || t2 === 1 ? 'di' : 'cmd' }
    }

    const plugin = await this.findDobotES01Plugin()
    if (!plugin) {
      throw new Error('未安装 DobotES01 吸盘插件')
    }

    if (action === 'grip') {
      this.es01CmdState = 'grip'
      return this.callDobotPlus(plugin, 'DeControl', [1])
    }
    if (action === 'release') {
      this.es01CmdState = 'release'
      return this.callDobotPlus(plugin, 'DeControl', [0])
    }
    // clearAlarm
    return this.callDobotPlus(plugin, 'ClearESAlarm', [])
  }

  // ─── 通讯设置 ──────────────────────────────────

  async getMotionDefaults(): Promise<Record<string, unknown>> {
    const reply = await this.http.send({
      method: 'get',
      url: '/properties/default',
      portName: this.ip,
      timeout: 5000,
    })
    return (reply.status && reply.data) ? (reply.data as Record<string, unknown>) : {}
  }

  async getBus(): Promise<Record<string, unknown>> {
    const reply = await this.http.send({
      method: 'get',
      url: '/interface/bus',
      portName: this.ip,
      timeout: 5000,
    })
    return (reply.status && reply.data) ? (reply.data as Record<string, unknown>) : {}
  }

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
    if (reply.status && reply.data) {
      // 控制器字段：ip / netmask / gateway / dhcp（无 dns）
      const d = reply.data as Record<string, unknown>
      return {
        dhcp: Boolean(d.dhcp),
        ip: String(d.ip ?? ''),
        mask: String(d.netmask ?? ''),
        gateway: String(d.gateway ?? ''),
      }
    }
    return {}
  }

  async setEthernet(params: Record<string, unknown>): Promise<void> {
    const reply = await this.http.send({
      method: 'post',
      url: '/interface/ethernet',
      portName: this.ip,
      params: {
        dhcp: Boolean(params.dhcp),
        ip: String(params.ip ?? ''),
        netmask: String(params.mask ?? ''),
        gateway: String(params.gateway ?? ''),
      },
      timeout: 10000,
    })
    if (!reply.status) throw new Error(`Set Ethernet failed: ${reply.message}`)
  }

  // ─── 按键设置 ──────────────────────────────────

  async getButtonMode(): Promise<Record<string, unknown>> {
    const reply = await this.http.send({
      method: 'get',
      url: '/settings/function/runButtonModeE6',
      portName: this.ip,
      timeout: 5000,
    })
    return (reply.status && reply.data) ? (reply.data as Record<string, unknown>) : {}
  }

  async setButtonMode(params: Record<string, unknown>): Promise<void> {
    const reply = await this.http.send({
      method: 'post',
      url: '/settings/function/runButtonModeE6',
      portName: this.ip,
      params,
      timeout: 10000,
    })
    if (!reply.status) throw new Error(`Set button mode failed: ${reply.message}`)
  }

  // ─── 电源设置 ──────────────────────────────────

  async getCCBoxVoltage(): Promise<Record<string, unknown>> {
    const reply = await this.http.send({
      method: 'get',
      url: '/settings/function/ccboxVoltage',
      portName: this.ip,
      timeout: 5000,
    })
    return (reply.status && reply.data) ? (reply.data as Record<string, unknown>) : {}
  }

  async setCCBoxVoltage(params: Record<string, unknown>): Promise<void> {
    const reply = await this.http.send({
      method: 'post',
      url: '/settings/function/ccboxVoltage',
      portName: this.ip,
      params,
      timeout: 10000,
    })
    if (!reply.status) throw new Error(`Set ccboxVoltage failed: ${reply.message}`)
  }

  // ─── 拖动设置 ──────────────────────────────────

  async getDragSensivity(): Promise<Record<string, unknown>> {
    const reply = await this.http.send({
      method: 'get',
      url: '/settings/function/dragSensivity',
      portName: this.ip,
      timeout: 5000,
    })
    return (reply.status && reply.data) ? (reply.data as Record<string, unknown>) : {}
  }

  async setDragSensivity(params: Record<string, unknown>): Promise<void> {
    const reply = await this.http.send({
      method: 'post',
      url: '/settings/function/dragSensivity',
      portName: this.ip,
      params,
      timeout: 10000,
    })
    if (!reply.status) throw new Error(`Set dragSensivity failed: ${reply.message}`)
  }

  // ─── 远程控制 ──────────────────────────────────

  async getRemoteIOCtrl(): Promise<Record<string, unknown>> {
    const reply = await this.http.send({
      method: 'get',
      url: '/settings/function/ioCtrl',
      portName: this.ip,
      timeout: 5000,
    })
    return (reply.status && reply.data) ? (reply.data as Record<string, unknown>) : {}
  }

  async setRemoteIOCtrl(params: Record<string, unknown>): Promise<void> {
    const reply = await this.http.send({
      method: 'post',
      url: '/settings/function/ioCtrl',
      portName: this.ip,
      params,
      timeout: 10000,
    })
    if (!reply.status) throw new Error(`Set ioCtrl failed: ${reply.message}`)
  }

  async getRemoteModbus(): Promise<Record<string, unknown>> {
    const reply = await this.http.send({
      method: 'get',
      url: '/settings/function/modbusCtrl',
      portName: this.ip,
      timeout: 5000,
    })
    return (reply.status && reply.data) ? (reply.data as Record<string, unknown>) : {}
  }

  async setRemoteModbus(params: Record<string, unknown>): Promise<void> {
    const reply = await this.http.send({
      method: 'post',
      url: '/settings/function/modbusCtrl',
      portName: this.ip,
      params,
      timeout: 10000,
    })
    if (!reply.status) throw new Error(`Set modbusCtrl failed: ${reply.message}`)
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
          dragPlayback: !!raw.dragPlayback,
          dragTrack: !!raw.dragTrack,
          dragTeach: !!raw.dragTeach,
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

/** 控制器返回的原始坐标项：值为 params[] 数组 + alias/enable/caliType/rawP0..rawP5 */
interface CoordinateItemRaw {
  alias?: string
  enable?: boolean
  params?: Array<number | string>
  caliType?: number
  [key: string]: unknown
}

/** 解析坐标项：id=数组下标，值在 params 中（MG6: [x,y,z,r,0,0]；CR: [x,y,z,rx,ry,rz]） */
function normalizeCoord(item: CoordinateItemRaw, index: number) {
  const params = Array.isArray(item.params) ? item.params.map(Number) : []
  const get = (i: number) => Number(params[i] ?? 0)
  const alias = String(item.alias ?? '')
  return {
    id: String(index),
    name: alias,
    alias,
    enable: Boolean(item.enable),
    x: get(0),
    y: get(1),
    z: get(2),
    r: get(3),
    rx: get(3),
    ry: get(4),
    rz: get(5),
    raw: item,
  }
}

/** 把前端扁平坐标项还原为控制器线格式（保留 rawP0..rawP5 标定数据） */
function denormalizeCoord(item: CoordinateItem): Record<string, unknown> {
  const raw = (item.raw && typeof item.raw === 'object' ? item.raw : {}) as Record<string, unknown>
  const out: Record<string, unknown> = {
    alias: item.alias ?? '',
    caliType: Number(raw.caliType ?? 0),
    enable: Boolean(item.enable),
    params: [
      Number(item.x ?? 0),
      Number(item.y ?? 0),
      Number(item.z ?? 0),
      Number(item.rx ?? 0),
      Number(item.ry ?? 0),
      Number(item.rz ?? 0),
    ],
  }
  for (let i = 0; i < 6; i++) {
    const key = `rawP${i}`
    if (raw[key] !== undefined) {
      out[key] = raw[key]
    } else {
      // 新增坐标系没有标定原点：补零默认值
      out[key] = { coordinate: [0, 0, 0, 0, 0, 0], joint: [0, 0, 0, 0, 0, 0], user: 0, tool: 0 }
    }
  }
  return out
}
