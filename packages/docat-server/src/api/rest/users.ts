/**
 * 用户管理 REST API
 * GET /api/users          — 列出所有用户（admin）
 * PUT /api/users/:id      — 更新用户信息（admin）
 * DELETE /api/users/:id   — 删除用户（admin）
 * PUT /api/users/:id/password — 重置用户密码（admin）
 */
import type { FastifyInstance } from 'fastify'
import { getDb } from '../../db/index.js'
import { authMiddleware, requireAdmin, destroyAllUserSessions } from '../../auth/auth.js'
import { hashPassword, verifyPassword } from '../../auth/password.js'
import type { ApiResponse, User, UserRole } from 'docat-shared/types'

export function userRoutes(app: FastifyInstance): void {
  /** 列出所有用户 */
  app.get('/api/users', async (request, reply): Promise<ApiResponse<User[]>> => {
    try {
      await authMiddleware(request, reply)
      if (reply.sent) return reply
      requireAdmin(request, reply)
      if (reply.sent) return reply

      const db = getDb()
      const users = db.prepare('SELECT id, username, role, createdAt FROM users ORDER BY createdAt ASC').all() as User[]

      return { success: true, data: users }
    } catch (err) {
      return { success: false, error: { code: 50000, message: (err as Error).message } }
    }
  })

  /** 更新用户信息（角色、用户名） */
  app.put<{ Params: { id: string }; Body: { username?: string; role?: UserRole } }>(
    '/api/users/:id',
    async (request, reply): Promise<ApiResponse<User>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireAdmin(request, reply)
      if (reply.sent) return reply

        const { id } = request.params
      const db = getDb()

      const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(id)
      if (!existing) {
        return { success: false, error: { code: 40403, message: '用户不存在' } }
      }

      const { username, role } = request.body

      if (username !== undefined) {
        if (username.length < 3) {
          return { success: false, error: { code: 42200, message: '用户名至少 3 字符' } }
        }
        const dup = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, id)
        if (dup) {
          return { success: false, error: { code: 42200, message: '用户名已存在' } }
        }
        db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, id)
      }

      if (role !== undefined) {
        if (!['admin', 'operator', 'viewer'].includes(role)) {
          return { success: false, error: { code: 42200, message: '角色必须是 admin / operator / viewer' } }
        }
        // 不允许取消最后一个 admin
        if (role !== 'admin') {
          const targetUser = db.prepare('SELECT role FROM users WHERE id = ?').get(id) as { role: string } | undefined
          if (targetUser?.role === 'admin') {
            const adminCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get() as { count: number }
            if (adminCount.count <= 1) {
              return { success: false, error: { code: 42200, message: '系统至少需要一个管理员' } }
            }
          }
        }
        db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id)
      }

      const updated = db.prepare('SELECT id, username, role, createdAt FROM users WHERE id = ?').get(id) as User
      return { success: true, data: updated }
    } catch (err) {
      return { success: false, error: { code: 50000, message: (err as Error).message } }
    }
  })

  /** 删除用户 */
  app.delete<{ Params: { id: string } }>(
    '/api/users/:id',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireAdmin(request, reply)
      if (reply.sent) return reply

        const { id } = request.params

        // 不允许删除自己
        if (request.auth!.userId === id) {
          return { success: false, error: { code: 42200, message: '不能删除当前登录的用户' } }
        }

        const db = getDb()

        // 检查是否是最后一个 admin
        const targetUser = db.prepare('SELECT role FROM users WHERE id = ?').get(id) as { role: string } | undefined
        if (!targetUser) {
          return { success: false, error: { code: 40403, message: '用户不存在' } }
        }
        if (targetUser.role === 'admin') {
          const adminCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get() as { count: number }
          if (adminCount.count <= 1) {
            return { success: false, error: { code: 42200, message: '系统至少需要一个管理员' } }
          }
        }

        // 销毁该用户所有会话
        destroyAllUserSessions(id)

        // 删除用户的脚本
        db.prepare('DELETE FROM scripts WHERE userId = ?').run(id)
        // 删除用户的最近项目记录
        db.prepare('DELETE FROM recent_projects WHERE userId = ?').run(id)
        // 删除用户
        db.prepare('DELETE FROM users WHERE id = ?').run(id)

        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  /** 管理员重置用户密码 */
  app.put<{ Params: { id: string }; Body: { password: string } }>(
    '/api/users/:id/password',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireAdmin(request, reply)
      if (reply.sent) return reply

        const { id } = request.params
        const { password } = request.body

        if (!password || password.length < 4) {
          return { success: false, error: { code: 42200, message: '密码至少 4 字符' } }
        }

        const db = getDb()
        const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(id)
        if (!existing) {
          return { success: false, error: { code: 40403, message: '用户不存在' } }
        }

        const passwordHash = await hashPassword(password)
        db.prepare('UPDATE users SET passwordHash = ? WHERE id = ?').run(passwordHash, id)

        // 销毁该用户所有会话，强制重新登录
        destroyAllUserSessions(id)

        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )
}
