/**
 * 编排设备管理中枢 — 注册表 + 连接生命周期 + 消息路由
 *
 * - 设备/姿态配置持久化（orch_devices / orch_poses 表）
 * - connect/disconnect/send：按类型创建后端实现
 * - 入站消息：记日志广播（WS orch-event → 前端日志面板）+ 投递给脚本运行时
 * - 心跳 / 自动重连（退避）
 * - Docat Motion 转发：经 DevicePool 执行 moveCartesian / controlDobotES01
 */
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import { getSetting } from '../api/rest/system.js'
import { eventBus } from '../event/EventBus.js'
import type { DevicePool } from '../device/DevicePool.js'
import type { OrchDeviceBackend } from './devices/DeviceBackend.js'
import { TcpServerDevice } from './devices/TcpServerDevice.js'
import { TcpClientDevice } from './devices/TcpClientDevice.js'
import { UdpDevice } from './devices/UdpDevice.js'
import { SerialDevice } from './devices/SerialDevice.js'
import { DocatMotionDevice } from './devices/DocatMotionDevice.js'
import type { OrchDeviceConfig, OrchDeviceRuntime, OrchDeviceType, OrchPose } from './types.js'

/** 脚本运行时桥接（运行中注册，停止后清空） */
export interface RuntimeBridge {
  onDeviceMessage: (name: string, text: string) => void
  onDeviceStatus: (name: string, connected: boolean) => void
  onPosesChanged: () => void
}

interface DeviceEntry {
  config: OrchDeviceConfig
  backend: OrchDeviceBackend | null
  connected: boolean
  /** 手动断开标记：手动断开不触发自动重连 */
  manualDisconnect: boolean
  heartbeatTimer: ReturnType<typeof setInterval> | null
  retryTimer: ReturnType<typeof setTimeout> | null
  retryCount: number
  /** 本次重连循环的起始时间（用于时长上限） */
  reconnectStartedAt: number
  /** 心跳：最近一次收到 pong 的时间戳 */
  lastPongAt: number
  /** 心跳：连续未应答周期数 */
  missedPongs: number
}

/** 通用设置 key 前缀（与 api/rest/orchestration.ts 一致） */
const SETTING_PREFIX = 'orch.'

export class OrchDeviceManager {
  private entries = new Map<string, DeviceEntry>()
  private pool: DevicePool
  private runtimeBridge: RuntimeBridge | null = null

  constructor(pool: DevicePool) {
    this.pool = pool
    this.loadFromDb()
  }

  // ─── 广播 ──────────────────────────────────────────

  private broadcast(payload: Record<string, unknown>) {
    eventBus.emit('orch:event', { ...payload, timestamp: Date.now() })
  }

  private log(deviceName: string, direction: 'send' | 'recv' | 'system' | 'error', text: string, kind?: string) {
    this.broadcast({ event: 'log', deviceName, direction, text, kind })
  }

  // ─── 持久化 ────────────────────────────────────────

  private loadFromDb() {
    const db = getDb()
    const rows = db.prepare('SELECT * FROM orch_devices').all() as Array<Record<string, unknown>>
    for (const row of rows) {
      this.entries.set(String(row.id), {
        config: this.rowToConfig(row),
        backend: null,
        connected: false,
        manualDisconnect: true,
        heartbeatTimer: null,
        retryTimer: null,
        retryCount: 0,
        reconnectStartedAt: 0,
        lastPongAt: 0,
        missedPongs: 0,
      })
    }
  }

  private rowToConfig(row: Record<string, unknown>): OrchDeviceConfig {
    return {
      id: String(row.id),
      name: String(row.name),
      type: String(row.type) as OrchDeviceType,
      ip: String(row.ip ?? ''),
      port: Number(row.port ?? 0),
      serialPort: String(row.serialPort ?? ''),
      baudRate: Number(row.baudRate ?? 115200),
      targetDeviceId: String(row.targetDeviceId ?? ''),
      autoReconnect: Number(row.autoReconnect ?? 1) === 1,
      heartbeat: Number(row.heartbeat ?? 0) === 1,
      createdAt: String(row.createdAt ?? ''),
    }
  }

