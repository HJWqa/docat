/**
 * 脚本运行状态 Store — 跨页面共享设备运行状态
 * 运行光标/日志来自设备 TCP 反馈（端口 65501-65525），经 WS 推送；
 * "是否在运行"以设备 /debugger/state 为准（value === 'run'），
 * WS 订阅在模块级注册，页面切换不丢失；任何页面都能感知"脚本是否在运行"。
 */
import { reactive } from 'vue'
import { wsClient } from '../services/ws'
import { debuggerState } from '../services/api'

export type RuntimeLevel = 'client' | 'special' | 'popup' | 'error'

export interface RuntimeLogEntry {
  id: number
  time: string
  level: RuntimeLevel
  text: string
}

export interface DeviceRuntimeState {
  /** 脚本是否在运行（设备 /debugger/state 权威） */
  running: boolean
  /** 设备当前运行的项目名（/debugger/state 的 prjname） */
  runningProject: string | null
  /** 当前执行的文件名（如 main.lua） */
  fileName: string | null
  /** 当前执行行号 */
  line: number
  cursorText: string
  logs: RuntimeLogEntry[]
}

export const runtimeStore = reactive({
  /** deviceId → 运行时状态 */
  states: {} as Record<string, DeviceRuntimeState>,

  getState(deviceId: string): DeviceRuntimeState {
    let state = this.states[deviceId]
    if (!state) {
      // 必须用 reactive() 创建并返回同一个代理，
      // 否则首次调用返回普通对象，后续修改不触发 Vue 响应（日志/光标 UI 不更新）
      state = reactive({ running: false, runningProject: null, fileName: null, line: 0, cursorText: '', logs: [] })
      this.states[deviceId] = state
    }
    return state
  },

  setRunning(deviceId: string, running: boolean) {
    this.getState(deviceId).running = running
  },

  /**
   * 向设备查询运行状态（GET /debugger/state → { value, prjname }）
   * value === 'run' → 脚本运行中；prjname → 当前运行的项目名
   * 刷新/换机登录/切换设备时调用，运行状态以设备为准
   */
  async syncFromDevice(deviceId: string): Promise<void> {
    try {
      const res = await debuggerState(deviceId)
      if (!res.success || !res.data) return
      const st = res.data as { value?: string; prjname?: string }
      const s = this.getState(deviceId)
      s.running = st.value === 'run'
      if (st.prjname) s.runningProject = st.prjname
    } catch {
      // 设备不可达时保持现状
    }
  },

  /** 清空执行行（保留运行标记与日志） */
  clearLine(deviceId: string) {
    const s = this.getState(deviceId)
    s.line = 0
    s.fileName = null
  },

  /** 全部重置（新开项目/切换设备时） */
  reset(deviceId: string) {
    const s = this.getState(deviceId)
    s.running = false
    s.runningProject = null
    s.fileName = null
    s.line = 0
    s.cursorText = ''
    s.logs = []
  },

  /** 追加一条日志（本地动作/模拟模式用） */
  addLog(deviceId: string, level: RuntimeLevel, text: string) {
    const s = this.getState(deviceId)
    s.logs = [...s.logs.slice(-199), {
      id: ++logId,
      time: new Date().toISOString(),
      level,
      text,
    }]
  },
})

// ─── WS 订阅（页面切换不丢失；destroy 后可重新注册）──

let logId = 0

const FINISH_PATTERN = /(?:\.py:finish|\.lua:finish|:finish\b|script executed|script finished|执行完成|运行完成|程序结束|\bdone\b)/i

export function isRuntimeFinishText(text: string): boolean {
  return FINISH_PATTERN.test(text)
}

export function parseRuntimeCursor(payload: unknown): { fileName?: string; line?: number; text: string } {
  const data = typeof payload === 'object' && payload
    ? String((payload as { data?: string }).data ?? '')
    : String(payload ?? '')
  const text = data.trim()
  if (!text) return { text }

  try {
    const json = JSON.parse(text) as Record<string, unknown>
    const fileName = typeof json.file === 'string' ? json.file : typeof json.thread === 'string' ? json.thread : undefined
    const line = Number(json.line ?? json.progress)
    return { fileName, line: Number.isFinite(line) && line > 0 ? line : undefined, text }
  } catch {
    // raw controller message
  }

  // file:line 可出现在文本任意位置（设备可能带前缀/一次推送多个位置）
  // 取最后一个匹配作为当前执行位置（参考实现同：progress 取最后）
  const matches = [...text.matchAll(/([^/\s:]+\.(?:lua|py)):(\d+)/g)]
  if (matches.length) {
    const m = matches[matches.length - 1]
    return { fileName: m[1], line: Number(m[2]), text: m[0] }
  }

  const numberMatch = /^(\d+)$/.exec(text) || /(?:line|Line|行)\s*[:：]?\s*(\d+)/.exec(text)
  if (numberMatch) return { line: Number(numberMatch[1]), text }

  return { text }
}

// ─── WS 订阅（页面切换不丢失；destroy 后可重新注册）──

function handleRuntimeLog(deviceId: string, payload: unknown) {
  const s = runtimeStore.getState(deviceId)
  const message = (typeof payload === 'object' && payload ? payload : {}) as { data?: string; level?: string; timestamp?: number }
  const rawText = String(message.data ?? '').trim()
  if (!rawText) return

  const isError = /(?:ERROR|ALARM|error|Traceback|Exception)/.test(rawText)
  s.logs = [...s.logs.slice(-199), {
    id: ++logId,
    time: new Date(message.timestamp ?? Date.now()).toISOString(),
    level: isError ? 'error' : (message.level as RuntimeLevel | undefined) ?? 'client',
    text: rawText,
  }]

  if (isRuntimeFinishText(rawText)) {
    s.running = false
    s.line = 0
    s.cursorText = '已完成'
    return
  }

  // 日志里的 file:line 也驱动执行行（如 src1.lua:12）
  const fileMatch = /([^/\s:]+\.(?:lua|py)):(\d+)/.exec(rawText)
  if (fileMatch) {
    const line = Number(fileMatch[2])
    if (Number.isFinite(line) && line > 0) {
      s.fileName = fileMatch[1]
      s.line = line
    }
  }
}

function handleRuntimeCursor(deviceId: string, payload: unknown) {
  const s = runtimeStore.getState(deviceId)
  const cursor = parseRuntimeCursor(payload)
  // finish 检测用原始文本（cursor.text 已被截断为单个位置）
  const rawCursorText = String((payload as { data?: string }).data ?? '').trim()
  if (isRuntimeFinishText(rawCursorText)) {
    s.running = false
    s.line = 0
    s.cursorText = '已完成'
    return
  }
  s.cursorText = cursor.text || (cursor.line ? `第 ${cursor.line} 行` : '')
  if (cursor.fileName) s.fileName = cursor.fileName
  if (cursor.line) s.line = cursor.line
}

// ─── 注册 / 注销 ──────────────────────────────────
// 注销时 wsClient.destroy() 会清空 handler 数组；
// 再次登录后调用 initRuntimeStore() 会先摘除旧引用（无害）再重新注册。

let unsubRuntimeLog: (() => void) | null = null
let unsubRuntimeCursor: (() => void) | null = null

export function initRuntimeStore() {
  unsubRuntimeLog?.()
  unsubRuntimeCursor?.()
  unsubRuntimeLog = wsClient.onRuntimeLog(handleRuntimeLog)
  unsubRuntimeCursor = wsClient.onRuntimeCursor(handleRuntimeCursor)
}

initRuntimeStore()
