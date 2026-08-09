/**
 * 设备管理 REST API
 * /api/devices — CRUD + 连接/断开/锁定/订阅
 */
import type { FastifyInstance } from 'fastify'
import { v4 as uuidv4 } from 'uuid'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'
import { getDb } from '../../db/index.js'
import { authMiddleware, requireOperator } from '../../auth/auth.js'
import type { DevicePool, ConnectionMode } from '../../device/DevicePool.js'
import type { AccessScheduler } from '../../access/AccessScheduler.js'
import { SftpTransport, type SftpFileEntry } from '../../device/transport/SftpTransport.js'
import { CRApiTcpTransport, type CRFeedBackData } from '../../device/transport/CRApiTcpTransport.js'
import { createStoredZip, type ZipEntryInput } from '../../utils/zip.js'
import { getSetting, SETTING_CALIB_EXPORT_DIR, DEFAULT_EXPORT_DIR, resolveExportDir } from './system.js'
import type { ApiResponse, DeviceConfig } from 'docat-shared/types'
import type { LoadParams, CustomPosture, SystemTime, CoordinateData, UserList, UserPermissionConfig } from '../../device/DeviceDriver.js'

const CONTROL_LOG_DIR = '/developOnly/logs/user'
const CONTROL_LOG_LEVELS = ['error', 'warning', 'info', 'user'] as const

const SYSTEM_JOINT_PRESETS = [
  { id: 'system-safe-origin', name: 'Safe Origin', joints: [0, 0, 0, 0, 0, 0], system: true },
  { id: 'system-pack', name: 'Pack', joints: [-90, 0, -140, -40, 0, 0], system: true },
  { id: 'system-research', name: 'Research', joints: [-90, 0, -90, 0, 90, 0], system: true },
] as const

type ControlLogLevel = typeof CONTROL_LOG_LEVELS[number]
type ControlLogDisplayLevel = ControlLogLevel | 'plain'

interface CalibrationExportRow {
  imgX: number
  imgY: number
  physX: number
  physY: number
  angle?: number
}

/** 清洗文件主名：剔除路径分隔符与控制字符 */
function sanitizeFileStem(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim()
}

/** 导出文件时间戳 yyyyMMdd_HHmmss */
function timestampStem(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** 数值格式化：统一保留 3 位小数 */
function fmtNum(v: number): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return '0.000'
  return n.toFixed(3)
}

/** 格式化导出行：每列左对齐补足到该列最大宽度，列间 3 个空格，与原始 txt 对齐风格一致 */
function formatExportLines(rows: CalibrationExportRow[]): string[] {
  const cols = rows.map(r => [fmtNum(r.imgX), fmtNum(r.imgY), fmtNum(r.physX), fmtNum(r.physY), fmtNum(r.angle ?? 0)])
  const widths = [0, 0, 0, 0, 0]
  cols.forEach(r => r.forEach((v, i) => {
    if (v.length > widths[i]) widths[i] = v.length
  }))
  return cols.map(r => r.map((v, i) => v.padEnd(widths[i])).join('   '))
}

interface JointPresetRow {
  id: string
  deviceId: string
  name: string
  joints: string
  createdAt: string
  updatedAt: string
}

interface ControlLogQuery {
  start?: string
  end?: string
  types?: string
  keyword?: string
  limit?: string
}

interface ControlLogFile {
  path: string
  name: string
  date: string
  size: number
  modifyTime: number
}

interface ControlLogLine {
  file: string
  path: string
  line: number
  level: ControlLogDisplayLevel
  text: string
}

const PLUGIN_NAME_RE = /^[A-Za-z0-9][\w.-]*$/

/** 官方插件描述（本地资源里的 description 多为 %{tr_...} 占位符，这里提供中文兜底） */
const PLUGIN_DESCRIPTIONS: Record<string, string> = {
  DobotES01: 'DobotES吸盘，与协作机器人即插即用',
  SafeSkin: '安全皮肤插件',
  ConveyorTrack: '传送带跟踪插件',
  DHGrip: 'DH系列电爪，与协作机器人即插即用',
  EndButtonSetting: '允许将末端生态按键设置为存点功能',
  EwellixLiftkit: '伊维莱升降柱插件',
  EXTIO: '扩展IO插件',
  ForceTorqueSensor: '六维力插件',
  JodellGrip: '适配钧舵EGP系列、RG系列中所有支持Modbus RTU通讯的夹爪',
  OnRobot: 'onrobot 插件，适配 2FG7 夹爪、RG 系列、VG 系列吸盘。',
  OperateInterface: '支持用户自定义程序运行界面',
  Palletizing: '码垛插件',
  RobotiqEpick: 'Robotiq 系列吸盘插件',
  RobotiqGrip: 'Robotiq 系列夹爪插件',
  CodeLibrary: '代码库',
}

/** 描述解析：明文直接用；%{tr_...} 占位符用内置表兜底 */
function resolvePluginDescription(baseName: string, raw?: unknown): string {
  if (typeof raw === 'string' && raw.trim() && !raw.trim().startsWith('%{') && !raw.trim().startsWith('tr_')) {
    return raw.trim()
  }
  return PLUGIN_DESCRIPTIONS[baseName] ?? ''
}

