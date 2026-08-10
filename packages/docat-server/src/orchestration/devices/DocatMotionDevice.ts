/**
 * Docat Motion 编排设备 — 模拟 /home/bzsc/dobot-docs/scripts/pick_place_tcp.py
 *
 * 协议（与 pick_place_tcp.py 一致，命令大小写不敏感，行尾分号可省略）：
 *   GP;抓(6);放(6)[;停靠(6)]   → GP;received; → 执行 → GP;reached;
 *   MovJ;x;y;z;Rx;Ry;Rz        → MovJ;received; → 执行 → MovJ;reached;
 *   MovL;... 同上（直线）
 *   Suck;1|0                   → Suck;received; → 执行 → Suck;reached;
 *   格式错误                    → {header};error;
 *
 * 运动转发：目标真实设备已连接时经 manager 注入的 forwarder 执行
 * （moveCartesian / controlDobotES01），否则内部模拟姿态与延时。
 */
import type { OrchDeviceBackend } from './DeviceBackend.js'

export interface DocatMotionEvents {
  /** 协议应答/系统信息（作为设备发来的消息） */
  onIncoming: (text: string) => void
  onError: (message: string) => void
  /** 转发运动到被模拟的真实设备；返回是否成功 */
  forwardMove: (pose: number[]) => Promise<boolean>
  /** 转发吸盘；on=true 吸取 */
  forwardSuck: (on: boolean) => Promise<boolean>
  /** 心跳应答内容（通用设置可配置） */
  getPong: () => string
}

interface MotionState {
  pose: number[]
  suction: boolean
}

export class DocatMotionDevice implements OrchDeviceBackend {
  readonly id: string
  private events: DocatMotionEvents
  private state: MotionState = { pose: [0, 0, 0, 0, 0, 0], suction: false }

  constructor(id: string, events: DocatMotionEvents) {
    this.id = id
    this.events = events
  }

  connect(): Promise<{ ok: boolean; error?: string }> {
    this.state = { pose: [0, 0, 0, 0, 0, 0], suction: false }
    return Promise.resolve({ ok: true })
  }

  async disconnect(): Promise<void> {
    // 无连接，无需处理
  }

  async send(text: string): Promise<boolean> {
    void this.handleCommand(text)
    return true
  }

  dispose(): void {
    // 无资源
  }

  // ─── 协议处理 ──────────────────────────────────────

  private splitFields(text: string): string[] {
    const t = String(text).replace(/\r/g, '').replace(/\n/g, '').trim()
    if (!t) return []
    const parts = t.split(';').map(p => p.trim())
    while (parts.length && parts[0] === '') parts.shift()
    while (parts.length && parts[parts.length - 1] === '') parts.pop()
    return parts
  }

  private parseFloats(items: string[]): number[] | null {
    const out: number[] = []
    for (const item of items) {
      const v = Number(item)
      if (!Number.isFinite(v)) return null
      out.push(v)
    }
    return out
  }

  private reply(header: string, status: 'received' | 'reached' | 'error') {
    this.events.onIncoming(`${header};${status};`)
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms))
  }

  private async moveTo(pose: number[]) {
    const ok = await this.events.forwardMove(pose)
    if (!ok) await this.sleep(400)
    this.state.pose = [...pose]
  }

  private async handleCommand(raw: string) {
    const parts = this.splitFields(raw)
    if (!parts.length) return
    const header = parts[0]
    const cmd = header.toUpperCase()
    const args = parts.slice(1)
    const reply = (status: 'received' | 'reached' | 'error') => this.reply(header, status)

    // 心跳：ping → pong（内容取自通用设置）
    if (cmd === 'PING') {
      this.events.onIncoming(this.events.getPong())
      return
    }

    const parsePose = (items: string[]): number[] | null => {
      const values = this.parseFloats(items)
      return values && values.length >= 6 ? values.slice(0, 6) : null
    }

    if (cmd === 'GP') {
      if (args.length < 12 || args.length % 6 !== 0) { reply('error'); return }
      const values = this.parseFloats(args)
      if (!values) { reply('error'); return }
      const poses: number[][] = []
      for (let i = 0; i < values.length; i += 6) poses.push(values.slice(i, i + 6))
      if (poses.length < 2) { reply('error'); return }

      reply('received')
      this.events.onIncoming(`GP 取放开始 抓(${poses[0].slice(0, 3).join(',')}) 放(${poses[1].slice(0, 3).join(',')})`)
      const above = (p: number[]) => [p[0], p[1], p[2] + 80, p[3], p[4], p[5]]
      await this.moveTo(above(poses[0]))
      await this.moveTo(poses[0])
      this.state.suction = true
      this.events.onIncoming('吸盘 开')
      await this.events.forwardSuck(true)
      await this.sleep(200)
      await this.moveTo(above(poses[0]))
      await this.moveTo(above(poses[1]))
      await this.moveTo(poses[1])
      this.state.suction = false
      this.events.onIncoming('吸盘 关')
      await this.events.forwardSuck(false)
      await this.sleep(200)
      await this.moveTo(above(poses[1]))
      if (poses.length >= 3) await this.moveTo(poses[2])
      this.events.onIncoming(`GP 完成 当前位姿 (${this.state.pose.map(v => Number(v).toFixed(1)).join(', ')})`)
      reply('reached')
      return
    }

    if (cmd === 'MOVJ' || cmd === 'MOVL') {
      const pose = parsePose(args)
      if (!pose) { reply('error'); return }
      reply('received')
      this.events.onIncoming(`执行 ${cmd} → (${pose.map(v => Number(v).toFixed(1)).join(', ')})`)
      await this.moveTo(pose)
      reply('reached')
      return
    }

    if (cmd === 'SUCK') {
      if (!args.length) { reply('error'); return }
      const v = String(args[0]).toLowerCase()
      let on: boolean
      if (['1', 'on', 'true', 'open'].includes(v)) on = true
      else if (['0', 'off', 'false', 'close'].includes(v)) on = false
      else {
        const n = Number(v)
        if (!Number.isFinite(n)) { reply('error'); return }
        on = n !== 0
      }
      reply('received')
      this.state.suction = on
      this.events.onIncoming(`吸盘 ${on ? '开' : '关'}`)
      await this.events.forwardSuck(on)
      await this.sleep(200)
      reply('reached')
      return
    }

    reply('error')
  }
}
