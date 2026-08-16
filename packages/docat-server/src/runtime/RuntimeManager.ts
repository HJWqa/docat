/**
 * 脚本运行时管理器 — 子进程生命周期 + JSON-lines 桥接
 *
 * JS：node runtime-js.mjs（vm 沙箱异步执行用户代码）
 * Python：python3 runtime-py.py（stdlib 顺序事件循环）
 * 单实例：运行中再次 run 会先终止旧脚本
 */
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { fileURLToPath } from 'node:url'
import { eventBus } from '../event/EventBus.js'
import type { OrchDeviceManager } from '../orchestration/OrchDeviceManager.js'

export type ScriptLanguage = 'javascript' | 'python'

export interface RunRequest {
  language: ScriptLanguage
  content: string
  fileName: string
  /** 浮点拼接小数位数（通用设置，init 时下发运行时） */
  decimalDigits?: number
}

interface OutgoingMessage {
  type: string
  [key: string]: unknown
}

/** Python 解释器候选（Windows 上 python3 常为商店空壳/缺失，需逐级回退） */
export interface PyCandidate {
  cmd: string
  /** 探测用参数（--version 等） */
  versionArgs: string[]
  /** 运行脚本时附加的参数（如 py -3 的 -3） */
  runArgs: string[]
}

const PY_CANDIDATES: PyCandidate[] = [
  { cmd: 'python3', versionArgs: ['--version'], runArgs: ['-u'] },
  { cmd: 'python', versionArgs: ['--version'], runArgs: ['-u'] },
  { cmd: 'py', versionArgs: ['-3', '--version'], runArgs: ['-3', '-u'] },
]

/** 已探测可用的 Python 解释器（缓存，避免每次运行都探测） */
let pyAvailable: PyCandidate | null | undefined

/** 用户配置的自定义 Python 命令（设置项 orch.pythonCommand，含可选参数，如 "C:\\Python311\\python.exe -u"） */
let customPythonCommand = ''

/** 切分自定义命令：命令 + 参数（支持双引号包裹的路径，如 "C:\\Program Files\\Python\\python.exe" -u） */
function parseCommandLine(cmdLine: string): { cmd: string; args: string[] } {
  const parts: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(cmdLine))) parts.push(m[1] ?? m[2] ?? m[3])
  return { cmd: parts[0] ?? '', args: parts.slice(1) }
}

/** Python 子进程环境：强制 UTF-8 模式，避免 Windows 下按 ANSI 代码页（GBK）编码导致日志乱码 */
export function pythonEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
}

/**
 * 权威探测自定义 Python 命令：用与真实运行完全一致的命令/参数/环境启动运行时 shim，
 * 检查是否发出 ready 握手。相比 `--version`，不受 launcher 语义差异影响
 * （如 py 默认版本解析失败但 py -3 可用、Store 别名等），不会误判可用命令。
 */
function probePythonShim(py: PyCandidate): { ok: boolean; reason: string } {
  const shim = fileURLToPath(new URL('./runtime-py.py', import.meta.url))
  const r = spawnSync(py.cmd, [...py.runArgs, shim], {
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 4000,
    encoding: 'utf-8',
    env: pythonEnv(),
    windowsHide: true,
  })
  if (r.error) return { ok: false, reason: r.error.message }
  if (r.status !== 0) return { ok: false, reason: `退出码 ${r.status ?? r.signal ?? 'unknown'}` }
  if (!r.stdout?.includes('"ready"')) return { ok: false, reason: '运行时未返回 ready' }
  return { ok: true, reason: '' }
}

/**
 * 解析 Windows py 启动器背后的真实解释器路径。
 * py.exe 会再派生子进程 python.exe（CREATE_NO_WINDOW 不向下传递），
 * 该孙进程作为控制台程序无控制台可继承时会弹出可见命令提示符窗口；
 * 直接解析出 sys.executable 后用 python.exe 本体运行即可避免。
 */
