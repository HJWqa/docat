/**
 * WebSocket 客户端 — 订阅设备实时状态
 * 多监听器模式：每个 onX 返回 unsubscribe 函数，页面间互不覆盖
 */
import type { DeviceState, WSMessage } from 'docat-shared/types'
import { getToken } from './api'
import { getWsUrl } from './runtime'

type StateHandler = (deviceId: string, state: DeviceState) => void
type AlarmHandler = (deviceId: string, alarm: unknown) => void
type OnlineHandler = (deviceId: string) => void
type OfflineHandler = (deviceId: string) => void
type RuntimeLogHandler = (deviceId: string, data: unknown) => void
type RuntimeCursorHandler = (deviceId: string, data: unknown) => void
type DeviceErrorHandler = (deviceId: string, data: unknown) => void
type OrchEventHandler = (data: unknown) => void
type Unsubscribe = () => void

type HandlerMap = {
  state: StateHandler[]
  alarm: AlarmHandler[]
  'device-online': OnlineHandler[]
  'device-offline': OfflineHandler[]
  'runtime-log': RuntimeLogHandler[]
  'runtime-cursor': RuntimeCursorHandler[]
  'device-error': DeviceErrorHandler[]
  'orch-event': OrchEventHandler[]
}

class WsClient {
  private ws: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private maxReconnectDelay = 30000
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private missedHeartbeats = 0
  private subscribed = new Set<string>()
  private handlers: HandlerMap = {
    state: [],
    alarm: [],
    'device-online': [],
    'device-offline': [],
    'runtime-log': [],
    'runtime-cursor': [],
    'device-error': [],
    'orch-event': [],
  }
  private _isConnected = false

  get isConnected(): boolean {
    return this._isConnected
  }

  /** 当前是否处于 WS 断线兜底状态（供页面判断是否降级到 REST 轮询） */
  get isDisconnected(): boolean {
    return !this._isConnected
  }

  connect() {
    const token = getToken()
    if (!token) return

    this.ws = new WebSocket(getWsUrl())

    this.ws.onopen = () => {
      console.log('[WS] Connected')
      this._isConnected = true
      this.reconnectAttempts = 0
      // 发送 token 认证
      this.ws!.send(JSON.stringify({ type: 'auth', data: token }))
      // 恢复订阅
      for (const id of this.subscribed) {
        this.ws!.send(JSON.stringify({ type: 'subscribe', deviceId: id }))
      }
      // 启动心跳
      this.startHeartbeat()
    }

    this.ws.onmessage = (event) => {
      try {
        const msg: WSMessage = JSON.parse(event.data)
        // 心跳响应
        if (msg.type === 'pong' as unknown) {
          this.missedHeartbeats = 0
          return
        }
        this.dispatch(msg)
      } catch {
        // ignore malformed
      }
    }

    this.ws.onclose = () => {
      console.log('[WS] Disconnected')
      this._isConnected = false
      this.stopHeartbeat()
      this.scheduleReconnect()
    }

    this.ws.onerror = () => { /* handled by onclose */ }
  }

  private dispatch(msg: WSMessage) {
    switch (msg.type) {
      case 'state':
        for (const h of this.handlers.state) h(msg.deviceId!, msg.data as DeviceState)
        break
      case 'alarm':
        for (const h of this.handlers.alarm) h(msg.deviceId!, msg.data)
        break
      case 'device-online':
        for (const h of this.handlers['device-online']) h(msg.deviceId!)
        break
      case 'device-offline':
        for (const h of this.handlers['device-offline']) h(msg.deviceId!)
        break
      case 'runtime-log':
        for (const h of this.handlers['runtime-log']) h(msg.deviceId!, msg.data)
        break
      case 'runtime-cursor':
        for (const h of this.handlers['runtime-cursor']) h(msg.deviceId!, msg.data)
        break
      case 'device-error':
        for (const h of this.handlers['device-error']) h(msg.deviceId!, msg.data)
        break
      case 'orch-event':
        for (const h of this.handlers['orch-event']) h(msg.data)
        break
      case 'peer-action':
        // 协同操作通知，后续处理
        break
    }
  }

