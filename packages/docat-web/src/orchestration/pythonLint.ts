/**
 * Python 实时语法检查调度 — 输入停顿后防抖请求服务端（ast.parse），
 * 丢弃过期结果。服务端不可用（mock/离线）时静默跳过，不影响编辑。
 */
import { orchPythonSyntaxCheck, type OrchPythonSyntaxCheckResult } from '../services/orchApi'

let timer: ReturnType<typeof setTimeout> | null = null
let seq = 0

/**
 * 调度一次 Python 语法检查。
 * - 空内容直接回调 ok（不请求）
 * - 停顿 delayMs 后发起请求；请求返回前若有新调度，旧结果丢弃
 * - 任何失败均回调 ok（不打扰编辑）
 */
export function schedulePythonSyntaxCheck(
  content: string,
  delayMs: number,
  onResult: (result: OrchPythonSyntaxCheckResult) => void,
): void {
  if (!content.trim()) {
    onResult({ ok: true })
    return
  }
  if (timer) clearTimeout(timer)
  const current = ++seq
  timer = setTimeout(() => {
    timer = null
    const checkSeq = current
    orchPythonSyntaxCheck(content)
      .then(res => {
        if (checkSeq !== seq) return
        onResult(res.success && res.data ? res.data : { ok: true })
      })
      .catch(() => {
        if (checkSeq === seq) onResult({ ok: true })
      })
  }, delayMs)
}

/** 取消挂起的检查（如组件卸载/切语言时） */
export function cancelPythonSyntaxCheck(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  seq++
}
