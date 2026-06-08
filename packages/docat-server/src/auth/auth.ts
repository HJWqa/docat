/**
 * 认证模块 — token 管理、登录/登出、Fastify 鉴权中间件
 * Token 存 SQLite sessions 表，可跨重启保持登录
 */
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import type { AuthToken, User, UserRole } from 'docat-shared/types'
import type { FastifyRequest, FastifyReply } from 'fastify'

// ─── Token 管理 ──────────────────────────────────

export function createSession(userId: string, expireDays: number = 30): AuthToken {
  const db = getDb()
  const token = uuidv4()
  const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(userId) as
    | Pick<User, 'id' | 'username' | 'role'>
    | undefined

  if (!user) throw new Error('User not found')

  const expiresAt = new Date(Date.now() + expireDays * 86400000).toISOString()

  db.prepare('INSERT INTO sessions (id, userId, expiresAt) VALUES (?, ?, ?)').run(
    token,
    userId,
    expiresAt
  )

  return {
    token,
    userId: user.id,
    username: user.username,
    role: user.role as UserRole,
    expiresAt,
  }
}

export function validateToken(token: string): AuthToken | null {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT s.id as token, s.userId, s.expiresAt, u.username, u.role
       FROM sessions s JOIN users u ON s.userId = u.id
       WHERE s.id = ? AND s.expiresAt > datetime('now')`
    )
    .get(token) as {
    token: string
    userId: string
    expiresAt: string
    username: string
    role: string
  } | null

  if (!row) return null

  return {
    token: row.token,
    userId: row.userId,
    username: row.username,
    role: row.role as UserRole,
    expiresAt: row.expiresAt,
  }
}

export function destroySession(token: string): void {
  const db = getDb()
  db.prepare('DELETE FROM sessions WHERE id = ?').run(token)
}

// ─── Fastify 认证中间件 ──────────────────────────

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthToken
  }
}

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    reply.status(401).send({ success: false, error: { code: 40100, message: '未提供认证 token' } })
    return
  }

  const token = header.slice(7)
  const session = validateToken(token)

  if (!session) {
    reply.status(401).send({ success: false, error: { code: 40100, message: 'Token 无效或已过期' } })
    return
  }

  request.auth = session
}

/** admin-only 权限中间件 */
export function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): void {
  if (!request.auth || request.auth.role !== 'admin') {
    reply.status(403).send({ success: false, error: { code: 40300, message: '需要管理员权限' } })
  }
}

/** operator+ 权限中间件 */
export function requireOperator(
  request: FastifyRequest,
  reply: FastifyReply
): void {
  if (!request.auth || request.auth.role === 'viewer') {
    reply.status(403).send({ success: false, error: { code: 40300, message: '需要操作者及以上权限' } })
  }
}

/** 清理过期会话 */
export function cleanupExpiredSessions(): void {
  const db = getDb()
  const result = db.prepare("DELETE FROM sessions WHERE expiresAt <= datetime('now')").run()
  if (result.changes > 0) {
    console.log(`[Auth] Cleaned up ${result.changes} expired sessions`)
  }
}
