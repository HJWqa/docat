/**
 * 编排 REST API — 设置 + 脚本文件（服务端本地目录）
 *
 * 脚本文件目录可通过「通用」设置修改（app_settings 持久化），修改后
 * 服务端热切换 fs.watch 监听目录，并通过 WS orch-event（scripts-dir）
 * 通知前端刷新文件列表。
 */
import type { FastifyInstance } from 'fastify'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { authMiddleware, requireOperator } from '../../auth/auth.js'
import { getSetting, setSetting } from './system.js'
import { eventBus } from '../../event/EventBus.js'
import type { ApiResponse } from 'docat-shared/types'

const SCRIPT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(js|mjs|cjs|py)$/

const SETTING_PREFIX = 'orch.'
const SETTING_SCRIPTS_DIR = 'orch.scriptsDir'

function assertScriptName(name: string): string {
  const value = String(name ?? '').trim()
  if (!SCRIPT_NAME_RE.test(value) || value.includes('..')) throw new Error('脚本文件名不合法')
  return value
}

export interface OrchScriptFileInfo {
  name: string
  size: number
  mtime: number
}

export interface OrchSettingsPayload {
  defaultSeparator: string
  logLimit: number
  autoConnectOnLoad: boolean
  scriptFollow: boolean
  /** 服务端脚本文件目录 */
  scriptsDir: string
}

let watcher: FSWatcher | null = null
/** 当前生效的脚本目录（初始为配置默认值，可经设置修改） */
let currentScriptsDir = ''
let notifyTimer: ReturnType<typeof setTimeout> | null = null

function readOrchSettings(): OrchSettingsPayload {
  const num = (v: string, fallback: number) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : fallback
  }
  return {
    defaultSeparator: getSetting(`${SETTING_PREFIX}defaultSeparator`) || ';',
    logLimit: num(getSetting(`${SETTING_PREFIX}logLimit`), 500),
    autoConnectOnLoad: getSetting(`${SETTING_PREFIX}autoConnectOnLoad`) === 'true',
    scriptFollow: getSetting(`${SETTING_PREFIX}scriptFollow`) !== 'false',
    scriptsDir: getSetting(SETTING_SCRIPTS_DIR) || currentScriptsDir,
  }
}

function ensureWatch(dir: string): void {
  mkdirSync(dir, { recursive: true })
  watcher?.close()
  watcher = watch(dir, (_eventType, filename) => {
    if (!filename) return
    const name = String(filename)
    if (!SCRIPT_NAME_RE.test(name)) return
    if (notifyTimer) clearTimeout(notifyTimer)
    notifyTimer = setTimeout(() => {
      notifyTimer = null
      try {
        const st = statSync(join(dir, name))
        eventBus.emit('orch:event', {
          event: 'script-file',
          name,
          mtime: st.mtimeMs,
          timestamp: Date.now(),
        })
      } catch {
        // 文件可能刚被删除
      }
    }, 300)
  })
}

