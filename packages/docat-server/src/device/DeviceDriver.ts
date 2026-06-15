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

  // ─── 告警 ──────────────────────────────────────
  abstract getAlarms(): Promise<Array<{ id: number; level: number; description: string; solution: string; date: string; time: string }>>
  abstract getWarnings(): Promise<Array<{ id: number; level: number; description: string; solution: string; date: string; time: string }>>
  abstract clearAlarm(): Promise<void>
  abstract resetCollision(): Promise<void>

  // ─── 运动控制 ──────────────────────────────────
  abstract setJogMode(mode: 'jog' | 'step'): Promise<void>
  abstract setTeachInch(distance: number): Promise<void>
  abstract jog(params: JogParams): Promise<void>
  abstract moveTo(pose: MoveParams): Promise<void>
  abstract moveJoints(joints: number[]): Promise<void>
  abstract moveJointsCommand(joints: number[], value: boolean): Promise<Record<string, unknown>>
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

  // ─── Dobot+ 插件系统 ──────────────────────────

  /** 列出已安装的 Dobot+ 插件 */
  abstract listDobotPlus(): Promise<string[]>

  /** 安装 Dobot+ 插件 */
  abstract installDobotPlus(name: string): Promise<void>

  /** 卸载 Dobot+ 插件 */
  abstract uninstallDobotPlus(name: string): Promise<void>

  /** 获取 Dobot+ 插件端口分配 */
  abstract getDobotPlusPorts(): Promise<Record<string, unknown>>

  // ─── 通讯设置 ──────────────────────────────────

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

/** 自定义姿态 */
export interface CustomPosture {
  name: string
  joint: number[]
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
  enable: boolean
  x?: number
  y?: number
  z?: number
  r?: number
  rx?: number
  ry?: number
  rz?: number
}
