/**
 * 设备驱动抽象基类 — 定义统一接口
 * 不同类型的设备（CR/Nova/MG6/Magician）实现具体逻辑
 */
import type {
  CartesianPose,
  DeviceState,
  DeviceStatus,
  FirmwareVersion,
  JogParams,
  JointPose,
  MoveParams,
} from 'docat-shared/types'

export type DeviceTypeName = 'CR' | 'Nova' | 'MG6' | 'Magician'

export abstract class DeviceDriver {
  abstract readonly id: string
  abstract readonly type: DeviceTypeName
  abstract readonly ip: string
  abstract status: DeviceStatus
  abstract state: DeviceState

  // ─── 生命周期 ──────────────────────────────────
  abstract connect(): Promise<void>
  abstract disconnect(): Promise<void>

  // ─── 伺服电源 ──────────────────────────────────
  abstract powerOn(): Promise<void>
  abstract powerOff(): Promise<void>

  // ─── 使能控制 ──────────────────────────────────
  abstract enable(): Promise<void>
  abstract disable(): Promise<void>

  // ─── 模式切换 ──────────────────────────────────
  abstract setAutoManualSwitch(value: boolean): Promise<void>
  abstract getAutoManualSwitch(): Promise<boolean>
  abstract setAutoManualMode(mode: 'auto' | 'manual'): Promise<void>
  abstract setRemoteSwitch(value: boolean): Promise<void>
  abstract getRemoteSwitch(): Promise<boolean>
  abstract setRemoteControl(mode: 'online' | 'tcp'): Promise<void>
  abstract getRemoteControl(): Promise<'online' | 'tcp'>

  // ─── 告警 ──────────────────────────────────────
  abstract getAlarms(): Promise<Array<{ id: number; level: number; description: string; solution: string; date: string; time: string }>>
  abstract getWarnings(): Promise<Array<{ id: number; level: number; description: string; solution: string; date: string; time: string }>>
  abstract clearAlarm(): Promise<void>
  abstract resetCollision(): Promise<void>

  // ─── 运动控制 ──────────────────────────────────
  abstract setJogMode(mode: 'jog' | 'step'): Promise<void>
  abstract setTeachInch(distance: number): Promise<void>
  /** 切换点动坐标系：joint / cartesian / tool */
  abstract setJogCoordinate(mode: 'joint' | 'cartesian' | 'tool'): Promise<void>
  abstract jog(params: JogParams): Promise<void>
  /** 仅清除点动按钮（panel/jog 全 false），比 stop 更轻、更适合即走即停 */
  abstract stopJog(): Promise<void>
  abstract moveTo(pose: MoveParams): Promise<void>
  abstract moveJoints(joints: number[]): Promise<void>
  abstract moveJointsCommand(joints: number[], value: boolean): Promise<Record<string, unknown>>
  /**
   * 统一点到点运动（对齐官方 /interface/movJ | movL）
   * - path: MovJ=关节插补路径，MovL=直线路径（与目标用 joint 还是 pose 无关）
   * - 目标可用 joint 和/或 pose；两者都给时与官方 runto 一致
   * @see dobot-docs Motion.md: MovJ/MovL 均可接受 {joint=...} 或 {pose=...}
   */
  abstract movePoint(params: {
    path?: 'MovJ' | 'MovL'
    joint?: number[]
    pose?: number[] // [x,y,z,rx,ry,rz]
    user?: number
    tool?: number
  }): Promise<Record<string, unknown>>
  /** @deprecated 请用 movePoint({ path:'MovL', pose })；保留兼容 */
  abstract moveCartesian(params: {
    x: number; y: number; z: number
    rx: number; ry: number; rz: number
    user?: number; tool?: number
    jointNear?: number[]
    path?: 'MovJ' | 'MovL'
  }): Promise<Record<string, unknown>>
  abstract inverseKinematics(params: { coordinate: number[]; jointNear: number[]; user?: number; tool?: number }): Promise<{ joint: number[]; errID: number; errMsg?: string }>
  abstract forwardKinematics(params: { joint: number[]; user?: number; tool?: number }): Promise<{ coordinate: number[]; errID: number; errMsg?: string }>
  abstract home(): Promise<void>
  abstract stop(): Promise<void>
  abstract emergencyStop(): Promise<void>

