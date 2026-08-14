/**
 * 编排真实模式 API — 与 docat-server 的 /api/orchestration 交互
 * 后端阶段实现；当前非 mock=1 时页面会真实请求这些接口（未实现则返回错误）。
 */
import { request } from './api'
import type { ApiResponse } from 'docat-shared/types'
import type { OrchDevice, OrchPose, OrchSettings } from '../stores/orchestrationStore'

// ─── 编排设备 ────────────────────────────────────────

export interface OrchDevicePayload {
  name: string
  type: string
  ip: string
  port: number
  serialPort: string
  baudRate: number
  targetDeviceId: string
  autoReconnect: boolean
  heartbeat: boolean
}

export function orchListDevices(): Promise<ApiResponse<OrchDevice[]>> {
  return request('GET', '/api/orchestration/devices')
}

export function orchCreateDevice(input: OrchDevicePayload): Promise<ApiResponse<OrchDevice>> {
  return request('POST', '/api/orchestration/devices', input)
}

export function orchUpdateDevice(id: string, patch: Partial<OrchDevicePayload>): Promise<ApiResponse<OrchDevice>> {
  return request('PUT', `/api/orchestration/devices/${id}`, patch)
}

export function orchDeleteDevice(id: string): Promise<ApiResponse<null>> {
  return request('DELETE', `/api/orchestration/devices/${id}`)
}

export function orchConnect(id: string, auto = false): Promise<ApiResponse<null>> {
  return request('POST', `/api/orchestration/devices/${id}/connect`, { auto })
}

export function orchDisconnect(id: string): Promise<ApiResponse<null>> {
  return request('POST', `/api/orchestration/devices/${id}/disconnect`)
}

export function orchSend(id: string, message: string): Promise<ApiResponse<null>> {
  return request('POST', `/api/orchestration/devices/${id}/send`, { message })
}

// ─── 姿态（独立于设备页姿态）────────────────────────

export function orchListPoses(): Promise<ApiResponse<OrchPose[]>> {
  return request('GET', '/api/orchestration/poses')
}

export function orchSavePose(pose: OrchPose): Promise<ApiResponse<OrchPose>> {
  return request('POST', '/api/orchestration/poses', pose)
}

export function orchDeletePose(name: string): Promise<ApiResponse<null>> {
  return request('DELETE', `/api/orchestration/poses/${encodeURIComponent(name)}`)
}

// ─── 设置 ────────────────────────────────────────────

export function orchGetSettings(): Promise<ApiResponse<OrchSettings>> {
  return request('GET', '/api/orchestration/settings')
}

export function orchSaveSettings(settings: OrchSettings): Promise<ApiResponse<OrchSettings>> {
  return request('PUT', '/api/orchestration/settings', settings)
}

// ─── 脚本运行（后端运行器）──────────────────────────

export function orchScriptRun(params: { language: 'javascript' | 'python'; content: string; fileName: string }): Promise<ApiResponse<null>> {
  return request('POST', '/api/orchestration/script/run', params)
}

export function orchScriptStop(): Promise<ApiResponse<null>> {
  return request('POST', '/api/orchestration/script/stop')
}

// ─── 脚本文件（服务端本地目录，后端监听变更）────────

export interface OrchScriptFileInfo {
  name: string
  size: number
  mtime: number
}

export function orchListScripts(): Promise<ApiResponse<OrchScriptFileInfo[]>> {
  return request('GET', '/api/orchestration/scripts')
}

export function orchCreateScript(name: string): Promise<ApiResponse<{ name: string; mtime: number }>> {
  return request('POST', '/api/orchestration/scripts', { name })
}

export function orchGetScript(name: string): Promise<ApiResponse<{ name: string; content: string; mtime: number }>> {
  return request('GET', `/api/orchestration/scripts/${encodeURIComponent(name)}`)
}

export function orchSaveScript(name: string, content: string): Promise<ApiResponse<{ mtime: number }>> {
  return request('PUT', `/api/orchestration/scripts/${encodeURIComponent(name)}`, { content })
}

/** 在服务端用 VSCode 打开脚本目录 */
export function orchOpenScriptsInEditor(): Promise<ApiResponse<{ dir: string }>> {
  return request('POST', '/api/orchestration/scripts/open-in-editor')
}

/** 服务端可用串口列表 */
export function orchListSerialPorts(): Promise<ApiResponse<string[]>> {
  return request('GET', '/api/orchestration/serial-ports')
}

/** 模块导出成员清单（require 自动补全用） */
export interface OrchModuleMember {
  name: string
  type: string
}

export function orchListModuleMembers(moduleName: string): Promise<ApiResponse<{ members: OrchModuleMember[] } | { error: string }>> {
  return request('POST', '/api/orchestration/scripts/module-members', { name: moduleName })
}

/** Python 模块导出成员清单（import 自动补全用；用服务端配置的 Python 解释器探测） */
export function orchListPythonModuleMembers(moduleName: string): Promise<ApiResponse<{ members: OrchModuleMember[] } | { error: string }>> {
  return request('POST', '/api/orchestration/scripts/python-module-members', { name: moduleName })
}