function resolvePyExecutable(py: PyCandidate): PyCandidate {
  if (process.platform !== 'win32' || py.cmd !== 'py') return py
  const r = spawnSync(py.cmd, [...py.runArgs, '-c', 'import sys; print(sys.executable)'], {
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 5000,
    encoding: 'utf-8',
    env: pythonEnv(),
    windowsHide: true,
  })
  const exe = r.status === 0 ? String(r.stdout ?? '').trim().split(/\r?\n/)[0] : ''
  if (!exe) return py
  // 已定位真实解释器，丢弃启动器专用版本参数（如 -3 / -3.12），保留解释器参数
  const args = py.runArgs.filter(a => !/^-3(\.\d+)?$/.test(a))
  return { cmd: exe, versionArgs: [], runArgs: args.length ? args : ['-u'] }
}

/**
 * 解析可用的 Python 解释器（平台自适应，结果缓存）：
 * 优先使用自定义命令（orch.pythonCommand，shim 权威探测），探测失败回退自动候选并回调告警。
 * 运行器与 module-members 探测共用，保证两端解释器一致。
 */
export function resolvePythonInterpreter(onFallbackWarn?: (msg: string) => void): PyCandidate | null {
  if (pyAvailable !== undefined) return pyAvailable

  if (customPythonCommand) {
    const { cmd, args } = parseCommandLine(customPythonCommand)
    const candidate: PyCandidate = { cmd, versionArgs: [...args, '--version'], runArgs: [...args, '-u'] }
    const probe = cmd ? probePythonShim(candidate) : { ok: false, reason: '命令为空' }
    if (probe.ok) {
      pyAvailable = resolvePyExecutable(candidate)
      return pyAvailable
    }
    pyAvailable = null
    onFallbackWarn?.(`自定义 Python 命令不可用（${customPythonCommand}）：${probe.reason}，已回退自动探测 python3 / python / py -3`)
  }

  if (pyAvailable === null || pyAvailable === undefined) {
    pyAvailable = null
    const candidates = process.platform === 'win32' ? PY_CANDIDATES : PY_CANDIDATES.slice(0, 1)
    for (const c of candidates) {
      try {
        const r = spawnSync(c.cmd, c.versionArgs, { stdio: 'ignore', timeout: 5000, env: pythonEnv(), windowsHide: true })
        if (!r.error && r.status === 0) {
          pyAvailable = resolvePyExecutable(c)
          break
        }
      } catch {
        // 继续下一个候选
      }
    }
  }
  return pyAvailable
}

export class RuntimeManager {
  private manager: OrchDeviceManager
  private child: ChildProcessWithoutNullStreams | null = null
  private language: ScriptLanguage = 'javascript'
  private fileName = ''
  private pendingContent = ''
  private buffer = ''
  private stoppedByUser = false
  private failTimer: ReturnType<typeof setTimeout> | null = null
  /** 启动阶段（ready 前）子进程 stdout 缓冲，超时诊断用 */
  private startupOutput = ''
  /** 脚本 require 的解析基准目录（服务端脚本目录，可被「通用」设置修改） */
  private requireBase = ''
  /** 浮点拼接小数位数（「通用」设置，init 时下发运行时） */
  private decimalDigits = 6

  constructor(manager: OrchDeviceManager) {
    this.manager = manager
  }

  /** 设置脚本 require 基准目录（脚本目录变更时同步更新） */
  setRequireBase(dir: string) {
    this.requireBase = dir
  }

  get running(): boolean {
    return this.child !== null
  }

  /** 当前运行的脚本文件名（供 WS 连接建立时推送状态快照） */
  get scriptFileName(): string {
    return this.fileName
  }

  private broadcastScriptStatus() {
    eventBus.emit('orch:event', {
      event: 'script-status',
      running: this.running,
      fileName: this.running ? this.fileName : '',
      timestamp: Date.now(),
    })
  }

  private shimPath(language: ScriptLanguage): string {
    const base = fileURLToPath(new URL('.', import.meta.url))
    return `${base}runtime-${language === 'python' ? 'py.py' : 'js.mjs'}`
  }

  /** 设置自定义 Python 命令（设置变更时调用；清空探测缓存使配置即时生效） */
  setPythonCommand(cmd: string) {
    const next = String(cmd ?? '').trim()
    if (next === customPythonCommand) return
    customPythonCommand = next
    pyAvailable = undefined
  }

