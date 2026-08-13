/**
 * 编排 REST API — 设备 / 姿态 / 设置 / 脚本文件 / 脚本运行
 *
 * 脚本文件目录可通过「通用」设置修改（app_settings 持久化），修改后
 * 服务端热切换 fs.watch 监听目录，并通过 WS orch-event（scripts-dir）
 * 通知前端刷新文件列表。
 */
import type { FastifyInstance } from 'fastify'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, watch, type FSWatcher } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { authMiddleware, requireOperator } from '../../auth/auth.js'
import { listSerialPorts } from '../../device/transport/MagicianSerialTransport.js'
import { getSetting, setSetting } from './system.js'
import { eventBus } from '../../event/EventBus.js'
import type { OrchDeviceManager } from '../../orchestration/OrchDeviceManager.js'
import type { RuntimeManager } from '../../runtime/RuntimeManager.js'
import type { OrchDeviceConfig, OrchPose } from '../../orchestration/types.js'
import type { ApiResponse } from 'docat-shared/types'

const SCRIPT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(js|mjs|cjs|py)$/

/** 服务端包根目录（src/api/rest → 包根；dist 下同样适用） */
const SERVER_PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const SETTING_PREFIX = 'orch.'
const SETTING_SCRIPTS_DIR = 'orch.scriptsDir'

/**
 * 解析 code 命令（Windows）：
 * cmd 按 PATHEXT 会把 `code` 解析成 Code.exe（GUI 主进程，裸路径参数不会打开目录），
 * 必须显式走 `...\bin\code.cmd`（CLI 包装）；找不到时回退到其他命中项。
 * 非 Windows 直接返回 'code'。返回 null 表示未找到。
 */
function resolveCodeCommand(): string | null {
  if (process.platform !== 'win32') return 'code'
  try {
    const r = spawnSync('where', ['code'], { encoding: 'utf8', timeout: 5000 })
    if (r.error || r.status !== 0 || !r.stdout) return null
    const lines = r.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    const cli = lines.find(l => /\\bin\\code\.cmd$/i.test(l))
    if (cli) return cli
    return lines.length > 0 ? lines[0] : null
  } catch {
    return null
  }
}

/** Windows 下 .cmd 不能直接 spawn（EINVAL），统一经 cmd.exe 执行 */
function codeArgs(codeCmd: string, args: string[]): string[] {
  return process.platform === 'win32'
    ? ['/d', '/c', codeCmd, ...args]
    : args
}

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
  /** 心跳周期（ms，发送 ping; 间隔） */
  heartbeatInterval: number
  /** 心跳超时（ms，超过无 pong 判定失活） */
  heartbeatTimeout: number
  /** 心跳连续失活判定阈值（周期数） */
  heartbeatMissThreshold: number
  /** 心跳发送内容（默认 ping;） */
  heartbeatPing: string
  /** 心跳应答内容（默认 pong;） */
  heartbeatPong: string
  /** 自动重连最大尝试次数（超过停止） */
  reconnectMaxAttempts: number
  /** 自动重连最长持续时间（秒，超过停止） */
  reconnectMaxSeconds: number
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
    heartbeatInterval: num(getSetting(`${SETTING_PREFIX}heartbeatInterval`), 5000),
    heartbeatTimeout: num(getSetting(`${SETTING_PREFIX}heartbeatTimeout`), 15000),
    heartbeatMissThreshold: num(getSetting(`${SETTING_PREFIX}heartbeatMissThreshold`), 3),
    heartbeatPing: getSetting(`${SETTING_PREFIX}heartbeatPing`) || 'ping;',
    heartbeatPong: getSetting(`${SETTING_PREFIX}heartbeatPong`) || 'pong;',
    reconnectMaxAttempts: num(getSetting(`${SETTING_PREFIX}reconnectMaxAttempts`), 8),
    reconnectMaxSeconds: num(getSetting(`${SETTING_PREFIX}reconnectMaxSeconds`), 600),
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