  // ─── 状态查询 ──────────────────────────────────
  abstract getPose(): Promise<CartesianPose>
  abstract getJoints(): Promise<JointPose>
  abstract getStatus(): Promise<DeviceStatus>
  abstract getVersion(): Promise<FirmwareVersion>
  abstract pollState(): Promise<DeviceState>

  // ─── 负载参数 ──────────────────────────────────

  /** 获取当前负载参数 */
  abstract getLoadParams(): Promise<LoadParams>

  /** 设置当前负载参数 */
  abstract setLoadParams(params: LoadParams): Promise<void>

  /** 获取全部负载预设组 */
  abstract getLoadConfig(): Promise<LoadParams[]>

  /** 替换全部负载预设组 */
  abstract setLoadConfig(config: LoadParams[]): Promise<void>

  // ─── 自定义姿态（控制器端存储的关节预设）──────

  /** 获取全部自定义姿态 */
  abstract getCustomPostures(): Promise<CustomPosture[]>

  /** 替换全部自定义姿态 */
  abstract setCustomPostures(postures: CustomPosture[]): Promise<void>

  // ─── 系统设置 ──────────────────────────────────

  /** 获取系统时间 */
  abstract getSystemTime(): Promise<SystemTime>

  /** 设置系统时间 */
  abstract setSystemTime(time: SystemTime): Promise<void>

  /** 设置机器人别名 */
  abstract setDeviceAlias(alias: string): Promise<void>

  // ─── 用户管理 ──────────────────────────────────

  /** 获取用户列表 */
  abstract getUserList(): Promise<UserList>

  /** 设置用户列表 */
  abstract setUserList(list: UserList): Promise<void>

  /** 获取权限配置 */
  abstract getUserConfig(): Promise<UserPermissionConfig[]>

  /** 设置权限配置 */
  abstract setUserConfig(config: UserPermissionConfig[]): Promise<void>

  // ─── 坐标系管理 ────────────────────────────────

  /** 获取用户坐标系列表 */
  abstract getUserCoordinate(): Promise<CoordinateData>

  /** 设置用户坐标系 */
  abstract setUserCoordinate(data: CoordinateData): Promise<void>

  /** 获取工具坐标系列表 */
  abstract getToolCoordinate(): Promise<CoordinateData>

  /** 设置工具坐标系 */
  abstract setToolCoordinate(data: CoordinateData): Promise<void>

  // ─── 运动参数 ──────────────────────────────────

  /** 获取再现关节参数 */
  abstract getPlaybackJointParams(): Promise<Record<string, unknown>>

  /** 设置再现关节参数 */
  abstract setPlaybackJointParams(params: Record<string, unknown>): Promise<void>

  /** 获取再现坐标参数 */
  abstract getPlaybackCoordinateParams(): Promise<Record<string, unknown>>

  /** 设置再现坐标参数 */
  abstract setPlaybackCoordinateParams(params: Record<string, unknown>): Promise<void>

  /** 获取示教关节参数 (jog) */
  abstract getTeachJointParams(): Promise<Record<string, unknown>>

  /** 设置示教关节参数 */
  abstract setTeachJointParams(params: Record<string, unknown>): Promise<void>

  /** 获取示教坐标参数 */
  abstract getTeachCoordinateParams(): Promise<Record<string, unknown>>

  /** 设置示教坐标参数 */
  abstract setTeachCoordinateParams(params: Record<string, unknown>): Promise<void>

  // ─── 轨迹录制 / 复现（控制器端）────────────────

  /** 三位开关控制（轨迹拖拽录制前需要打开） */
  abstract setThreeSwitch(value: boolean): Promise<void>

  /** 启停控制器端轨迹录制（getpos: true 开始采集，false 保存） */
  abstract setRecurrentTrack(value: boolean): Promise<Record<string, unknown>>

  /** 查询轨迹录制状态（isFinish: 控制器已停止录制并生成文件） */
  abstract getRecurrentTrackStatus(): Promise<{ isFinish: boolean; result: boolean }>

  /** 获取轨迹复现参数（multi 速度倍率 / const 是否匀速 / loop 次数） */
  abstract getRetraceParams(): Promise<{ multi: number; const: number; loop: number }>

  /** 设置轨迹复现参数 */
  abstract setRetraceParams(params: { multi: number; const: number; loop: number }): Promise<void>