  private persistConfig(config: OrchDeviceConfig) {
    const db = getDb()
    db.prepare(`
      INSERT INTO orch_devices (id, name, type, ip, port, serialPort, baudRate, targetDeviceId, autoReconnect, heartbeat, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, type = excluded.type, ip = excluded.ip, port = excluded.port,
        serialPort = excluded.serialPort, baudRate = excluded.baudRate,
        targetDeviceId = excluded.targetDeviceId, autoReconnect = excluded.autoReconnect,
        heartbeat = excluded.heartbeat
    `).run(
      config.id, config.name, config.type, config.ip, config.port, config.serialPort,
      config.baudRate, config.targetDeviceId, config.autoReconnect ? 1 : 0,
      config.heartbeat ? 1 : 0, config.createdAt,
    )
  }

  // ─── 设备 CRUD ─────────────────────────────────────

  list(): OrchDeviceRuntime[] {
    return [...this.entries.values()].map(e => ({ ...e.config, connected: e.connected }))
  }

  get(id: string): OrchDeviceRuntime | null {
    const e = this.entries.get(id)
    return e ? { ...e.config, connected: e.connected } : null
  }

  add(input: Omit<OrchDeviceConfig, 'id' | 'createdAt'>): { ok: boolean; error?: string; device?: OrchDeviceRuntime } {
    const name = input.name.trim()
    if (!name) return { ok: false, error: '名称不能为空' }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return { ok: false, error: '名称需符合变量命名规则' }
    for (const e of this.entries.values()) {
      if (e.config.name === name) return { ok: false, error: '名称已存在' }
    }
    const config: OrchDeviceConfig = {
      id: uuidv4(),
      name,
      type: input.type,
      ip: input.ip ?? '',
      port: input.port ?? 0,
      serialPort: input.serialPort ?? '',
      baudRate: input.baudRate ?? 115200,
      targetDeviceId: input.targetDeviceId ?? '',
      autoReconnect: input.autoReconnect ?? true,
      heartbeat: input.heartbeat ?? false,
      createdAt: new Date().toISOString(),
    }
    this.persistConfig(config)
    this.entries.set(config.id, {
      config, backend: null, connected: false, manualDisconnect: true,
      heartbeatTimer: null, retryTimer: null, retryCount: 0,
      reconnectStartedAt: 0,
      lastPongAt: 0, missedPongs: 0,
    })
    return { ok: true, device: { ...config, connected: false } }
  }

