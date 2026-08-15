/**
 * 系统管理 REST API
 * /api/system/info, /api/system/logs
 */
import type { FastifyInstance } from 'fastify'
import { mkdirSync, readFileSync } from 'node:fs'
import { execFile, spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { getDb } from '../../db/index.js'
import { authMiddleware, requireAdmin } from '../../auth/auth.js'
import type { DevicePool } from '../../device/DevicePool.js'
import type { ApiResponse, AuditLogEntry } from 'docat-shared/types'

const SERVER_VERSION = '0.1.0'

/** 应用设置键：标定导出目录 */
export const SETTING_CALIB_EXPORT_DIR = 'calibExportDir'
export const DEFAULT_EXPORT_DIR = './data/exports'

/** 应用设置键：移动/预设板块限位（'1' = 开启，'0' = 关闭，缺省开启） */
export const SETTING_MOVE_POSE_LIMIT = 'movePoseLimit'

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

const execFileAsync = promisify(execFile)

/** WSL（Windows Subsystem for Linux）检测 */
function isWsl(): boolean {
  try {
    return /microsoft|wsl/i.test(readFileSync('/proc/version', 'utf8'))
  } catch {
    return false
  }
}

/** Linux 桌面环境检测（有 DISPLAY/WAYLAND_DISPLAY 视为桌面，否则视为无头服务器） */
function hasDesktopEnv(): boolean {
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
}

function spawnDetached(cmd: string, args: string[]): void {
  spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref()
}

/**
 * 在服务端打开目录（供桌面用户使用）：
 * - Windows / WSL：explorer.exe 打开
 * - Linux 桌面：xdg-open
 * - Linux 无头服务器：不支持，返回 null
 * 返回成功时的打开方式描述；失败/不支持返回 null。
 */
export async function openDirectory(dir: string): Promise<string | null> {
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    return null
  }

  try {
    if (process.platform === 'win32') {
      // explorer.exe 对相对路径的解析依赖自身 CWD，统一传绝对路径
      spawnDetached('explorer.exe', [resolve(dir)])
      return 'Windows 资源管理器'
    }

    if (isWsl()) {
      const { stdout } = await execFileAsync('wslpath', ['-w', dir])
      const winPath = stdout.trim()
      spawnDetached('explorer.exe', [winPath])
      return 'Windows 资源管理器（WSL）'
    }

    if (hasDesktopEnv()) {
      spawnDetached('xdg-open', [dir])
      return '系统文件管理器'
    }

    return null
  } catch {
    return null
  }
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
      return {
        success: true,
        data: {
          [SETTING_CALIB_EXPORT_DIR]: getSetting(SETTING_CALIB_EXPORT_DIR) || DEFAULT_EXPORT_DIR,
          [SETTING_MOVE_POSE_LIMIT]: getSetting(SETTING_MOVE_POSE_LIMIT) || '1',
        },
      }
    } catch (err) {
      return { success: false, error: { code: 50000, message: (err as Error).message } }
    }
  })

  /** 保存应用设置（管理员；各字段可选，仅在提供时保存） */
  app.post<{ Body: Partial<Record<string, string>> }>('/api/system/settings', async (request, reply): Promise<ApiResponse<null>> => {
    try {
      await authMiddleware(request, reply)
      if (reply.sent) return reply
      requireAdmin(request, reply)

      if (request.body?.calibExportDir !== undefined) {
        const dir = request.body.calibExportDir.trim()
        if (!dir) {
          return { success: false, error: { code: 40000, message: '导出目录不能为空' } }
        }
        setSetting(SETTING_CALIB_EXPORT_DIR, dir)
      }
      if (request.body?.movePoseLimit !== undefined) {
        const value = request.body.movePoseLimit === '1' ? '1' : '0'
        setSetting(SETTING_MOVE_POSE_LIMIT, value)
      }
      return { success: true, data: null }
    } catch (err) {
      return { success: false, error: { code: 50000, message: (err as Error).message } }
    }
  })

  /** 在服务端打开标定导出目录（管理员；Linux 无头服务器不支持） */
  app.post<{ Body: { dir?: string } }>('/api/system/settings/openExportDir', async (request, reply): Promise<ApiResponse<{ path: string; opener: string } | null>> => {
    try {
      await authMiddleware(request, reply)
      if (reply.sent) return reply
      requireAdmin(request, reply)

      const raw = request.body?.dir?.trim() || getSetting(SETTING_CALIB_EXPORT_DIR)
      const dir = resolveExportDir(raw)
      const opener = await openDirectory(dir)
      if (!opener) {
        return {
          success: false,
          error: { code: 40000, message: '服务端无桌面环境（Linux 无头服务器），无法打开目录' },
        }
      }
      return { success: true, data: { path: dir, opener } }
    } catch (err) {
      return { success: false, error: { code: 50000, message: (err as Error).message } }
    }
  })
}
