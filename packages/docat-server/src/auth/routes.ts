/**
 * 认证相关 REST API 路由
 * POST /api/auth/register, POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me
 */
import type { FastifyInstance } from 'fastify'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import { hashPassword, verifyPassword } from './password.js'
import { createSession, destroySession, authMiddleware } from './auth.js'
import type { ApiResponse, AuthToken, User, UserRole } from 'docat-shared/types'

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /** 注册 — 首次使用创建 admin，后续只能 admin 创建用户 */
  app.post<{ Body: { username: string; password: string; role?: UserRole } }>(
    '/api/auth/register',
    async (request, reply): Promise<ApiResponse<User>> => {
      try {
        const { username, password, role } = request.body
        const db = getDb()

        // 检查是否有用户（首次注册总是 admin）
        const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }
        const effectiveRole = userCount.count === 0 ? 'admin' : role ?? 'operator'

        // 非首次注册需要认证 + admin
        if (userCount.count > 0) {
          try {
            await authMiddleware(request, reply)
            if (reply.sent) return reply
            if (request.auth?.role !== 'admin') {
              return { success: false, error: { code: 40300, message: '仅管理员可创建用户' } }
            }
          } catch {
            // authMiddleware 已经处理了错误响应
            if (reply.sent) return reply
          }
        }

        // 验证参数
        if (!username || !password || username.length < 3 || password.length < 6) {
          return {
            success: false,
            error: { code: 42200, message: '用户名至少 3 字符，密码至少 6 字符' },
          }
        }

        // 检查用户名是否已存在
        const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
        if (existing) {
          return {
            success: false,
            error: { code: 42200, message: '用户名已存在' },
          }
        }

        const userId = uuidv4()
        const passwordHash = await hashPassword(password)

        db.prepare('INSERT INTO users (id, username, passwordHash, role) VALUES (?, ?, ?, ?)').run(
          userId,
          username,
          passwordHash,
          effectiveRole
        )

        return {
          success: true,
          data: { id: userId, username, role: effectiveRole as UserRole, createdAt: new Date().toISOString() },
        }
      } catch (err) {
        return {
          success: false,
          error: { code: 50000, message: (err as Error).message },
        }
      }
    }
  )

  /** 登录 — 返回持久化 token */
  app.post<{ Body: { username: string; password: string } }>(
    '/api/auth/login',
    async (request, reply): Promise<ApiResponse<AuthToken>> => {
      try {
        const { username, password } = request.body
        const db = getDb()

        const user = db.prepare('SELECT id, username, passwordHash, role FROM users WHERE username = ?').get(username) as
          | { id: string; username: string; passwordHash: string; role: string }
          | undefined

        if (!user) {
          return { success: false, error: { code: 40100, message: '用户名或密码错误' } }
        }

        const valid = await verifyPassword(password, user.passwordHash)
        if (!valid) {
          return { success: false, error: { code: 40100, message: '用户名或密码错误' } }
        }

        const token = createSession(user.id)

        return { success: true, data: token }
      } catch (err) {
        return {
          success: false,
          error: { code: 50000, message: (err as Error).message },
        }
      }
    }
  )

  /** 注销 */
  app.post('/api/auth/logout', async (request, reply): Promise<ApiResponse<null>> => {
    try {
      await authMiddleware(request, reply)
      if (reply.sent) return reply

      const header = request.headers.authorization!
      const token = header.slice(7)
      destroySession(token)

      return { success: true, data: null }
    } catch (err) {
      return { success: false, error: { code: 50000, message: (err as Error).message } }
    }
  })

  /** 获取当前用户信息 */
  app.get('/api/auth/me', async (request, reply): Promise<ApiResponse<User>> => {
    try {
      await authMiddleware(request, reply)
      if (reply.sent) return reply

      const auth = request.auth!
      const db = getDb()
      const user = db.prepare('SELECT id, username, role, createdAt FROM users WHERE id = ?').get(auth.userId) as
        | User
        | undefined

      if (!user) {
        return { success: false, error: { code: 40403, message: '用户不存在' } }
      }

      return { success: true, data: user }
    } catch (err) {
      return { success: false, error: { code: 50000, message: (err as Error).message } }
    }
  })
}
