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
import { CRApiTcpTransport, type CRFeedBackData } from '../../device/transport/CRApiTcpTransport.js'
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

  // ─── 自定义姿态（控制器端）────────────────────

  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/customPostures',
    async (request, reply): Promise<ApiResponse<CustomPosture[]>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        const data = await entry.driver.getCustomPostures()
        return { success: true, data }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.post<{ Params: { id: string }; Body: Array<{ name: string; joint: number[] }> }>(
    '/api/devices/:id/customPostures',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        const entry = pool.getDevice(request.params.id)
        if (!entry) return { success: false, error: { code: 40401, message: '设备未连接' } }
        await entry.driver.setCustomPostures(request.body)
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

  // ─── CR TCP Dashboard (29999) + Feedback (30004) ──

  const crTcpCache = new Map<string, CRApiTcpTransport>()
  let crTcpLatestFeed: CRFeedBackData | null = null

  function getCrTcp(deviceId: string, ip: string): CRApiTcpTransport {
    let t = crTcpCache.get(deviceId)
    if (!t) {
      t = new CRApiTcpTransport(ip)
      t.on('feedback', (data) => { crTcpLatestFeed = data })
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
            feedback: crTcpLatestFeed,
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
        crTcpLatestFeed = null
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

  // ─── Trajectory Recording (CSV → Controller SFTP) ──

  const TRAJECTORY_DIR = '/developOnly/process/trajectory'
  const trackRecording = new Map<string, { timer: ReturnType<typeof setInterval>; ip: string; name: string; lines: string[] }>()

  app.post<{ Params: { id: string }; Body: { name: string } }>(
    '/api/devices/:id/tcp/record/start',
    async (request, reply): Promise<ApiResponse<{ name: string }>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply; requireOperator(request, reply)

        const config = getDb().prepare('SELECT ip FROM devices WHERE id = ?').get(request.params.id) as { ip: string } | undefined
        if (!config) return { success: false, error: { code: 40401, message: '设备不存在' } }

        if (trackRecording.has(request.params.id)) {
          return { success: false, error: { code: 40901, message: '已在录制中' } }
        }

        getCrTcp(request.params.id, config.ip) // ensure TCP connected
        const name = request.body.name || `track_${Date.now()}`
        const lines: string[] = ['timestamp,j1,j2,j3,j4,j5,j6']

        const timer = setInterval(() => {
          if (crTcpLatestFeed && crTcpLatestFeed.QActual) {
            const joints = crTcpLatestFeed.QActual.map(v => v.toFixed(4)).join(',')
            lines.push(`${Date.now()},${joints}`)
          }
        }, 100)

        trackRecording.set(request.params.id, { timer, ip: config.ip, name, lines })
        return { success: true, data: { name } }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  app.post<{ Params: { id: string } }>(
    '/api/devices/:id/tcp/record/stop',
    async (request, reply): Promise<ApiResponse<{ name: string }>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply; requireOperator(request, reply)

        const rec = trackRecording.get(request.params.id)
        if (!rec) return { success: false, error: { code: 40401, message: '没有正在进行的录制' } }

        clearInterval(rec.timer)
        trackRecording.delete(request.params.id)

        // Write CSV to controller via SFTP
        const sftp = new SftpTransport(rec.ip)
        const content = rec.lines.join('\n')
        await sftp.ensureDir(TRAJECTORY_DIR)
        await sftp.writeText(`${TRAJECTORY_DIR}/${rec.name}.csv`, content)

        return { success: true, data: { name: rec.name } }
      } catch (err) { return { success: false, error: { code: 50000, message: (err as Error).message } } }
    }
  )

  app.get<{ Params: { id: string } }>(
    '/api/devices/:id/tcp/record/status',
    async (request, reply): Promise<ApiResponse<{ recording: boolean; name?: string }>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply
        const rec = trackRecording.get(request.params.id)
        return { success: true, data: { recording: !!rec, name: rec?.name } }
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
          `${TRAJECTORY_DIR}/${request.body.newName}.csv`
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
    async (request, reply): Promise<ApiResponse<Array<{ j1: number; j2: number; j3: number; j4: number; j5: number; j6: number }>>> => {
      try {
        await authMiddleware(request, reply); if (reply.sent) return reply

        const config = getDb().prepare('SELECT ip FROM devices WHERE id = ?').get(request.params.id) as { ip: string } | undefined
        if (!config) return { success: false, error: { code: 40401, message: '设备不存在' } }

        const sftp = new SftpTransport(config.ip)
        const content = await sftp.readText(`${TRAJECTORY_DIR}/${request.params.trackName}.csv`)
        const lines = content.trim().split('\n').slice(1)
        const points = lines.map(line => {
          const [ts, j1, j2, j3, j4, j5, j6] = line.split(',').map(Number)
          return { j1, j2, j3, j4, j5, j6 }
        })
        return { success: true, data: points }
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

  /** 笛卡尔直线移动 (MovL, 控制器内部 IK) */
  app.post<{ Params: { id: string }; Body: { x: number; y: number; z: number; rx?: number; ry?: number; rz?: number; user?: number; tool?: number } }>(
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
          x: b.x, y: b.y, z: b.z,
          rx: b.rx ?? 0, ry: b.ry ?? 0, rz: b.rz ?? 0,
          user: b.user, tool: b.tool,
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
