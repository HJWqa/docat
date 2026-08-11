/**
 * 编排（Orchestration）Store — 编排设备 / 姿态 / 设置 / 日志 / 脚本桥接
 *
 * 双模式：
 *  - mock（?mock=1）：前端本地模拟引擎。连接状态、TCP/串口链路、Docat Motion
 *    协议、脚本（浏览器内 JS 运行）全部在浏览器内模拟，便于先行体验。
 *  - 真实模式（无 mock=1）：设备 CRUD / 连接 / 收发 / 姿态 / 脚本运行全部
 *    走 docat-server 的 /api/orchestration REST + WS（orch-event）；
 *    后端未实现时接口返回错误，前端按真实请求处理。
 */
import { reactive } from 'vue'
import * as api from '../services/api'
import { wsClient } from '../services/ws'
import { deviceStore } from './deviceStore'
import * as orchApi from '../services/orchApi'

// ─── 类型 ─────────────────────────────────────────────

export type OrchDeviceType = 'tcp-server' | 'tcp-client' | 'udp' | 'serial' | 'docat-motion'

export interface OrchDevice {
  id: string
  /** 变量命名规则的名称（供脚本调用），唯一 */
  name: string
  type: OrchDeviceType
  ip: string
  port: number
  serialPort: string
  baudRate: number
  /** docat-motion：被模拟的真实机械臂设备 id */
  targetDeviceId: string
  autoReconnect: boolean
  heartbeat: boolean
  /** 运行时连接状态（不持久化） */
  connected: boolean
  createdAt: string
}

export interface OrchPose {
  name: string
  type: 'joint' | 'cartesian'
  joint: number[]
  pose: { x: number; y: number; z: number; rx: number; ry: number; rz: number }
  updatedAt: string
}

export interface OrchSettings {
  defaultSeparator: string
  logLimit: number
  autoConnectOnLoad: boolean
  scriptFollow: boolean
  /** 心跳周期（ms，发送 ping 间隔） */
  heartbeatInterval: number
  /** 心跳超时（ms，超过无应答判定失活） */
  heartbeatTimeout: number
  /** 心跳连续失活判定阈值（周期数） */
  heartbeatMissThreshold: number
  /** 心跳发送内容（支持 \n 换行） */
  heartbeatPing: string
  /** 心跳应答内容（支持 \n 换行） */
  heartbeatPong: string
  /** 自动重连最大尝试次数（超过停止） */
  reconnectMaxAttempts: number
  /** 自动重连最长持续时间（秒，超过停止） */
  reconnectMaxSeconds: number
  /** 服务端脚本文件目录（真实模式，通用设置可修改） */
  scriptsDir: string
}

export type LogDirection = 'send' | 'recv' | 'system' | 'script' | 'error'

export interface OrchLogEntry {
  id: number
  time: number
  deviceName: string
  direction: LogDirection
  text: string
  /** 脚本编译错误行号（编辑器红色波浪线用） */
  line?: number
  /** 脚本编译错误列 */
  column?: number
}

export const ORCH_DEVICE_TYPES: Array<{ value: OrchDeviceType; label: string }> = [
  { value: 'tcp-server', label: 'TCP Server' },
  { value: 'tcp-client', label: 'TCP Client' },
  { value: 'udp', label: 'UDP' },
  { value: 'serial', label: '串口' },
  { value: 'docat-motion', label: 'Docat Motion' },
]

export function orchTypeLabel(type: OrchDeviceType): string {
  return ORCH_DEVICE_TYPES.find(t => t.value === type)?.label ?? type
}

export const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/** 变量命名规则校验，返回错误文案；合法返回 '' */
export function identifierError(name: string, existing: string[] = []): string {
  const v = name.trim()
  if (!v) return '名称不能为空'
  if (!IDENTIFIER_RE.test(v)) return '需符合变量命名规则：字母/数字/下划线，且不以数字开头'
  if (existing.includes(v)) return '名称已存在'
  return ''
}

// ─── 模式（mock=1 前端模拟；否则真实请求）─────────────

let orchMock = true

export function setOrchMockMode(mock: boolean) {
  orchMock = mock
}

export function isOrchMockMode(): boolean {
  return orchMock
}

// ─── 持久化 ──────────────────────────────────────────

const STORAGE_KEY = 'docat.orchestration.v1'

interface PersistedShape {
  devices: Array<Omit<OrchDevice, 'connected'>>
  poses: OrchPose[]
  settings: OrchSettings
}

function loadPersisted(): PersistedShape | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedShape
    if (!parsed || !Array.isArray(parsed.devices) || !Array.isArray(parsed.poses)) return null
    return parsed
  } catch {
    return null
  }
}

/** 持久化编排数据（mock 模式本地；真实模式由服务端存储，仅刷新本地副本） */
export function persistOrchestration() {
  if (!orchMock) return
  const payload: PersistedShape = {
    devices: orchStore.devices.map(({ connected: _c, ...d }) => d),
    poses: orchStore.poses,
    settings: { ...orchStore.settings },
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)) } catch { /* ignore */ }
}

// ─── Store 状态 ───────────────────────────────────────

