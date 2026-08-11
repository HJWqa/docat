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

export async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts?: { timeoutMs?: number; rawBody?: BodyInit; contentType?: string },
): Promise<ApiResponse<T>> {  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const rawBody = opts?.rawBody
  if (rawBody !== undefined) {
    if (opts?.contentType) headers['Content-Type'] = opts.contentType
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  const timeoutMs = opts?.timeoutMs
  const controller = timeoutMs ? new AbortController() : null
  const timer = timeoutMs
    ? setTimeout(() => controller!.abort(), timeoutMs)
    : null

  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller?.signal,
    })
    return res.json()
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return { success: false, error: { code: 40800, message: '请求超时' } }
    }
    throw err
  } finally {
    if (timer) clearTimeout(timer)
  }
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

export async function registerDevice(ip: string, name: string, autoConnect = false): Promise<ApiResponse<DeviceConfig>> {
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
  mode?: 'exclusive' | 'virtual'
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

export async function setAutoManualSwitch(id: string, value: boolean): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/autoManualSwitch`, { value })
}

export async function getAutoManualSwitch(id: string): Promise<ApiResponse<{ value: boolean }>> {
  return request('GET', `/api/devices/${id}/autoManualSwitch`)
}

export async function setAutoManualMode(id: string, mode: 'auto' | 'manual'): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/autoManualMode`, { mode })
}

export async function setRemoteSwitch(id: string, value: boolean): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/remoteSwitch`, { value })
}

export async function getRemoteSwitch(id: string): Promise<ApiResponse<{ value: boolean }>> {
  return request('GET', `/api/devices/${id}/remoteSwitch`)
}

export async function setRemoteControl(id: string, mode: 'online' | 'tcp'): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/remoteControl`, { mode })
}

export async function getRemoteControl(id: string): Promise<ApiResponse<{ mode: 'online' | 'tcp' }>> {
  return request('GET', `/api/devices/${id}/remoteControl`)
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

export async function setJogCoordinate(id: string, mode: 'joint' | 'cartesian' | 'tool'): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/jogCoordinate`, { mode })
}

export async function jogDevice(id: string, axis: string, direction: string, mode?: string): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/jog`, { axis, direction, mode })
}

/** 仅停止点动（panel/jog 全 false），比 stop 更轻 */
export async function stopJogDevice(id: string): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/jog/stop`)
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
  // 服务端会阻塞到到位（最长 ~30s），前端超时放宽
  return request('POST', `/api/devices/${id}/moveJoints`, { joints }, { timeoutMs: 60000 })
}

export interface MoveJointsCommandState {
  status?: boolean
  value?: boolean
  isAlarms?: boolean
}

export async function moveJointsCommand(id: string, joints: number[], value: boolean): Promise<ApiResponse<MoveJointsCommandState>> {
  return request('POST', `/api/devices/${id}/moveJointsCommand`, { joints, value })
}

export async function moveDevice(id: string, params: {
  x: number; y: number; z: number
  r?: number; rx?: number; ry?: number; rz?: number
  mode?: string; user?: number; tool?: number
  jointNear?: number[]
}): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/move`, params)
}

/**
 * 统一点到点。path=MovJ|MovL 是路径类型；joint/pose 是目标表示，二者正交。
 * @see dobot-docs Motion.md
 */
export async function movePoint(id: string, params: {
  path?: 'MovJ' | 'MovL'
  joint?: number[]
  pose?: number[] | { x: number; y: number; z: number; rx?: number; ry?: number; rz?: number }
  user?: number
  tool?: number
}): Promise<ApiResponse<Record<string, unknown>>> {
  return request('POST', `/api/devices/${id}/movePoint`, params, { timeoutMs: 60000 })
}

export async function moveCartesian(id: string, params: {
  x: number; y: number; z: number
  rx?: number; ry?: number; rz?: number
  user?: number; tool?: number
  jointNear?: number[]
  path?: 'MovJ' | 'MovL'
}): Promise<ApiResponse<Record<string, unknown>>> {
  return request('POST', `/api/devices/${id}/moveCartesian`, params, { timeoutMs: 60000 })
}

export interface IKResult { joint: number[]; errID: number; errMsg?: string }

export async function inverseKinematics(id: string, params: { coordinate: number[]; jointNear?: number[]; user?: number; tool?: number }): Promise<ApiResponse<IKResult>> {
  return request('POST', `/api/devices/${id}/inverseKinematics`, params)
}

export interface FKResult { coordinate: number[]; errID: number; errMsg?: string }

