/**
 * 脚本运行时管理器 — 子进程生命周期 + JSON-lines 桥接
 *
 * JS：node runtime-js.mjs（vm 沙箱异步执行用户代码）
 * Python：python3 runtime-py.py（stdlib 顺序事件循环）
 * 单实例：运行中再次 run 会先终止旧脚本
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { eventBus } from '../event/EventBus.js'
import type { OrchDeviceManager } from '../orchestration/OrchDeviceManager.js'

export type ScriptLanguage = 'javascript' | 'python'

export interface RunRequest {
  language: ScriptLanguage
  content: string
  fileName: string
}

interface OutgoingMessage {
  type: string
  [key: string]: unknown
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

  constructor(manager: OrchDeviceManager) {
    this.manager = manager
  }

  get running(): boolean {
    return this.child !== null
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

  private sendToChild(msg: OutgoingMessage) {
    if (!this.child) return
    try {
      this.child.stdin.write(`${JSON.stringify(msg)}\n`)
    } catch {
      // 子进程可能已退出
    }
  }

  private broadcastLog(level: string, text: string) {
    eventBus.emit('orch:event', { event: 'log', deviceName: '脚本', direction: level === 'error' ? 'error' : 'script', text, timestamp: Date.now() })
  }

  async run(req: RunRequest): Promise<{ ok: boolean; error?: string }> {
    await this.stop()
    this.stoppedByUser = false
    this.language = req.language
    this.fileName = req.fileName
    this.pendingContent = req.content

    let child: ChildProcessWithoutNullStreams
    try {
      if (req.language === 'python') {
        child = spawn('python3', [this.shimPath('python')], { stdio: ['pipe', 'pipe', 'pipe'], detached: true })
      } else {
        child = spawn(process.execPath, [this.shimPath('javascript')], { stdio: ['pipe', 'pipe', 'pipe'], detached: true })
      }
    } catch (err) {
      return { ok: false, error: `启动失败：${(err as Error).message}` }
    }

    this.failTimer = setTimeout(() => {
      // 3s 内未 ready 视为启动失败
      this.failTimer = null
      this.killChild()
      this.broadcastLog('error', '脚本启动超时')
    }, 3000)

    child.stdout.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf-8')
      let idx: number
      while ((idx = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, idx)
        this.buffer = this.buffer.slice(idx + 1)
        if (line.trim()) this.handleChildMessage(line)
      }
    })

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8').trim()
      if (text) this.broadcastLog('error', text)
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
        // 推送姿态/设备快照 + 脚本内容（init 先于 script，子进程按序处理）
        this.sendToChild({ type: 'init', poses: this.manager.listPoses(), devices: this.manager.list().map(d => ({ name: d.name, connected: d.connected })) })
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
        this.broadcastLog(level, String(msg.text ?? ''))
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
    try {
      // 杀掉整个进程组（含 setInterval 等子进程）
      process.kill(-child.pid!, 'SIGKILL')
    } catch {
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