export const orchStore = reactive({
  devices: [] as OrchDevice[],
  poses: [] as OrchPose[],
  settings: {
    defaultSeparator: ';',
    logLimit: 500,
    autoConnectOnLoad: false,
    scriptFollow: true,
    heartbeatInterval: 5000,
    heartbeatTimeout: 15000,
    heartbeatMissThreshold: 3,
    heartbeatPing: 'ping;',
    heartbeatPong: 'pong;',
    reconnectMaxAttempts: 8,
    reconnectMaxSeconds: 600,
    scriptsDir: '',
  } as OrchSettings,
  logs: [] as OrchLogEntry[],
  selectedDeviceId: '',
  settingsTab: 'general' as 'general' | 'device' | 'pose' | 'programming',
  /** 真实模式：脚本运行状态（后端 WS 推送） */
  scriptRunning: false,
  initialized: false,
})

let logSeq = 0

export function addLog(deviceName: string, direction: LogDirection, text: string, line?: number, column?: number) {
  orchStore.logs.push({ id: ++logSeq, time: Date.now(), deviceName, direction, text, line, column })
  const limit = orchStore.settings.logLimit || 500
  if (orchStore.logs.length > limit) {
    orchStore.logs = orchStore.logs.slice(orchStore.logs.length - limit)
  }
}

export function clearLogs() {
  orchStore.logs = []
}

// ─── 工具 ────────────────────────────────────────────

/** IP 输入历史（前端记忆，供添加/编辑下拉提示） */
const IP_HISTORY_KEY = 'docat.orchestration.ip-history'

