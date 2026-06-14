/**
 * docat API 客户端 — REST + WebSocket
 */
import type {
  ApiResponse,
  AuthToken,
  DeviceConfig,
  DeviceInfo,
  DeviceState,
  Script,
  ScriptLanguage,
  User,
  UserRole,
} from 'docat-shared/types'
import { getApiBaseUrl } from './runtime'

const BASE = getApiBaseUrl()

async function request<T>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

// ─── Auth ────────────────────────────────────────

export async function login(username: string, password: string): Promise<ApiResponse<AuthToken>> {
  return request('POST', '/api/auth/login', { username, password })
}

export async function register(username: string, password: string, role?: UserRole): Promise<ApiResponse<User>> {
  return request('POST', '/api/auth/register', { username, password, role })
}

export async function me(): Promise<ApiResponse<User>> {
  return request('GET', '/api/auth/me')
}

export async function logout(): Promise<ApiResponse<null>> {
  return request('POST', '/api/auth/logout')
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<ApiResponse<null>> {
  return request('PUT', '/api/auth/password', { currentPassword, newPassword })
}

export async function switchUser(username: string, password: string): Promise<ApiResponse<AuthToken>> {
  return request('POST', '/api/auth/switch', { username, password })
}

// ─── Users (admin) ───────────────────────────────

export async function listUsers(): Promise<ApiResponse<User[]>> {
  return request('GET', '/api/users')
}

export async function updateUser(id: string, params: { username?: string; role?: UserRole }): Promise<ApiResponse<User>> {
  return request('PUT', `/api/users/${id}`, params)
}

export async function deleteUser(id: string): Promise<ApiResponse<null>> {
  return request('DELETE', `/api/users/${id}`)
}

export async function resetUserPassword(id: string, password: string): Promise<ApiResponse<null>> {
  return request('PUT', `/api/users/${id}/password`, { password })
}

// ─── Devices ────────────────────────────────────

export async function listDevices(): Promise<ApiResponse<DeviceConfig[]>> {
  return request('GET', '/api/devices')
}

export async function scanDevices(): Promise<ApiResponse<DeviceInfo[]>> {
  return request('GET', '/api/devices/scan')
}

export async function registerDevice(ip: string, name: string, autoConnect = true): Promise<ApiResponse<DeviceConfig>> {
  return request('POST', '/api/devices', { ip, name, autoConnect })
}

export async function updateDevice(id: string, params: { ip?: string; name?: string; type?: string; autoConnect?: boolean }): Promise<ApiResponse<DeviceConfig>> {
  return request('PUT', `/api/devices/${id}`, params)
}

export async function deleteDevice(id: string): Promise<ApiResponse<null>> {
  return request('DELETE', `/api/devices/${id}`)
}

export async function connectDevice(id: string, mode?: 'exclusive' | 'virtual'): Promise<ApiResponse<unknown>> {
  return request('POST', `/api/devices/${id}/connect`, { mode: mode ?? 'exclusive' })
}

export async function getDeviceStatus(id: string): Promise<ApiResponse<{
  connected: boolean
  status: Record<string, unknown> | null
  state: Record<string, unknown> | null
}>> {
  return request('GET', `/api/devices/${id}/status`)
}

export interface JointPreset {
  id: string
  name: string
  joints: number[]
  system: boolean
  sortOrder: number
}

export async function listJointPresets(id: string): Promise<ApiResponse<JointPreset[]>> {
  return request('GET', `/api/devices/${id}/jointPresets`)
}

export async function createJointPreset(id: string, name: string, joints: number[]): Promise<ApiResponse<JointPreset>> {
  return request('POST', `/api/devices/${id}/jointPresets`, { name, joints })
}

export async function updateJointPreset(id: string, presetId: string, params: { name?: string; joints?: number[] }): Promise<ApiResponse<JointPreset>> {
  return request('PUT', `/api/devices/${id}/jointPresets/${presetId}`, params)
}

export async function deleteJointPreset(id: string, presetId: string): Promise<ApiResponse<null>> {
  return request('DELETE', `/api/devices/${id}/jointPresets/${presetId}`)
}

export async function reorderJointPresets(id: string, presetIds: string[]): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/jointPresets/reorder`, { presetIds })
}

export async function forceReleaseDevice(id: string): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/forceRelease`)
}

