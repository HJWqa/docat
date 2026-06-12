/**
 * 设备管理 REST API
 * /api/devices — CRUD + 连接/断开/锁定/订阅
 */
import type { FastifyInstance } from 'fastify'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../../db/index.js'
import { authMiddleware, requireOperator } from '../../auth/auth.js'
import type { DevicePool, ConnectionMode } from '../../device/DevicePool.js'
import type { AccessScheduler } from '../../access/AccessScheduler.js'
import { SftpTransport, type SftpFileEntry } from '../../device/transport/SftpTransport.js'
import type { ApiResponse, DeviceConfig } from 'docat-shared/types'

const CONTROL_LOG_DIR = '/developOnly/logs/user'
const CONTROL_LOG_LEVELS = ['error', 'warning', 'info', 'user'] as const

const SYSTEM_JOINT_PRESETS = [
  { id: 'system-safe-origin', name: 'Safe Origin', joints: [0, 0, 0, 0, 0, 0], system: true },
  { id: 'system-pack', name: 'Pack', joints: [-90, 0, -140, -40, 0, 0], system: true },
  { id: 'system-research', name: 'Research', joints: [-90, 0, -90, 0, 90, 0], system: true },
] as const

type ControlLogLevel = typeof CONTROL_LOG_LEVELS[number]
type ControlLogDisplayLevel = ControlLogLevel | 'plain'

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

        const { ip, name, type = '', autoConnect = true } = request.body
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

        // 从 driver 获取扩展告警信息
        const extInfo: Record<string, unknown> = {}
        const rawExchange = (entry.driver as unknown as Record<string, unknown>).rawExchange as Record<string, unknown> | undefined
        if (rawExchange) {
          extInfo.warningList = rawExchange.warningList
          extInfo.isCollision = rawExchange.isCollision
          extInfo.skinCollison = rawExchange.skinCollison
          extInfo.emergencyStop = rawExchange.emergencyStop
          extInfo.protectiveStop = rawExchange.protectiveStop
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

        // 新预设排到最后
        const maxOrder = db.prepare('SELECT COALESCE(MAX(sortOrder), 0) FROM device_joint_presets WHERE deviceId = ?')
          .get(request.params.id) as Record<string, number>
        const sortOrder = (Object.values(maxOrder)[0] ?? 0) + 1

        const id = uuidv4()
        const rounded = joints.map(j => Number(j.toFixed(6)))
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
        await entry.driver.jog({
          axis: axis as 'x' | 'y' | 'z' | 'r' | 'j1' | 'j2' | 'j3' | 'j4' | 'j5' | 'j6',
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

  /** 笛卡尔移动 */
  app.post<{ Params: { id: string }; Body: { x: number; y: number; z: number; r?: number; mode?: string; user?: number; tool?: number } }>(
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

        const { x, y, z, r, mode, user, tool } = request.body
        await entry.driver.moveTo({
          x, y, z, r,
          mode: (mode as 'go' | 'move' | 'jump') || 'move',
          user, tool,
        })
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )
}