export async function forwardKinematics(id: string, params: { joint: number[]; user?: number; tool?: number }): Promise<ApiResponse<FKResult>> {
  return request('POST', `/api/devices/${id}/forwardKinematics`, params)
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

export async function listDeviceProjects(
  id: string,
  opts?: { refresh?: boolean },
): Promise<ApiResponse<ControllerProjectSummary[]>> {
  const qs = opts?.refresh ? '?refresh=1' : ''
  return request('GET', `/api/devices/${id}/projects${qs}`)
}

export async function listRecentProjects(id: string): Promise<ApiResponse<RecentProject[]>> {
  return request('GET', `/api/devices/${id}/projects/recent`)
}

export async function openDeviceProject(
  id: string,
  projectName: string,
  opts?: { refresh?: boolean },
): Promise<ApiResponse<ControllerProjectDetail>> {
  const qs = opts?.refresh ? '?refresh=1' : ''
  return request('GET', `/api/devices/${id}/projects/${encodeURIComponent(projectName)}${qs}`)
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

// 设备协议为 kg，前端统一使用 g — 在 API 边界换算
const LOAD_G_PER_KG = 1000

function loadToG(value: number): number {
  return Math.round(value * LOAD_G_PER_KG)
}

export async function getLoadParams(id: string): Promise<ApiResponse<LoadParams>> {
  const res = await request<LoadParams>('GET', `/api/devices/${id}/loadParams`)
  if (res.success && res.data) {
    res.data.loadValue = loadToG(res.data.loadValue)
  }
  return res
}

export async function setLoadParams(id: string, params: LoadParams): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/loadParams`, {
    ...params,
    loadValue: params.loadValue / LOAD_G_PER_KG,
  })
}

export async function getLoadConfig(id: string): Promise<ApiResponse<LoadParams[]>> {
  const res = await request<LoadParams[]>('GET', `/api/devices/${id}/loadConfig`)
  if (res.success && res.data) {
    res.data.forEach(item => { item.loadValue = loadToG(item.loadValue) })
  }
  return res
}

export async function setLoadConfig(id: string, config: LoadParams[]): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/loadConfig`,
    config.map(item => ({ ...item, loadValue: item.loadValue / LOAD_G_PER_KG })))
}

// ─── Custom Postures ──────────────────────────

export type CustomPostureType = 'joint' | 'cartesian'

export interface CustomPosturePose {
  x: number
  y: number
  z: number
  rx: number
  ry: number
  rz: number
}

export interface CustomPostureItem {
  name: string
  /** joint（默认）| cartesian */
  type?: CustomPostureType
  joint: number[]
  pose?: CustomPosturePose
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

export async function getDeviceAlias(id: string): Promise<ApiResponse<{ alias: string }>> {
  return request('GET', `/api/devices/${id}/deviceAlias`)
}

// ─── 标定导出 & 应用设置 ────────────────────────

export interface CalibrationExportRow {
  imgX: number
  imgY: number
  physX: number
  physY: number
  angle: number
}

export async function exportCalibration(
  id: string,
  rows: CalibrationExportRow[],
  name?: string,
): Promise<ApiResponse<{ path: string; filename: string }>> {
  return request('POST', `/api/devices/${id}/calibration/export`, { rows, name })
}

export async function exportCalibrationXml(
  id: string,
  content: string,
  name?: string,
): Promise<ApiResponse<{ path: string; filename: string }>> {
  return request('POST', `/api/devices/${id}/calibration/exportXml`, { content, name })
}

export async function getSystemSettings(): Promise<ApiResponse<{ calibExportDir: string }>> {
  return request('GET', `/api/system/settings`)
}

export async function saveSystemSettings(settings: { calibExportDir: string }): Promise<ApiResponse<null>> {
  return request('POST', `/api/system/settings`, settings)
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
  /** 控制器槽位 id（数组下标，如 "0"、"1"） */
  id?: string
  /** 别名（显示名），协议字段 alias */
  alias: string
  enable: boolean
  x?: number; y?: number; z?: number
  rx?: number; ry?: number; rz?: number
  /** 控制器原始数据（params / rawP0..rawP5 / caliType），写回时保留 */
  raw?: Record<string, unknown>
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

export async function getMotionDefaults(id: string): Promise<ApiResponse<Record<string, unknown>>> {
  return request('GET', `/api/devices/${id}/motionDefaults`)
}

export async function getBus(id: string): Promise<ApiResponse<Record<string, unknown>>> {
  return request('GET', `/api/devices/${id}/bus`)
}

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

// ─── Trajectory / Tracks (via controller SFTP) ─

export async function startTrackRecording(id: string): Promise<ApiResponse<{ started: boolean }>> {
  return request('POST', `/api/devices/${id}/tcp/record/start`)
}

export async function stopTrackRecording(id: string): Promise<ApiResponse<{ saved: boolean }>> {
  return request('POST', `/api/devices/${id}/tcp/record/stop`)
}

export interface TrackFileItem { name: string; size: number; mtime: string }

export async function listTracks(id: string): Promise<ApiResponse<TrackFileItem[]>> {
  return request('GET', `/api/devices/${id}/tcp/tracks`)
}

export async function renameTrack(id: string, trackName: string, newName: string): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/tcp/tracks/${encodeURIComponent(trackName)}/rename`, { newName })
}

export async function deleteTrack(id: string, trackName: string): Promise<ApiResponse<null>> {
  return request('DELETE', `/api/devices/${id}/tcp/tracks/${encodeURIComponent(trackName)}`)
}

export async function getTrackContent(id: string, trackName: string): Promise<ApiResponse<string>> {
  return request('GET', `/api/devices/${id}/tcp/tracks/${encodeURIComponent(trackName)}`)
}

export async function getRecordStatus(id: string): Promise<ApiResponse<{ recording: boolean; isFinish: boolean; result: boolean }>> {
  return request('GET', `/api/devices/${id}/tcp/record/status`)
}

export async function startTrackPlayback(id: string, name: string): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/tcp/playback/start`, { name })
}