  /** 探测可用的 Python 解释器（自定义命令优先，失败回退自动候选并告警） */
  private resolvePython(): PyCandidate | null {
    return resolvePythonInterpreter((msg) => this.broadcastLog('error', msg))
  }

  private sendToChild(msg: OutgoingMessage) {
    if (!this.child) return
    try {
      this.child.stdin.write(`${JSON.stringify(msg)}\n`)
    } catch {
      // 子进程可能已退出
    }
  }

  private broadcastLog(level: string, text: string, line?: number, column?: number) {
    const payload: Record<string, unknown> = { event: 'log', deviceName: '脚本', direction: level === 'error' ? 'error' : 'script', text, timestamp: Date.now() }
    if (line !== undefined) payload.line = line
    if (column !== undefined) payload.column = column
    eventBus.emit('orch:event', payload)
  }

  async run(req: RunRequest): Promise<{ ok: boolean; error?: string }> {
    await this.stop()
    this.stoppedByUser = false
    this.language = req.language
    this.fileName = req.fileName
    this.pendingContent = req.content
    this.startupOutput = ''
    this.decimalDigits = Number.isFinite(Number(req.decimalDigits)) ? Math.min(12, Math.max(0, Math.floor(Number(req.decimalDigits)))) : 6

    let child: ChildProcessWithoutNullStreams
    try {
      if (req.language === 'python') {
        const py = this.resolvePython()
        if (!py) {
          return { ok: false, error: '未找到 Python 解释器（python3 / python / py -3 均不可用），请安装 Python 并加入 PATH 后重试' }
        }
        // env 强制 UTF-8（避免 Windows GBK 管道编码导致日志乱码）
        // Windows：detached=true 时 CREATE_NO_WINDOW 被忽略（MSDN 二者互斥），子进程无控制台，
        // 其派生的孙进程（如 py.exe → python.exe）会新建可见控制台窗口弹窗；
        // 去掉 detached 后子进程获得隐藏控制台，孙进程继承之不再弹窗；taskkill /T 不需要 detached
        // POSIX：需 detached 以便 process.kill(-pid) 杀整个进程组
        child = spawn(
          py.cmd,
          [...py.runArgs, this.shimPath('python')],
          { stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true, env: pythonEnv() },
        )
      } else {
        child = spawn(process.execPath, [this.shimPath('javascript')], {
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: process.platform !== 'win32',
          windowsHide: true,
        })
      }
    } catch (err) {
      return { ok: false, error: `启动失败：${(err as Error).message}` }
    }

    this.failTimer = setTimeout(() => {
      // 10s 内未 ready 视为启动失败（正常路径 <1s；慢盘/杀软环境下留足余量）
      this.failTimer = null
      this.killChild()
      const out = this.startupOutput.trim().slice(-500)
      this.broadcastLog('error', out ? `脚本启动超时（子进程输出：${out}）` : '脚本启动超时')
    }, 10000)

    // StringDecoder 处理跨 chunk 的多字节字符，避免 UTF-8 字符被截断产生乱码（�）
    const stdoutDecoder = new StringDecoder('utf-8')
    const stderrDecoder = new StringDecoder('utf-8')

    child.stdout.on('data', (chunk: Buffer) => {
      if (this.startupOutput.length < 4000) this.startupOutput += chunk.toString('utf8')
      this.buffer += stdoutDecoder.write(chunk)
      let idx: number
      while ((idx = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, idx)
        this.buffer = this.buffer.slice(idx + 1)
        if (line.trim()) this.handleChildMessage(line)
      }
    })

    let stderrBuffer = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuffer += stderrDecoder.write(chunk)
      let idx: number
      while ((idx = stderrBuffer.indexOf('\n')) >= 0) {
        const line = stderrBuffer.slice(0, idx).trim()
        stderrBuffer = stderrBuffer.slice(idx + 1)
        if (line) this.broadcastLog('error', line)
      }
    })

    child.on('error', (err) => {
      this.clearFailTimer()
      this.broadcastLog('error', `启动失败：${err.message}`)
      this.child = null
      this.manager.setRuntimeBridge(null)
      this.broadcastScriptStatus()
    })

    child.on('exit', (code) => {
      this.clearFailTimer()
      // 冲刷剩余缓冲（无换行结尾的尾部输出）
      const stdoutRest = this.buffer + stdoutDecoder.end()
      if (stdoutRest.trim()) this.handleChildMessage(stdoutRest.trim())
      const stderrRest = (stderrBuffer + stderrDecoder.end()).trim()
      if (stderrRest) this.broadcastLog('error', stderrRest)
      this.child = null
      this.manager.setRuntimeBridge(null)
      if (!this.stoppedByUser) {
        if (code === 0) this.broadcastLog('info', '脚本已结束')
        else this.broadcastLog('error', `脚本进程异常退出（code ${code ?? 'null'}）`)
      }
      this.broadcastScriptStatus()
    })

    // 设备消息/状态/姿态 → 脚本子进程
    this.manager.setRuntimeBridge({
      onDeviceMessage: (name, text) => this.sendToChild({ type: 'message', device: name, text }),
      onDeviceStatus: (name, connected) => this.sendToChild({ type: 'device-status', name, connected }),
      onPosesChanged: () => this.pushPoses(),
    })

    this.child = child
    this.broadcastScriptStatus()
    return { ok: true }
  }

  private handleChildMessage(line: string) {
    let msg: OutgoingMessage
    try {
      msg = JSON.parse(line)
    } catch {
      this.broadcastLog('error', `子进程输出非 JSON：${line.slice(0, 200)}`)
      return
    }
    switch (msg.type) {
      case 'ready': {
        this.clearFailTimer()
        this.startupOutput = ''
        // 推送姿态/设备快照 + 脚本内容（init 先于 script，子进程按序处理）
        this.sendToChild({ type: 'init', poses: this.manager.listPoses(), devices: this.manager.list().map(d => ({ name: d.name, connected: d.connected })), requireBase: this.requireBase || undefined, decimalDigits: this.decimalDigits })
        this.sendToChild({ type: 'script', content: this.pendingContent })
        this.broadcastLog('info', `脚本已启动（${this.fileName}）`)
        break
      }
      case 'send': {
        const device = String(msg.device ?? '')
        const text = String(msg.text ?? '')
        if (!device) break
        this.manager.sendByName(device, text)
        break
      }
      case 'log': {
        const level = String(msg.level ?? 'info')
        const line = typeof msg.line === 'number' ? msg.line : undefined
        const column = typeof msg.column === 'number' ? msg.column : undefined
        this.broadcastLog(level, String(msg.text ?? ''), line, column)
        break
      }
    }
  }

  /** 推送姿态快照（脚本侧本地副本更新） */
  pushPoses() {
    this.sendToChild({ type: 'poses', poses: this.manager.listPoses() })
  }

  private clearFailTimer() {
    if (this.failTimer) {
      clearTimeout(this.failTimer)
      this.failTimer = null
    }
  }

  private killChild() {
    const child = this.child
    this.child = null
    if (!child || child.exitCode !== null) return
    let done = false
    try {
      if (process.platform === 'win32') {
        // Windows 无进程组：taskkill /T 杀整棵进程树（含脚本再派生的子进程）
        const r = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
        done = !r.error && r.status === 0
      } else {
        // POSIX：杀掉整个进程组（含 setInterval 等子进程）
        process.kill(-child.pid!, 'SIGKILL')
        done = true
      }
    } catch {
      done = false
    }
    if (!done) {
      try {
        child.kill('SIGKILL')
      } catch {
        // ignore
      }
    }
  }

  async stop(): Promise<void> {
    if (!this.child) return
    this.stoppedByUser = true
    this.killChild()
    this.manager.setRuntimeBridge(null)
    this.broadcastLog('info', '脚本已终止')
    this.broadcastScriptStatus()
    // 等子进程退出事件处理完成
    await new Promise(r => setTimeout(r, 50))
  }
}
