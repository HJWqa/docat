/**
 * WebSocket 客户端 — 订阅设备实时状态
 */
import type { DeviceState, WSMessage } from 'docat-shared/types'
import { getToken } from './api'

type StateHandler = (deviceId: string, state: DeviceState) => void
type AlarmHandler = (deviceId: string, alarm: unknown) => void
type OnlineHandler = (deviceId: string) => void
type OfflineHandler = (deviceId: string) => void
type RuntimeLogHandler = (deviceId: string, data: unknown) => void
type RuntimeCursorHandler = (deviceId: string, data: unknown) => void

class WsClient {
  private ws: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private subscribed = new Set<string>()
  private handlers: {
    onState?: StateHandler
    onAlarm?: AlarmHandler
    onOnline?: OnlineHandler
    onOffline?: OfflineHandler
    onRuntimeLog?: RuntimeLogHandler
    onRuntimeCursor?: RuntimeCursorHandler
  } = {}

  connect() {
    const token = getToken()
    if (!token) return

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${proto}//${location.host}/ws`

    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      console.log('[WS] Connected')
      // 发送 token 认证
      this.ws!.send(JSON.stringify({ type: 'auth', data: token }))
      // 恢复订阅
      for (const id of this.subscribed) {
        this.ws!.send(JSON.stringify({ type: 'subscribe', deviceId: id }))
      }
    }

    this.ws.onmessage = (event) => {
      try {
        const msg: WSMessage = JSON.parse(event.data)
        switch (msg.type) {
          case 'state':
            this.handlers.onState?.(msg.deviceId!, msg.data as DeviceState)
            break
          case 'alarm':
            this.handlers.onAlarm?.(msg.deviceId!, msg.data)
            break
          case 'device-online':
            this.handlers.onOnline?.(msg.deviceId!)
            break
          case 'device-offline':
            this.handlers.onOffline?.(msg.deviceId!)
            break
          case 'runtime-log':
            this.handlers.onRuntimeLog?.(msg.deviceId!, msg.data)
            break
          case 'runtime-cursor':
            this.handlers.onRuntimeCursor?.(msg.deviceId!, msg.data)
            break
          case 'peer-action':
            // 协同操作通知，后续处理
            break
        }
      } catch {
        // ignore malformed
      }
    }

    this.ws.onclose = () => {
      console.log('[WS] Disconnected, reconnecting in 3s...')
      this.reconnectTimer = setTimeout(() => this.connect(), 3000)
    }

    this.ws.onerror = () => { /* handled by onclose */ }
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

  onState(h: StateHandler) { this.handlers.onState = h }
  onAlarm(h: AlarmHandler) { this.handlers.onAlarm = h }
  onOnline(h: OnlineHandler) { this.handlers.onOnline = h }
  onOffline(h: OfflineHandler) { this.handlers.onOffline = h }
  onRuntimeLog(h: RuntimeLogHandler) { this.handlers.onRuntimeLog = h }
  onRuntimeCursor(h: RuntimeCursorHandler) { this.handlers.onRuntimeCursor = h }

  disconnect() {
    this.handlers = {}
    this.subscribed.clear()
    this.ws?.close()
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
  }
}

export const wsClient = new WsClient()
