/**
 * 编排服务层 — 脚本运行器 + 本地文件跟随
 *
 * 双模式：
 *  - mock（?mock=1）：浏览器内 JS 模拟运行（演示用）。
 *  - 真实模式：脚本交给 docat-server 后端运行器（Node 跑 JS / python3 子进程），
 *    日志与运行状态经 WS（orch-event）推送。
 */
import { addLog, buildScriptContext, isOrchMockMode, type ScriptContext } from '../stores/orchestrationStore'
import { orchScriptRun, orchScriptStop } from './orchApi'

export interface ScriptRunHandle {
  stop: () => void
}

const STOP_SENTINEL = Symbol('docat-script-stop')

/**
 * 运行脚本。
 * mock：浏览器内运行（沙箱上下文 docat），async/await + 终止感知 sleep；
 * 真实：提交后端运行器执行。
 */
export async function runScript(
  code: string,
  info: { fileName: string; language: 'javascript' | 'python' },
  onDone?: (ok: boolean, message: string) => void
): Promise<ScriptRunHandle> {
  if (!isOrchMockMode()) {
    addLog('脚本', 'system', `提交后端运行 ${info.fileName}`)
    const res = await orchScriptRun({ language: info.language, content: code, fileName: info.fileName })
    if (!res.success) {
      addLog('脚本', 'error', `启动失败：${res.error?.message ?? '未知错误'}`)
      onDone?.(false, res.error?.message ?? '启动失败')
      return { stop: () => void orchScriptStop() }
    }
    return { stop: () => void orchScriptStop() }
  }

  scriptRunState.running = true
  scriptRunState.startedAt = Date.now()
  addLog('脚本', 'system', '脚本已启动')
  const handle = runJsScript(code, (ok, message) => {
    scriptRunState.running = false
    if (!ok && message !== '已终止') addLog('脚本', 'system', `脚本结束（${message}）`)
    onDone?.(ok, message)
  })
  return {
    stop: () => {
      handle.stop()
      scriptRunState.running = false
    },
  }
}

/**
 * 运行 JS 脚本（沙箱上下文：docat）。
 * 脚本内可使用 async/await；调用 utils.sleep 时终止会立即生效。
 */

/**
 * 从浏览器错误对象解析用户代码行号（包装偏移 2：第 1 行包裹、第 2 行 "use strict"）
 */
function extractScriptErrorLine(err: unknown): { line?: number; column?: number } {
  const e = err as { lineNumber?: number; columnNumber?: number; stack?: string }
  if (Number.isInteger(e.lineNumber)) {
    return {
      line: Math.max(1, (e.lineNumber as number) - 2),
      column: Number.isInteger(e.columnNumber) ? (e.columnNumber as number) : undefined,
    }
  }
  // 兜底：从 stack 解析 "<anonymous>:N" 或 "at <anonymous> (…:N:M)"
  const sm = /(?:<anonymous>|eval(?:machine)?)[^:\n]*:(\d+)(?::(\d+))?/.exec(e.stack || '')
  if (sm) {
    return {
      line: Math.max(1, Number(sm[1]) - 2),
      column: sm[2] ? Number(sm[2]) : undefined,
    }
  }
  return {}
}

