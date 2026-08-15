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
import { pythonEnv, resolvePythonInterpreter, type RuntimeManager } from '../../runtime/RuntimeManager.js'
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
    const r = spawnSync('where', ['code'], { encoding: 'utf8', timeout: 5000, windowsHide: true })
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
  /** 浮点拼接保留的小数位数（0-12，默认 6），脚本运行时 init 下发 */
  decimalDigits: number
  logLimit: number
  autoConnectOnLoad: boolean
  scriptFollow: boolean
  /** 前端轮询对账（每 4s 与服务端设备状态对账；WS 异常时兜底） */
  pollReconcile: boolean
  /** 快速恢复（仅 tcp-client）：固定间隔直接重连（不探测、不打扰对端），恢复即连；不受重连上限约束 */
  rapidRecovery: boolean
  /** 快速恢复重连间隔（ms） */
  rapidRecoveryInterval: number
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
  /** 自动重连最大尝试次数（0 = 不限次数；超过停止） */
  reconnectMaxAttempts: number
  /** 自动重连最长持续时间（秒，超过停止） */
  reconnectMaxSeconds: number
  /** 服务端脚本文件目录 */
  scriptsDir: string
  /** 自定义 Python 命令/路径（留空自动探测 python3 / python / py -3） */
  pythonCommand: string
}

let watcher: FSWatcher | null = null
/** 当前生效的脚本目录（初始为配置默认值，可经设置修改） */
let currentScriptsDir = ''
let notifyTimer: ReturnType<typeof setTimeout> | null = null

// ─── Python 标准库快照（前端自动补全用）────────────────

/** 快照条目：模块成员 / builtins / 类型方法 */
export interface StdlibMember {
  name: string
  type: string
  doc: string
}

export interface PythonStdlibSnapshot {
  builtins: StdlibMember[]
  types: Record<string, StdlibMember[]>
  modules: Record<string, StdlibMember[]>
}

/** 快照覆盖的常用类型方法（dir(builtins.T) 生成） */
const STDLIB_SNAPSHOT_TYPES = ['str', 'list', 'dict', 'set', 'tuple', 'bytes']

/** 快照覆盖的常用标准库模块（importlib.import_module 生成） */
const STDLIB_SNAPSHOT_MODULES = [
  'math', 'os', 'json', 'time', 'random', 're', 'collections', 'itertools',
  'functools', 'datetime', 'pathlib', 'sys', 'string', 'statistics',
]

let stdlibSnapshotCache: { key: string; at: number; data: PythonStdlibSnapshot } | null = null
/** 快照缓存有效期（解释器固定时成员不变；防止每次打开脚本面板都探测） */
const STDLIB_SNAPSHOT_TTL = 60 * 60 * 1000

// ─── 模块成员探测缓存（内存）：避免每次输入都启动子进程探测 ──
// 成功缓存 1h；失败仅缓存 10s（给重试机会，且避免反复慢探测）

type MemberProbeResult = { ok: true; members: Array<{ name: string; type: string }> } | { ok: false; message: string }

const memberProbeCache = new Map<string, { at: number; result: MemberProbeResult }>()
const MEMBER_PROBE_OK_TTL = 60 * 60 * 1000
const MEMBER_PROBE_FAIL_TTL = 10 * 1000

function readProbeCache(key: string): MemberProbeResult | null {
  const entry = memberProbeCache.get(key)
  if (!entry) return null
  const ttl = entry.result.ok ? MEMBER_PROBE_OK_TTL : MEMBER_PROBE_FAIL_TTL
  if (Date.now() - entry.at > ttl) {
    memberProbeCache.delete(key)
    return null
  }
  return entry.result
}

function writeProbeCache(key: string, result: MemberProbeResult): void {
  memberProbeCache.set(key, { at: Date.now(), result })
}