  update(id: string, patch: Partial<Pick<OrchDeviceConfig, 'name' | 'type' | 'ip' | 'port' | 'serialPort' | 'baudRate' | 'targetDeviceId' | 'autoReconnect' | 'heartbeat'>>): { ok: boolean; error?: string } {
    const entry = this.entries.get(id)
    if (!entry) return { ok: false, error: '设备不存在' }
    // 过滤 undefined 字段，避免覆盖默认值
    const clean: typeof patch = {}
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) (clean as Record<string, unknown>)[k] = v
    }
    const next = { ...entry.config, ...clean }
    if (patch.name && patch.name !== entry.config.name) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(patch.name.trim())) return { ok: false, error: '名称需符合变量命名规则' }
      for (const e of this.entries.values()) {
        if (e.config.id !== id && e.config.name === patch.name.trim()) return { ok: false, error: '名称已存在' }
      }
    }
    if (next.type !== 'serial' && next.type !== 'docat-motion' && !next.ip.trim()) return { ok: false, error: 'IP 不能为空' }
    if (next.type !== 'serial' && next.type !== 'docat-motion' && !(next.port > 0 && next.port <= 65535)) return { ok: false, error: '端口需为 1-65535' }
    if (next.type === 'serial' && !next.serialPort.trim()) return { ok: false, error: '串口号不能为空' }

    // 连接参数变化 → 断开
    if (entry.connected && (next.type !== entry.config.type || next.ip !== entry.config.ip
      || next.port !== entry.config.port || next.serialPort !== entry.config.serialPort)) {
      void this.disconnect(id)
    }
    entry.config = { ...entry.config, ...clean, name: patch.name ? patch.name.trim() : entry.config.name }
    this.persistConfig(entry.config)
    return { ok: true }
  }

  async remove(id: string) {
    const entry = this.entries.get(id)
    if (!entry) return
    if (entry.connected) await this.disconnect(id)
    entry.backend?.dispose()
    if (entry.heartbeatTimer) clearInterval(entry.heartbeatTimer)
    if (entry.retryTimer) clearTimeout(entry.retryTimer)
    this.entries.delete(id)
    getDb().prepare('DELETE FROM orch_devices WHERE id = ?').run(id)
  }

  /** 修改后向脚本运行时推送姿态（无脚本运行时忽略） */
  setRuntimeBridge(bridge: RuntimeBridge | null) {
    this.runtimeBridge = bridge
  }

  // ─── 连接生命周期 ─────────────────────────────────

  /**
   * 连接设备。
   * auto = true（如"启动时自动连接"）：失败不进入自动重连，等同开关未打开。
   * silent = true（快速恢复探测模式）：失败不记日志（对端未恢复属常态）。
   * connectTimeoutMs：仅 tcp-client 生效，覆盖默认连接超时。
   */
  async connect(id: string, auto = false, silent = false, connectTimeoutMs?: number): Promise<{ ok: boolean; error?: string }> {
    const entry = this.entries.get(id)
    if (!entry) return { ok: false, error: '设备不存在' }
    if (entry.connected) return { ok: true }
    entry.manualDisconnect = false
    if (entry.retryTimer) { clearTimeout(entry.retryTimer); entry.retryTimer = null }

    const cfg = entry.config
    let backend: OrchDeviceBackend
    const onIncoming = (text: string) => this.handleIncoming(cfg, text)
    const onError = (message: string) => {
      // 连接尝试期间（backend 尚未就绪）由 connect 失败分支统一记录，避免成对刷屏
      if (!entry.backend) return
      this.log(cfg.name, 'error', message)
      this.broadcast({ event: 'device-error', deviceId: cfg.id, name: cfg.name, message })
    }

    switch (cfg.type) {
      case 'tcp-server':
        backend = new TcpServerDevice(cfg.id, cfg.ip || '0.0.0.0', cfg.port, {
          onIncoming, onError,
          onClientChange: (c) => {
            if (c) this.log(cfg.name, 'system', '客户端已接入')
            else this.log(cfg.name, 'system', '客户端已断开')
          },
        })
        break
      case 'tcp-client':
        backend = new TcpClientDevice(cfg.id, cfg.ip, cfg.port, {
          onIncoming, onError,
          onClientChange: (c) => this.handleLinkChange(entry, c),
        }, connectTimeoutMs)
        break
      case 'udp':
        backend = new UdpDevice(cfg.id, cfg.ip, cfg.port, { onIncoming, onError })
        break
      case 'serial':
        backend = new SerialDevice(cfg.id, cfg.serialPort, cfg.baudRate, {
          onIncoming, onError,
          onClientChange: (c) => this.handleLinkChange(entry, c),
        })
        break
      case 'docat-motion':
        backend = new DocatMotionDevice(cfg.id, {
          onIncoming, onError,
          getPong: () => this.heartbeatSettings().pong,
          forwardMove: async (pose) => this.forwardMove(cfg, pose),
          forwardSuck: async (on) => this.forwardSuck(cfg, on),
        })
        break
      default:
        return { ok: false, error: `未知设备类型 ${cfg.type}` }
    }

    const result = await backend.connect()
    if (!result.ok) {
      backend.dispose()
      // 首次失败记录；重试轮次静默（降噪）。auto 连接失败不进入重连。silent 快速模式不记日志。
      if (entry.retryCount === 0 && !silent) {
        this.log(cfg.name, 'error', `连接失败：${result.error}`, 'connect')
      }
      if (!auto) this.scheduleReconnect(entry)
      return result
    }

    entry.backend = backend
    entry.connected = true
    entry.retryCount = 0
    entry.reconnectStartedAt = 0
    entry.lastPongAt = Date.now()
    entry.missedPongs = 0
    this.log(cfg.name, 'system', '已连接')
    this.startHeartbeat(entry)
    this.broadcast({ event: 'device-status', deviceId: cfg.id, name: cfg.name, connected: true })
    this.runtimeBridge?.onDeviceStatus(cfg.name, true)
    return { ok: true }
  }

  async disconnect(id: string): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.manualDisconnect = true
    if (entry.retryTimer) { clearTimeout(entry.retryTimer); entry.retryTimer = null }
    if (entry.heartbeatTimer) { clearInterval(entry.heartbeatTimer); entry.heartbeatTimer = null }
    const wasConnected = entry.connected
    await entry.backend?.disconnect()
    entry.backend?.dispose()
    entry.backend = null
    entry.connected = false
    if (wasConnected) {
      this.log(entry.config.name, 'system', '已断开')
      this.broadcast({ event: 'device-status', deviceId: entry.config.id, name: entry.config.name, connected: false })
      this.runtimeBridge?.onDeviceStatus(entry.config.name, false)
    }
  }

  /** 连接意外断开（客户端主动断/对端断开）→ 自动重连 */
  private handleLinkChange(entry: DeviceEntry, connected: boolean) {
    if (connected) {
      if (!entry.connected) {
        entry.connected = true
        entry.retryCount = 0
        this.log(entry.config.name, 'system', '链路已恢复')
        this.broadcast({ event: 'device-status', deviceId: entry.config.id, name: entry.config.name, connected: true })
        this.runtimeBridge?.onDeviceStatus(entry.config.name, true)
      }
      return
    }
    if (entry.connected) {
      entry.connected = false
      this.log(entry.config.name, 'system', '链路中断')
      this.broadcast({ event: 'device-status', deviceId: entry.config.id, name: entry.config.name, connected: false })
      this.runtimeBridge?.onDeviceStatus(entry.config.name, false)
    }
    // 释放底层连接（socket/监听），避免重连时端口占用
    if (entry.backend) {
      const backend = entry.backend
      entry.backend = null
      void backend.disconnect().finally(() => backend.dispose())
    }
    if (!entry.manualDisconnect) this.scheduleReconnect(entry)
  }

  private scheduleReconnect(entry: DeviceEntry) {
    if (!entry.config.autoReconnect || entry.manualDisconnect || entry.connected) return
    if (entry.retryTimer) return

    // 快速恢复（仅 tcp-client）：固定间隔直接重连，不探测、不打扰对端。
    // 对端口关闭时 connect 瞬时失败（ECONNREFUSED，无副作用）；恢复后下一轮直接连上并保持。
    // 不受次数/时长上限约束，开关不会自动关闭（手动断开仍取消循环）。
    const rr = this.rapidRecoverySettings()
    if (entry.config.type === 'tcp-client' && rr.enabled) {
      entry.retryTimer = setTimeout(() => {
        entry.retryTimer = null
        if (entry.manualDisconnect || entry.connected) return
        void this.connect(entry.config.id, false, true, rr.connectTimeout).then((r) => {
          if (!r.ok && entry.config.autoReconnect && !entry.manualDisconnect && !entry.connected) {
            this.scheduleReconnect(entry)
          }
        })
      }, rr.interval)
      return
    }

    // 首次失败：记录重连循环起始
    if (entry.reconnectStartedAt === 0) entry.reconnectStartedAt = Date.now()

    // 上限：次数 / 时长（通用设置可配；maxAttempts=0 表示不限次数）
    const rc = this.reconnectSettings()
    if (entry.retryCount >= rc.maxAttempts || Date.now() - entry.reconnectStartedAt >= rc.maxSeconds * 1000) {
      this.log(entry.config.name, 'system', `已停止自动重连（达到上限：${entry.retryCount} 次 / ${rc.maxSeconds}s）`)
      // 通知前端关闭连接意图开关（desired），避免下次断线继续重连
      this.broadcast({ event: 'retry-stop', deviceId: entry.config.id, name: entry.config.name })
      entry.retryCount = 0
      entry.reconnectStartedAt = 0
      return
    }

    const delay = Math.min(1000 * 2 ** entry.retryCount, 30000)
    entry.retryCount++
    entry.retryTimer = setTimeout(() => {
      entry.retryTimer = null
      void this.connect(entry.config.id)
    }, delay)
  }

  /** 从「通用」设置读取快速恢复参数（仅 tcp-client 生效） */
  private rapidRecoverySettings(): { enabled: boolean; interval: number; connectTimeout: number } {
    const num = (v: string, fallback: number) => {
      const n = Number(v)
      return Number.isFinite(n) && n > 0 ? n : fallback
    }
    const interval = Math.max(200, num(getSetting(`${SETTING_PREFIX}rapidRecoveryInterval`), 1000))
    return {
      enabled: getSetting(`${SETTING_PREFIX}rapidRecovery`) !== 'false',
      interval,
      // 黑洞 IP 时保持重试节奏：连接超时不超过间隔的 2 倍（封顶 3s）
      connectTimeout: Math.min(3000, Math.max(500, interval * 2)),
    }
  }

  /** 从「通用」设置读取重连上限（maxAttempts=0 表示不限次数） */
  private reconnectSettings(): { maxAttempts: number; maxSeconds: number } {
    const num = (v: string, fallback: number) => {
      const n = Number(v)
      return Number.isFinite(n) && n > 0 ? n : fallback
    }
    const attempts = (v: string, fallback: number) => {
      const n = Number(v)
      if (!Number.isFinite(n)) return fallback
      return n > 0 ? n : Infinity // 0 = 不限次数
    }
    return {
      maxAttempts: attempts(getSetting(`${SETTING_PREFIX}reconnectMaxAttempts`), 8),
      maxSeconds: num(getSetting(`${SETTING_PREFIX}reconnectMaxSeconds`), 600),
    }
  }

  private startHeartbeat(entry: DeviceEntry) {
    if (entry.heartbeatTimer) clearInterval(entry.heartbeatTimer)
    if (!entry.config.heartbeat) return
    const hb = this.heartbeatSettings()
    entry.heartbeatTimer = setInterval(() => {
      if (!entry.connected) {
        clearInterval(entry.heartbeatTimer!)
        entry.heartbeatTimer = null
        return
      }
      // 应用层心跳：发送 ping 内容，期待 pong 内容（在 handleIncoming 中登记）
      this.log(entry.config.name, 'send', hb.ping.replace(/\n/g, '\\n'))
      void entry.backend?.send(hb.ping)
      const hbNow = this.heartbeatSettings()
      if (entry.lastPongAt > 0 && Date.now() - entry.lastPongAt > hbNow.timeout) {
        entry.missedPongs++
        if (entry.missedPongs >= hbNow.threshold) {
          this.log(entry.config.name, 'error', `心跳超时（${entry.missedPongs} 个周期无 ${hbNow.pong.trim()} 应答），判定链路失活`)
          entry.missedPongs = 0
          this.handleLinkChange(entry, false)
        } else {
          this.log(entry.config.name, 'system', `心跳超时（第 ${entry.missedPongs}/${hbNow.threshold} 个周期无 ${hbNow.pong.trim()} 应答）`)
        }
      }
    }, hb.interval)
  }

  /** 从「通用」设置读取心跳参数（每次心跳 tick 实时取值，支持 \n 转义） */
  private heartbeatSettings(): { interval: number; timeout: number; threshold: number; ping: string; pong: string } {
    const num = (v: string, fallback: number) => {
      const n = Number(v)
      return Number.isFinite(n) && n > 0 ? n : fallback
    }
    const esc = (v: string, fallback: string) => {
      const s = getSetting(`${SETTING_PREFIX}${v}`)
      if (!s) return fallback
      return s.replace(/\\n/g, '\n')
    }
    const interval = num(getSetting(`${SETTING_PREFIX}heartbeatInterval`), 5000)
    return {
      interval,
      timeout: Math.max(interval, num(getSetting(`${SETTING_PREFIX}heartbeatTimeout`), 15000)),
      threshold: Math.max(1, num(getSetting(`${SETTING_PREFIX}heartbeatMissThreshold`), 3)),
      ping: esc('heartbeatPing', 'ping;'),
      pong: esc('heartbeatPong', 'pong;'),
    }
  }

  // ─── 消息路由 ─────────────────────────────────────

  /** 脚本 send 的底层：按名称寻址并发送 */
  sendByName(name: string, text: string): boolean {
    const entry = [...this.entries.values()].find(e => e.config.name === name)
    if (!entry) {
      this.log('脚本', 'error', `发送失败：设备 "${name}" 不存在`)
      return false
    }
    if (!entry.connected) {
      this.log(entry.config.name, 'error', `发送失败：设备未连接 → ${text}`)
      return false
    }
    this.log(entry.config.name, 'send', text)
    void entry.backend?.send(text)
    return true
  }

  private handleIncoming(cfg: OrchDeviceConfig, text: string) {
    // 心跳应答登记：匹配配置的 pong 内容 → 重置失活计数
    const entry = this.entries.get(cfg.id)
    if (entry && entry.config.heartbeat && this.isPongText(text)) {
      entry.lastPongAt = Date.now()
      entry.missedPongs = 0
    }
    this.log(cfg.name, 'recv', text)
    this.runtimeBridge?.onDeviceMessage(cfg.name, text)
  }

  /** 入站文本是否为配置的心跳应答（大小写不敏感，忽略尾部 ; 与换行） */
  private isPongText(text: string): boolean {
    const hb = this.heartbeatSettings()
    const pong = hb.pong.replace(/\\n/g, '\n').replace(/[\r\n;]+$/g, '').trim().toLowerCase()
    if (!pong) return false
    const incoming = String(text).replace(/[\r\n;]+$/g, '').trim().toLowerCase()
    return incoming === pong
  }

  // ─── Docat Motion 转发 ────────────────────────────

  private getTargetDevice(targetId: string) {
    if (!targetId) return null
    const entry = this.pool.getDevice(targetId)
    if (!entry || !entry.driver.status.connected) return null
    return entry
  }

  private async forwardMove(cfg: OrchDeviceConfig, pose: number[]): Promise<boolean> {
    const entry = this.getTargetDevice(cfg.targetDeviceId)
    if (!entry) return false
    try {
      await entry.driver.moveCartesian({
        x: pose[0], y: pose[1], z: pose[2], rx: pose[3], ry: pose[4], rz: pose[5],
      })
      return true
    } catch (err) {
      this.log(cfg.name, 'error', `转发到真实设备失败：${(err as Error).message}`)
      return false
    }
  }

  private async forwardSuck(cfg: OrchDeviceConfig, on: boolean): Promise<boolean> {
    const entry = this.getTargetDevice(cfg.targetDeviceId)
    if (!entry) return false
    try {
      await entry.driver.controlDobotES01(on ? 'grip' : 'release')
      return true
    } catch (err) {
      this.log(cfg.name, 'error', `转发吸盘失败：${(err as Error).message}`)
      return false
    }
  }

  // ─── 姿态 ─────────────────────────────────────────

  listPoses(): OrchPose[] {
    const db = getDb()
    const rows = db.prepare('SELECT * FROM orch_poses ORDER BY name').all() as Array<Record<string, unknown>>
    return rows.map(r => ({
      name: String(r.name),
      type: String(r.type) as OrchPose['type'],
      joint: JSON.parse(String(r.joint ?? '[]')) as number[],
      pose: JSON.parse(String(r.pose ?? '{}')) as OrchPose['pose'],
      updatedAt: String(r.updatedAt ?? ''),
    }))
  }

  savePose(pose: OrchPose): { ok: boolean; error?: string } {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(pose.name)) return { ok: false, error: '姿态名需符合变量命名规则' }
    const db = getDb()
    db.prepare(`
      INSERT INTO orch_poses (name, type, joint, pose, updatedAt)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        type = excluded.type, joint = excluded.joint, pose = excluded.pose, updatedAt = excluded.updatedAt
    `).run(pose.name, pose.type, JSON.stringify(pose.joint), JSON.stringify(pose.pose), new Date().toISOString())
    this.broadcast({ event: 'pose' })
    this.runtimeBridge?.onPosesChanged()
    return { ok: true }
  }

  deletePose(name: string) {
    getDb().prepare('DELETE FROM orch_poses WHERE name = ?').run(name)
    this.broadcast({ event: 'pose' })
    this.runtimeBridge?.onPosesChanged()
  }

  /** 关闭所有设备（优雅退出） */
  async shutdown() {
    for (const id of [...this.entries.keys()]) {
      await this.disconnect(id)
    }
  }
}