export async function disconnectDevice(id: string): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/disconnect`)
}

export async function lockDevice(id: string, timeout?: number): Promise<ApiResponse<unknown>> {
  return request('POST', `/api/devices/${id}/lock`, { timeout })
}

export async function releaseDevice(id: string): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/release`)
}

export async function subscribeDevice(id: string): Promise<ApiResponse<unknown>> {
  return request('POST', `/api/devices/${id}/subscribe`)
}

export async function getDeviceSpeed(id: string): Promise<ApiResponse<{ ratio: number }>> {
  return request('GET', `/api/devices/${id}/speed`)
}

export async function setDeviceSpeed(id: string, ratio: number): Promise<ApiResponse<{ ratio: number }>> {
  return request('POST', `/api/devices/${id}/speed`, { ratio })
}

// ─── Motion Control ─────────────────────────────

export async function powerOnDevice(id: string): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/powerOn`)
}

export async function powerOffDevice(id: string): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/powerOff`)
}

export async function enableDevice(id: string): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/enable`)
}

export async function disableDevice(id: string): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/disable`)
}

export interface DeviceAlarm {
  id: number; level: number; description: string; solution: string; date: string; time: string
}

export async function getDeviceAlarms(id: string): Promise<ApiResponse<DeviceAlarm[]>> {
  return request('GET', `/api/devices/${id}/alarms`)
}

export async function getDeviceWarnings(id: string): Promise<ApiResponse<DeviceAlarm[]>> {
  return request('GET', `/api/devices/${id}/warnings`)
}

export interface ControlLogFile {
  path: string
  name: string
  date: string
  size: number
  modifyTime: number
}

export interface ControlLogLine {
  file: string
  path: string
  line: number
  level: 'error' | 'warning' | 'info' | 'user' | 'plain'
  text: string
}

export interface ControlLogQuery {
  start?: string
  end?: string
  types?: string[]
  keyword?: string
  limit?: number
}

export interface ControlLogResult {
  files: ControlLogFile[]
  entries: ControlLogLine[]
  total: number
  limited: boolean
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value))
  }
  const text = query.toString()
  return text ? `?${text}` : ''
}

export async function listControlLogFiles(id: string, query: ControlLogQuery = {}): Promise<ApiResponse<ControlLogFile[]>> {
  return request('GET', `/api/devices/${id}/controlLogs/files${buildQuery({
    start: query.start,
    end: query.end,
  })}`)
}

export async function queryControlLogs(id: string, query: ControlLogQuery = {}): Promise<ApiResponse<ControlLogResult>> {
  return request('GET', `/api/devices/${id}/controlLogs${buildQuery({
    start: query.start,
    end: query.end,
    types: query.types?.join(','),
    keyword: query.keyword,
    limit: query.limit,
  })}`)
}

export async function clearAlarm(id: string): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/clearAlarm`)
}

export async function resetCollision(id: string): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/resetCollision`)
}

export async function setJogMode(id: string, mode: 'jog' | 'step'): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/jogMode`, { mode })
}

export async function setTeachInch(id: string, distance: number): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/teachInch`, { distance })
}

export async function jogDevice(id: string, axis: string, direction: string, mode?: string): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/jog`, { axis, direction, mode })
}

export async function stopDevice(id: string): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/stop`)
}

export async function homeDevice(id: string): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/home`)
}

export async function estopDevice(id: string): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/estop`)
}

export async function moveJoints(id: string, joints: number[]): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/moveJoints`, { joints })
}

export interface MoveJointsCommandState {
  status?: boolean
  value?: boolean
  isAlarms?: boolean
}

export async function moveJointsCommand(id: string, joints: number[], value: boolean): Promise<ApiResponse<MoveJointsCommandState>> {
  return request('POST', `/api/devices/${id}/moveJointsCommand`, { joints, value })
}

export async function moveDevice(id: string, params: { x: number; y: number; z: number; r?: number; mode?: string; user?: number; tool?: number }): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/move`, params)
}