export function getIpHistory(): string[] {
  try {
    const raw = localStorage.getItem(IP_HISTORY_KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(arr) ? arr.filter((i): i is string => typeof i === 'string' && i.length > 0) : []
  } catch {
    return []
  }
}

export function recordIp(ip: string): void {
  const value = String(ip ?? '').trim()
  if (!value) return
  try {
    const next = [value, ...getIpHistory().filter(i => i !== value)].slice(0, 10)
    localStorage.setItem(IP_HISTORY_KEY, JSON.stringify(next))
  } catch {
    // ignore
  }
}

/**
 * 解析手动输入的坐标文本（6 个数值）：
 * 支持空格 / 逗号 / 分号 / 回车 / Tab 分隔，首尾可带 [ ] 或 ( )。
 * 解析成功返回 6 个 float，否则返回 null。
 */
export function parsePoseText(text: string): number[] | null {
  const raw = String(text ?? '').trim()
  if (!raw) return null
  const cleaned = raw.replace(/^[[(]/, '').replace(/[\])]$/, '').trim()
  if (!cleaned) return null
  const parts = cleaned.split(/[;,\s]+/).filter(Boolean)
  if (parts.length !== 6) return null
  const out: number[] = []
  for (const part of parts) {
    const v = Number(part)
    if (!Number.isFinite(v)) return null
    out.push(v)
  }
  return out
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function emptyPose(): OrchPose['pose'] {
  return { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }
}

/** 按名称查设备（脚本按名称寻址） */
export function findDeviceByName(name: string): OrchDevice | undefined {
  return orchStore.devices.find(d => d.name === name)
}

export function isDeviceConnected(name: string): boolean {
  return orchStore.devices.some(d => d.name === name && d.connected)
}

/** 姿态 → 数值数组：joint 类型返回关节角，cartesian 返回 [x,y,z,rx,ry,rz] */
export function poseArray(name: string): number[] | null {
  const p = orchStore.poses.find(item => item.name === name)
  if (!p) return null
  if (p.type === 'cartesian') return [p.pose.x, p.pose.y, p.pose.z, p.pose.rx, p.pose.ry, p.pose.rz]
  return [...(p.joint || [0, 0, 0, 0, 0, 0])]
}

/** 姿态 → 文本（默认分隔符 ;） */
export function poseText(name: string, separator = ';'): string | null {
  const arr = poseArray(name)
  return arr ? arr.join(separator) : null
}

// ─── 真实模式 WS 事件 ─────────────────────────────────

interface OrchWsEvent {
  event?: string
  deviceId?: string
  deviceName?: string
  direction?: LogDirection
  text?: string
  connected?: boolean
  running?: boolean
  name?: string
  mtime?: number
  dir?: string
  line?: number
  column?: number
  [key: string]: unknown
}

let unsubOrchEvent: (() => void) | null = null

/** 脚本文件变更订阅（真实模式：服务端 fs.watch → WS 推送） */
const scriptChangeHandlers: Array<(name: string, mtime: number) => void> = []

export function onOrchScriptChange(cb: (name: string, mtime: number) => void): () => void {
  scriptChangeHandlers.push(cb)
  return () => {
    const idx = scriptChangeHandlers.indexOf(cb)
    if (idx >= 0) scriptChangeHandlers.splice(idx, 1)
  }
}

/** 服务端脚本目录变更订阅（真实模式） */
const scriptsDirHandlers: Array<(dir: string) => void> = []

export function onOrchScriptsDirChange(cb: (dir: string) => void): () => void {
  scriptsDirHandlers.push(cb)
  return () => {
    const idx = scriptsDirHandlers.indexOf(cb)
    if (idx >= 0) scriptsDirHandlers.splice(idx, 1)
  }
}

function handleOrchEvent(payload: unknown) {
  const ev = (typeof payload === 'object' && payload ? payload : {}) as OrchWsEvent
  switch (ev.event) {
    case 'device-status':
      if (ev.deviceId) {
        const d = orchStore.devices.find(item => item.id === ev.deviceId)
        if (d) d.connected = !!ev.connected
      }
      break
    case 'log':
      if (ev.text) {
        addLog(
          ev.deviceName || ev.deviceId || '编排',
          ev.direction || 'recv',
          String(ev.text),
          typeof ev.line === 'number' ? ev.line : undefined,
          typeof ev.column === 'number' ? ev.column : undefined,
        )
      }
      break
    case 'pose':
      void refreshPosesFromServer()
      break
    case 'script-status':
      orchStore.scriptRunning = !!ev.running
      break
    case 'script-file':
      if (ev.name) {
        for (const cb of [...scriptChangeHandlers]) cb(String(ev.name), Number(ev.mtime ?? 0))
      }
      break
    case 'scripts-dir':
      if (ev.dir) {
        orchStore.settings.scriptsDir = String(ev.dir)
        for (const cb of [...scriptsDirHandlers]) cb(String(ev.dir))
      }
      break
  }
}

async function refreshPosesFromServer() {
  const res = await orchApi.orchListPoses()
  if (res.success && res.data) orchStore.poses = res.data
}

/** 真实模式下注册 WS 事件（模块级，页面切换不丢失） */
export function initOrchWs() {
  unsubOrchEvent?.()
  if (orchMock) return
  unsubOrchEvent = wsClient.onOrchEvent(handleOrchEvent)
}

// ─── 设备连接意图开关（desired，持久化）───────────────
// 开关 = 用户"想要连接"的意图（不随连接状态回弹）；绿点指示实际连接状态。
// 自动重连前提：开关打开（desired）且设备配置 autoReconnect。

const DESIRED_KEY = 'docat.orchestration.device-desired'

function loadDesired(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(DESIRED_KEY)
    const parsed = raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

const desiredMap: Record<string, boolean> = loadDesired()

function persistDesired() {
  try {
    localStorage.setItem(DESIRED_KEY, JSON.stringify(desiredMap))
  } catch {
    // ignore
  }
}

export function isDeviceDesired(id: string): boolean {
  return desiredMap[id] === true
}

export function setDeviceDesired(id: string, desired: boolean) {
  if (desired) desiredMap[id] = true
  else delete desiredMap[id]
  persistDesired()
}

/** 恢复连接意图开关打开的设备（等同用户手动打开，允许自动重连） */
function restoreDesiredConnections() {
  for (const d of orchStore.devices) {
    if (isDeviceDesired(d.id) && !d.connected) void connectDevice(d.id)
  }
}

// ─── 初始化 / 持久化 ─────────────────────────────────

export async function initOrchestration() {
  if (orchStore.initialized) return
  orchStore.initialized = true

  if (!orchMock) {
    const [deviceRes, poseRes, settingsRes] = await Promise.all([
      orchApi.orchListDevices(),
      orchApi.orchListPoses(),
      orchApi.orchGetSettings(),
    ])
    if (deviceRes.success && deviceRes.data) orchStore.devices = deviceRes.data
    if (poseRes.success && poseRes.data) orchStore.poses = poseRes.data
    if (settingsRes.success && settingsRes.data) orchStore.settings = { ...orchStore.settings, ...settingsRes.data }
    initOrchWs()
    restoreDesiredConnections()
    return
  }

  const persisted = loadPersisted()
  if (persisted) {
    orchStore.devices = persisted.devices.map(d => ({ ...d, connected: false }))
    orchStore.poses = persisted.poses
    orchStore.settings = { ...orchStore.settings, ...persisted.settings }
  }
  if (orchStore.settings.autoConnectOnLoad) {
    // 自动连接：等同开关未打开，失败不进入自动重连
    for (const d of orchStore.devices) void connectDevice(d.id, false, true)
  }
  restoreDesiredConnections()
}

// ─── 编排设备 CRUD ───────────────────────────────────

export interface NewOrchDeviceInput {
  name: string
  type: OrchDeviceType
  ip: string
  port: number
  serialPort: string
  baudRate: number
  targetDeviceId: string
  autoReconnect: boolean
  heartbeat: boolean
}

export async function addOrchDevice(input: NewOrchDeviceInput): Promise<{ ok: boolean; error?: string }> {
  const name = input.name.trim()
  const err = identifierError(name, orchStore.devices.map(d => d.name))
  if (err) return { ok: false, error: err }
  if (input.type !== 'docat-motion' && !input.ip.trim()) return { ok: false, error: 'IP 不能为空' }
  if (input.type !== 'docat-motion' && !(input.port > 0 && input.port <= 65535)) return { ok: false, error: '端口需为 1-65535' }
  if (input.type === 'serial' && !input.serialPort.trim()) return { ok: false, error: '串口号不能为空' }

  if (!orchMock) {
    const res = await orchApi.orchCreateDevice(input)
    if (!res.success) return { ok: false, error: res.error?.message ?? '添加失败' }
    orchStore.devices = [...orchStore.devices.filter(d => d.id !== res.data!.id), res.data!]
    return { ok: true }
  }

  orchStore.devices.push({
    id: uuid(),
    name,
    type: input.type,
    ip: input.ip.trim(),
    port: input.port || 0,
    serialPort: input.serialPort.trim(),
    baudRate: input.baudRate || 115200,
    targetDeviceId: input.targetDeviceId,
    autoReconnect: input.autoReconnect,
    heartbeat: input.heartbeat,
    connected: false,
    createdAt: new Date().toISOString(),
  })
  persistOrchestration()
  addLog(name, 'system', '设备已注册')
  return { ok: true }
}

export async function updateOrchDevice(
  id: string,
  patch: Partial<Pick<OrchDevice, 'name' | 'type' | 'ip' | 'port' | 'serialPort' | 'baudRate' | 'targetDeviceId' | 'autoReconnect' | 'heartbeat'>>
): Promise<{ ok: boolean; error?: string }> {
  const idx = orchStore.devices.findIndex(d => d.id === id)
  if (idx < 0) return { ok: false, error: '设备不存在' }
  const cur = orchStore.devices[idx]
  const next = { ...cur, ...patch }
  if (next.name !== cur.name) {
    const err = identifierError(next.name, orchStore.devices.filter(d => d.id !== id).map(d => d.name))
    if (err) return { ok: false, error: err }
  }
  if (next.type !== 'docat-motion' && !next.ip.trim()) return { ok: false, error: 'IP 不能为空' }
  if (next.type !== 'docat-motion' && !(next.port > 0 && next.port <= 65535)) return { ok: false, error: '端口需为 1-65535' }
  if (next.type === 'serial' && !next.serialPort.trim()) return { ok: false, error: '串口号不能为空' }
  if (next.connected && (next.type !== cur.type || next.ip !== cur.ip || next.port !== cur.port)) {
    void disconnectDevice(id)
  }

  if (!orchMock) {
    const res = await orchApi.orchUpdateDevice(id, patch)
    if (!res.success) return { ok: false, error: res.error?.message ?? '保存失败' }
    const updated = res.data
    if (updated) orchStore.devices[idx] = { ...updated, connected: cur.connected }
    return { ok: true }
  }

  orchStore.devices[idx] = next
  persistOrchestration()
  return { ok: true }
}

export function removeOrchDevice(id: string) {
  const d = orchStore.devices.find(item => item.id === id)
  if (d) {
    void disconnectDevice(id)
    if (orchMock) addLog(d.name, 'system', '设备已移除')
  }
  orchStore.devices = orchStore.devices.filter(item => item.id !== id)
  if (orchStore.selectedDeviceId === id) orchStore.selectedDeviceId = ''
  delete desiredMap[id]
  persistDesired()
  if (!orchMock) {
    void orchApi.orchDeleteDevice(id)
    return
  }
  persistOrchestration()
}

// ─── 连接模拟引擎 ─────────────────────────────────────

const heartbeatTimers: Record<string, ReturnType<typeof setInterval>> = {}
const retryTimers: Record<string, ReturnType<typeof setTimeout>> = {}
const motionState: Record<string, { pose: number[]; suction: boolean; busy: boolean }> = {}

function stopHeartbeat(id: string) {
  if (heartbeatTimers[id]) {
    clearInterval(heartbeatTimers[id])
    delete heartbeatTimers[id]
  }
}

function startHeartbeat(d: OrchDevice) {
  stopHeartbeat(d.id)
  if (!d.heartbeat) return
  heartbeatTimers[d.id] = setInterval(() => {
    if (!d.connected) { stopHeartbeat(d.id); return }
    addLog(d.name, 'system', '心跳正常')
  }, 5000)
}

function stopRetry(id: string) {
  if (retryTimers[id]) {
    clearTimeout(retryTimers[id])
    delete retryTimers[id]
  }
}

/** mock 重连计数（次数/时长上限与真实模式一致，通用设置可配） */
const retryCounts: Record<string, number> = {}
const retryStartedAt: Record<string, number> = {}

function scheduleReconnect(d: OrchDevice) {
  // 仅当连接意图开关打开才自动重连
  if (!d.autoReconnect || !isDeviceDesired(d.id) || d.connected) return
  stopRetry(d.id)
  if (!retryStartedAt[d.id]) retryStartedAt[d.id] = Date.now()
  const maxAttempts = Math.max(1, Number(orchStore.settings.reconnectMaxAttempts) || 8)
  const maxSeconds = Math.max(10, Number(orchStore.settings.reconnectMaxSeconds) || 600)
  if ((retryCounts[d.id] ?? 0) >= maxAttempts || Date.now() - retryStartedAt[d.id] >= maxSeconds * 1000) {
    addLog(d.name, 'system', `已停止自动重连（达到上限：${retryCounts[d.id] ?? 0} 次 / ${maxSeconds}s）`)
    retryCounts[d.id] = 0
    retryStartedAt[d.id] = 0
    return
  }
  retryCounts[d.id] = (retryCounts[d.id] ?? 0) + 1
  retryTimers[d.id] = setTimeout(() => {
    delete retryTimers[d.id]
    void connectDevice(d.id, true)
  }, 2000)
}

/** 查找同 ip:port 的已连接 TCP Server（tcp-client 的目标） */
function findConnectedServer(client: OrchDevice): OrchDevice | undefined {
  return orchStore.devices.find(d =>
    d.type === 'tcp-server' && d.connected && d.ip === client.ip && d.port === client.port
  )
}

function markConnected(d: OrchDevice) {
  if (d.connected) return
  d.connected = true
  addLog(d.name, 'system', '已连接')
  startHeartbeat(d)
  emitConnect(d.name)
}

function markDisconnected(d: OrchDevice, reason: string) {
  if (!d.connected) return
  d.connected = false
  stopHeartbeat(d.id)
  addLog(d.name, 'system', reason)
  emitDisconnect(d.name)
}

export async function connectDevice(id: string, isRetry = false, auto = false): Promise<void> {
  const d = orchStore.devices.find(item => item.id === id)
  if (!d || d.connected) return
  stopRetry(id)

  if (!orchMock) {
    const res = await orchApi.orchConnect(id, auto)
    if (!res.success) {
      if (!isRetry) addLog(d.name, 'error', `连接失败：${res.error?.message ?? '未知错误'}`)
      return
    }
    return
  }

  if (d.type === 'tcp-client') {
    const server = findConnectedServer(d)
    if (!server) {
      if (!isRetry) {
        addLog(d.name, 'error', `连接失败：未找到 TCP Server (${d.ip}:${d.port})${d.autoReconnect && !auto ? '，将自动重连' : ''}`)
      }
      if (d.autoReconnect && !auto) scheduleReconnect(d)
      return
    }
    await sleep(150)
    markConnected(d)
    retryCounts[d.id] = 0
    retryStartedAt[d.id] = 0
    addLog(server.name, 'system', `客户端 ${d.name} 已接入`)
    return
  }

  if (d.type === 'tcp-server' || d.type === 'udp' || d.type === 'serial' || d.type === 'docat-motion') {
    await sleep(150)
    if (d.type === 'docat-motion') {
      motionState[d.id] = { pose: [0, 0, 0, 0, 0, 0], suction: false, busy: false }
    }
    markConnected(d)
    retryCounts[d.id] = 0
    retryStartedAt[d.id] = 0
    // TCP Server 连接后，等待中的客户端立即接入
    if (d.type === 'tcp-server') {
      for (const client of orchStore.devices) {
        if (client.type === 'tcp-client' && !client.connected && client.ip === d.ip && client.port === d.port) {
          void connectDevice(client.id)
        }
      }
    }
    return
  }
}

export async function disconnectDevice(id: string): Promise<void> {
  const d = orchStore.devices.find(item => item.id === id)
  if (!d || !d.connected) return

  if (!orchMock) {
    const res = await orchApi.orchDisconnect(id)
    if (!res.success) addLog(d.name, 'error', `断开失败：${res.error?.message ?? '未知错误'}`)
    else d.connected = false
    return
  }

  markDisconnected(d, '已断开')
  delete motionState[d.id]
  if (d.type === 'tcp-server') {
    for (const client of orchStore.devices) {
      if (client.type === 'tcp-client' && client.ip === d.ip && client.port === d.port && client.connected) {
        markDisconnected(client, `服务端 ${d.name} 断开，链路中断`)
        if (client.autoReconnect) scheduleReconnect(client)
      }
    }
  }
}

// ─── 消息路由（脚本 send / 设备交互）───────────────────

export type MessageHandler = (text: string) => void
const messageHandlers: Record<string, MessageHandler[]> = {}
const connectHandlers: Record<string, Array<() => void>> = {}
const disconnectHandlers: Record<string, Array<() => void>> = {}

export function onDeviceMessage(name: string, cb: MessageHandler): () => void {
  if (!messageHandlers[name]) messageHandlers[name] = []
  messageHandlers[name].push(cb)
  return () => {
    messageHandlers[name] = (messageHandlers[name] || []).filter(h => h !== cb)
  }
}

export function onDeviceConnect(name: string, cb: () => void): () => void {
  if (!connectHandlers[name]) connectHandlers[name] = []
  connectHandlers[name].push(cb)
  return () => { connectHandlers[name] = (connectHandlers[name] || []).filter(h => h !== cb) }
}

export function onDeviceDisconnect(name: string, cb: () => void): () => void {
  if (!disconnectHandlers[name]) disconnectHandlers[name] = []
  disconnectHandlers[name].push(cb)
  return () => { disconnectHandlers[name] = (disconnectHandlers[name] || []).filter(h => h !== cb) }
}

function emitConnect(name: string) {
  for (const cb of connectHandlers[name] || []) cb()
}

function emitDisconnect(name: string) {
  for (const cb of disconnectHandlers[name] || []) cb()
}

function deliverIncoming(device: OrchDevice, text: string) {
  addLog(device.name, 'recv', text)
  for (const cb of messageHandlers[device.name] || []) {
    try { cb(text) } catch (err) { addLog(device.name, 'error', `脚本处理消息异常：${(err as Error).message}`) }
  }
}

/** 向编排设备发送消息（脚本 send 的底层） */
export function sendMessage(deviceName: string, text: string): boolean {
  const d = findDeviceByName(deviceName)
  if (!d) {
    addLog('脚本', 'error', `发送失败：设备 "${deviceName}" 不存在`)
    return false
  }
  if (!d.connected) {
    addLog(d.name, 'error', `发送失败：设备未连接 → ${text}`)
    return false
  }
  addLog(d.name, 'send', text)

  if (!orchMock) {
    void orchApi.orchSend(d.id, text)
    return true
  }

  if (d.type === 'tcp-client') {
    const server = findConnectedServer(d)
    if (server) {
      deliverIncoming(server, text)
    } else {
      addLog(d.name, 'error', '发送失败：TCP Server 链路不可达')
      return false
    }
  } else if (d.type === 'tcp-server') {
    const client = orchStore.devices.find(c => c.type === 'tcp-client' && c.connected && c.ip === d.ip && c.port === d.port)
    if (client) deliverIncoming(client, text)
    else addLog(d.name, 'error', '发送失败：无已接入的 TCP Client')
  } else if (d.type === 'udp') {
    // 模拟 UDP 回环
    setTimeout(() => deliverIncoming(d, text), 200)
  } else if (d.type === 'serial') {
    // 模拟串口回环
    setTimeout(() => deliverIncoming(d, text), 150)
  } else if (d.type === 'docat-motion') {
    // 协议处理：不把原始命令回显，只回复 received / reached
    void handleMotionCommand(d, text)
  }
  return true
}

// ─── Docat Motion（pick_place_tcp.py 协议模拟）────────

function splitFields(text: string): string[] {
  const t = String(text).replace(/\r/g, '').replace(/\n/g, '').trim()
  if (!t) return []
  const parts = t.split(';').map(p => p.trim())
  while (parts.length && parts[0] === '') parts.shift()
  while (parts.length && parts[parts.length - 1] === '') parts.pop()
  return parts
}

function parseFloats(items: string[]): number[] | null {
  const out: number[] = []
  for (const item of items) {
    const v = Number(item)
    if (!Number.isFinite(v)) return null
    out.push(v)
  }
  return out
}

function motionReply(device: OrchDevice, header: string, status: 'received' | 'reached' | 'error') {
  addLog(device.name, 'recv', `${header};${status};`)
  for (const cb of messageHandlers[device.name] || []) {
    try { cb(`${header};${status};`) } catch { /* ignore */ }
  }
}

/** 转发运动到被模拟的真实设备（若已连接） */
async function forwardMove(device: OrchDevice, pose: number[]) {
  const target = device.targetDeviceId
  const targetCfg = deviceStore.getDevice(target)
  if (target && deviceStore.isConnected(target) && targetCfg) {
    const res = await api.moveCartesian(target, {
      x: pose[0], y: pose[1], z: pose[2], rx: pose[3], ry: pose[4], rz: pose[5],
    })
    if (!res.success) {
      addLog(device.name, 'error', `转发到 ${targetCfg.name} 失败：${res.error?.message}，改为模拟执行`)
      await sleep(300)
      return
    }
    return
  }
  await sleep(400)
}

async function motionMoveTo(device: OrchDevice, pose: number[]) {
  const st = motionState[device.id]
  if (!st) return
  await forwardMove(device, pose)
  st.pose = [...pose]
}

async function handleMotionCommand(device: OrchDevice, raw: string) {
  const st = motionState[device.id]
  if (!st) return
  const parts = splitFields(raw)
  if (!parts.length) return
  const header = parts[0]
  const cmd = header.toUpperCase()
  const args = parts.slice(1)

  const reply = (status: 'received' | 'reached' | 'error') => motionReply(device, header, status)

  const parsePose = (items: string[]): number[] | null => {
    const values = parseFloats(items)
    return values && values.length >= 6 ? values.slice(0, 6) : null
  }

  if (cmd === 'GP') {
    if (args.length < 12 || args.length % 6 !== 0) { reply('error'); return }
    const values = parseFloats(args)
    if (!values) { reply('error'); return }
    const poses: number[][] = []
    for (let i = 0; i < values.length; i += 6) poses.push(values.slice(i, i + 6))
    if (poses.length < 2) { reply('error'); return }

    reply('received')
    addLog(device.name, 'system', `GP 取放流程开始：抓(${poses[0].slice(0, 3).join(',')}) 放(${poses[1].slice(0, 3).join(',')})`)
    await motionMoveTo(device, [poses[0][0], poses[0][1], poses[0][2] + 80, poses[0][3], poses[0][4], poses[0][5]])
    await motionMoveTo(device, poses[0])
    st.suction = true
    addLog(device.name, 'system', '吸盘 开')
    await sleep(200)
    await motionMoveTo(device, [poses[0][0], poses[0][1], poses[0][2] + 80, poses[0][3], poses[0][4], poses[0][5]])
    await motionMoveTo(device, [poses[1][0], poses[1][1], poses[1][2] + 80, poses[1][3], poses[1][4], poses[1][5]])
    await motionMoveTo(device, poses[1])
    st.suction = false
    addLog(device.name, 'system', '吸盘 关')
    await sleep(200)
    await motionMoveTo(device, [poses[1][0], poses[1][1], poses[1][2] + 80, poses[1][3], poses[1][4], poses[1][5]])
    if (poses.length >= 3) await motionMoveTo(device, poses[2])
    addLog(device.name, 'system', `GP 完成，当前位姿 (${st.pose.map(v => Number(v).toFixed(1)).join(', ')})`)
    reply('reached')
    return
  }

  if (cmd === 'MOVJ' || cmd === 'MOVL') {
    const pose = parsePose(args)
    if (!pose) { reply('error'); return }
    reply('received')
    addLog(device.name, 'system', `执行 ${cmd.toUpperCase()} → (${pose.map(v => Number(v).toFixed(1)).join(', ')})`)
    await motionMoveTo(device, pose)
    reply('reached')
    return
  }

  if (cmd === 'SUCK') {
    if (!args.length) { reply('error'); return }
    const v = String(args[0]).toLowerCase()
    let on: boolean
    if (['1', 'on', 'true', 'open'].includes(v)) on = true
    else if (['0', 'off', 'false', 'close'].includes(v)) on = false
    else {
      const n = Number(v)
      if (!Number.isFinite(n)) { reply('error'); return }
      on = n !== 0
    }
    reply('received')
    st.suction = on
    addLog(device.name, 'system', `吸盘 ${on ? '开' : '关'}`)
    await sleep(200)
    reply('reached')
    return
  }

  reply('error')
}

/** 读取 Docat Motion 当前位姿（设置-姿态 读取用） */
export function getMotionPose(id: string): number[] | null {
  const st = motionState[id]
  return st ? [...st.pose] : null
}

/** 手动运动 Docat Motion 到目标位姿（设置-姿态 一键运动用） */
export function manualMoveMotion(id: string, pose: number[]): boolean {
  const st = motionState[id]
  if (!st) return false
  st.pose = [...pose]
  addLog(orchStore.devices.find(d => d.id === id)?.name ?? 'Docat Motion', 'system', `手动运动到 (${pose.map(v => Number(v).toFixed(1)).join(', ')})`)
  return true
}

/** 读取 Docat Motion 吸盘状态 */
export function getMotionSuction(id: string): boolean {
  return motionState[id]?.suction ?? false
}

// ─── 姿态 CRUD（独立于 device 页姿态存储）──────────────

function poseItem(name: string, type: 'joint' | 'cartesian', joint: number[], pose: OrchPose['pose']): OrchPose {
  return { name: name.trim(), type, joint: [...joint], pose: { ...pose }, updatedAt: new Date().toISOString() }
}

function pushPoseToServer(item: OrchPose) {
  if (orchMock) return
  void orchApi.orchSavePose(item)
}

export async function addOrchPose(name: string, type: 'joint' | 'cartesian', joint: number[], pose: OrchPose['pose']): Promise<{ ok: boolean; error?: string }> {
  const err = identifierError(name, orchStore.poses.map(p => p.name))
  if (err) return { ok: false, error: err }
  const item = poseItem(name, type, joint, pose)
  if (orchMock) {
    orchStore.poses.push(item)
    persistOrchestration()
    return { ok: true }
  }
  const res = await orchApi.orchSavePose(item)
  if (!res.success) return { ok: false, error: res.error?.message ?? '保存失败' }
  orchStore.poses = [...orchStore.poses.filter(p => p.name !== item.name), res.data ?? item]
  return { ok: true }
}

export function removeOrchPose(name: string) {
  orchStore.poses = orchStore.poses.filter(p => p.name !== name)
  if (orchMock) {
    persistOrchestration()
    return
  }
  void orchApi.orchDeletePose(name)
}

export async function renameOrchPose(oldName: string, newName: string): Promise<{ ok: boolean; error?: string }> {
  const err = identifierError(newName, orchStore.poses.filter(p => p.name !== oldName).map(p => p.name))
  if (err) return { ok: false, error: err }
  const p = orchStore.poses.find(item => item.name === oldName)
  if (!p) return { ok: false, error: '姿态不存在' }
  const renamed = { ...p, name: newName.trim(), updatedAt: new Date().toISOString() }
  if (orchMock) {
    p.name = renamed.name
    p.updatedAt = renamed.updatedAt
    persistOrchestration()
    return { ok: true }
  }
  const [del, save] = await Promise.all([orchApi.orchDeletePose(oldName), orchApi.orchSavePose(renamed)])
  if (!save.success) return { ok: false, error: save.error?.message ?? '重命名失败' }
  void del
  orchStore.poses = orchStore.poses.filter(item => item.name !== oldName)
  orchStore.poses.push(save.data ?? renamed)
  return { ok: true }
}

/** 覆盖保存（或新增），旧值保留 10s 内可撤销 */
export async function saveOrchPoseFromCurrent(
  name: string,
  type: 'joint' | 'cartesian',
  joint: number[],
  pose: OrchPose['pose']
): Promise<{ ok: boolean; overwritten: boolean; error?: string }> {
  const v = name.trim()
  const err = identifierError(v, [])
  if (err) return { ok: false, overwritten: false, error: err }
  const existing = orchStore.poses.find(p => p.name === v)
  const item = poseItem(v, type, joint, pose)

  if (!orchMock) {
    const res = await orchApi.orchSavePose(item)
    if (!res.success) return { ok: false, overwritten: !!existing, error: res.error?.message ?? '保存失败' }
    if (existing) {
      undoSnapshot = { name: v, previous: { ...existing } }
      orchStore.poses = orchStore.poses.map(p => p.name === v ? (res.data ?? item) : p)
    } else {
      orchStore.poses = [...orchStore.poses, res.data ?? item]
    }
    return { ok: true, overwritten: !!existing }
  }

  if (existing) {
    undoSnapshot = { name: v, previous: { ...existing } }
    existing.type = item.type
    existing.joint = [...item.joint]
    existing.pose = { ...item.pose }
    existing.updatedAt = item.updatedAt
  } else {
    orchStore.poses.push(item)
  }
  persistOrchestration()
  return { ok: true, overwritten: !!existing }
}

let undoSnapshot: { name: string; previous: OrchPose } | null = null

export async function undoPoseOverwrite(): Promise<boolean> {
  if (!undoSnapshot) return false
  const { name, previous } = undoSnapshot
  const idx = orchStore.poses.findIndex(p => p.name === name)
  if (idx >= 0) orchStore.poses[idx] = { ...previous }
  else orchStore.poses.push({ ...previous })
  undoSnapshot = null
  if (orchMock) {
    persistOrchestration()
    return true
  }
  const res = await orchApi.orchSavePose({ ...previous })
  return res.success
}

export function hasUndoablePose(): boolean {
  return !!undoSnapshot
}

/** 保存设置（mock 本地 / 真实模式同步服务端） */
export async function saveOrchSettings(): Promise<void> {
  orchStore.settings.logLimit = Math.max(50, Number(orchStore.settings.logLimit) || 500)
  if (!orchStore.settings.defaultSeparator) orchStore.settings.defaultSeparator = ';'
  if (orchMock) {
    persistOrchestration()
    return
  }
  void orchApi.orchSaveSettings({ ...orchStore.settings })
}

// ─── 脚本桥接（浏览器内 JS 模拟运行用）─────────────────

type WaitMatcher = string | ((text: string) => boolean)

export function buildScriptContext() {
  const normalizeMatcher = (matcher: WaitMatcher) =>
    typeof matcher === 'function' ? matcher : (t: string) => t.startsWith(String(matcher))

  const waitFor = (name: string, matcher: WaitMatcher, timeoutMs = 10000): Promise<string> => {
    const match = normalizeMatcher(matcher)
    return new Promise((resolve, reject) => {
      const unsub = onDeviceMessage(name, (text) => {
        if (match(text)) {
          unsub()
          resolve(text)
        }
      })
      setTimeout(() => {
        unsub()
        reject(new Error(`等待 ${name} 应答超时（${timeoutMs}ms）`))
      }, Math.max(0, Number(timeoutMs) || 10000))
    })
  }

  return {
    devices: {
      send: (name: string, text: string) => sendMessage(name, String(text)),
      onMessage: (name: string, cb: MessageHandler) => onDeviceMessage(name, cb),
      onConnect: (name: string, cb: () => void) => onDeviceConnect(name, cb),
      onDisconnect: (name: string, cb: () => void) => onDeviceDisconnect(name, cb),
      isConnected: (name: string) => isDeviceConnected(name),
      /** 等待设备下一条匹配消息（字符串按前缀匹配 / 函数），超时 reject */
      waitFor: (name: string, matcher: WaitMatcher, timeoutMs?: number) => waitFor(name, matcher, timeoutMs),
      /** 发送并等待匹配应答 */
      sendAndWait: (name: string, text: string, matcher: WaitMatcher, timeoutMs?: number) => {
        sendMessage(name, String(text))
        return waitFor(name, matcher, timeoutMs)
      },
    },
    poses: {
      get: (name: string, separator?: string) =>
        separator !== undefined && separator !== null
          ? poseText(name, String(separator))
          : poseArray(name),
      list: () => orchStore.poses.map(p => p.name),
    },
    utils: {
      toArray: (text: string, separator = orchStore.settings.defaultSeparator || ';') => splitFields(String(text)),
      toString: (arr: Array<number | string>, separator = orchStore.settings.defaultSeparator || ';') =>
        (Array.isArray(arr) ? arr : []).join(String(separator)),
      sleep: (ms: number) => sleep(Math.max(0, Number(ms) || 0)),
      // WSL 路径转换（/mnt/d/... ⇄ D:\...）
      wslToWin: (path: string) => wslToWinPath(String(path)),
      winToWsl: (path: string) => winToWslPath(String(path)),
      // 标定转换（真实模式读取服务端文件；mock 不支持文件读取）
      calib: {
        parseIwcaf: (path: string) => calibUnavailable(`parseIwcaf('${path}')`),
        parseXml: (path: string) => calibUnavailable(`parseXml('${path}')`),
        imageToWorld: (m: CalibMatrixLike, x: number, y: number, sep?: string) =>
          calibImageToWorld(m, Number(x), Number(y), sep),
        worldToImage: (m: CalibMatrixLike, wx: number, wy: number, sep?: string) =>
          calibWorldToImage(m, Number(wx), Number(wy), sep),
      },
    },
    log: {
      info: (text: string) => addLog('脚本', 'script', String(text)),
      warn: (text: string) => addLog('脚本', 'script', `⚠ ${String(text)}`),
      error: (text: string) => addLog('脚本', 'error', String(text)),
    },
  }
}

// ─── 标定/路径工具实现（mock 与真实模式共享的纯逻辑）──

/** WSL → Windows：/mnt/d/foo → D:\foo */
export function wslToWinPath(path: string): string {
  const m = /^\/mnt\/([a-zA-Z])(\/.*)?$/.exec(path)
  if (!m) return path
  const rest = (m[2] || '').replace(/\//g, '\\')
  return `${m[1].toUpperCase()}:${rest || '\\'}`
}

/** Windows → WSL：D:\foo → /mnt/d/foo */
export function winToWslPath(path: string): string {
  const m = /^([a-zA-Z]):[\\/](.*)$/.exec(path)
  if (!m) return path
  const rest = (m[2] || '').replace(/[\\/]/g, '/')
  return `/mnt/${m[1].toLowerCase()}/${rest}`
}

export interface CalibMatrixLike {
  m00: number
  m01: number
  m02: number
  m10: number
  m11: number
  m12: number
}

function calibUnavailable(call: string): never {
  throw new Error(`${call} 需在真实模式运行（读取服务端标定文件）；mock 模式仅支持转换函数`)
}

function calibImageToWorld(m: CalibMatrixLike, x: number, y: number, sep?: string): number[] | string {
  const wx = m.m00 * x + m.m01 * y + m.m02
  const wy = m.m10 * x + m.m11 * y + m.m12
  return sep !== undefined && sep !== null ? `${wx}${sep}${wy}` : [wx, wy]
}

function calibWorldToImage(m: CalibMatrixLike, wx: number, wy: number, sep?: string): number[] | string {
  const det = m.m00 * m.m11 - m.m01 * m.m10
  if (Math.abs(det) < 1e-12) throw new Error('标定矩阵不可逆（行列式接近 0）')
  const ix = (m.m11 * (wx - m.m02) - m.m01 * (wy - m.m12)) / det
  const iy = (-m.m10 * (wx - m.m02) + m.m00 * (wy - m.m12)) / det
  return sep !== undefined && sep !== null ? `${ix}${sep}${iy}` : [ix, iy]
}

export type ScriptContext = ReturnType<typeof buildScriptContext>