/** 生成快照的 Python 脚本：sys.argv[1]=类型列表，sys.argv[2]=模块列表 */
const STDLIB_SNAPSHOT_SCRIPT = `
import builtins, importlib, json, sys
MAXN = 300
def members(obj):
    out = []
    for k in dir(obj):
        if k.startswith("_"):
            continue
        try:
            v = getattr(obj, k)
            doc = ""
            d = getattr(v, "__doc__", None)
            if d:
                doc = str(d).strip().splitlines()[0].strip()[:200]
        except BaseException:
            continue
        if len(out) >= MAXN:
            break
        out.append({"name": k, "type": "function" if callable(v) else "variable", "doc": doc})
    return out
payload = {"builtins": members(builtins), "types": {}, "modules": {}}
for t in sys.argv[1].split(","):
    try:
        payload["types"][t] = members(getattr(builtins, t))
    except BaseException:
        pass
for m in sys.argv[2].split(","):
    try:
        payload["modules"][m] = members(importlib.import_module(m))
    except BaseException:
        pass
print(json.dumps(payload))
`

function readOrchSettings(): OrchSettingsPayload {
  const num = (v: string, fallback: number) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : fallback
  }
  const numOrZero = (v: string, fallback: number) => {
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? n : fallback
  }
  const decimalDigits = numOrZero(getSetting(`${SETTING_PREFIX}decimalDigits`), 6)
  return {
    defaultSeparator: getSetting(`${SETTING_PREFIX}defaultSeparator`) || ';',
    decimalDigits: Math.min(12, Math.floor(decimalDigits)),
    logLimit: num(getSetting(`${SETTING_PREFIX}logLimit`), 500),
    autoConnectOnLoad: getSetting(`${SETTING_PREFIX}autoConnectOnLoad`) === 'true',
    scriptFollow: getSetting(`${SETTING_PREFIX}scriptFollow`) !== 'false',
    pollReconcile: getSetting(`${SETTING_PREFIX}pollReconcile`) !== 'false',
    rapidRecovery: getSetting(`${SETTING_PREFIX}rapidRecovery`) !== 'false',
    rapidRecoveryInterval: num(getSetting(`${SETTING_PREFIX}rapidRecoveryInterval`), 1000),
    heartbeatInterval: num(getSetting(`${SETTING_PREFIX}heartbeatInterval`), 5000),
    heartbeatTimeout: num(getSetting(`${SETTING_PREFIX}heartbeatTimeout`), 15000),
    heartbeatMissThreshold: num(getSetting(`${SETTING_PREFIX}heartbeatMissThreshold`), 3),
    heartbeatPing: getSetting(`${SETTING_PREFIX}heartbeatPing`) || 'ping;',
    heartbeatPong: getSetting(`${SETTING_PREFIX}heartbeatPong`) || 'pong;',
    reconnectMaxAttempts: numOrZero(getSetting(`${SETTING_PREFIX}reconnectMaxAttempts`), 8),
    reconnectMaxSeconds: num(getSetting(`${SETTING_PREFIX}reconnectMaxSeconds`), 600),
    scriptsDir: getSetting(SETTING_SCRIPTS_DIR) || currentScriptsDir,
    pythonCommand: getSetting(`${SETTING_PREFIX}pythonCommand`) || '',
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
  // 恢复自定义 Python 命令（清空探测缓存，使配置即时生效）
  runtime.setPythonCommand(getSetting(`${SETTING_PREFIX}pythonCommand`) || '')

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
        if (body.decimalDigits !== undefined) {
          const n = Math.floor(Number(body.decimalDigits))
          setSetting(`${SETTING_PREFIX}decimalDigits`, String(Number.isFinite(n) ? Math.min(12, Math.max(0, n)) : 6))
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
        if (body.pollReconcile !== undefined) {
          setSetting(`${SETTING_PREFIX}pollReconcile`, body.pollReconcile ? 'true' : 'false')
        }
        if (body.rapidRecovery !== undefined) {
          setSetting(`${SETTING_PREFIX}rapidRecovery`, body.rapidRecovery ? 'true' : 'false')
        }
        if (body.rapidRecoveryInterval !== undefined) {
          setSetting(`${SETTING_PREFIX}rapidRecoveryInterval`, String(Math.min(60000, Math.max(200, Number(body.rapidRecoveryInterval) || 1000))))
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
          const n = Number(body.reconnectMaxAttempts)
          setSetting(`${SETTING_PREFIX}reconnectMaxAttempts`, String(Number.isFinite(n) ? Math.min(100, Math.max(0, Math.floor(n))) : 8))
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
        if (body.pythonCommand !== undefined) {
          const cmd = String(body.pythonCommand || '').trim()
          setSetting(`${SETTING_PREFIX}pythonCommand`, cmd)
          runtime.setPythonCommand(cmd)
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

        // 缓存命中直接返回（key 含脚本目录：require 解析基准影响成员）
        const cacheKey = `js:${moduleName}|${currentScriptsDir}`
        const cached = readProbeCache(cacheKey)
        if (cached) {
          return cached.ok
            ? { success: true, data: { members: cached.members } }
            : { success: false, error: { code: 50000, message: cached.message } }
        }

        const probe = spawnSync(process.execPath, ['-e', `
          const { createRequire } = require('node:module')
          const path = require('node:path')
          const name = process.argv[1]
          // 脚本目录统一转绝对路径（createRequire 要求绝对路径，相对路径会直接抛错）
          const scriptDir = process.argv[2] ? path.resolve(process.argv[2]) : ''
          // 与脚本运行时一致：先脚本目录解析，回退服务端包目录
          let scriptRequire = null
          try {
            scriptRequire = scriptDir ? createRequire(path.join(scriptDir, '__docat_members__.js')) : null
          } catch (e) {
            scriptRequire = null
          }
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
          windowsHide: true,
        })

        if (probe.error || probe.status !== 0 || !probe.stdout) {
          writeProbeCache(cacheKey, { ok: false, message: '模块加载失败或超时' })
          return { success: false, error: { code: 50000, message: '模块加载失败或超时' } }
        }
        const parsed = JSON.parse(probe.stdout) as { error?: string; members?: Array<{ name: string; type: string }> }
        if (parsed.error) {
          writeProbeCache(cacheKey, { ok: false, message: parsed.error })
          return { success: false, error: { code: 50000, message: parsed.error } }
        }
        const jsMembers = parsed.members ?? []
        writeProbeCache(cacheKey, { ok: true, members: jsMembers })
        return { success: true, data: { members: jsMembers } }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  // ─── Python 模块成员（自动补全用）：用配置的 Python 解释器列出模块导出 ──
  app.post<{ Body: { name?: string } }>(
    '/api/orchestration/scripts/python-module-members',
    async (request, reply): Promise<ApiResponse<{ members: Array<{ name: string; type: string }> } | { error: string }>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        const moduleName = String(request.body?.name ?? '').trim()
        if (!moduleName || !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(moduleName)) {
          return { success: false, error: { code: 42200, message: '缺少模块名' } }
        }

        // 与脚本运行同一解释器解析逻辑（自定义命令优先），保证探测一致
        const py = resolvePythonInterpreter()
        if (!py) {
          return { success: false, error: { code: 50000, message: '未找到 Python 解释器（python3 / python / py -3 均不可用）' } }
        }

        // 缓存命中直接返回（key 含解释器：自定义 Python 命令变更后自动失效）
        const cacheKey = `py:${py.cmd}|${moduleName}`
        const cached = readProbeCache(cacheKey)
        if (cached) {
          return cached.ok
            ? { success: true, data: { members: cached.members } }
            : { success: false, error: { code: 50000, message: cached.message } }
        }

        const probe = spawnSync(py.cmd, [...py.runArgs, '-c', `
import importlib, json, sys
try:
    mod = importlib.import_module(sys.argv[1])
except BaseException as e:
    print(json.dumps({"error": "%s: %s" % (type(e).__name__, e)}))
    raise SystemExit(0)
out = []
for k in dir(mod):
    if k.startswith("_"):
        continue
    try:
        v = getattr(mod, k)
    except BaseException:
        continue
    if len(out) >= 300:
        break
    t = type(v).__name__
    out.append({"name": k, "type": "function" if ("function" in t or "method" in t) else "variable"})
print(json.dumps({"members": out}))
`, moduleName], {
          cwd: SERVER_PKG_ROOT,
          timeout: 5000,
          encoding: 'utf-8',
          env: pythonEnv(),
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        })

        if (probe.error || probe.status !== 0 || !probe.stdout) {
          writeProbeCache(cacheKey, { ok: false, message: '模块加载失败或超时' })
          return { success: false, error: { code: 50000, message: '模块加载失败或超时' } }
        }
        // 取最后一个可解析的 JSON 行（import 期间模块自身的 print 输出可忽略）
        const lines = probe.stdout.split(/\r?\n/).filter(Boolean)
        let payload: { error?: string; members?: Array<{ name: string; type: string }> } | null = null
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            payload = JSON.parse(lines[i]) as { error?: string; members?: Array<{ name: string; type: string }> }
            break
          } catch {
            // 非 JSON 行（模块自身输出）跳过
          }
        }
        if (!payload) {
          writeProbeCache(cacheKey, { ok: false, message: '模块探测无输出' })
          return { success: false, error: { code: 50000, message: '模块探测无输出' } }
        }
        if (payload.error) {
          writeProbeCache(cacheKey, { ok: false, message: payload.error })
          return { success: false, error: { code: 50000, message: payload.error } }
        }
        const pyMembers = payload.members ?? []
        writeProbeCache(cacheKey, { ok: true, members: pyMembers })
        return { success: true, data: { members: pyMembers } }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  // ─── Python 标准库快照（自动补全用）：builtins + 类型方法 + 常用 stdlib 成员 ──
  app.post(
    '/api/orchestration/scripts/python-stdlib-snapshot',
    async (request, reply): Promise<ApiResponse<PythonStdlibSnapshot>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply

        // 与脚本运行同一解释器解析逻辑（自定义命令优先），保证成员与运行环境一致
        const py = resolvePythonInterpreter()
        if (!py) {
          return { success: false, error: { code: 50000, message: '未找到 Python 解释器（python3 / python / py -3 均不可用）' } }
        }

        const key = `${py.cmd}|${py.runArgs.join(' ')}`
        if (stdlibSnapshotCache && stdlibSnapshotCache.key === key && Date.now() - stdlibSnapshotCache.at < STDLIB_SNAPSHOT_TTL) {
          return { success: true, data: stdlibSnapshotCache.data }
        }

        const probe = spawnSync(py.cmd, [...py.runArgs, '-c', STDLIB_SNAPSHOT_SCRIPT, STDLIB_SNAPSHOT_TYPES.join(','), STDLIB_SNAPSHOT_MODULES.join(',')], {
          cwd: SERVER_PKG_ROOT,
          timeout: 8000,
          encoding: 'utf-8',
          env: pythonEnv(),
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        })

        if (probe.error || probe.status !== 0 || !probe.stdout) {
          return { success: false, error: { code: 50000, message: '标准库快照生成失败或超时' } }
        }
        // 取最后一个可解析的 JSON 行（import 期间模块自身的 print 输出可忽略）
        const lines = probe.stdout.split(/\r?\n/).filter(Boolean)
        let payload: PythonStdlibSnapshot | null = null
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            payload = JSON.parse(lines[i]) as PythonStdlibSnapshot
            break
          } catch {
            // 非 JSON 行（模块自身输出）跳过
          }
        }
        if (!payload) {
          return { success: false, error: { code: 50000, message: '标准库快照探测无输出' } }
        }
        stdlibSnapshotCache = { key, at: Date.now(), data: payload }
        return { success: true, data: payload }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

  // ─── Python 语法检查（编辑时实时波浪线）：用与运行一致的解释器 ast.parse ──
  app.post<{ Body: { content?: string } }>(
    '/api/orchestration/scripts/python-syntax-check',
    async (request, reply): Promise<ApiResponse<{ ok: boolean; error?: { line: number; column: number; message: string } }>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        const content = String(request.body?.content ?? '')
        if (content.length > 2 * 1024 * 1024) {
          return { success: false, error: { code: 42200, message: '内容过大' } }
        }
        const py = resolvePythonInterpreter()
        if (!py) {
          return { success: false, error: { code: 50000, message: '未找到 Python 解释器（python3 / python / py -3 均不可用）' } }
        }
        const probe = spawnSync(py.cmd, [...py.runArgs, '-c', `
import ast, json, sys
src = sys.stdin.read()
try:
    ast.parse(src)
    print(json.dumps({"ok": True}))
except SyntaxError as e:
    print(json.dumps({"ok": False, "error": {"line": e.lineno or 1, "column": e.offset or 1, "message": e.msg}}))
except BaseException as e:
    print(json.dumps({"ok": False, "error": {"line": 1, "column": 1, "message": "%s: %s" % (type(e).__name__, e)}}))
`], {
          input: content,
          timeout: 5000,
          encoding: 'utf-8',
          env: pythonEnv(),
          // stdin 必须 pipe：input 内容经 stdin 传入脚本（'ignore' 会吞掉 input）
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        })
        if (probe.error || probe.status !== 0 || !probe.stdout) {
          return { success: false, error: { code: 50000, message: '语法检查失败或超时' } }
        }
        const lines = probe.stdout.split(/\r?\n/).filter(Boolean)
        let payload: { ok: boolean; error?: { line: number; column: number; message: string } } | null = null
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            payload = JSON.parse(lines[i]) as { ok: boolean; error?: { line: number; column: number; message: string } }
            break
          } catch {
            // 非 JSON 行跳过
          }
        }
        if (!payload) {
          return { success: false, error: { code: 50000, message: '语法检查无输出' } }
        }
        return { success: true, data: payload }
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
      const probe = spawnSync(shellCmd, codeArgs(codeCmd, ['--version']), { timeout: 3000, stdio: 'ignore', windowsHide: true })
      if (probe.error || probe.status !== 0) {
        return { success: false, error: { code: 50000, message: 'code 命令不可用，请确认服务端已安装 VSCode 并加入 PATH' } }
      }

      // 目录统一转绝对路径（VSCode CLI 对相对路径解析不可靠）
      const targetDir = resolve(currentScriptsDir)
      const child = spawn(shellCmd, codeArgs(codeCmd, [targetDir]), { detached: true, stdio: 'ignore', windowsHide: true })
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
  app.get<{ Params: { id: string } }>(
    '/api/orchestration/devices/:id/motion-pose',
    async (request, reply): Promise<ApiResponse<{ pose: number[] }>> => {
      try {
        await authMiddleware(request, reply)
        if (reply.sent) return reply
        const device = orchDevices.get(request.params.id)
        if (!device) return { success: false, error: { code: 40402, message: '设备不存在' } }
        const pose = orchDevices.getMotionPose(request.params.id)
        if (!pose) return { success: false, error: { code: 50000, message: 'Docat Motion 未连接' } }
        return { success: true, data: { pose } }
      } catch (err) {
        return { success: false, error: { code: 50000, message: (err as Error).message } }
      }
    }
  )

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
        const result = await runtime.run({ language, content: String(request.body.content ?? ''), fileName: String(request.body.fileName ?? 'script.js'), decimalDigits: readOrchSettings().decimalDigits })
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