// ─── Controller Projects ────────────────────────

export interface ProjectFileRights {
  user?: string
  group?: string
  other?: string
}

export interface ControllerProjectSummary {
  name: string
  path: string
  language: ScriptLanguage
  size: number
  modifiedAt: string
  files: number
}

export interface ControllerProjectFile {
  name: string
  path: string
  size: number
  modifyTime: number
  rights?: ProjectFileRights
  content: string
  editable: boolean
  language: 'lua' | 'python' | 'json' | 'xml' | 'text'
}

export interface ControllerProjectDetail extends ControllerProjectSummary {
  prj: unknown
  fileList: ControllerProjectFile[]
}

export interface RecentProject {
  projectName: string
  projectPath: string
  language: ScriptLanguage
  openedAt: string
}

export async function listDeviceProjects(id: string): Promise<ApiResponse<ControllerProjectSummary[]>> {
  return request('GET', `/api/devices/${id}/projects`)
}

export async function listRecentProjects(id: string): Promise<ApiResponse<RecentProject[]>> {
  return request('GET', `/api/devices/${id}/projects/recent`)
}

export async function openDeviceProject(id: string, projectName: string): Promise<ApiResponse<ControllerProjectDetail>> {
  return request('GET', `/api/devices/${id}/projects/${encodeURIComponent(projectName)}`)
}

export async function createDeviceProject(id: string, name: string, language: ScriptLanguage): Promise<ApiResponse<ControllerProjectDetail>> {
  return request('POST', `/api/devices/${id}/projects`, { name, language })
}

export async function deleteDeviceProject(id: string, projectName: string): Promise<ApiResponse<null>> {
  return request('DELETE', `/api/devices/${id}/projects/${encodeURIComponent(projectName)}`)
}

export async function renameDeviceProject(id: string, projectName: string, name: string): Promise<ApiResponse<ControllerProjectDetail>> {
  return request('POST', `/api/devices/${id}/projects/${encodeURIComponent(projectName)}/rename`, { name })
}

export async function runDeviceProject(id: string, projectName: string): Promise<ApiResponse<{ preCompile: unknown; debugger: unknown }>> {
  return request('POST', `/api/devices/${id}/projects/${encodeURIComponent(projectName)}/run`, {})
}

export async function createProjectFile(id: string, projectName: string, name: string, content = ''): Promise<ApiResponse<ControllerProjectDetail>> {
  return request('POST', `/api/devices/${id}/projects/${encodeURIComponent(projectName)}/files`, { name, content })
}

export async function updateProjectFile(id: string, projectName: string, fileName: string, content: string): Promise<ApiResponse<ControllerProjectDetail>> {
  return request('PUT', `/api/devices/${id}/projects/${encodeURIComponent(projectName)}/files/${encodeURIComponent(fileName)}`, { content })
}

export async function deleteProjectFile(id: string, projectName: string, fileName: string): Promise<ApiResponse<ControllerProjectDetail>> {
  return request('DELETE', `/api/devices/${id}/projects/${encodeURIComponent(projectName)}/files/${encodeURIComponent(fileName)}`)
}

// ─── Project Points ─────────────────────────────

export interface PointData {
  id: string
  name: string
  alias?: string
  pose: number[]
  joint: number[]
  tool: number
  user: number
}

export async function getPoints(id: string, projectName: string): Promise<ApiResponse<PointData[]>> {
  return request('GET', `/api/devices/${id}/projects/${encodeURIComponent(projectName)}/points`)
}

export async function savePoint(id: string, projectName: string, opts?: { tool?: number; user?: number }): Promise<ApiResponse<PointData>> {
  return request('POST', `/api/devices/${id}/projects/${encodeURIComponent(projectName)}/points`, opts)
}

export async function updatePoint(id: string, projectName: string, pointId: string, data: Partial<PointData>): Promise<ApiResponse<PointData>> {
  return request('PUT', `/api/devices/${id}/projects/${encodeURIComponent(projectName)}/points/${pointId}`, data)
}