export function orchestrationRoutes(app: FastifyInstance, scriptsDir: string): void {
  // 启动时恢复用户配置的目录（有则用之），并建立监听
  const persisted = getSetting(SETTING_SCRIPTS_DIR)
  currentScriptsDir = persisted || scriptsDir
  ensureWatch(currentScriptsDir)

  // ─── 编排设置（含脚本目录）─────────────────────────
  app.get('/api/orchestration/settings', async (request, reply): Promise<ApiResponse<OrchSettingsPayload>> => {
    try {
      await authMiddleware(request, reply)
      if (reply.sent) return reply
      return { success: true, data: readOrchSettings() }
    } catch (err) {
      return { success: false, error: { code: 50000, message: (err as Error).message } }
    }
  })

  app.put<{ Body: Partial<OrchSettingsPayload> }>(
    '/api/orchestration/settings',
    async (request, reply): Promise<ApiResponse<OrchSettingsPayload>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        if (reply.sent) return reply

        const body = request.body ?? {}
        if (body.defaultSeparator !== undefined) {
          setSetting(`${SETTING_PREFIX}defaultSeparator`, String(body.defaultSeparator || ';'))
        }
        if (body.logLimit !== undefined) {
          setSetting(`${SETTING_PREFIX}logLimit`, String(Math.max(50, Number(body.logLimit) || 500)))
        }
        if (body.autoConnectOnLoad !== undefined) {
          setSetting(`${SETTING_PREFIX}autoConnectOnLoad`, body.autoConnectOnLoad ? 'true' : 'false')
        }
        if (body.scriptFollow !== undefined) {
          setSetting(`${SETTING_PREFIX}scriptFollow`, body.scriptFollow ? 'true' : 'false')
        }
        if (body.scriptsDir !== undefined) {
          const dir = String(body.scriptsDir || '').trim()
          if (!dir) return { success: false, error: { code: 42200, message: '脚本目录不能为空' } }
          setSetting(SETTING_SCRIPTS_DIR, dir)
          if (dir !== currentScriptsDir) {
            currentScriptsDir = dir
            ensureWatch(dir)
            eventBus.emit('orch:event', {
              event: 'scripts-dir',
              dir,
              timestamp: Date.now(),
            })
          }
        }

        return { success: true, data: readOrchSettings() }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  // ─── 用 VSCode 打开脚本目录（服务端）────────────────
  app.post('/api/orchestration/scripts/open-in-editor', async (request, reply): Promise<ApiResponse<{ dir: string }>> => {
    try {
      await authMiddleware(request, reply)
      if (reply.sent) return reply
      requireOperator(request, reply)
      if (reply.sent) return reply

      // 先确认 code 命令可用（避免异步 spawn 后才报错）
      const probe = spawnSync('code', ['--version'], { timeout: 3000, stdio: 'ignore' })
      if (probe.error || probe.status !== 0) {
        return { success: false, error: { code: 50000, message: '未找到 code 命令，请确认服务端已安装 VSCode 并加入 PATH' } }
      }

      const child = spawn('code', [currentScriptsDir], { detached: true, stdio: 'ignore' })
      child.on('error', (err) => console.error('[Orchestration] code 启动失败:', err.message))
      child.unref()

      return { success: true, data: { dir: currentScriptsDir } }
    } catch (err) {
      return { success: false, error: { code: 50000, message: (err as Error).message } }
    }
  })

  // ─── 可用串口列表（/dev 下的串口设备）───────────────
  app.get('/api/orchestration/serial-ports', async (request, reply): Promise<ApiResponse<string[]>> => {
    try {
      await authMiddleware(request, reply)
      if (reply.sent) return reply
      const ports: string[] = []
      try {
        const entries = readdirSync('/dev')
        for (const name of entries) {
          if (/^(tty(USB|ACM|S|AMA|THS|XRUSB|SC)|cu\.)/.test(name)) ports.push(`/dev/${name}`)
        }
      } catch {
        // /dev 不可读（如非 Linux）→ 返回空列表
      }
      return { success: true, data: ports.sort((a, b) => a.localeCompare(b)) }
    } catch (err) {
      return { success: false, error: { code: 50000, message: (err as Error).message } }
    }
  })

  // ─── 脚本文件列表 ──────────────────────────────────
  app.get('/api/orchestration/scripts', async (request, reply): Promise<ApiResponse<OrchScriptFileInfo[]>> => {
    try {
      await authMiddleware(request, reply)
      if (reply.sent) return reply
      const files: OrchScriptFileInfo[] = readdirSync(currentScriptsDir)
        .filter(name => SCRIPT_NAME_RE.test(name))
        .map(name => {
          const st = statSync(join(currentScriptsDir, name))
          return { name, size: st.size, mtime: st.mtimeMs }
        })
        .sort((a, b) => a.name.localeCompare(b.name))
      return { success: true, data: files }
    } catch (err) {
      return { success: false, error: { code: 50000, message: (err as Error).message } }
    }
  })

  // ─── 读取脚本文件 ──────────────────────────────────
  app.get<{ Params: { name: string } }>(
    '/api/orchestration/scripts/:name',
    async (request, reply): Promise<ApiResponse<{ name: string; content: string; mtime: number }>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        const name = assertScriptName(request.params.name)
        const path = join(currentScriptsDir, name)
        const content = readFileSync(path, 'utf-8')
        const mtime = statSync(path).mtimeMs
        return { success: true, data: { name, content, mtime } }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  // ─── 保存脚本文件 ──────────────────────────────────
  app.put<{ Params: { name: string }; Body: { content?: string } }>(
    '/api/orchestration/scripts/:name',
    async (request, reply): Promise<ApiResponse<{ mtime: number }>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        if (reply.sent) return reply
        const name = assertScriptName(request.params.name)
        const path = join(currentScriptsDir, name)
        writeFileSync(path, String(request.body.content ?? ''), 'utf-8')
        const mtime = statSync(path).mtimeMs
        return { success: true, data: { mtime } }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )
}
