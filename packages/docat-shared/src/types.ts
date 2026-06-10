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

export interface JogParams {
  axis: 'x' | 'y' | 'z' | 'r' | 'j1' | 'j2' | 'j3' | 'j4' | 'j5' | 'j6'
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

export interface WSMessage {
  type: WSEventType
  deviceId?: string
  data?: unknown
  user?: string
  action?: string
  params?: unknown
  timestamp?: number
}

// ─── API 通用响应格式 ─────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: {
    code: number
    message: string
  }
  meta?: {
    page?: number
    pageSize?: number
    total?: number
  }
}