export async function deletePoint(id: string, projectName: string, pointId: string): Promise<ApiResponse<null>> {
  return request('DELETE', `/api/devices/${id}/projects/${encodeURIComponent(projectName)}/points/${pointId}`)
}

export async function teachFileUpdate(id: string, projectName: string): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/projects/${encodeURIComponent(projectName)}/teachFileUpdate`)
}

// ─── Load Parameters ──────────────────────────

export interface LoadParams {
  name: string
  centerX: number
  centerY: number
  centerZ: number
  loadValue: number
}

export async function getLoadParams(id: string): Promise<ApiResponse<LoadParams>> {
  return request('GET', `/api/devices/${id}/loadParams`)
}

export async function setLoadParams(id: string, params: LoadParams): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/loadParams`, params)
}

export async function getLoadConfig(id: string): Promise<ApiResponse<LoadParams[]>> {
  return request('GET', `/api/devices/${id}/loadConfig`)
}

export async function setLoadConfig(id: string, config: LoadParams[]): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/loadConfig`, config)
}

// ─── Custom Postures ──────────────────────────

export interface CustomPostureItem {
  name: string
  joint: number[]
}

export async function getCustomPostures(id: string): Promise<ApiResponse<CustomPostureItem[]>> {
  return request('GET', `/api/devices/${id}/customPostures`)
}

export async function setCustomPostures(id: string, postures: CustomPostureItem[]): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/customPostures`, postures)
}

// ─── System Settings ──────────────────────────

export async function getSystemTime(id: string): Promise<ApiResponse<{ date?: string; time?: string; timeZone?: string }>> {
  return request('GET', `/api/devices/${id}/systemTime`)
}

export async function setSystemTime(id: string, t: { date?: string; time?: string; timeZone?: string }): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/systemTime`, t)
}

export async function setDeviceAlias(id: string, alias: string): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/deviceAlias`, { alias })
}

// ─── User Management ──────────────────────────

export interface ControllerUserItem {
  level: number
  name: string
  password: string
  enablePassword: boolean
}

export interface ControllerUserList {
  defaultLevel: number
  list: ControllerUserItem[]
}

export async function getControllerUsers(id: string): Promise<ApiResponse<ControllerUserList>> {
  return request('GET', `/api/devices/${id}/users`)
}

export async function setControllerUsers(id: string, list: ControllerUserList): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/users`, list)
}

export interface PermissionConfig {
  level: number
  config: Record<string, number>
}

export async function getUserPermissions(id: string): Promise<ApiResponse<PermissionConfig[]>> {
  return request('GET', `/api/devices/${id}/userPermissions`)
}

export async function setUserPermissions(id: string, config: PermissionConfig[]): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/userPermissions`, config)
}

// ─── Coordinate Management ────────────────────

export interface CoordItem {
  name: string; enable: boolean
  x?: number; y?: number; z?: number; r?: number
  rx?: number; ry?: number; rz?: number
}

export async function getUserCoordinate(id: string): Promise<ApiResponse<{ coordList: CoordItem[] }>> {
  return request('GET', `/api/devices/${id}/userCoordinate`)
}

export async function setUserCoordinate(id: string, data: { coordList: CoordItem[] }): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/userCoordinate`, data)
}

export async function getToolCoordinate(id: string): Promise<ApiResponse<{ coordList: CoordItem[] }>> {
  return request('GET', `/api/devices/${id}/toolCoordinate`)
}

export async function setToolCoordinate(id: string, data: { coordList: CoordItem[] }): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/toolCoordinate`, data)
}

// ─── Motion Parameters ────────────────────────

export async function getPlaybackJointParams(id: string): Promise<ApiResponse<Record<string, unknown>>> {
  return request('GET', `/api/devices/${id}/playbackJointParams`)
}

export async function setPlaybackJointParams(id: string, p: Record<string, unknown>): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/playbackJointParams`, p)
}

export async function getPlaybackCoordinateParams(id: string): Promise<ApiResponse<Record<string, unknown>>> {
  return request('GET', `/api/devices/${id}/playbackCoordinateParams`)
}

export async function setPlaybackCoordinateParams(id: string, p: Record<string, unknown>): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/playbackCoordinateParams`, p)
}

