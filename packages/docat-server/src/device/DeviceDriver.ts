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

  // ─── 脚本 / 项目 ─────────────────────────────
  abstract runScript(script: string): Promise<void>
  abstract stopScript(): Promise<void>
  abstract uploadScript(name: string, content: string): Promise<void>
  abstract listProjects(): Promise<string[]>
  abstract runProject(name: string): Promise<void>
  abstract deleteProject(name: string): Promise<void>
}
