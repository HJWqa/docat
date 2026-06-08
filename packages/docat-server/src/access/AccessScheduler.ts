/**
 * 设备访问调度器 — 管理独占锁和共享会话
 * 解决痛点: 多客户端不能同时操作同一设备
 * @see docat-architecture-blueprint.md #AccessScheduler
 */
import type { AccessGrant, AccessMode, AccessRequest } from 'docat-shared/types'
import { SharedSession } from '../device/SharedSession.js'

interface QueueEntry {
  request: AccessRequest
  resolve: (grant: AccessGrant) => void
  reject: (err: Error) => void
}

interface DeviceAccessState {
  /** 当前独占锁持有者 clientId */
  exclusiveLock: string | null
  /** 锁超时定时器 */
  lockTimer: ReturnType<typeof setTimeout> | null
  /** 共享会话 */
  sharedSession: SharedSession | null
  /** 等待队列 */
  queue: QueueEntry[]
}

export class AccessScheduler {
  private devices: Map<string, DeviceAccessState> = new Map()

  private getOrCreateState(deviceId: string): DeviceAccessState {
    if (!this.devices.has(deviceId)) {
      this.devices.set(deviceId, {
        exclusiveLock: null,
        lockTimer: null,
        sharedSession: null,
        queue: [],
      })
    }
    return this.devices.get(deviceId)!
  }

  /** 请求设备访问 */
  async requestAccess(req: AccessRequest): Promise<AccessGrant> {
    const state = this.getOrCreateState(req.deviceId)

    return new Promise((resolve, reject) => {
      // 独占模式：如果空闲或自己是锁持有者，直接获取
      if (req.mode === 'exclusive') {
        if (state.exclusiveLock === null || state.exclusiveLock === req.clientId) {
          resolve(this.grantExclusive(req))
          return
        }
      }

      // 共享模式：不能和独占锁共存
      if (req.mode === 'shared') {
        if (state.exclusiveLock === null) {
          resolve(this.grantShared(req))
          return
        }
        if (state.exclusiveLock === req.clientId) {
          resolve(this.grantShared(req))
          return
        }
      }

      // 订阅模式：总是可以订阅（只读）
      if (req.mode === 'subscribe') {
        resolve(this.grantSubscribe(req))
        return
      }

      // 加入等待队列
      state.queue.push({ request: req, resolve, reject })
    })
  }

  /** 释放设备访问 */
  releaseAccess(clientId: string, deviceId: string): void {
    const state = this.devices.get(deviceId)
    if (!state) return

    // 释放独占锁
    if (state.exclusiveLock === clientId) {
      state.exclusiveLock = null
      if (state.lockTimer) {
        clearTimeout(state.lockTimer)
        state.lockTimer = null
      }
    }

    // 销毁共享会话
    if (state.sharedSession?.isHost(clientId)) {
      state.sharedSession.destroy()
      state.sharedSession = null
    }

    // 处理队列中的下一个请求
    this.processQueue(deviceId)
  }

  /** 获取设备当前的访问状态 */
  getAccessState(deviceId: string): {
    locked: boolean
    lockedBy: string | null
    sharedClients: number
    queueLength: number
  } {
    const state = this.devices.get(deviceId)
    return {
      locked: state != null && state.exclusiveLock !== null,
      lockedBy: state?.exclusiveLock ?? null,
      sharedClients: state?.sharedSession?.subscriberCount ?? 0,
      queueLength: state?.queue.length ?? 0,
    }
  }

  /** 添加客户端到共享会话 */
  joinSharedSession(deviceId: string, client: { id: string; username: string; send: (msg: unknown) => void }): boolean {
    const state = this.devices.get(deviceId)
    if (!state?.sharedSession) return false

    state.sharedSession.addSubscriber(client)
    return true
  }

  /** 从共享会话移除客户端 */
  leaveSharedSession(deviceId: string, clientId: string): void {
    const state = this.devices.get(deviceId)
    if (!state?.sharedSession) return

    state.sharedSession.removeSubscriber(clientId)
    if (state.sharedSession.subscriberCount === 0) {
      state.sharedSession = null
    }
  }

  // ─── 私有方法 ────────────────────────────────

  private grantExclusive(req: AccessRequest): AccessGrant {
    const state = this.getOrCreateState(req.deviceId)
    state.exclusiveLock = req.clientId

    const timeout = req.timeout ?? 300_000 // 默认 5 分钟
    state.lockTimer = setTimeout(() => {
      this.releaseAccess(req.clientId, req.deviceId)
    }, timeout)

    return {
      token: `lock_${req.deviceId}_${req.clientId}`,
      deviceId: req.deviceId,
      mode: 'exclusive',
      expiresAt: Date.now() + timeout,
    }
  }

  private grantShared(req: AccessRequest): AccessGrant {
    return {
      token: `shared_${req.deviceId}_${req.clientId}`,
      deviceId: req.deviceId,
      mode: 'shared',
      expiresAt: Date.now() + 86400000,
    }
  }

  private grantSubscribe(req: AccessRequest): AccessGrant {
    return {
      token: `sub_${req.deviceId}_${req.clientId}`,
      deviceId: req.deviceId,
      mode: 'subscribe',
      expiresAt: Date.now() + 86400000,
    }
  }

  private processQueue(deviceId: string): void {
    const state = this.devices.get(deviceId)
    if (!state || state.queue.length === 0) return

    const entry = state.queue.shift()!
    this.requestAccess(entry.request).then(entry.resolve).catch(entry.reject)
  }
}