export async function getTeachJointParams(id: string): Promise<ApiResponse<Record<string, unknown>>> {
  return request('GET', `/api/devices/${id}/teachJointParams`)
}

export async function setTeachJointParams(id: string, p: Record<string, unknown>): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/teachJointParams`, p)
}

export async function getTeachCoordinateParams(id: string): Promise<ApiResponse<Record<string, unknown>>> {
  return request('GET', `/api/devices/${id}/teachCoordinateParams`)
}

export async function setTeachCoordinateParams(id: string, p: Record<string, unknown>): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/teachCoordinateParams`, p)
}

// ─── Communication ────────────────────────────

export async function setBus(id: string, params: Record<string, unknown>): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/bus`, params)
}

export async function getWiFi(id: string): Promise<ApiResponse<Record<string, unknown>>> {
  return request('GET', `/api/devices/${id}/wifi`)
}

export async function setWiFi(id: string, params: Record<string, unknown>): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/wifi`, params)
}

export async function getEthernet(id: string): Promise<ApiResponse<Record<string, unknown>>> {
  return request('GET', `/api/devices/${id}/ethernet`)
}

export async function setEthernet(id: string, params: Record<string, unknown>): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/ethernet`, params)
}

// ─── Scripts ────────────────────────────────────

export async function listScripts(): Promise<ApiResponse<Script[]>> {
  return request('GET', '/api/scripts')
}

export async function createScript(name: string, content: string, language = 'lua'): Promise<ApiResponse<Script>> {
  return request('POST', '/api/scripts', { name, content, language })
}

export async function updateScript(id: string, params: { name?: string; content?: string; language?: string; deviceId?: string | null }): Promise<ApiResponse<Script>> {
  return request('PUT', `/api/scripts/${id}`, params)
}

export async function deleteScript(id: string): Promise<ApiResponse<null>> {
  return request('DELETE', `/api/scripts/${id}`)
}

export interface ScriptDeployResult {
  projectName: string
  projectPath: string
  files: string[]
}

export async function deployScript(id: string, deviceId: string, projectName?: string): Promise<ApiResponse<ScriptDeployResult>> {
  return request('POST', `/api/scripts/${id}/deploy`, { deviceId, projectName })
}

export async function runScript(id: string, deviceId: string, projectName?: string): Promise<ApiResponse<{ deployed: ScriptDeployResult; preCompile: unknown; debugger: unknown }>> {
  return request('POST', `/api/scripts/${id}/run`, { deviceId, projectName })
}

export async function debuggerPreCompile(deviceId: string, project: string): Promise<ApiResponse<unknown>> {
  return request('POST', `/api/devices/${deviceId}/debugger/preCompile`, { project })
}

export async function debuggerState(deviceId: string): Promise<ApiResponse<unknown>> {
  return request('GET', `/api/devices/${deviceId}/debugger/state`)
}

export async function debuggerBreakPoint(deviceId: string, line: number[][], opCode = 4): Promise<ApiResponse<unknown>> {
  return request('POST', `/api/devices/${deviceId}/debugger/breakPoint`, { opCode, line })
}

export async function debuggerContinue(deviceId: string): Promise<ApiResponse<unknown>> {
  return request('POST', `/api/devices/${deviceId}/debugger/run`, { type: 0 })
}

export async function debuggerSuspend(deviceId: string): Promise<ApiResponse<unknown>> {
  return request('POST', `/api/devices/${deviceId}/debugger/suspend`)
}

export async function debuggerStop(deviceId: string): Promise<ApiResponse<unknown>> {
  return request('POST', `/api/devices/${deviceId}/debugger/stop`)
}

// ─── System ─────────────────────────────────────

export async function systemInfo(): Promise<ApiResponse<{
  version: string; onlineDevices: number; uptime: number
}>> {
  return request('GET', '/api/system/info')
}

// ─── Token ──────────────────────────────────────

const TOKEN_KEY = 'docat_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}
