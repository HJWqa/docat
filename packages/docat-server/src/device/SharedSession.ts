/**
 * 协同操作会话 — 多个客户端同时查看/操作同一设备
 * 支持状态同步广播 + 操作指令转发
 * @see docat-architecture-blueprint.md #SharedSession
 */
import type { DeviceState } from 'docat-shared/types'
import type { WSMessage } from 'docat-shared/types'
import { eventBus } from '../event/EventBus.js'

interface ClientHandle {
  id: string
  username: string
  send: (msg: WSMessage) => void
}

export class SharedSession {
  readonly deviceId: string
  private host: ClientHandle
  private subscribers: Set<ClientHandle> = new Set()
  lastState: DeviceState | null = null

  constructor(deviceId: string, host: ClientHandle) {
    this.deviceId = deviceId
    this.host = host
  }

  /** 添加订阅者 */
  addSubscriber(client: ClientHandle): void {
    this.subscribers.add(client)
    eventBus.emit('shared:client-joined', { deviceId: this.deviceId, clientId: client.id })

    // 立即推送当前状态给新订阅者
    if (this.lastState) {
      client.send({ type: 'state', deviceId: this.deviceId, data: this.lastState })
    }
  }

  /** 移除订阅者 */
  removeSubscriber(clientId: string): void {
    for (const c of this.subscribers) {
      if (c.id === clientId) {
        this.subscribers.delete(c)
        eventBus.emit('shared:client-left', { deviceId: this.deviceId, clientId })
        break
      }
    }
  }

  /** 广播设备状态给所有订阅者 */
  broadcastState(state: DeviceState): void {
    this.lastState = state
    const msg: WSMessage = { type: 'state', deviceId: this.deviceId, data: state }

    this.host.send(msg)
    for (const client of this.subscribers) {
      client.send(msg)
    }
  }

  /** 广播客户端操作给其他订阅者 */
  broadcastPeerAction(clientId: string, username: string, action: string, params: unknown): void {
    const msg: WSMessage = {
      type: 'peer-action',
      deviceId: this.deviceId,
      user: username,
      action,
      params,
      timestamp: Date.now(),
    }

    // 广播给除操作者外的所有客户端
    if (this.host.id !== clientId) {
      this.host.send(msg)
    }
    for (const client of this.subscribers) {
      if (client.id !== clientId) {
        client.send(msg)
      }
    }
  }

  /** 订阅者数量 */
  get subscriberCount(): number {
    return this.subscribers.size
  }

  /** 是否为主控 */
  isHost(clientId: string): boolean {
    return this.host.id === clientId
  }

  /** 销毁会话 */
  destroy(): void {
    for (const client of this.subscribers) {
      client.send({ type: 'device-offline', deviceId: this.deviceId })
    }
    this.subscribers.clear()
  }
}