export function orchestrationRoutes(app: FastifyInstance, scriptsDir: string, orchDevices: OrchDeviceManager, runtime: RuntimeManager): void {
  // 启动时恢复用户配置的目录（有则用之），并建立监听
  const persisted = getSetting(SETTING_SCRIPTS_DIR)
  currentScriptsDir = persisted || scriptsDir
  ensureWatch(currentScriptsDir)

  // 每次启动把编排手册覆盖拷贝到脚本目录（手册随版本更新，以最新为准）
  try {
    const manualSrc = join(SERVER_PKG_ROOT, '..', '..', 'docs', 'orchestration-script.md')
    const manualDest = join(currentScriptsDir, 'orchestration-script.md')
    if (existsSync(manualSrc)) copyFileSync(manualSrc, manualDest)
  } catch {
    // 手册缺失/拷贝失败不影响启动
  }

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
        if (body.heartbeatInterval !== undefined) {
          setSetting(`${SETTING_PREFIX}heartbeatInterval`, String(Math.max(1000, Number(body.heartbeatInterval) || 5000)))
        }
        if (body.heartbeatTimeout !== undefined) {
          setSetting(`${SETTING_PREFIX}heartbeatTimeout`, String(Math.max(2000, Number(body.heartbeatTimeout) || 15000)))
        }
        if (body.heartbeatMissThreshold !== undefined) {
          setSetting(`${SETTING_PREFIX}heartbeatMissThreshold`, String(Math.max(1, Number(body.heartbeatMissThreshold) || 3)))
        }
        if (body.heartbeatPing !== undefined) {
          setSetting(`${SETTING_PREFIX}heartbeatPing`, String(body.heartbeatPing || 'ping;'))
        }
        if (body.heartbeatPong !== undefined) {
          setSetting(`${SETTING_PREFIX}heartbeatPong`, String(body.heartbeatPong || 'pong;'))
        }
        if (body.reconnectMaxAttempts !== undefined) {
          setSetting(`${SETTING_PREFIX}reconnectMaxAttempts`, String(Math.max(1, Math.min(100, Number(body.reconnectMaxAttempts) || 8))))
        }
        if (body.reconnectMaxSeconds !== undefined) {
          setSetting(`${SETTING_PREFIX}reconnectMaxSeconds`, String(Math.max(10, Math.min(86400, Number(body.reconnectMaxSeconds) || 600))))
        }
        if (body.scriptsDir !== undefined) {
          const dir = String(body.scriptsDir || '').trim()
          if (!dir) return { success: false, error: { code: 42200, message: '脚本目录不能为空' } }
          setSetting(SETTING_SCRIPTS_DIR, dir)
          if (dir !== currentScriptsDir) {
            currentScriptsDir = dir
            ensureWatch(dir)
            runtime.setRequireBase(dir)
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

  // ─── 脚本模块成员（自动补全用）：子进程加载模块并列出导出 ──
  app.post<{ Body: { name?: string } }>(
    '/api/orchestration/scripts/module-members',
    async (request, reply): Promise<ApiResponse<{ members: Array<{ name: string; type: string }> } | { error: string }>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        const moduleName = String(request.body?.name ?? '').trim()
        if (!moduleName || moduleName.includes('\0')) {
          return { success: false, error: { code: 42200, message: '缺少模块名' } }
        }

        const probe = spawnSync(process.execPath, ['-e', `
          const { createRequire } = require('node:module')
          const path = require('node:path')
          const name = process.argv[1]
          const scriptDir = process.argv[2]
          // 与脚本运行时一致：先脚本目录解析，回退服务端包目录
          const scriptRequire = scriptDir ? createRequire(path.join(scriptDir, '__docat_members__.js')) : null
          let mod = null
          let lastError = null
          if (scriptRequire) {
            try { mod = scriptRequire(name) } catch (e) { lastError = e }
          }
          if (!mod) {
            try { mod = require(name) } catch (e) { lastError = e }
          }
          if (!mod) { console.log(JSON.stringify({ error: lastError ? lastError.message : '模块加载失败' })); process.exit(0) }
          if (typeof mod !== 'object' || mod === null) { console.log(JSON.stringify({ members: [] })); process.exit(0) }
          const out = []
          const seen = new Set()
          for (const k of Object.keys(mod)) {
            if (seen.has(k)) continue
            seen.add(k)
            const v = mod[k]
            let type = typeof v
            if (v && typeof v === 'object') type = Array.isArray(v) ? 'array' : 'object'
            else if (typeof v === 'function') type = 'function'
            out.push({ name: k, type })
            if (out.length >= 300) break
          }
          console.log(JSON.stringify({ members: out }))
        `, moduleName, currentScriptsDir], {
          cwd: SERVER_PKG_ROOT,
          timeout: 5000,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'pipe'],
        })

        if (probe.error || probe.status !== 0 || !probe.stdout) {
          return { success: false, error: { code: 50000, message: '模块加载失败或超时' } }
        }
        const parsed = JSON.parse(probe.stdout) as { error?: string; members?: Array<{ name: string; type: string }> }
        if (parsed.error) return { success: false, error: { code: 50000, message: parsed.error } }
        return { success: true, data: { members: parsed.members ?? [] } }
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

      const codeCmd = resolveCodeCommand()
      if (!codeCmd) {
        return { success: false, error: { code: 50000, message: '未找到 code 命令，请确认服务端已安装 VSCode 并加入 PATH' } }
      }
      // Windows 上 .cmd 经 cmd.exe 执行；非 Windows 直接跑 code
      const shellCmd = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : codeCmd

      // 先确认 code 命令可用（避免异步 spawn 后才报错）
      const probe = spawnSync(shellCmd, codeArgs(codeCmd, ['--version']), { timeout: 3000, stdio: 'ignore' })
      if (probe.error || probe.status !== 0) {
        return { success: false, error: { code: 50000, message: 'code 命令不可用，请确认服务端已安装 VSCode 并加入 PATH' } }
      }

      // 目录统一转绝对路径（VSCode CLI 对相对路径解析不可靠）
      const targetDir = resolve(currentScriptsDir)
      const child = spawn(shellCmd, codeArgs(codeCmd, [targetDir]), { detached: true, stdio: 'ignore' })
      child.on('error', (err) => console.error('[Orchestration] code 启动失败:', err.message))
      child.unref()

      return { success: true, data: { dir: targetDir } }
    } catch (err) {
      return { success: false, error: { code: 50000, message: (err as Error).message } }
    }
  })

  // ─── 可用串口列表 ──────────────────────────────────
  app.get('/api/orchestration/serial-ports', async (request, reply): Promise<ApiResponse<string[]>> => {
    try {
      await authMiddleware(request, reply)
      if (reply.sent) return reply
      let ports = await listSerialPorts()
      if (process.platform === 'linux') {
        try {
          const entries = readdirSync('/dev')
          const devPorts = entries
            .filter((name) => /^(tty(USB|ACM|S|AMA|THS|XRUSB|SC)|cu\.)/.test(name))
            .map((name) => `/dev/${name}`)
          ports = Array.from(new Set([...ports, ...devPorts]))
        } catch {
          // /dev 不可读（如非 Linux）→ 忽略
        }
      }
      return { success: true, data: ports.sort((a, b) => a.localeCompare(b)) }
    } catch (err) {
      return { success: false, error: { code: 50000, message: (err as Error).message } }
    }
  })

  // ─── 新建脚本文件 ──────────────────────────────────
  app.post<{ Body: { name?: string } }>(
    '/api/orchestration/scripts',
    async (request, reply): Promise<ApiResponse<{ name: string; mtime: number }>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        if (reply.sent) return reply
        const name = assertScriptName(String(request.body?.name ?? '').trim())
        const path = join(currentScriptsDir, name)
        if (existsSync(path)) {
          return { success: false, error: { code: 42200, message: '文件已存在' } }
        }
        writeFileSync(path, '', 'utf-8')
        const mtime = statSync(path).mtimeMs
        return { success: true, data: { name, mtime } }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

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

  // ─── 编排设备 CRUD ─────────────────────────────────
  app.get('/api/orchestration/devices', async (request, reply): Promise<ApiResponse<unknown[]>> => {
    try {
      await authMiddleware(request, reply)
      if (reply.sent) return reply
      return { success: true, data: orchDevices.list() }
    } catch (err) {
      return { success: false, error: { code: 50000, message: (err as Error).message } }
    }
  })

  app.post<{ Body: Omit<OrchDeviceConfig, 'id' | 'createdAt'> }>(
    '/api/orchestration/devices',
    async (request, reply): Promise<ApiResponse<unknown>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        if (reply.sent) return reply
        const result = orchDevices.add(request.body)
        if (!result.ok) return { success: false, error: { code: 42200, message: result.error ?? '添加失败' } }
        return { success: true, data: result.device }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.put<{ Params: { id: string }; Body: Partial<OrchDeviceConfig> }>(
    '/api/orchestration/devices/:id',
    async (request, reply): Promise<ApiResponse<unknown>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        if (reply.sent) return reply
        const result = orchDevices.update(request.params.id, request.body)
        if (!result.ok) return { success: false, error: { code: 42200, message: result.error ?? '保存失败' } }
        return { success: true, data: orchDevices.get(request.params.id) }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.delete<{ Params: { id: string } }>(
    '/api/orchestration/devices/:id',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        if (reply.sent) return reply
        await orchDevices.remove(request.params.id)
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  // ─── 设备连接 / 断开 / 发送 ────────────────────────
  app.post<{ Params: { id: string }; Body: { auto?: boolean } }>(
    '/api/orchestration/devices/:id/connect',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        if (reply.sent) return reply
        const result = await orchDevices.connect(request.params.id, request.body?.auto === true)
        if (!result.ok) return { success: false, error: { code: 50000, message: result.error ?? '连接失败' } }
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.post<{ Params: { id: string } }>(
    '/api/orchestration/devices/:id/disconnect',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        if (reply.sent) return reply
        await orchDevices.disconnect(request.params.id)
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.post<{ Params: { id: string }; Body: { message?: string } }>(
    '/api/orchestration/devices/:id/send',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        if (reply.sent) return reply
        const device = orchDevices.get(request.params.id)
        if (!device) return { success: false, error: { code: 40402, message: '设备不存在' } }
        const ok = orchDevices.sendByName(device.name, String(request.body.message ?? ''))
        if (!ok) return { success: false, error: { code: 50000, message: '发送失败（设备未连接或不存在）' } }
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  // ─── 编排姿态 ──────────────────────────────────────
  app.get('/api/orchestration/poses', async (request, reply): Promise<ApiResponse<OrchPose[]>> => {
    try {
      await authMiddleware(request, reply)
      if (reply.sent) return reply
      return { success: true, data: orchDevices.listPoses() }
    } catch (err) {
      return { success: false, error: { code: 50000, message: (err as Error).message } }
    }
  })

  app.post<{ Body: OrchPose }>(
    '/api/orchestration/poses',
    async (request, reply): Promise<ApiResponse<OrchPose>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        if (reply.sent) return reply
        const result = orchDevices.savePose(request.body)
        if (!result.ok) return { success: false, error: { code: 42200, message: result.error ?? '保存失败' } }
        return { success: true, data: request.body }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.delete<{ Params: { name: string } }>(
    '/api/orchestration/poses/:name',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        if (reply.sent) return reply
        orchDevices.deletePose(request.params.name)
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  // ─── 脚本运行 ──────────────────────────────────────
  app.post<{ Body: { language?: string; content?: string; fileName?: string } }>(
    '/api/orchestration/script/run',
    async (request, reply): Promise<ApiResponse<null>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        requireOperator(request, reply)
        if (reply.sent) return reply
        const language = String(request.body.language ?? 'javascript') === 'python' ? 'python' : 'javascript'
        const result = await runtime.run({ language, content: String(request.body.content ?? ''), fileName: String(request.body.fileName ?? 'script.js') })
        if (!result.ok) return { success: false, error: { code: 50000, message: result.error ?? '启动失败' } }
        return { success: true, data: null }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  app.post('/api/orchestration/script/stop', async (request, reply): Promise<ApiResponse<null>> => {
    try {
      await authMiddleware(request, reply)
      if (reply.sent) return reply
      requireOperator(request, reply)
      if (reply.sent) return reply
      await runtime.stop()
      return { success: true, data: null }
    } catch (err) {
      return { success: false, error: { code: 50000, message: (err as Error).message } }
    }
  })
}
