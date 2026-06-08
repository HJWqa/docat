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
}
