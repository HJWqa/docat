/**
 * 系统管理 REST API
 * /api/system/info, /api/system/logs
 */
import type { FastifyInstance } from 'fastify'
import { getDb } from '../../db/index.js'
import { authMiddleware, requireAdmin } from '../../auth/auth.js'
import type { DevicePool } from '../../device/DevicePool.js'
import type { ApiResponse, AuditLogEntry } from 'docat-shared/types'

const SERVER_VERSION = '0.1.0'

/** 应用设置键：标定导出目录 */
export const SETTING_CALIB_EXPORT_DIR = 'calibExportDir'
export const DEFAULT_EXPORT_DIR = './data/exports'

/**
 * 解析导出目录：
 * - 空值 → 默认目录
 * - Windows 系统：原样使用（D:\... 为绝对路径）
 * - 非 Windows（WSL/Linux）：若形如盘符路径 D:\... / D:/...，自动转为 /mnt/d/...
 */
export function resolveExportDir(raw: string): string {
  if (!raw || !raw.trim()) return DEFAULT_EXPORT_DIR
  const dir = raw.trim()
  if (process.platform === 'win32') return dir
  const m = /^([a-zA-Z]):[\\/](.*)$/.exec(dir)
  if (m) {
    return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/[\\/]+/g, '/')}`
  }
  return dir
}

export function getSetting(key: string): string {
  try {
    const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value ?? ''
  } catch {
    return ''
  }
}

export function setSetting(key: string, value: string): void {
  getDb().prepare(`
    INSERT INTO app_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value)
}

export function systemRoutes(app: FastifyInstance, pool: DevicePool): void {
  /** 服务端信息 */
  app.get('/api/system/info', async (request, reply): Promise<ApiResponse<unknown>> => {
    try {
      await authMiddleware(request, reply)
      if (reply.sent) return reply

      return {
        success: true,
        data: {
          version: SERVER_VERSION,
          nodeVersion: process.version,
          platform: process.platform,
          uptime: process.uptime(),
          onlineDevices: pool.onlineCount,
          registeredDevices: pool.deviceIds.length,
          memoryUsage: process.memoryUsage(),
        },
      }
    } catch (err) {
      return { success: false, error: { code: 50000, message: (err as Error).message } }
    }
  })

  /** 操作日志（管理员） */
  app.get<{ Querystring: { page?: string; pageSize?: string; userId?: string; deviceId?: string } }>(
    '/api/system/logs',
    async (request, reply): Promise<ApiResponse<AuditLogEntry[]>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireAdmin(request, reply)

        const db = getDb()
        const page = parseInt(request.query.page ?? '1', 10)
        const pageSize = parseInt(request.query.pageSize ?? '50', 10)
        const offset = (page - 1) * pageSize

        let query = 'SELECT * FROM auditLog'
        const conditions: string[] = []
        const params: unknown[] = []

        if (request.query.userId) {
          conditions.push('userId = ?')
          params.push(request.query.userId)
        }
        if (request.query.deviceId) {
          conditions.push('deviceId = ?')
          params.push(request.query.deviceId)
        }

        if (conditions.length > 0) {
          query += ' WHERE ' + conditions.join(' AND ')
        }
        query += ' ORDER BY createdAt DESC LIMIT ? OFFSET ?'
        params.push(pageSize, offset)

        const logs = db.prepare(query).all(...params) as AuditLogEntry[]
        const total = (db.prepare('SELECT COUNT(*) as count FROM auditLog').get() as { count: number }).count

        return {
          success: true,
          data: logs,
          meta: { page, pageSize, total },
        }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 读取应用设置 */
  app.get('/api/system/settings', async (request, reply): Promise<ApiResponse<Record<string, string>>> => {
    try {
      await authMiddleware(request, reply)
      if (reply.sent) return reply
      return { success: true, data: { [SETTING_CALIB_EXPORT_DIR]: getSetting(SETTING_CALIB_EXPORT_DIR) || DEFAULT_EXPORT_DIR } }
    } catch (err) {
      return { success: false, error: { code: 50000, message: (err as Error).message } }
    }
  })

  /** 保存应用设置（管理员） */
  app.post<{ Body: Partial<Record<string, string>> }>('/api/system/settings', async (request, reply): Promise<ApiResponse<null>> => {
    try {
      await authMiddleware(request, reply)
      if (reply.sent) return reply
      requireAdmin(request, reply)

      const dir = (request.body?.calibExportDir ?? '').trim()
      if (!dir) {
        return { success: false, error: { code: 40000, message: '导出目录不能为空' } }
      }
      setSetting(SETTING_CALIB_EXPORT_DIR, dir)
      return { success: true, data: null }
    } catch (err) {
      return { success: false, error: { code: 50000, message: (err as Error).message } }
    }
  })
}