/** 可选本地插件资源目录（gitignored，env 可覆盖）；放插件文件夹即可被自动发现 */
function resolveLocalDobotPlusDir(): string | null {
  const env = process.env.DOCAT_DOBOT_PLUS_UI_DIR?.trim()
  const cwd = process.cwd()
  const candidates: string[] = []
  if (env) candidates.push(env)
  // 兼容 turbo / 单包启动：从当前目录逐级向上找仓库里的插件目录
  let dir = cwd
  for (let depth = 0; depth < 6 && dir; depth++) {
    candidates.push(path.join(dir, 'packages/docat-web/public/dobot-plus'))
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  candidates.push(path.join(cwd, 'dobot-plus-ui'))
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return null
}

function listLocalDobotPlusPlugins(dir: string): string[] {
  const plugins: string[] = []
  for (const name of readdirSync(dir)) {
    if (!PLUGIN_NAME_RE.test(name)) continue
    const entry = path.join(dir, name)
    if (statSync(entry).isDirectory() && existsSync(path.join(entry, 'Main', 'index.html'))) {
      plugins.push(name)
    }
  }
  return plugins.sort((a, b) => a.localeCompare(b))
}

function readLocalPluginMeta(dir: string, name: string): { description?: string; version?: string } {
  try {
    const raw = readFileSync(path.join(dir, name, 'Main', 'config.json'), 'utf8')
    const cfg = JSON.parse(raw) as { name?: unknown; description?: unknown; version?: unknown }
    const baseName = typeof cfg.name === 'string' && cfg.name ? cfg.name : name.replace(/_(?:v|V)\d.*$/, '')
    return {
      description: resolvePluginDescription(baseName, cfg.description) || undefined,
      version: typeof cfg.version === 'string' ? cfg.version : undefined,
    }
  } catch { return {} }
}

function collectLocalPluginFiles(dir: string, pluginName: string): ZipEntryInput[] {
  const root = path.join(dir, pluginName)
  const entries: ZipEntryInput[] = []
  const walk = (current: string, rel: string) => {
    for (const name of readdirSync(current)) {
      const full = path.join(current, name)
      const relPath = rel ? `${rel}/${name}` : name
      const stat = statSync(full)
      if (stat.isDirectory()) walk(full, relPath)
      else if (!name.includes('Zone.Identifier')) entries.push({ path: relPath, data: readFileSync(full) })
    }
  }
  walk(root, '')
  return entries
}

/** 与官方一致：zip 内带 <插件名>/ 顶层目录 */
function buildPluginZip(pluginName: string, files: ZipEntryInput[]): Buffer {
  return createStoredZip(files.map(file => ({ path: `${pluginName}/${file.path}`, data: file.data })))
}

/** 更新控制器 hash.json，记录本地资源哈希（供官方 App 同步校验） */
async function writePluginHashToController(sftp: SftpTransport, pluginName: string, zip: Buffer): Promise<void> {
  const hash = createHash('sha1').update(zip).digest('hex')
  const hashPath = '/developOnly/ecology/hash.json'
  let existing: Record<string, unknown> = {}
  try {
    const raw = await sftp.readText(hashPath)
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') existing = parsed as Record<string, unknown>
  } catch { /* 控制器暂无 hash.json */ }
  existing[pluginName] = { pc_hash: hash }
  await sftp.writeText(hashPath, JSON.stringify(existing, null, 2))
}

const PLUGIN_UPLOAD_EXCLUDED_DIRS = new Set(['Blocks', 'Main', 'Resources', 'Scripts', 'Toolbar'])

/** 官方除了 zip 外，还会把 API 相关文件（config.json、*.lua 等）单独上传到 ecology/<插件名>/ */
function collectPluginApiFiles(pluginName: string, files: ZipEntryInput[]): ZipEntryInput[] {
  return files.filter(file => {
    const top = file.path.split('/')[0]
    return !PLUGIN_UPLOAD_EXCLUDED_DIRS.has(top)
  })
}

function todayDateKey(): string {
  const now = new Date()
  return [
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('')
}

function toDateKey(input: string | undefined, fallback: string): string {
  if (!input) return fallback
  const trimmed = input.trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (iso) return `${iso[1]}${iso[2]}${iso[3]}`
  const compact = /^(\d{6}|\d{8})$/.exec(trimmed)
  if (compact) return normalizeLogDateKey(compact[1])
  return fallback
}

function normalizeDateRange(query: ControlLogQuery): { start: string; end: string } {
  const fallback = todayDateKey()
  let start = toDateKey(query.start, fallback)
  let end = toDateKey(query.end, fallback)
  if (start > end) [start, end] = [end, start]
  return { start, end }
}

function parseControlLogTypes(raw: string | undefined): ControlLogLevel[] {
  if (!raw) return [...CONTROL_LOG_LEVELS]
  const selected = raw.split(',')
    .map(item => item.trim().toLowerCase())
    .filter((item): item is ControlLogLevel => (CONTROL_LOG_LEVELS as readonly string[]).includes(item))
  return selected.length > 0 ? selected : [...CONTROL_LOG_LEVELS]
}

function parseControlLogLimit(raw: string | undefined): number {
  const value = Number.parseInt(raw ?? '1000', 10)
  if (!Number.isFinite(value)) return 1000
  return Math.max(1, Math.min(5000, value))
}

function getControlLogDate(name: string): string | null {
  const match = /^(\d{6}|\d{8})\.log$/i.exec(name)
  return match ? normalizeLogDateKey(match[1]) : null
}

function normalizeLogDateKey(date: string): string {
  return date.length === 6 ? `20${date}` : date
}

function mapControlLogFiles(entries: SftpFileEntry[], start: string, end: string): ControlLogFile[] {
  return entries
    .map(entry => {
      const date = getControlLogDate(entry.name)
      if (!date) return null
      if (date < start || date > end) return null
      return {
        path: entry.path,
        name: entry.name,
        date,
        size: entry.size,
        modifyTime: entry.modifyTime,
      }
    })
    .filter((entry): entry is ControlLogFile => entry !== null)
    .sort((a, b) => b.name.localeCompare(a.name))
}

function detectControlLogLevel(line: string): ControlLogLevel | null {
  const lower = line.toLowerCase()
  for (const level of CONTROL_LOG_LEVELS) {
    if (lower.includes(`[${level}]`)) return level
  }
  return null
}

export function deviceRoutes(app: FastifyInstance, pool: DevicePool, scheduler: AccessScheduler): void {
  function getDeviceIp(deviceId: string): string | null {
    const online = pool.getDevice(deviceId)
    if (online) return online.driver.ip

    const db = getDb()
    const device = db.prepare('SELECT ip FROM devices WHERE id = ?').get(deviceId) as { ip: string } | undefined
    return device?.ip ?? null
  }

  async function listControlLogFiles(deviceId: string, query: ControlLogQuery): Promise<ControlLogFile[]> {
    const ip = getDeviceIp(deviceId)
    if (!ip) throw new Error('设备不存在')

    const { start, end } = normalizeDateRange(query)
    const sftp = new SftpTransport(ip)
    const entries = await sftp.list(CONTROL_LOG_DIR)
    return mapControlLogFiles(entries, start, end)
  }

  /** 列出所有已注册设备 */
  app.get('/api/devices', async (request, reply): Promise<ApiResponse<DeviceConfig[]>> => {
    try {
      await authMiddleware(request, reply)
      if (reply.sent) return reply

      const db = getDb()
      const devices = db.prepare('SELECT * FROM devices ORDER BY createdAt DESC').all() as DeviceConfig[]
      return { success: true, data: devices }
    } catch (err) {
      return { success: false, error: { code: 50000, message: (err as Error).message } }
    }
  })

  /** 注册新设备 */
  app.post<{ Body: { ip: string; name: string; type?: string; autoConnect?: boolean } }>(
    '/api/devices',
    async (request, reply): Promise<ApiResponse<DeviceConfig>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const { ip, name, type = '', autoConnect = false } = request.body
        if (!ip || !name) {
          return { success: false, error: { code: 42200, message: '缺少 ip 或 name' } }
        }

        const db = getDb()
        const id = uuidv4()

        db.prepare(
          'INSERT INTO devices (id, ip, name, type, autoConnect) VALUES (?, ?, ?, ?, ?)'
        ).run(id, ip, name, type, autoConnect ? 1 : 0)

        const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as DeviceConfig
        return { success: true, data: device }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 更新设备信息 */
  app.put<{ Params: { id: string }; Body: Partial<Omit<DeviceConfig, 'id' | 'createdAt'>> }>(
    '/api/devices/:id',
    async (request, reply): Promise<ApiResponse<DeviceConfig>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const { id } = request.params
        const db = getDb()

        const existing = db.prepare('SELECT * FROM devices WHERE id = ?').get(id)
        if (!existing) {
          return { success: false, error: { code: 40401, message: '设备不存在' } }
        }

        const { ip, name, type, autoConnect } = request.body
        if (ip) db.prepare('UPDATE devices SET ip = ? WHERE id = ?').run(ip, id)
        if (name) db.prepare('UPDATE devices SET name = ? WHERE id = ?').run(name, id)
        if (type) db.prepare('UPDATE devices SET type = ? WHERE id = ?').run(type, id)
        if (autoConnect !== undefined) {
          db.prepare('UPDATE devices SET autoConnect = ? WHERE id = ?').run(autoConnect ? 1 : 0, id)
        }

        const updated = db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as DeviceConfig
        return { success: true, data: updated }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 删除设备注册 */
  app.delete<{ Params: { id: string } }>(
    '/api/devices/:id',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const { id } = request.params
        const db = getDb()

        const result = db.prepare('DELETE FROM devices WHERE id = ?').run(id)
        if (result.changes === 0) {
          return { success: false, error: { code: 40401, message: '设备不存在' } }
        }

        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 扫描网络上的设备 */
  app.get('/api/devices/scan', async (request, reply) => {
    try {
      await authMiddleware(request, reply)
      if (reply.sent) return reply

      const devices = await pool.scan()
      return { success: true, data: devices }
    } catch (err) {
      return { success: false, error: { code: 50000, message: (err as Error).message } }
    }
  })

  /** 连接设备 */
  app.post<{ Params: { id: string }; Body: { mode?: ConnectionMode } }>(
    '/api/devices/:id/connect',
    async (request, reply): Promise<ApiResponse<unknown>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const { id } = request.params
        const mode: ConnectionMode = request.body?.mode === 'virtual' ? 'virtual' : 'exclusive'
        const db = getDb()
        const device = db.prepare('SELECT ip FROM devices WHERE id = ?').get(id) as { ip: string } | undefined

        if (!device) {
          return { success: false, error: { code: 40401, message: '设备不存在' } }
        }

        // 传递 mode 让 pool 用这个模式连接
        const result = await pool.connect(device.ip, id, mode)
        return { success: result.status, data: result.data, error: result.status ? undefined : { code: result.code, message: result.message ?? '' } }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 获取设备实时状态 */
  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/status',
    async (request, reply): Promise<ApiResponse<unknown>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply

        const entry = pool.getDevice(request.params.id)
        if (!entry) {
          return { success: true, data: { connected: false, status: null, state: null, alarms: null } }
        }

        // 从 driver 获取扩展告警信息（与 WS device:state 的 _ext 对齐）
        const extInfo: Record<string, unknown> = {}
        const rawExchange = (entry.driver as unknown as Record<string, unknown>).rawExchange as Record<string, unknown> | undefined
        if (rawExchange) {
          extInfo.warningList = rawExchange.warningList
          extInfo.isCollision = rawExchange.isCollision
          extInfo.skinCollison = rawExchange.skinCollison
          extInfo.emergencyStop = rawExchange.emergencyStop
          extInfo.protectiveStop = rawExchange.protectiveStop
          extInfo.isAlarmUpdate = rawExchange.isAlarmUpdate
          extInfo.isWarningUpdate = rawExchange.isWarningUpdate
          extInfo.autoManual = rawExchange.autoManual
          extInfo.coordinate = rawExchange.coordinate
        }

        return {
          success: true,
          data: {
            connected: entry.driver.status.connected,
            mode: entry.mode,
            tcpConnected: entry.mode === 'exclusive' ? entry.tcp.isAllConnected : true,
            status: entry.driver.status,
            state: entry.driver.state,
            alarms: entry.driver.state.alarm,
            ...extInfo,
          },
        }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 断开设备 */
  app.post<{ Params: { id: string } }>(
    '/api/devices/:id/disconnect',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        // 先断开 pool 中的连接，再用 dbDeviceId
        await pool.disconnect(request.params.id)
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 强制释放设备占用（解除幽灵占用） */
  app.post<{ Params: { id: string } }>(
    '/api/devices/:id/forceRelease',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const { id } = request.params
        const ip = getDeviceIp(id)
        if (!ip) {
          return { success: false, error: { code: 40401, message: '设备不存在' } }
        }

        const result = await pool.forceRelease(ip)
        if (!result.status) {
          return { success: false, error: { code: result.code, message: result.message ?? '' } }
        }
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 获取设备全局速度比 */
  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/speed',
    async (request, reply): Promise<ApiResponse<{ ratio: number }>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply

        const entry = pool.getDevice(request.params.id)
        if (!entry) {
          return { success: false, error: { code: 40401, message: '设备未连接' } }
        }

        const res = await entry.http.main.send({
          method: 'get',
          url: '/settings/common',
          portName: entry.driver.ip,
          timeout: 3000,
        })

        if (res.status && res.data) {
          const data = res.data as { ratio?: number }
          return { success: true, data: { ratio: data.ratio ?? 100 } }
        }
        return { success: false, error: { code: 50000, message: `获取速度失败: ${res.message ?? ''}` } }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 设置设备全局速度比 */
  app.post<{ Params: { id: string }; Body: { ratio: number } }>(
    '/api/devices/:id/speed',
    async (request, reply): Promise<ApiResponse<{ ratio: number }>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const entry = pool.getDevice(request.params.id)
        if (!entry) {
          return { success: false, error: { code: 40401, message: '设备未连接' } }
        }

        const { ratio } = request.body
        if (typeof ratio !== 'number' || ratio < 1 || ratio > 100) {
          return { success: false, error: { code: 40001, message: 'ratio 必须是 1~100 的数字' } }
        }

        const res = await entry.http.main.send({
          method: 'post',
          url: '/settings/common',
          portName: entry.driver.ip,
          params: { ratio },
          timeout: 3000,
        })

        if (res.status) {
          return { success: true, data: { ratio } }
        }
        return { success: false, error: { code: 50000, message: `设置速度失败: ${res.message ?? ''}` } }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 锁定设备（独占访问） */
  app.post<{ Params: { id: string }; Body: { timeout?: number } }>(
    '/api/devices/:id/lock',
    async (request, reply): Promise<ApiResponse<unknown>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const grant = await scheduler.requestAccess({
          clientId: request.auth!.userId,
          deviceId: request.params.id,
          mode: 'exclusive',
          timeout: request.body?.timeout,
        })

        return { success: true, data: grant }
      } catch (err) {
        return { success: false, error: { code: 40901, message: (err as Error).message } }
      }
    }
  )

  /** 释放设备锁定 */
  app.post<{ Params: { id: string } }>(
    '/api/devices/:id/release',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply

        scheduler.releaseAccess(request.auth!.userId, request.params.id)
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 订阅设备状态 */
  app.post<{ Params: { id: string } }>(
    '/api/devices/:id/subscribe',
    async (request, reply): Promise<ApiResponse<unknown>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply

        const grant = await scheduler.requestAccess({
          clientId: request.auth!.userId,
          deviceId: request.params.id,
          mode: 'subscribe',
        })

        return { success: true, data: grant }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  // ─── 运动控制 ──────────────────────────────────

  /** 伺服上电 */
  app.post<{ Params: { id: string } }>(
    '/api/devices/:id/powerOn',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const entry = pool.getDevice(request.params.id)
        if (!entry) {
          return { success: false, error: { code: 40401, message: '设备未连接' } }
        }

        await entry.driver.powerOn()
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 伺服下电 */
  app.post<{ Params: { id: string } }>(
    '/api/devices/:id/powerOff',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const entry = pool.getDevice(request.params.id)
        if (!entry) {
          return { success: false, error: { code: 40401, message: '设备未连接' } }
        }

        await entry.driver.powerOff()
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 设置/获取手动自动模式总开关 */
  app.post<{ Params: { id: string }; Body: { value: boolean } }>(
    '/api/devices/:id/autoManualSwitch',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply; requireOperator(request, reply)
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        await entry.driver.setAutoManualSwitch(request.body.value)
        return { success: true, data: null }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )
  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/autoManualSwitch',
    async (request, reply): Promise<ApiResponse<{ value: boolean }>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        const value = await entry.driver.getAutoManualSwitch()
        return { success: true, data: { value } }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  /** 设置手动/自动模式 */
  app.post<{ Params: { id: string }; Body: { mode: 'auto' | 'manual' } }>(
    '/api/devices/:id/autoManualMode',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply; requireOperator(request, reply)
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        await entry.driver.setAutoManualMode(request.body.mode)
        return { success: true, data: null }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  /** 设置/获取远程模式开关 (TCP vs Online) */
  app.post<{ Params: { id: string }; Body: { value: boolean } }>(
    '/api/devices/:id/remoteSwitch',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply; requireOperator(request, reply)
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        await entry.driver.setRemoteSwitch(request.body.value)
        return { success: true, data: null }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/remoteSwitch',
    async (request, reply): Promise<ApiResponse<{ value: boolean }>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        const value = await entry.driver.getRemoteSwitch()
        return { success: true, data: { value } }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  /** 设置/获取远程控制模式 (Online vs TCP)
   *  对应机器人 /settings/function/remoteControl 端点
   *  参考 OpenDobot46: RemoteModeType.Online = 'tp', RemoteModeType.TCP = 'tcp' */
  app.post<{ Params: { id: string }; Body: { mode: 'online' | 'tcp' } }>(
    '/api/devices/:id/remoteControl',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply; requireOperator(request, reply)
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        await entry.driver.setRemoteControl(request.body.mode)
        return { success: true, data: null }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/remoteControl',
    async (request, reply): Promise<ApiResponse<{ mode: 'online' | 'tcp' }>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        const mode = await entry.driver.getRemoteControl()
        return { success: true, data: { mode } }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  /** 使能（启用运动控制） */
  app.post<{ Params: { id: string } }>(
    '/api/devices/:id/enable',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const entry = pool.getDevice(request.params.id)
        if (!entry) {
          return { success: false, error: { code: 40401, message: '设备未连接' } }
        }

        await entry.driver.enable()
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 下使能（禁用运动控制） */
  app.post<{ Params: { id: string } }>(
    '/api/devices/:id/disable',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const entry = pool.getDevice(request.params.id)
        if (!entry) {
          return { success: false, error: { code: 40401, message: '设备未连接' } }
        }

        await entry.driver.disable()
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  // ─── 负载参数 ──────────────────────────────────

  /** 获取当前负载参数 */
  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/loadParams',
    async (request, reply): Promise<ApiResponse<LoadParams>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply

        const entry = pool.getDevice(request.params.id)
        if (!entry) {
          return { success: false, error: { code: 40401, message: '设备未连接' } }
        }

        const data = await entry.driver.getLoadParams()
        return { success: true, data }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 设置当前负载参数 */
  app.post<{ Params: { id: string }; Body: { name: string; centerX: number; centerY: number; centerZ: number; loadValue: number } }>(
    '/api/devices/:id/loadParams',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const entry = pool.getDevice(request.params.id)
        if (!entry) {
          return { success: false, error: { code: 40401, message: '设备未连接' } }
        }

        await entry.driver.setLoadParams(request.body)
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 获取全部负载预设组 */
  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/loadConfig',
    async (request, reply): Promise<ApiResponse<LoadParams[]>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply

        const entry = pool.getDevice(request.params.id)
        if (!entry) {
          return { success: false, error: { code: 40401, message: '设备未连接' } }
        }

        const data = await entry.driver.getLoadConfig()
        return { success: true, data }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 替换全部负载预设组 */
  app.post<{ Params: { id: string }; Body: Array<{ name: string; centerX: number; centerY: number; centerZ: number; loadValue: number }> }>(
    '/api/devices/:id/loadConfig',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const entry = pool.getDevice(request.params.id)
        if (!entry) {
          return { success: false, error: { code: 40401, message: '设备未连接' } }
        }

        await entry.driver.setLoadConfig(request.body)
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  // ─── 自定义姿态 ────────────────────────────────
  // Magician E6 等机型控制器不支持 /settings/function/customPose（405 Unsupported method）。
  // 官方软件遇到该情况会隐藏姿态 UI；这里改为：
  // 1) 始终持久化到 docat 本地 device_joint_presets
  // 2) 若设备已连接且控制器支持，再 best-effort 同步到控制器

  function normalizeJointArray(raw: unknown): number[] {
    const joint = (Array.isArray(raw) ? raw : [])
      .slice(0, 6)
      .map(j => Number(Number(j).toFixed(6)))
    while (joint.length < 6) joint.push(0)
    return joint
  }

  function normalizePose(raw: unknown): CustomPosture['pose'] | undefined {
    if (!raw || typeof raw !== 'object') return undefined
    const p = raw as Record<string, unknown>
    return {
      x: Number(p.x ?? 0),
      y: Number(p.y ?? 0),
      z: Number(p.z ?? 0),
      rx: Number(p.rx ?? p.r ?? 0),
      ry: Number(p.ry ?? 0),
      rz: Number(p.rz ?? 0),
    }
  }

  function loadCustomPosturesFromDb(deviceId: string): CustomPosture[] {
    const db = getDb()
    const rows = db.prepare(
      'SELECT name, joints, type, pose FROM device_joint_presets WHERE deviceId = ? ORDER BY sortOrder ASC, name ASC'
    ).all(deviceId) as Array<{ name: string; joints: string; type?: string; pose?: string | null }>
    return rows.map(row => {
      const type = row.type === 'cartesian' ? 'cartesian' as const : 'joint' as const
      let pose: CustomPosture['pose'] | undefined
      if (row.pose) {
        try { pose = normalizePose(JSON.parse(row.pose)) } catch { /* ignore */ }
      }
      return {
        name: row.name,
        type,
        joint: normalizeJointArray(JSON.parse(row.joints)),
        ...(type === 'cartesian' && pose ? { pose } : {}),
      }
    })
  }

  function saveCustomPosturesToDb(deviceId: string, postures: CustomPosture[]): void {
    const db = getDb()
    const del = db.prepare('DELETE FROM device_joint_presets WHERE deviceId = ?')
    const ins = db.prepare(
      'INSERT INTO device_joint_presets (id, deviceId, name, joints, sortOrder, type, pose) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    db.transaction(() => {
      del.run(deviceId)
      postures.forEach((p, i) => {
        const name = String(p.name ?? '').trim() || `P${i + 1}`
        const type = p.type === 'cartesian' ? 'cartesian' : 'joint'
        const joint = normalizeJointArray(p.joint)
        const pose = type === 'cartesian' ? (normalizePose(p.pose) ?? {
          x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0,
        }) : null
        ins.run(
          uuidv4(),
          deviceId,
          name,
          JSON.stringify(joint),
          i + 1,
          type,
          pose ? JSON.stringify(pose) : null,
        )
      })
    })()
  }

  function isControllerCustomPoseUnsupported(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err ?? '')
    return /Unsupported method|405|4002/i.test(msg)
  }

  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/customPostures',
    async (request, reply): Promise<ApiResponse<CustomPosture[]>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply

        const deviceId = request.params.id
        const db = getDb()
        const device = db.prepare('SELECT id FROM devices WHERE id = ?').get(deviceId)
        if (!device) {
          return { success: false, error: { code: 40401, message: '设备不存在' } }
        }

        // 优先读本地库（E6 可靠）；若本地为空且控制器有数据，则导入一次
        const local = loadCustomPosturesFromDb(deviceId)
        if (local.length > 0) {
          return { success: true, data: local }
        }

        const entry = pool.getDevice(deviceId)
        if (entry) {
          try {
            const remote = await entry.driver.getCustomPostures()
            if (Array.isArray(remote) && remote.length > 0) {
              saveCustomPosturesToDb(deviceId, remote)
              return { success: true, data: remote }
            }
          } catch {
            // 控制器不支持或离线：返回本地空列表
          }
        }

        return { success: true, data: local }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.post<{ Params: { id: string }; Body: CustomPosture[] }>(
    '/api/devices/:id/customPostures',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const deviceId = request.params.id
        const db = getDb()
        const device = db.prepare('SELECT id FROM devices WHERE id = ?').get(deviceId)
        if (!device) {
          return { success: false, error: { code: 40401, message: '设备不存在' } }
        }

        const body = Array.isArray(request.body) ? request.body : []
        const postures: CustomPosture[] = body.map((p, i) => {
          const type = p?.type === 'cartesian' ? 'cartesian' as const : 'joint' as const
          const name = String(p?.name ?? '').trim() || `P${i + 1}`
          const joint = normalizeJointArray(p?.joint)
          const pose = type === 'cartesian' ? normalizePose(p?.pose) : undefined
          return {
            name,
            type,
            joint,
            ...(type === 'cartesian' ? {
              pose: pose ?? { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 },
            } : {}),
          }
        })

        // 1) 始终写入本地库（含 cartesian）
        saveCustomPosturesToDb(deviceId, postures)

        // 2) 控制器 customPose 仅支持关节；只同步 joint 类型
        const entry = pool.getDevice(deviceId)
        if (entry) {
          const jointOnly = postures
            .filter(p => (p.type ?? 'joint') === 'joint')
            .map(p => ({ name: p.name, joint: p.joint }))
          try {
            // 即使只有笛卡尔预设，也推一次（空/仅 joint）以尽量保持控制器一致
            await entry.driver.setCustomPostures(jointOnly)
          } catch (err) {
            if (!isControllerCustomPoseUnsupported(err)) {
              // 本地已保存成功；控制器同步失败仅记日志，不阻断用户
              console.warn(`[customPostures] controller sync failed for ${deviceId}:`, (err as Error).message)
            }
          }
        }

        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  // ─── 系统设置 ──────────────────────────────────

  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/systemTime',
    async (request, reply): Promise<ApiResponse<SystemTime>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        const data = await entry.driver.getSystemTime()
        return { success: true, data }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.post<{ Params: { id: string }; Body: { date?: string; time?: string; timeZone?: string } }>(
    '/api/devices/:id/systemTime',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        await entry.driver.setSystemTime(request.body)
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.post<{ Params: { id: string }; Body: { alias: string } }>(
    '/api/devices/:id/deviceAlias',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        await entry.driver.setDeviceAlias(request.body.alias)
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  // ─── 标定数据导出（服务端写文件）───────────────

  app.post<{ Params: { id: string }; Body: { rows?: CalibrationExportRow[]; name?: string } }>(
    '/api/devices/:id/calibration/export',
    async (request, reply): Promise<ApiResponse<{ path: string; filename: string }>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const rows = request.body?.rows ?? []
        if (rows.length === 0) {
          return { success: false, error: { code: 40000, message: '没有可导出的标定数据' } }
        }

        const dir = resolveExportDir(getSetting(SETTING_CALIB_EXPORT_DIR) || DEFAULT_EXPORT_DIR)
        mkdirSync(dir, { recursive: true })

        const safeName = sanitizeFileStem(request.body?.name ?? request.params.id).slice(0, 40) || 'device'
        const filename = `calib_${safeName}_${timestampStem()}.txt`
        const filePath = path.join(dir, filename)

        const lines = formatExportLines(rows)
        writeFileSync(filePath, lines.join('\r\n') + '\r\n', 'utf8')
        return { success: true, data: { path: filePath, filename } }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  // ─── 标定 XML 导出（客户端生成 XML，服务端落盘）──────

  app.post<{ Params: { id: string }; Body: { content?: string; name?: string } }>(
    '/api/devices/:id/calibration/exportXml',
    async (request, reply): Promise<ApiResponse<{ path: string; filename: string }>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const content = request.body?.content ?? ''
        if (!content.trim()) {
          return { success: false, error: { code: 40000, message: '没有可导出的 XML 内容' } }
        }
        if (content.length > 2 * 1024 * 1024) {
          return { success: false, error: { code: 40000, message: 'XML 内容过大' } }
        }

        const dir = resolveExportDir(getSetting(SETTING_CALIB_EXPORT_DIR) || DEFAULT_EXPORT_DIR)
        mkdirSync(dir, { recursive: true })

        const safeName = sanitizeFileStem(request.body?.name ?? request.params.id).slice(0, 40) || 'device'
        const filename = `calib_${safeName}_${timestampStem()}.xml`
        const filePath = path.join(dir, filename)

        writeFileSync(filePath, content, 'utf8')
        return { success: true, data: { path: filePath, filename } }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  // ─── 用户管理 ──────────────────────────────────

  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/users',
    async (request, reply): Promise<ApiResponse<UserList>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        const data = await entry.driver.getUserList()
        return { success: true, data }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/devices/:id/users',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        await entry.driver.setUserList(request.body as never)
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/userPermissions',
    async (request, reply): Promise<ApiResponse<UserPermissionConfig[]>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        const data = await entry.driver.getUserConfig()
        return { success: true, data }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.post<{ Params: { id: string }; Body: Array<Record<string, unknown>> }>(
    '/api/devices/:id/userPermissions',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        await entry.driver.setUserConfig(request.body as never)
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  // ─── 坐标系管理 ────────────────────────────────

  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/userCoordinate',
    async (request, reply): Promise<ApiResponse<CoordinateData>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        const data = await entry.driver.getUserCoordinate()
        return { success: true, data }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.post<{ Params: { id: string }; Body: CoordinateData }>(
    '/api/devices/:id/userCoordinate',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        await entry.driver.setUserCoordinate(request.body)
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/toolCoordinate',
    async (request, reply): Promise<ApiResponse<CoordinateData>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        const data = await entry.driver.getToolCoordinate()
        return { success: true, data }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.post<{ Params: { id: string }; Body: CoordinateData }>(
    '/api/devices/:id/toolCoordinate',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        await entry.driver.setToolCoordinate(request.body)
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  // ─── 运动参数 ──────────────────────────────────

  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/playbackJointParams',
    async (request, reply): Promise<ApiResponse<Record<string, unknown>>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        const data = await entry.driver.getPlaybackJointParams()
        return { success: true, data }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/devices/:id/playbackJointParams',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply; requireOperator(request, reply)
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        await entry.driver.setPlaybackJointParams(request.body)
        return { success: true, data: null }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/playbackCoordinateParams',
    async (request, reply): Promise<ApiResponse<Record<string, unknown>>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        const data = await entry.driver.getPlaybackCoordinateParams()
        return { success: true, data }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/devices/:id/playbackCoordinateParams',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply; requireOperator(request, reply)
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        await entry.driver.setPlaybackCoordinateParams(request.body)
        return { success: true, data: null }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/teachJointParams',
    async (request, reply): Promise<ApiResponse<Record<string, unknown>>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        const data = await entry.driver.getTeachJointParams()
        return { success: true, data }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/devices/:id/teachJointParams',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply; requireOperator(request, reply)
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        await entry.driver.setTeachJointParams(request.body)
        return { success: true, data: null }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/teachCoordinateParams',
    async (request, reply): Promise<ApiResponse<Record<string, unknown>>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        const data = await entry.driver.getTeachCoordinateParams()
        return { success: true, data }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/devices/:id/teachCoordinateParams',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply; requireOperator(request, reply)
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        await entry.driver.setTeachCoordinateParams(request.body)
        return { success: true, data: null }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  // ─── 通讯设置 ──────────────────────────────────

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/devices/:id/bus',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        await entry.driver.setBus(request.body)
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/wifi',
    async (request, reply): Promise<ApiResponse<Record<string, unknown>>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        const data = await entry.driver.getWiFi()
        return { success: true, data }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/devices/:id/wifi',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply; requireOperator(request, reply)
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        await entry.driver.setWiFi(request.body)
        return { success: true, data: null }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/ethernet',
    async (request, reply): Promise<ApiResponse<Record<string, unknown>>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        const data = await entry.driver.getEthernet()
        return { success: true, data }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/devices/:id/ethernet',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply; requireOperator(request, reply)
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        await entry.driver.setEthernet(request.body)
        return { success: true, data: null }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  // ─── Dobot+ 插件管理 ──────────────────────────

  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/dobotPlus',
    async (request, reply): Promise<ApiResponse<string[]>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        const data = await entry.driver.listDobotPlus()
        return { success: true, data }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  app.post<{ Params: { id: string }; Body: { name: string; action: string } }>(
    '/api/devices/:id/dobotPlus',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply; requireOperator(request, reply)
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        if (request.body.action === 'install') await entry.driver.installDobotPlus(request.body.name)
        else if (request.body.action === 'uninstall') await entry.driver.uninstallDobotPlus(request.body.name)
        else return { success: false, error: { code: 40001, message: 'action 必须是 install 或 uninstall' } }
        return { success: true, data: null }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/dobotPlus/ports',
    async (request, reply): Promise<ApiResponse<Record<string, unknown>>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        const data = await entry.driver.getDobotPlusPorts()
        return { success: true, data }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  /** 本地放置的插件资源（可选，gitignored）：自动发现可安装/带界面的插件 */
  app.get<{ Params: { id: string } }>(
    '/api/dobotPlus/local',
    async (request, reply): Promise<ApiResponse<{ plugins: Array<{ name: string; description?: string; version?: string }> }>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        const dir = resolveLocalDobotPlusDir()
        const plugins = dir
          ? listLocalDobotPlusPlugins(dir).map(name => ({ name, ...readLocalPluginMeta(dir, name) }))
          : []
        return { success: true, data: { plugins } }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  /** 从本地插件资源安装：打包上传到控制器 /developOnly/ecology/<name>/<name>.zip 后调用安装 */
  app.post<{ Params: { id: string }; Body: { name?: string } }>(
    '/api/devices/:id/dobotPlus/installLocal',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        if (reply.sent) return reply

        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }

        const name = (request.body?.name ?? '').trim()
        if (!name || !PLUGIN_NAME_RE.test(name)) {
          return { success: false, error: { code: 40001, message: '缺少合法的插件名' } }
        }
        const dir = resolveLocalDobotPlusDir()
        const pluginDir = dir ? path.join(dir, name) : ''
        if (!dir || !existsSync(pluginDir) || !existsSync(path.join(pluginDir, 'Main', 'index.html'))) {
          return { success: false, error: { code: 40402, message: `本地未找到插件 "${name}"（请先放置到 ${dir ?? '本地插件目录'}）` } }
        }

        const files = collectLocalPluginFiles(dir, name)
        if (files.length === 0) {
          return { success: false, error: { code: 40001, message: `本地插件 "${name}" 为空` } }
        }
        const zip = buildPluginZip(name, files)

        const sftp = new SftpTransport(entry.driver.ip)
        const remoteDir = `/developOnly/ecology/${name}`
        await sftp.ensureDir(remoteDir)
        await sftp.writeBuffer(`${remoteDir}/${name}.zip`, zip)

        // 官方还会单独上传 API 文件到 ecology/<插件名>/ 下
        const apiFiles = collectPluginApiFiles(name, files)
        for (const file of apiFiles) {
          await sftp.writeBuffer(`${remoteDir}/${file.path}`, file.data)
        }

        await writePluginHashToController(sftp, name, zip)
        await entry.driver.installDobotPlus(name)

        // 安装后校验插件是否真的出现在已安装列表
        let installed = false
        for (let i = 0; i < 5 && !installed; i++) {
          const list = await entry.driver.listDobotPlus()
          installed = list.some(n => n.toLowerCase() === name.toLowerCase())
          if (!installed && i < 4) await new Promise(resolve => setTimeout(resolve, 500))
        }
        if (!installed) {
          return {
            success: false,
            error: {
              code: 50001,
              message: `安装接口已调用，但插件 "${name}" 未出现在已安装列表中，请检查控制器日志`,
            },
          }
        }

        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 控制器上可安装的 Dobot+ 插件目录（来自 /developOnly/ecology/） */
  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/dobotPlus/catalog',
    async (request, reply): Promise<ApiResponse<{
      available: string[]
      present: string[]
      metadata: Record<string, { description?: string; version?: string }>
    }>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }

        const sftp = new SftpTransport(entry.driver.ip)
        const available: string[] = []
        const present: string[] = []
        const metadata: Record<string, { description?: string; version?: string }> = {}

        // eco_config.json 是控制器维护的可安装插件清单
        try {
          const raw = await sftp.readText('/developOnly/ecology/eco_config.json')
          const parsed: unknown = JSON.parse(raw)
          if (Array.isArray(parsed)) available.push(...parsed.map(String))
        } catch { /* 控制器无 eco_config.json 时忽略 */ }

        // 已存在于控制器 ecology 目录中的插件（含已安装）
        try {
          const entries = await sftp.list('/developOnly/ecology')
          for (const e of entries) {
            if (e.type !== 'd') continue
            if (e.name === 'uninstalledBackupFiles' || e.name === 'static') continue
            present.push(e.name)
          }
        } catch { /* ecology 目录不可读时忽略 */ }

        // 读取控制器上插件目录的 config.json（可能含可读描述）
        if (present.length > 0) {
          try {
            const texts = await sftp.readTexts(
              present.map(n => `/developOnly/ecology/${n}/config.json`)
            )
            for (const [filePath, content] of texts) {
              try {
                const cfg = JSON.parse(content) as { name?: unknown; description?: unknown; version?: unknown }
                const pluginName = filePath.split('/').pop() ?? ''
                const baseName = typeof cfg.name === 'string' && cfg.name ? cfg.name : pluginName.replace(/_(?:v|V)\d.*$/, '')
                metadata[pluginName] = {
                  description: resolvePluginDescription(baseName, cfg.description) || undefined,
                  version: typeof cfg.version === 'string' ? cfg.version : undefined,
                }
              } catch { /* 单个 config.json 解析失败忽略 */ }
            }
          } catch { /* 控制器 config.json 不可读时忽略 */ }
        }

        return {
          success: true,
          data: {
            available: [...new Set(available)].sort((a, b) => a.localeCompare(b)),
            present: [...new Set(present)].sort((a, b) => a.localeCompare(b)),
            metadata,
          },
        }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  /** 上传插件 zip 到控制器并安装（zip 需以 <插件名>.zip 命名） */
  app.post<{ Params: { id: string }; Querystring: { name?: string } }>(
    '/api/devices/:id/dobotPlus/upload',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        if (reply.sent) return reply

        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }

        const name = (request.query?.name ?? '').trim()
        if (!name || !/^[A-Za-z0-9][\w.-]*$/.test(name)) {
          return { success: false, error: { code: 40001, message: '缺少合法的插件名（query 参数 name，如 DobotES01_v1-0-3-stable）' } }
        }

        const body = request.body
        if (!Buffer.isBuffer(body) || body.length === 0) {
          return { success: false, error: { code: 40001, message: '缺少插件包内容（application/octet-stream）' } }
        }
        if (body.length > 200 * 1024 * 1024) {
          return { success: false, error: { code: 40001, message: '插件包过大（>200MB）' } }
        }

        const sftp = new SftpTransport(entry.driver.ip)
        const dir = `/developOnly/ecology/${name}`
        await sftp.ensureDir(dir)
        await sftp.writeBuffer(`${dir}/${name}.zip`, body)
        await entry.driver.installDobotPlus(name)

        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 通用 Dobot+ 插件函数调用 */
  app.post<{ Params: { id: string }; Body: { plugin: string; fn: string; data?: unknown } }>(
    '/api/devices/:id/dobotPlus/call',
    async (request, reply): Promise<ApiResponse<unknown>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        const { plugin, fn, data } = request.body ?? {}
        if (!plugin || !fn) {
          return { success: false, error: { code: 40001, message: 'plugin 与 fn 必填' } }
        }
        const result = await entry.driver.callDobotPlus(String(plugin), String(fn), data)
        return { success: true, data: result }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** DobotES01 吸盘控制：grip / release / clearAlarm / status */
  app.post<{ Params: { id: string }; Body: { action: 'grip' | 'release' | 'clearAlarm' | 'status' } }>(
    '/api/devices/:id/dobotPlus/es01',
    async (request, reply): Promise<ApiResponse<unknown>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        const action = request.body?.action
        if (action !== 'grip' && action !== 'release' && action !== 'clearAlarm' && action !== 'status') {
          return { success: false, error: { code: 40001, message: 'action 必须是 grip/release/clearAlarm/status' } }
        }
        const data = await entry.driver.controlDobotES01(action)
        return { success: true, data }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/dobotPlus/es01/status',
    async (request, reply): Promise<ApiResponse<unknown>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        const data = await entry.driver.controlDobotES01('status')
        return { success: true, data }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  // ─── CR TCP Dashboard (29999) + Feedback (30004) ──

  const crTcpCache = new Map<string, CRApiTcpTransport>()
  /** 每个设备各自缓存最新反馈，避免多设备录制时互相串数据 */
  const crTcpLatestFeedByDevice = new Map<string, CRFeedBackData>()

  function getCrTcp(deviceId: string, ip: string): CRApiTcpTransport {
    let t = crTcpCache.get(deviceId)
    if (!t) {
      t = new CRApiTcpTransport(ip)
      t.on('feedback', (data) => { crTcpLatestFeedByDevice.set(deviceId, data) })
      t.connectDashboard()
      t.connectFeed()
      crTcpCache.set(deviceId, t)
    }
    return t
  }

  app.post<{ Params: { id: string }; Body: { command: string } }>(
    '/api/devices/:id/tcp/dashboard',
    async (request, reply): Promise<ApiResponse<{ reply: string }>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const config = getDb().prepare('SELECT ip FROM devices WHERE id = ?').get(request.params.id) as { ip: string } | undefined
        if (!config) return { success: false, error: { code: 40401, message: '设备不存在' } }

        const tcp = getCrTcp(request.params.id, config.ip)
        const replyText = await tcp.sendDashboard(request.body.command)
        return { success: true, data: { reply: replyText } }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/tcp/status',
    async (request, reply): Promise<ApiResponse<{ dashboard: string; feed: string; feedback: CRFeedBackData | null }>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply

        const config = getDb().prepare('SELECT ip FROM devices WHERE id = ?').get(request.params.id) as { ip: string } | undefined
        if (!config) return { success: false, error: { code: 40401, message: '设备不存在' } }

        const tcp = getCrTcp(request.params.id, config.ip)
        return {
          success: true,
          data: {
            dashboard: tcp.isDashboardConnected ? 'connected' : 'disconnected',
            feed: tcp.isFeedConnected ? 'connected' : 'disconnected',
            feedback: crTcpLatestFeedByDevice.get(request.params.id) ?? null,
          },
        }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.post<{ Params: { id: string } }>(
    '/api/devices/:id/tcp/disconnect',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply; requireOperator(request, reply)
        const t = crTcpCache.get(request.params.id)
        if (t) { t.disconnect(); crTcpCache.delete(request.params.id) }
        crTcpLatestFeedByDevice.delete(request.params.id)
        return { success: true, data: null }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  app.post<{ Params: { id: string }; Body: { autoReconnect: boolean } }>(
    '/api/devices/:id/tcp/autoReconnect',
    async (request, reply): Promise<ApiResponse<{ autoReconnect: boolean }>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply; requireOperator(request, reply)
        const t = crTcpCache.get(request.params.id)
        if (t) { t.autoReconnect = request.body.autoReconnect }
        return { success: true, data: { autoReconnect: !!t?.autoReconnect } }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  // ─── 轨迹录制 / 复现（控制器端）────────────────
  // 参考 OpenDobot46（DobotStudio Pro 4.6）：
  //  - 录制：POST /panel/threeSwitch {value:true} → POST /interface/recurrentTrack {getpos:true}
  //    进入拖拽模式后控制器每 50ms 采一个点；结束：{getpos:false}（或末端按键触发 isFinish）
  //  - 文件：SFTP /developOnly/process/trajectory/*.csv（默认按 年-月-日-时-分-秒 命名）
  //  - 复现：POST /interface/debugReTrace {cmd:'start'|'stop', addr}，参数 /settings/function/reTraceParams

  const TRAJECTORY_DIR = '/developOnly/process/trajectory'
  const TRACK_NAME_RE = /^[^/\\:*?"<>|\s][^/\\:*?"<>|]{0,63}$/

  function sanitizeTrackName(name: string, fallback: string): string {
    const trimmed = name.trim().replace(/\.csv$/i, '')
    return TRACK_NAME_RE.test(trimmed) ? trimmed : fallback
  }

  app.post<{ Params: { id: string } }>(
    '/api/devices/:id/tcp/record/start',
    async (request, reply): Promise<ApiResponse<{ started: boolean }>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply; requireOperator(request, reply)

        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }

        // 与官方一致：先开三位开关（可拖拽），再让控制器开始采集
        await entry.driver.setThreeSwitch(true)
        await entry.driver.setRecurrentTrack(true)
        return { success: true, data: { started: true } }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  app.post<{ Params: { id: string } }>(
    '/api/devices/:id/tcp/record/stop',
    async (request, reply): Promise<ApiResponse<{ saved: boolean }>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply; requireOperator(request, reply)

        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }

        // 停止采集并退出拖拽，控制器落盘生成 CSV
        await entry.driver.setRecurrentTrack(false)
        await entry.driver.setThreeSwitch(false)
        return { success: true, data: { saved: true } }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/tcp/record/status',
    async (request, reply): Promise<ApiResponse<{ recording: boolean; isFinish: boolean; result: boolean }>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply

        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }

        const status = await entry.driver.getRecurrentTrackStatus()
        return {
          success: true,
          data: {
            recording: !status.isFinish,
            isFinish: status.isFinish,
            result: status.result,
          },
        }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  app.post<{ Params: { id: string }; Body: { name?: string } }>(
    '/api/devices/:id/tcp/playback/start',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply; requireOperator(request, reply)

        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        const name = (request.body?.name ?? '').trim()
        if (!name) return { success: false, error: { code: 40001, message: '缺少轨迹文件名' } }

        await entry.driver.setDebugReTrace('start', name)
        return { success: true, data: null }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  app.post<{ Params: { id: string }; Body: { name?: string } }>(
    '/api/devices/:id/tcp/playback/stop',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply; requireOperator(request, reply)

        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }

        await entry.driver.setDebugReTrace('stop', (request.body?.name ?? '').trim())
        return { success: true, data: null }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/tcp/playback/status',
    async (request, reply): Promise<ApiResponse<{
      addr: string
      currentTimes: number
      isDone: boolean
      percent: number
      result: boolean
    }>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply

        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }

        return { success: true, data: await entry.driver.getDebugReTrace() }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/tcp/playback/params',
    async (request, reply): Promise<ApiResponse<{ multi: number; const: number; loop: number }>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply

        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }

        return { success: true, data: await entry.driver.getRetraceParams() }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  app.post<{ Params: { id: string }; Body: { multi?: number; const?: number; loop?: number } }>(
    '/api/devices/:id/tcp/playback/params',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply; requireOperator(request, reply)

        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }

        await entry.driver.setRetraceParams({
          multi: request.body?.multi ?? 1,
          const: request.body?.const ?? 0,
          loop: request.body?.loop ?? 1,
        })
        return { success: true, data: null }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/tcp/tracks',
    async (request, reply): Promise<ApiResponse<Array<{ name: string; size: number; mtime: string }>>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply

        const config = getDb().prepare('SELECT ip FROM devices WHERE id = ?').get(request.params.id) as { ip: string } | undefined
        if (!config) return { success: false, error: { code: 40401, message: '设备不存在' } }

        const sftp = new SftpTransport(config.ip)
        const entries = await sftp.list(TRAJECTORY_DIR).catch(() => [] as Array<{ name: string; size: number; modifyTime: number }>)
        const files = entries
          .filter(f => f.name.endsWith('.csv'))
          .map(f => ({
            name: f.name.replace(/\.csv$/i, ''),
            size: f.size,
            mtime: f.modifyTime ? new Date(f.modifyTime * 1000).toISOString() : '',
          }))
        return { success: true, data: files }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  app.post<{ Params: { id: string; trackName: string }; Body: { newName: string } }>(
    '/api/devices/:id/tcp/tracks/:trackName/rename',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply; requireOperator(request, reply)

        const config = getDb().prepare('SELECT ip FROM devices WHERE id = ?').get(request.params.id) as { ip: string } | undefined
        if (!config) return { success: false, error: { code: 40401, message: '设备不存在' } }

        const sftp = new SftpTransport(config.ip)
        await sftp.rename(
          `${TRAJECTORY_DIR}/${request.params.trackName}.csv`,
          `${TRAJECTORY_DIR}/${sanitizeTrackName(request.body.newName || '', request.params.trackName)}.csv`
        )
        return { success: true, data: null }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  app.delete<{ Params: { id: string; trackName: string } }>(
    '/api/devices/:id/tcp/tracks/:trackName',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply; requireOperator(request, reply)

        const config = getDb().prepare('SELECT ip FROM devices WHERE id = ?').get(request.params.id) as { ip: string } | undefined
        if (!config) return { success: false, error: { code: 40401, message: '设备不存在' } }

        const sftp = new SftpTransport(config.ip)
        await sftp.deleteFile(`${TRAJECTORY_DIR}/${request.params.trackName}.csv`)
        return { success: true, data: null }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  app.get<{ Params: { id: string; trackName: string } }>(
    '/api/devices/:id/tcp/tracks/:trackName',
    async (request, reply): Promise<ApiResponse<string>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply

        const config = getDb().prepare('SELECT ip FROM devices WHERE id = ?').get(request.params.id) as { ip: string } | undefined
        if (!config) return { success: false, error: { code: 40401, message: '设备不存在' } }

        const sftp = new SftpTransport(config.ip)
        const content = await sftp.readText(`${TRAJECTORY_DIR}/${request.params.trackName}.csv`)
        // 返回原始 CSV 文本，前端按表头解析位姿列
        return { success: true, data: content }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  /** 设备级关节预设（所有用户可见） */
  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/jointPresets',
    async (request, reply): Promise<ApiResponse<Array<{ id: string; name: string; joints: number[]; system: boolean; sortOrder: number }>>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply

        const db = getDb()
        const device = db.prepare('SELECT id FROM devices WHERE id = ?').get(request.params.id)
        if (!device) {
          return { success: false, error: { code: 40401, message: '设备不存在' } }
        }

        const rows = db.prepare('SELECT * FROM device_joint_presets WHERE deviceId = ? ORDER BY sortOrder ASC, name ASC')
          .all(request.params.id) as (JointPresetRow & { sortOrder: number })[]
        const custom = rows.map(row => ({
          id: row.id,
          name: row.name,
          joints: JSON.parse(row.joints) as number[],
          system: false,
          sortOrder: row.sortOrder,
        }))
        const system = SYSTEM_JOINT_PRESETS.map((p, i) => ({ ...p, joints: [...p.joints], sortOrder: -(SYSTEM_JOINT_PRESETS.length - i) }))
        return { success: true, data: [...system, ...custom] }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.post<{ Params: { id: string }; Body: { name: string; joints: number[] } }>(
    '/api/devices/:id/jointPresets',
    async (request, reply): Promise<ApiResponse<{ id: string; name: string; joints: number[]; system: boolean; sortOrder: number }>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const { name, joints } = request.body
        const trimmedName = String(name || '').trim()
        if (!trimmedName) {
          return { success: false, error: { code: 40001, message: '预设名称不能为空' } }
        }
        if (!Array.isArray(joints) || joints.length !== 6 || joints.some(j => !Number.isFinite(j))) {
          return { success: false, error: { code: 40001, message: 'joints 必须是 6 个有效数字' } }
        }
        if (SYSTEM_JOINT_PRESETS.some(p => p.name.toLowerCase() === trimmedName.toLowerCase())) {
          return { success: false, error: { code: 40901, message: '不能覆盖系统预设' } }
        }

        const db = getDb()
        const device = db.prepare('SELECT id FROM devices WHERE id = ?').get(request.params.id)
        if (!device) {
          return { success: false, error: { code: 40401, message: '设备不存在' } }
        }

        // 同名覆盖：如果已存在同名自定义预设，则更新 joints
        const existing = db.prepare('SELECT id, sortOrder FROM device_joint_presets WHERE deviceId = ? AND name = ?')
          .get(request.params.id, trimmedName) as { id: string; sortOrder: number } | undefined

        const rounded = joints.map(j => Number(j.toFixed(6)))
        if (existing) {
          db.prepare('UPDATE device_joint_presets SET joints = ?, updatedAt = datetime(\'now\') WHERE id = ?')
            .run(JSON.stringify(rounded), existing.id)
          return { success: true, data: { id: existing.id, name: trimmedName, joints: rounded, system: false, sortOrder: existing.sortOrder } }
        }

        // 新预设排到最后
        const maxOrder = db.prepare('SELECT COALESCE(MAX(sortOrder), 0) FROM device_joint_presets WHERE deviceId = ?')
          .get(request.params.id) as Record<string, number>
        const sortOrder = (Object.values(maxOrder)[0] ?? 0) + 1

        const id = uuidv4()
        db.prepare('INSERT INTO device_joint_presets (id, deviceId, name, joints, sortOrder) VALUES (?, ?, ?, ?, ?)')
          .run(id, request.params.id, trimmedName, JSON.stringify(rounded), sortOrder)
        return { success: true, data: { id, name: trimmedName, joints: rounded, system: false, sortOrder } }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 更新预设（支持部分更新：name 和/或 joints） */
  app.put<{ Params: { id: string; presetId: string }; Body: { name?: string; joints?: number[] } }>(
    '/api/devices/:id/jointPresets/:presetId',
    async (request, reply): Promise<ApiResponse<{ id: string; name: string; joints: number[]; system: boolean; sortOrder: number }>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        if (SYSTEM_JOINT_PRESETS.some(p => p.id === request.params.presetId)) {
          return { success: false, error: { code: 40901, message: '不能编辑系统预设' } }
        }

        const db = getDb()
        const existing = db.prepare('SELECT * FROM device_joint_presets WHERE id = ? AND deviceId = ?')
          .get(request.params.presetId, request.params.id) as (JointPresetRow & { sortOrder: number }) | undefined
        if (!existing) {
          return { success: false, error: { code: 40401, message: '预设不存在' } }
        }

        const trimmedName = request.body.name != null ? String(request.body.name).trim() : existing.name
        if (!trimmedName) {
          return { success: false, error: { code: 40001, message: '预设名称不能为空' } }
        }
        if (SYSTEM_JOINT_PRESETS.some(p => p.name.toLowerCase() === trimmedName.toLowerCase())) {
          return { success: false, error: { code: 40901, message: '不能使用系统预设名称' } }
        }

        const newJoints = request.body.joints ?? JSON.parse(existing.joints)
        if (!Array.isArray(newJoints) || newJoints.length !== 6 || newJoints.some((j: number) => !Number.isFinite(j))) {
          return { success: false, error: { code: 40001, message: 'joints 必须是 6 个有效数字' } }
        }

        const rounded = newJoints.map((j: number) => Number(j.toFixed(6)))
        db.prepare(`
          UPDATE device_joint_presets
          SET name = ?, joints = ?, updatedAt = datetime('now')
          WHERE id = ? AND deviceId = ?
        `).run(trimmedName, JSON.stringify(rounded), request.params.presetId, request.params.id)
        return { success: true, data: { id: request.params.presetId, name: trimmedName, joints: rounded, system: false, sortOrder: existing.sortOrder } }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 重排预设顺序 */
  app.post<{ Params: { id: string }; Body: { presetIds: string[] } }>(
    '/api/devices/:id/jointPresets/reorder',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const { presetIds } = request.body
        if (!Array.isArray(presetIds)) {
          return { success: false, error: { code: 40001, message: 'presetIds 必须是数组' } }
        }

        const db = getDb()
        const update = db.prepare('UPDATE device_joint_presets SET sortOrder = ? WHERE id = ? AND deviceId = ?')
        db.transaction(() => {
          for (let i = 0; i < presetIds.length; i++) {
            update.run(i + 1, presetIds[i], request.params.id)
          }
        })()
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.delete<{ Params: { id: string; presetId: string } }>(
    '/api/devices/:id/jointPresets/:presetId',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        if (SYSTEM_JOINT_PRESETS.some(p => p.id === request.params.presetId)) {
          return { success: false, error: { code: 40901, message: '不能删除系统预设' } }
        }

        const db = getDb()
        const result = db.prepare('DELETE FROM device_joint_presets WHERE id = ? AND deviceId = ?')
          .run(request.params.presetId, request.params.id)
        if (result.changes === 0) {
          return { success: false, error: { code: 40401, message: '预设不存在' } }
        }
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 获取设备告警详情 */
  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/alarms',
    async (request, reply) => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply

        const entry = pool.getDevice(request.params.id)
        if (!entry) {
          return { success: false, error: { code: 40401, message: '设备未连接' } }
        }

        const alarms = await entry.driver.getAlarms()
        return { success: true, data: alarms }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 获取设备警告详情 */
  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/warnings',
    async (request, reply) => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply

        const entry = pool.getDevice(request.params.id)
        if (!entry) {
          return { success: false, error: { code: 40401, message: '设备未连接' } }
        }

        const warnings = await entry.driver.getWarnings()
        return { success: true, data: warnings }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 获取设备历史控制日志文件列表（SFTP） */
  app.get<{ Params: { id: string }; Querystring: ControlLogQuery }>(
    '/api/devices/:id/controlLogs/files',
    async (request, reply): Promise<ApiResponse<ControlLogFile[]>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply

        const files = await listControlLogFiles(request.params.id, request.query)
        return { success: true, data: files }
      } catch (err) {
        const message = (err as Error).message
        return {
          success: false,
          error: { code: message === '设备不存在' ? 40401 : 6000, message },
        }
      }
    }
  )

  /** 查询设备历史控制日志内容（SFTP） */
  app.get<{ Params: { id: string }; Querystring: ControlLogQuery }>(
    '/api/devices/:id/controlLogs',
    async (request, reply): Promise<ApiResponse<{
      files: ControlLogFile[]
      entries: ControlLogLine[]
      total: number
      limited: boolean
    }>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply

        const files = await listControlLogFiles(request.params.id, request.query)
        const types = parseControlLogTypes(request.query.types)
        const filterByType = types.length !== CONTROL_LOG_LEVELS.length
        const limit = parseControlLogLimit(request.query.limit)
        const keyword = request.query.keyword?.trim().toLowerCase() ?? ''
        const ip = getDeviceIp(request.params.id)
        if (!ip) {
          return { success: false, error: { code: 40401, message: '设备不存在' } }
        }

        const sftp = new SftpTransport(ip)
        const entries: ControlLogLine[] = []
        let total = 0
        let limited = false
        const fileContents = await sftp.readTexts(files.map(file => file.path))

        for (const file of files) {
          const content = fileContents.get(file.path) ?? ''
          const lines = content.split(/\r?\n/)

          for (let index = lines.length - 1; index >= 0; index--) {
            const text = lines[index].trimEnd()
            if (!text) continue

            const level = detectControlLogLevel(text)
            if (filterByType && (!level || !types.includes(level))) continue
            if (keyword && !text.toLowerCase().includes(keyword)) continue

            total += 1
            if (entries.length < limit) {
              entries.push({
                file: file.name,
                path: file.path,
                line: index + 1,
                level: level ?? 'plain',
                text,
              })
            } else {
              limited = true
            }
          }
        }

        return { success: true, data: { files, entries, total, limited } }
      } catch (err) {
        const message = (err as Error).message
        return {
          success: false,
          error: { code: message === '设备不存在' ? 40401 : 6000, message },
        }
      }
    }
  )

  /** 清除告警 */
  app.post<{ Params: { id: string } }>(
    '/api/devices/:id/clearAlarm',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const entry = pool.getDevice(request.params.id)
        if (!entry) {
          return { success: false, error: { code: 40401, message: '设备未连接' } }
        }

        await entry.driver.clearAlarm()
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 清除碰撞标志 */
  app.post<{ Params: { id: string } }>(
    '/api/devices/:id/resetCollision',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const entry = pool.getDevice(request.params.id)
        if (!entry) {
          return { success: false, error: { code: 40401, message: '设备未连接' } }
        }

        await entry.driver.resetCollision()
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 设置点动模式 */
  app.post<{ Params: { id: string }; Body: { mode: 'jog' | 'step' } }>(
    '/api/devices/:id/jogMode',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const entry = pool.getDevice(request.params.id)
        if (!entry) {
          return { success: false, error: { code: 40401, message: '设备未连接' } }
        }

        if (request.body.mode !== 'jog' && request.body.mode !== 'step') {
          return { success: false, error: { code: 40001, message: 'mode 必须是 jog 或 step' } }
        }

        await entry.driver.setJogMode(request.body.mode)
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 切换点动坐标系 joint / cartesian / tool */
  app.post<{ Params: { id: string }; Body: { mode: 'joint' | 'cartesian' | 'tool' } }>(
    '/api/devices/:id/jogCoordinate',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const entry = pool.getDevice(request.params.id)
        if (!entry) {
          return { success: false, error: { code: 40401, message: '设备未连接' } }
        }

        const mode = request.body.mode
        if (mode !== 'joint' && mode !== 'cartesian' && mode !== 'tool') {
          return { success: false, error: { code: 40001, message: 'mode 必须是 joint / cartesian / tool' } }
        }

        await entry.driver.setJogCoordinate(mode)
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 设置寸动距离 */
  app.post<{ Params: { id: string }; Body: { distance: number } }>(
    '/api/devices/:id/teachInch',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const entry = pool.getDevice(request.params.id)
        if (!entry) {
          return { success: false, error: { code: 40401, message: '设备未连接' } }
        }

        if (!Number.isFinite(request.body.distance) || request.body.distance <= 0) {
          return { success: false, error: { code: 40001, message: 'distance 必须是正数' } }
        }

        await entry.driver.setTeachInch(request.body.distance)
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** Jog 点动 */
  app.post<{ Params: { id: string }; Body: { axis: string; direction: string; mode?: string; stepValue?: number } }>(
    '/api/devices/:id/jog',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const entry = pool.getDevice(request.params.id)
        if (!entry) {
          return { success: false, error: { code: 40401, message: '设备未连接' } }
        }

        const { axis, direction, mode } = request.body
        const validAxes = new Set(['x', 'y', 'z', 'rx', 'ry', 'rz', 'r', 'j1', 'j2', 'j3', 'j4', 'j5', 'j6'])
        if (!validAxes.has(axis)) {
          return { success: false, error: { code: 40001, message: `无效轴: ${axis}` } }
        }
        await entry.driver.jog({
          axis: axis as 'x' | 'y' | 'z' | 'rx' | 'ry' | 'rz' | 'r' | 'j1' | 'j2' | 'j3' | 'j4' | 'j5' | 'j6',
          direction: direction as '+' | '-',
          mode: (mode as 'continuous' | 'step') || 'continuous',
          stepValue: request.body.stepValue,
        })
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 停止点动（仅清 panel/jog 按钮，低延迟） */
  app.post<{ Params: { id: string } }>(
    '/api/devices/:id/jog/stop',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const entry = pool.getDevice(request.params.id)
        if (!entry) {
          return { success: false, error: { code: 40401, message: '设备未连接' } }
        }

        await entry.driver.stopJog()
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 停止运动 */
  app.post<{ Params: { id: string } }>(
    '/api/devices/:id/stop',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const entry = pool.getDevice(request.params.id)
        if (!entry) {
          return { success: false, error: { code: 40401, message: '设备未连接' } }
        }

        await entry.driver.stop()
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 回零 */
  app.post<{ Params: { id: string } }>(
    '/api/devices/:id/home',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const entry = pool.getDevice(request.params.id)
        if (!entry) {
          return { success: false, error: { code: 40401, message: '设备未连接' } }
        }

        await entry.driver.home()
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 急停 */
  app.post<{ Params: { id: string } }>(
    '/api/devices/:id/estop',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const entry = pool.getDevice(request.params.id)
        if (!entry) {
          return { success: false, error: { code: 40401, message: '设备未连接' } }
        }

        await entry.driver.emergencyStop()
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 关节空间移动 */
  app.post<{ Params: { id: string }; Body: { joints: number[] } }>(
    '/api/devices/:id/moveJoints',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const entry = pool.getDevice(request.params.id)
        if (!entry) {
          return { success: false, error: { code: 40401, message: '设备未连接' } }
        }

        const { joints } = request.body
        if (!Array.isArray(joints) || joints.length !== 6 || joints.some(j => !Number.isFinite(j))) {
          return { success: false, error: { code: 40001, message: 'joints 必须是 6 个有效数字' } }
        }

        await entry.driver.moveJoints(joints)
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 关节运动命令帧 */
  app.post<{ Params: { id: string }; Body: { joints: number[]; value: boolean } }>(
    '/api/devices/:id/moveJointsCommand',
    async (request, reply): Promise<ApiResponse<Record<string, unknown>>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const entry = pool.getDevice(request.params.id)
        if (!entry) {
          return { success: false, error: { code: 40401, message: '设备未连接' } }
        }

        const { joints, value } = request.body
        if (!Array.isArray(joints) || joints.length !== 6 || joints.some(j => !Number.isFinite(j))) {
          return { success: false, error: { code: 40001, message: 'joints 必须是 6 个有效数字' } }
        }
        if (typeof value !== 'boolean') {
          return { success: false, error: { code: 40001, message: 'value 必须是 boolean' } }
        }

        const data = await entry.driver.moveJointsCommand(joints, value)
        return { success: true, data }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /**
   * 统一点到点运动
   * body: { path?: 'MovJ'|'MovL', joint?: number[6], pose?: number[6]|{x,y,z,rx,ry,rz}, user?, tool? }
   * 对齐文档：MovJ/MovL 均可接受 joint 或 pose 目标。
   */
  app.post<{ Params: { id: string }; Body: {
    path?: 'MovJ' | 'MovL'
    joint?: number[]
    pose?: number[] | { x: number; y: number; z: number; rx?: number; ry?: number; rz?: number; r?: number }
    user?: number
    tool?: number
  } }>(
    '/api/devices/:id/movePoint',
    async (request, reply): Promise<ApiResponse<Record<string, unknown>>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        const b = request.body ?? {}
        const path = b.path === 'MovJ' ? 'MovJ' : 'MovL'

        let poseArr: number[] | undefined
        if (Array.isArray(b.pose) && b.pose.length >= 6) {
          poseArr = b.pose.slice(0, 6).map(Number)
        } else if (b.pose && typeof b.pose === 'object') {
          const p = b.pose as Record<string, number>
          poseArr = [Number(p.x ?? 0), Number(p.y ?? 0), Number(p.z ?? 0), Number(p.rx ?? p.r ?? 0), Number(p.ry ?? 0), Number(p.rz ?? 0)]
        }

        const joint = Array.isArray(b.joint) && b.joint.length >= 6
          ? b.joint.slice(0, 6).map(Number)
          : undefined

        if (!poseArr && !joint) {
          return { success: false, error: { code: 40001, message: '需要 joint 或 pose' } }
        }

        const data = await entry.driver.movePoint({
          path,
          joint,
          pose: poseArr,
          user: b.user,
          tool: b.tool,
        })
        return { success: true, data }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 笛卡尔目标运动（兼容旧 API；默认 MovL，可传 path=MovJ） */
  app.post<{ Params: { id: string }; Body: {
    x: number; y: number; z: number
    rx?: number; ry?: number; rz?: number
    user?: number; tool?: number
    jointNear?: number[]
    path?: 'MovJ' | 'MovL'
  } }>(
    '/api/devices/:id/moveCartesian',
    async (request, reply): Promise<ApiResponse<Record<string, unknown>>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        const b = request.body
        const data = await entry.driver.moveCartesian({
          x: Number(b.x), y: Number(b.y), z: Number(b.z),
          rx: Number(b.rx ?? 0), ry: Number(b.ry ?? 0), rz: Number(b.rz ?? 0),
          user: b.user, tool: b.tool,
          jointNear: b.jointNear,
          path: b.path === 'MovJ' ? 'MovJ' : 'MovL',
        })
        return { success: true, data }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  /** 正运动学求解（关节 → 笛卡尔） */
  app.post<{ Params: { id: string }; Body: { joint: number[]; user?: number; tool?: number } }>(
    '/api/devices/:id/forwardKinematics',
    async (request, reply): Promise<ApiResponse<{ coordinate: number[]; errID: number; errMsg?: string }>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        const data = await entry.driver.forwardKinematics(request.body)
        return { success: true, data }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  /** 逆运动学求解（不执行运动） */
  app.post<{ Params: { id: string }; Body: { coordinate: number[]; jointNear?: number[]; user?: number; tool?: number } }>(
    '/api/devices/:id/inverseKinematics',
    async (request, reply): Promise<ApiResponse<{ joint: number[]; errID: number; errMsg?: string }>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply; requireOperator(request, reply)
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        const b = request.body
        const data = await entry.driver.inverseKinematics({
          coordinate: b.coordinate,
          jointNear: b.jointNear ?? [0,0,0,0,0,0],
          user: b.user, tool: b.tool,
        })
        return { success: true, data }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  /** 笛卡尔移动（兼容旧 API，内部走 MovL） */
  app.post<{ Params: { id: string }; Body: {
    x: number; y: number; z: number
    r?: number; rx?: number; ry?: number; rz?: number
    mode?: string; user?: number; tool?: number
    jointNear?: number[]
  } }>(
    '/api/devices/:id/move',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const entry = pool.getDevice(request.params.id)
        if (!entry) {
          return { success: false, error: { code: 40401, message: '设备未连接' } }
        }

        const b = request.body
        // 兼容旧字段 r（曾只传 RX），以及完整 rx/ry/rz
        await entry.driver.moveCartesian({
          x: Number(b.x),
          y: Number(b.y),
          z: Number(b.z),
          rx: Number(b.rx ?? b.r ?? 0),
          ry: Number(b.ry ?? 0),
          rz: Number(b.rz ?? 0),
          user: b.user,
          tool: b.tool,
          jointNear: b.jointNear,
        })
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  // ─── 工程点位管理 (point.json) ──────────────────

  interface PointData {
    id: string
    name: string
    alias?: string
    pose: number[]
    joint: number[]
    tool: number
    user: number
  }

  /** 生成点名称：扫描已有点取最大编号+1 */
  function nextPointName(points: PointData[]): string {
    let max = 0
    for (const p of points) {
      const m = /^P(\d+)$/.exec(p.name)
      if (m) max = Math.max(max, parseInt(m[1], 10))
    }
    return `P${max + 1}`
  }

  /** 获取工程点位列表 */
  app.get<{ Params: { id: string; projectName: string } }>(
    '/api/devices/:id/projects/:projectName/points',
    async (request, reply): Promise<ApiResponse<PointData[]>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply

        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }

        const projectName = decodeURIComponent(request.params.projectName)
        const projectPath = `/developOnly/project/${projectName}`
        const sftp = new SftpTransport(entry.driver.ip)
        const raw = await sftp.readText(`${projectPath}/point.json`)
        return { success: true, data: JSON.parse(raw) as PointData[] }
      } catch {
        return { success: true, data: [] }
      }
    }
  )

  /** 保存当前设备位姿为新点 */
  app.post<{ Params: { id: string; projectName: string }; Body: { tool?: number; user?: number } }>(
    '/api/devices/:id/projects/:projectName/points',
    async (request, reply): Promise<ApiResponse<PointData>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }

        const projectName = decodeURIComponent(request.params.projectName)
        const projectPath = `/developOnly/project/${projectName}`
        const ip = entry.driver.ip

        // 读取当前 point.json
        const sftp = new SftpTransport(ip)
        let points: PointData[] = []
        try {
          const raw = await sftp.readText(`${projectPath}/point.json`)
          points = JSON.parse(raw) as PointData[]
        } catch {
          points = []
        }

        // 读取当前位姿
        const state = await entry.driver.pollState()
        const pose = state.pose
        const joints = state.joints
        const newPoint: PointData = {
          id: crypto.randomUUID(),
          name: nextPointName(points),
          alias: '',
          pose: [pose.x, pose.y, pose.z, pose.rx ?? pose.r ?? 0, pose.ry ?? 0, pose.rz ?? 0],
          joint: [joints.j1, joints.j2, joints.j3, joints.j4, joints.j5 ?? 0, joints.j6 ?? 0],
          tool: request.body?.tool ?? 0,
          user: request.body?.user ?? 0,
        }
        points.push(newPoint)

        // SFTP 写回
        await sftp.writeText(`${projectPath}/point.json`, JSON.stringify(points))

        // 触发控制器更新变量文件
        try {
          await entry.http.main.send({
            method: 'post',
            url: '/project/teachFileUpdate',
            portName: ip,
            params: { file: 'point.json' },
            timeout: 5000,
          })
        } catch { /* 非关键 */ }

        return { success: true, data: newPoint }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 删除工程点位 */
  app.delete<{ Params: { id: string; projectName: string; pointId: string } }>(
    '/api/devices/:id/projects/:projectName/points/:pointId',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }

        const projectName = decodeURIComponent(request.params.projectName)
        const projectPath = `/developOnly/project/${projectName}`
        const ip = entry.driver.ip

        const sftp = new SftpTransport(ip)
        let points: PointData[] = []
        try {
          const raw = await sftp.readText(`${projectPath}/point.json`)
          points = JSON.parse(raw) as PointData[]
        } catch {
          return { success: false, error: { code: 40401, message: '点位文件不存在' } }
        }

        const filtered = points.filter(p => p.id !== request.params.pointId)
        if (filtered.length === points.length) {
          return { success: false, error: { code: 40401, message: '点位不存在' } }
        }

        await sftp.writeText(`${projectPath}/point.json`, JSON.stringify(filtered))

        try {
          await entry.http.main.send({
            method: 'post',
            url: '/project/teachFileUpdate',
            portName: ip,
            params: { file: 'point.json' },
            timeout: 5000,
          })
        } catch { /* 非关键 */ }

        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 更新工程点位（支持修改 joint/pose 等） */
  app.put<{ Params: { id: string; projectName: string; pointId: string }; Body: Partial<PointData> }>(
    '/api/devices/:id/projects/:projectName/points/:pointId',
    async (request, reply): Promise<ApiResponse<PointData>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }

        const projectName = decodeURIComponent(request.params.projectName)
        const projectPath = `/developOnly/project/${projectName}`
        const ip = entry.driver.ip
        const sftp = new SftpTransport(ip)

        let points: PointData[] = []
        try { points = JSON.parse(await sftp.readText(`${projectPath}/point.json`)) as PointData[] }
        catch { return { success: false, error: { code: 40401, message: '点位文件不存在' } } }

        const idx = points.findIndex(p => p.id === request.params.pointId)
        if (idx === -1) return { success: false, error: { code: 40401, message: '点位不存在' } }

        const body = request.body
        const current = points[idx]
        // 合并更新
        if (body.name !== undefined) current.name = body.name
        if (body.alias !== undefined) current.alias = body.alias
        if (body.joint) current.joint = body.joint
        if (body.pose) current.pose = body.pose
        if (body.tool !== undefined) current.tool = body.tool
        if (body.user !== undefined) current.user = body.user

        await sftp.writeText(`${projectPath}/point.json`, JSON.stringify(points))
        try { await entry.http.main.send({ method: 'post', url: '/project/teachFileUpdate', portName: ip, params: { file: 'point.json' }, timeout: 5000 }) }
        catch { /* 非关键 */ }

        return { success: true, data: current }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 触发控制器编译点文件 */
  app.post<{ Params: { id: string; projectName: string } }>(
    '/api/devices/:id/projects/:projectName/teachFileUpdate',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)

        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }

        await entry.http.main.send({
          method: 'post',
          url: '/project/teachFileUpdate',
          portName: entry.driver.ip,
          params: { file: 'point.json' },
          timeout: 5000,
        })
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )
}