export async function stopTrackPlayback(id: string, name?: string): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/tcp/playback/stop`, { name })
}

export interface TrackPlaybackStatus {
  addr: string
  currentTimes: number
  isDone: boolean
  percent: number
  result: boolean
}

export async function getTrackPlaybackStatus(id: string): Promise<ApiResponse<TrackPlaybackStatus>> {
  return request('GET', `/api/devices/${id}/tcp/playback/status`)
}

export async function getTrackPlaybackParams(id: string): Promise<ApiResponse<{ multi: number; const: number; loop: number }>> {
  return request('GET', `/api/devices/${id}/tcp/playback/params`)
}

export async function setTrackPlaybackParams(id: string, params: { multi: number; const: number; loop: number }): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/tcp/playback/params`, params)
}

// ─── Dobot+ ────────────────────────────────────

export async function listDobotPlus(id: string): Promise<ApiResponse<string[]>> {
  return request('GET', `/api/devices/${id}/dobotPlus`)
}

export async function manageDobotPlus(id: string, name: string, action: 'install' | 'uninstall'): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/dobotPlus`, { name, action })
}

export async function getDobotPlusPorts(id: string): Promise<ApiResponse<Record<string, unknown>>> {
  return request('GET', `/api/devices/${id}/dobotPlus/ports`)
}

export interface DobotPlusCatalog {
  available: string[]
  present: string[]
  metadata: Record<string, { description?: string; version?: string }>
}

export interface DobotPlusPluginMeta {
  name: string
  description?: string
  version?: string
}

/** 控制器上可安装的 Dobot+ 插件目录 */
export async function getDobotPlusCatalog(id: string): Promise<ApiResponse<DobotPlusCatalog>> {
  return request('GET', `/api/devices/${id}/dobotPlus/catalog`)
}

/** 本地放置的插件资源（可选，gitignored）：自动发现可安装/带界面的插件 */
export async function getDobotPlusLocal(): Promise<ApiResponse<{ plugins: DobotPlusPluginMeta[] }>> {
  return request('GET', '/api/dobotPlus/local')
}

/** 从本地插件资源安装：打包上传到控制器后自动安装 */
export async function installLocalDobotPlusPlugin(id: string, name: string): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/dobotPlus/installLocal`, { name }, { timeoutMs: 120000 })
}

/** 上传插件 zip 到控制器并安装（name 为插件完整名，如 DobotES01_v1-0-3-stable） */
export async function uploadDobotPlusPlugin(id: string, name: string, file: Blob): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/dobotPlus/upload?name=${encodeURIComponent(name)}`, undefined, {
    rawBody: file,
    contentType: 'application/octet-stream',
    timeoutMs: 300000,
  })
}

export async function callDobotPlus(
  id: string,
  plugin: string,
  fn: string,
  data?: unknown,
): Promise<ApiResponse<unknown>> {
  return request('POST', `/api/devices/${id}/dobotPlus/call`, { plugin, fn, data })
}

export type DobotES01Action = 'grip' | 'release' | 'clearAlarm' | 'status'

export interface DobotES01Status {
  status: number // 0=吸附 1=释放 2=异常
  toolDI1?: number
  toolDI2?: number
}

export async function controlDobotES01(
  id: string,
  action: DobotES01Action,
): Promise<ApiResponse<unknown>> {
  return request('POST', `/api/devices/${id}/dobotPlus/es01`, { action })
}

export async function getDobotES01Status(id: string): Promise<ApiResponse<DobotES01Status>> {
  return request('GET', `/api/devices/${id}/dobotPlus/es01/status`)
}

// ─── CR TCP Dashboard (29999/30004) ────────────

export interface CRTcpStatus {
  dashboard: string
  feed: string
  feedback: Record<string, unknown> | null
}

export async function getCRTcpStatus(id: string): Promise<ApiResponse<CRTcpStatus>> {
  return request('GET', `/api/devices/${id}/tcp/status`)
}

export async function sendCRDashboard(id: string, command: string): Promise<ApiResponse<{ reply: string }>> {
  return request('POST', `/api/devices/${id}/tcp/dashboard`, { command })
}

export async function disconnectCRTcp(id: string): Promise<ApiResponse<null>> {
  return request('POST', `/api/devices/${id}/tcp/disconnect`)
}

export async function setCRAutoReconnect(id: string, autoReconnect: boolean): Promise<ApiResponse<{ autoReconnect: boolean }>> {
  return request('POST', `/api/devices/${id}/tcp/autoReconnect`, { autoReconnect })
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