  /** 启停轨迹复现（addr 为控制器上的轨迹文件名，含后缀） */
  abstract setDebugReTrace(cmd: 'start' | 'stop', addr: string): Promise<void>

  /** 查询轨迹复现状态 */
  abstract getDebugReTrace(): Promise<{
    addr: string
    currentTimes: number
    isDone: boolean
    percent: number
    result: boolean
  }>

  // ─── Dobot+ 插件系统 ──────────────────────────

  /** 列出已安装的 Dobot+ 插件 */
  abstract listDobotPlus(): Promise<string[]>

  /** 安装 Dobot+ 插件 */
  abstract installDobotPlus(name: string): Promise<void>

  /** 卸载 Dobot+ 插件 */
  abstract uninstallDobotPlus(name: string): Promise<void>

  /** 获取 Dobot+ 插件端口分配 */
  abstract getDobotPlusPorts(): Promise<Record<string, unknown>>

  /**
   * 调用 Dobot+ 插件 HTTP API
   * 实际请求发往插件端口，路径形如 /dobotPlus/{pluginName}/{fn}
   */
  abstract callDobotPlus(
    pluginName: string,
    fn: string,
    data?: unknown,
  ): Promise<unknown>

  /** DobotES01 吸盘：吸取 / 释放 / 清错 / 状态 */
  abstract controlDobotES01(action: 'grip' | 'release' | 'clearAlarm' | 'status'): Promise<unknown>

  // ─── 通讯设置 ──────────────────────────────────

  /** 获取总线通讯参数 */
  abstract getBus(): Promise<Record<string, unknown>>

  /** 获取运动参数默认值（/properties/default：teach/playback 的 velocity/acceleration/jerk min/max/def） */
  abstract getMotionDefaults(): Promise<Record<string, unknown>>

  /** 设置总线通讯参数 */
  abstract setBus(params: Record<string, unknown>): Promise<void>

  /** 获取 WiFi 配置 */
  abstract getWiFi(): Promise<Record<string, unknown>>

  /** 设置 WiFi 配置 */
  abstract setWiFi(params: Record<string, unknown>): Promise<void>

  /** 获取以太网配置 */
  abstract getEthernet(): Promise<Record<string, unknown>>

  /** 设置以太网配置 */
  abstract setEthernet(params: Record<string, unknown>): Promise<void>

  // ─── 脚本 / 项目 ─────────────────────────────
  abstract runScript(script: string): Promise<void>
  abstract stopScript(): Promise<void>
  abstract uploadScript(name: string, content: string): Promise<void>
  abstract listProjects(): Promise<string[]>
  abstract runProject(name: string): Promise<void>
  abstract deleteProject(name: string): Promise<void>
}

/** 负载参数 */
export interface LoadParams {
  name: string
  centerX: number
  centerY: number
  centerZ: number
  loadValue: number
}

/** 自定义姿态（关节 或 笛卡尔） */
export type CustomPostureType = 'joint' | 'cartesian'

export interface CustomPosturePose {
  x: number
  y: number
  z: number
  rx: number
  ry: number
  rz: number
}

export interface CustomPosture {
  name: string
  /** joint（默认）| cartesian */
  type?: CustomPostureType
  /** 关节角 J1..J6；cartesian 时可为空/占位 */
  joint: number[]
  /** 笛卡尔位姿；仅 type=cartesian 时有效 */
  pose?: CustomPosturePose
}

/** 系统时间 */
export interface SystemTime {
  date?: string
  time?: string
  timeZone?: string
}

/** 用户列表 */
export interface UserList {
  defaultLevel: number
  list: ControllerUser[]
}

export interface ControllerUser {
  level: number
  name: string
  password: string
  enablePassword: boolean
}

/** 权限配置 */
export interface UserPermissionConfig {
  level: number
  config: Record<string, number>
}

/** 坐标系数据 */
export interface CoordinateData {
  coordList: CoordinateItem[]
}

export interface CoordinateItem {
  id?: string
  name: string
  alias?: string
  enable: boolean
  x?: number
  y?: number
  z?: number
  r?: number
  rx?: number
  ry?: number
  rz?: number
  /** 控制器原始数据（params / rawP0..rawP5 / caliType），写回时透传保留标定数据 */
  raw?: Record<string, unknown>
}