export function runJsScript(code: string, onDone?: (ok: boolean, message: string) => void): ScriptRunHandle {
  let stopped = false
  const ctx: ScriptContext & { __stopped?: boolean } = buildScriptContext()

  // 终止感知的 sleep：脚本终止后立即停止等待
  const origSleep = ctx.utils.sleep
  ctx.utils.sleep = (ms: number) =>
    new Promise((resolve, reject) => {
      if (stopped) { reject(STOP_SENTINEL); return }
      const t = setTimeout(() => {
        if (stopped) reject(STOP_SENTINEL)
        else resolve()
      }, ms)
      const iv = setInterval(() => {
        if (stopped) {
          clearTimeout(t)
          clearInterval(iv)
          reject(STOP_SENTINEL)
        }
      }, 50)
    })

  const stop = () => {
    if (stopped) return
    stopped = true
    ctx.__stopped = true
  }

  const body = `(async () => {\n"use strict";\n${code}\n})()`
  let fn: (c: ScriptContext) => Promise<unknown>
  try {
    fn = new Function('docat', `return ${body}`) as (c: ScriptContext) => Promise<unknown>
  } catch (err) {
    const { line, column } = extractScriptErrorLine(err)
    const lineText = line !== undefined ? `（第 ${line} 行${column !== undefined ? `，第 ${column} 列` : ''}）` : ''
    addLog('脚本', 'error', `脚本编译失败：${(err as Error).message}${lineText}`, line, column)
    onDone?.(false, (err as Error).message)
    return { stop }
  }

  Promise.resolve()
    .then(() => fn(ctx))
    .then(
      () => {
        if (!stopped) { addLog('脚本', 'script', '脚本运行结束') }
        onDone?.(true, stopped ? '已终止' : '运行结束')
      },
      (err: unknown) => {
        if (err === STOP_SENTINEL || (err instanceof Error && err.message === 'docat-script-stop')) {
          addLog('脚本', 'system', '脚本已终止')
          onDone?.(false, '已终止')
          return
        }
        const { line, column } = extractScriptErrorLine(err)
        const lineText = line !== undefined ? `（第 ${line} 行${column !== undefined ? `，第 ${column} 列` : ''}）` : ''
        addLog('脚本', 'error', `脚本异常：${err instanceof Error ? err.message : String(err)}${lineText}`, line, column)
        onDone?.(false, err instanceof Error ? err.message : String(err))
      }
    )

  return { stop }
}

/** 脚本运行状态（供 ScriptPanel 展示） */
export const scriptRunState = {
  running: false,
  startedAt: 0,
}

export function isScriptRunning(): boolean {
  return scriptRunState.running
}

/** 本地文件选择 + 跟随（File System Access API；不支持时降级为一次性读取） */
export interface PickedScriptFile {
  name: string
  read: () => Promise<string>
  /** 文件句柄（支持轮询 lastModified） */
  handle?: FileSystemFileHandle
  lastModified?: number
}

export async function pickScriptFile(): Promise<PickedScriptFile | null> {
  const picker = (window as unknown as { showOpenFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker
  if (typeof picker === 'function') {
    try {
      const [handle] = await picker.call(window, {
        types: [
          {
            description: '脚本文件',
            accept: { 'text/javascript': ['.js', '.mjs', '.cjs', '.py'] },
          },
        ],
      })
      if (!handle) return null
      return {
        name: handle.name,
        handle,
        lastModified: await getFileLastModified(handle),
        read: async () => (await handle.getFile()).text(),
      }
    } catch {
      // 用户取消或 API 受限 → 降级 input
    }
  }
  return null
}

async function getFileLastModified(handle: FileSystemFileHandle): Promise<number> {
  try {
    const file = await handle.getFile()
    return file.lastModified
  } catch {
    return 0
  }
}

/** 轮询文件变更：文件修改时间变化时触发回调 */
export function watchScriptFile(
  handle: FileSystemFileHandle,
  interval = 1500,
  onChange: (content: string, lastModified: number) => void
): () => void {
  let lastModified = 0
  let timer: ReturnType<typeof setInterval> | null = null

  void getFileLastModified(handle).then(v => { lastModified = v })

  const poll = async () => {
    try {
      const file = await handle.getFile()
      if (file.lastModified !== lastModified) {
        lastModified = file.lastModified
        onChange(await file.text(), file.lastModified)
      }
    } catch {
      // 文件不可读时静默
    }
  }

  timer = setInterval(() => void poll(), interval)
  return () => {
    if (timer) clearInterval(timer)
    timer = null
  }
}
