/**
 * 内部事件总线 — 基于 EventEmitter 的解耦通信
 * 用于 server 内部各模块间异步通信
 */
import { EventEmitter } from 'node:events'

export type EventName =
  | 'device:discovered'
  | 'device:connected'
  | 'device:disconnected'
  | 'device:state'
  | 'device:alarm'
  | 'device:runtime-log'
  | 'device:runtime-cursor'
  | 'device:error'
  | 'access:granted'
  | 'access:released'
  | 'access:requested'
  | 'shared:client-joined'
  | 'shared:client-left'
  | 'shared:command'

class EventBus extends EventEmitter {
  private static instance: EventBus

  static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus()
    }
    return EventBus.instance
  }

  /** 安全 emit，捕获异常不中断其他监听器 */
  emit(event: EventName, ...args: unknown[]): boolean {
    try {
      return super.emit(event, ...args)
    } catch (err) {
      console.error(`[EventBus] Error emitting "${event}":`, err)
      return false
    }
  }
}

export const eventBus = EventBus.getInstance()