  subscribe(deviceId: string) {
    this.subscribed.add(deviceId)
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'subscribe', deviceId }))
    }
  }

  unsubscribe(deviceId: string) {
    this.subscribed.delete(deviceId)
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'unsubscribe', deviceId }))
    }
  }

  /** 底层发送；未连接返回 false，由调用方决定是否降级 REST */
  private rawSend(msg: Record<string, unknown>): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    try {
      this.ws.send(JSON.stringify(msg))
      return true
    } catch {
      return false
    }
  }

  /**
   * 实时点动（低延迟路径）
   * 成功经 WS 发出返回 true；否则 false（调用方应降级 REST）
   */
  sendJog(deviceId: string, axis: string, direction: string, mode?: string): boolean {
    return this.rawSend({
      type: 'jog',
      deviceId,
      data: { axis, direction, mode: mode || 'continuous' },
      timestamp: Date.now(),
    })
  }

  /** 实时停止点动 */
  sendJogStop(deviceId: string): boolean {
    return this.rawSend({
      type: 'jog-stop',
      deviceId,
      timestamp: Date.now(),
    })
  }

  // ─── 多监听器注册，返回 unsubscribe ────────────

  onState(h: StateHandler): Unsubscribe {
    this.handlers.state.push(h)
    return () => { this.handlers.state = this.handlers.state.filter(x => x !== h) }
  }
  onAlarm(h: AlarmHandler): Unsubscribe {
    this.handlers.alarm.push(h)
    return () => { this.handlers.alarm = this.handlers.alarm.filter(x => x !== h) }
  }
  onOnline(h: OnlineHandler): Unsubscribe {
    this.handlers['device-online'].push(h)
    return () => { this.handlers['device-online'] = this.handlers['device-online'].filter(x => x !== h) }
  }
  onOffline(h: OfflineHandler): Unsubscribe {
    this.handlers['device-offline'].push(h)
    return () => { this.handlers['device-offline'] = this.handlers['device-offline'].filter(x => x !== h) }
  }
  onRuntimeLog(h: RuntimeLogHandler): Unsubscribe {
    this.handlers['runtime-log'].push(h)
    return () => { this.handlers['runtime-log'] = this.handlers['runtime-log'].filter(x => x !== h) }
  }
  onRuntimeCursor(h: RuntimeCursorHandler): Unsubscribe {
    this.handlers['runtime-cursor'].push(h)
    return () => { this.handlers['runtime-cursor'] = this.handlers['runtime-cursor'].filter(x => x !== h) }
  }
  onDeviceError(h: DeviceErrorHandler): Unsubscribe {
    this.handlers['device-error'].push(h)
    return () => { this.handlers['device-error'] = this.handlers['device-error'].filter(x => x !== h) }
  }
  onOrchEvent(h: OrchEventHandler): Unsubscribe {
    this.handlers['orch-event'].push(h)
    return () => { this.handlers['orch-event'] = this.handlers['orch-event'].filter(x => x !== h) }
  }

  // ─── 心跳 ───────────────────────────────────────

  private startHeartbeat() {
    this.missedHeartbeats = 0
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
      this.missedHeartbeats++
      if (this.missedHeartbeats > 3) {
        console.warn('[WS] Heartbeat timeout, reconnecting...')
        this.ws.close()
        return
      }
      this.ws.send(JSON.stringify({ type: 'ping' }))
    }, 10000) // 每 10s 一次心跳
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  // ─── 指数退避重连 ───────────────────────────────

  private scheduleReconnect() {
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay)
    this.reconnectAttempts++
    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`)
    this.reconnectTimer = setTimeout(() => this.connect(), delay)
  }

  disconnect() {
    this.stopHeartbeat()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.subscribed.clear()
    this.ws?.close()
    this.ws = null
    this._isConnected = false
    // 不清 handlers — 重连后恢复；只在 logout 时手动清
  }

  /** 完全清理（logout 时调用） */
  destroy() {
    this.disconnect()
    this.handlers = {
      state: [],
      alarm: [],
      'device-online': [],
      'device-offline': [],
      'runtime-log': [],
      'runtime-cursor': [],
      'device-error': [],
      'orch-event': [],
    }
  }
}

export const wsClient = new WsClient()
