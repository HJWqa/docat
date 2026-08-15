/**
 * Monaco web worker 统一分发 — 编辑器基础 worker + TS/JS 语言服务 worker。
 *
 * 两个编辑器视图（编排脚本面板 / 编程视图）共用本模块，避免各自覆盖
 * self.MonacoEnvironment 导致 worker 配置互相失效（如编程视图覆盖掉 TS worker）。
 */
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import TsWorker from 'monaco-editor/languages/features/typescript/ts.worker?worker'

type MonacoEnv = {
  globalAPI?: boolean
  getWorker?(workerId: string, label: string): Worker | Promise<Worker>
}

const workerScope = self as unknown as { MonacoEnvironment?: MonacoEnv }

let configured = false

/** 设置 Monaco 环境（幂等）：TS/JS 模型走 TS worker，其余走编辑器 worker */
export function setupMonacoWorkers() {
  if (configured || workerScope.MonacoEnvironment) return
  configured = true
  workerScope.MonacoEnvironment = {
    getWorker(_workerId, label) {
      if (label === 'typescript' || label === 'javascript') return new TsWorker()
      return new EditorWorker()
    },
  }
}
