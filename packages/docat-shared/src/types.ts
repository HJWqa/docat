/**
 * docat 共享类型定义
 * 从 OpenDobot46 提取并适配 Client-Server 架构
 * @see OpenDobot46/src.vm/dobotvm/device/type.ts
 * @see OpenDobot46/src.dobotlink/http/type.ts
 */

import { ControllerBuildType } from './protocol.js'

// ─── 设备发现与连接 ────────────────────────────

export interface DeviceInfo {
  portName: string
  status: string
  type: string
  alias: string
  buildType: ControllerBuildType
  controllerTypeExt: string
}

// ─── HTTP 请求 / 响应 ──────────────────────────

export interface TransportParams {
  method: string
  portName: string
  url: string
  needBaseUrl?: boolean
  params?: unknown
  timeout?: number
}

export interface TransportReply<T = unknown> {
  status: boolean
  code: number
  data?: T
  message?: string
}

// ─── 笛卡尔位姿 ───────────────────────────────

export interface CartesianPose {
  x: number
  y: number
  z: number
  r?: number
  l?: number
  rx?: number
  ry?: number
  rz?: number
  arm?: 0 | 1
  setCoordinate?: {
    user: CoordinateData
    tool: CoordinateData
  }
  recoverCoordinate?: {
    user: CoordinateData
    tool: CoordinateData
  }
}

export interface CoordinateData {
  x: number
  y: number
  z: number
  rx: number
  ry: number
  rz: number
}

// ─── 关节位姿 ────────────────────────────────

export interface JointPose {
  j1: number
  j2: number
  j3: number
  j4: number
  j5?: number
  j6?: number
}

// ─── 运动参数 ────────────────────────────────

export type JogAxis = 'x' | 'y' | 'z' | 'rx' | 'ry' | 'rz' | 'r' | 'j1' | 'j2' | 'j3' | 'j4' | 'j5' | 'j6'

/** 点动坐标系类型（对齐控制器 /interface/coordinate） */
export type JogCoordinate = 'joint' | 'cartesian' | 'tool'

export interface JogParams {
  axis: JogAxis
  direction: '+' | '-'
  mode: 'continuous' | 'step'
  stepValue?: number
}

export interface MoveParams {
  x: number
  y: number
  z: number
  r?: number
  mode: 'go' | 'move' | 'jump'
  tool?: number
  user?: number
  armOrientation?: 'left' | 'right'
  cfg?: number
}

// ─── IO 状态 ──────────────────────────────────

export interface IOState {
  input?: IOAddress[]
  output?: IOAddress[]
  adc?: IOAddress[]
  endInput?: IOAddress[]
  endOutput?: IOAddress[]
  extendDO?: number[][]
  extendDI?: number[][]
  ioAI?: number[]
  endAI?: number[]
  gpioAO?: number[]
}

export interface IOAddress {
  address: number
  value?: number
}

// ─── 设备状态 ────────────────────────────────

export interface DeviceState {
  pose: CartesianPose
  joints: JointPose
  io: IOState
  alarm: AlarmInfo[]
  status: DeviceStatus
  timestamp: number
  /** 控制器实时状态：是否正在轨迹复现（拖拽复现） */
  dragPlayback?: boolean
  /** 控制器实时状态：是否正在轨迹录制（拖拽录制） */
  dragTrack?: boolean
  /** 控制器实时状态：是否正在拖拽示教 */
  dragTeach?: boolean
}

export interface DeviceStatus {
  connected: boolean
  running: boolean
  paused: boolean
  emergencyStopped: boolean
  error: boolean
  mode: 'manual' | 'auto' | 'teach'
}

export interface AlarmInfo {
  id: number
  level: 'warning' | 'error' | 'fatal'
  message: string
  timestamp: number
}

// ─── 固件信息 ────────────────────────────────

export interface FirmwareVersion {
  controller: string
  servo: string
  version: string
  controllerTypeExt: string
}

// ─── 设备配置 ────────────────────────────────

export interface DeviceConfig {
  id: string
  ip: string
  name: string
  type: string
  autoConnect: boolean
  createdAt: string
}

// ─── 用户与鉴权 ──────────────────────────────

export type UserRole = 'admin' | 'operator' | 'viewer'

export interface User {
  id: string
  username: string
  role: UserRole
  createdAt: string
}

export interface AuthToken {
  token: string
  userId: string
  username: string
  role: UserRole
  expiresAt: string
}

// ─── 脚本 ────────────────────────────────────

export type ScriptLanguage = 'lua' | 'python' | 'blockly'

export interface Script {
  id: string
  userId: string
  name: string
  content: string
  language: ScriptLanguage
  deviceId?: string
  createdAt: string
  updatedAt: string
}

// ─── 操作日志 ────────────────────────────────

export interface AuditLogEntry {
  id: string
  userId: string
  action: string
  deviceId: string
  detail: string
  createdAt: string
}

// ─── 设备访问 ────────────────────────────────

export type AccessMode = 'exclusive' | 'shared' | 'subscribe'

export interface AccessRequest {
  clientId: string
  deviceId: string
  mode: AccessMode
  timeout?: number
}

export interface AccessGrant {
  token: string
  deviceId: string
  mode: AccessMode
  expiresAt: number
}

// ─── 项目（设备端文件） ──────────────────────

export interface DeviceProject {
  name: string
  path: string
  size: number
  modifiedAt: string
}

// ─── WebSocket 事件 ──────────────────────────

export type WSEventType =
  | 'subscribe'
  | 'unsubscribe'
  | 'state'
  | 'peer-action'
  | 'device-online'
  | 'device-offline'
  | 'device-error'
  | 'alarm'
  | 'runtime-log'
  | 'runtime-cursor'
  /** 实时点动（低延迟）：浏览器 → server → 设备，不经 REST */
  | 'jog'
  | 'jog-stop'
  | 'jog-ack'
  | 'error'
  /** 编排（orchestration）事件通道：data.event ∈ device-status | log | pose | script-status */
  | 'orch-event'

export interface WSMessage {
  type: WSEventType
  deviceId?: string
  data?: unknown
  user?: string
  action?: string
  params?: unknown
  timestamp?: number
}

/** WS 点动指令载荷 */
export interface WSJogCommand {
  axis: string
  direction: '+' | '-'
  mode?: 'continuous' | 'step'
}

// ─── API 通用响应格式 ─────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: {
    code: number
    message: string
    /** 设备连接状态（occupied / unconnected / null） */
    status?: string | null
  }
  meta?: {
    page?: number
    pageSize?: number
    total?: number
  }
  /** 响应命中本地缓存（秒回，内容可能过期，客户端应后台刷新） */
  cached?: boolean
  /** 缓存内容为陈旧回退（控制器不可达时的兜底） */
  stale?: boolean
  /** 缓存写入时间 */
  cachedAt?: string
}
