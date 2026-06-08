/**
 * WebSocket 实时事件处理
 * @see docat-architecture-blueprint.md #WebSocket 事件
 */
import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import { validateToken } from '../../auth/auth.js'
import type { DevicePool } from '../../device/DevicePool.js'
import type { AccessScheduler } from '../../access/AccessScheduler.js'
import { eventBus } from '../../event/EventBus.js'
import type { WSMessage } from 'docat-shared/types'

interface WsClient {
  ws: WebSocket
  userId: string
  username: string
  role: string
}

export function websocketRoutes(
  app: FastifyInstance,
  pool: DevicePool,
  scheduler: AccessScheduler
): void {
  const clients: Map<WebSocket, WsClient> = new Map()

  app.get('/ws', { websocket: true }, (socket, request) => {
    const ws = socket as unknown as WebSocket

    // 等待认证消息
    let authenticated = false
    let client: WsClient | null = null

    ws.on('message', (raw: Buffer | string) => {
      try {
        const msg: WSMessage = JSON.parse(raw.toString())

        // 认证
        if (!authenticated) {
          const token = msg.data as string | undefined
          if (!token) {
            ws.send(JSON.stringify({ type: 'error', data: { message: '需要 token 认证' } }))
            ws.close()
            return
          }

          const session = validateToken(token)
          if (!session) {
            ws.send(JSON.stringify({ type: 'error', data: { message: 'Token 无效或已过期' } }))
            ws.close()
            return
          }

          client = {
            ws,
            userId: session.userId,
            username: session.username,
            role: session.role,
          }
          clients.set(ws, client)
          authenticated = true
          console.log(`[WS] Client connected: ${session.username} (${session.userId})`)
          return
        }

        // 认证后处理订阅
        const currentClient = client!
        if (!currentClient) return

        switch (msg.type) {
          case 'subscribe': {
            const deviceId = msg.deviceId
            if (!deviceId) return

            const joined = scheduler.joinSharedSession(deviceId, {
              id: currentClient.userId,
              username: currentClient.username,
              send: (m) => ws.send(JSON.stringify(m)),
            })

            if (!joined) {
              // 尝试创建新的共享会话
              scheduler.requestAccess({
                clientId: currentClient.userId,
                deviceId,
                mode: 'shared',
              }).then(() => {
                scheduler.joinSharedSession(deviceId, {
                  id: currentClient.userId,
                  username: currentClient.username,
                  send: (m) => ws.send(JSON.stringify(m)),
                })
              }).catch(() => {
                ws.send(JSON.stringify({ type: 'error', data: { message: '无法订阅该设备' } }))
              })
            }
            break
          }

          case 'unsubscribe': {
            if (msg.deviceId) {
              scheduler.leaveSharedSession(msg.deviceId, currentClient.userId)
            }
            break
          }

          default:
            // 其他消息类型由具体业务处理
            break
        }
      } catch (err) {
        console.error('[WS] Parse error:', (err as Error).message)
      }
    })

    ws.on('close', () => {
      if (client) {
        clients.delete(ws)
        console.log(`[WS] Client disconnected: ${client.username}`)
      }
    })

    ws.on('error', (err: Error) => {
      console.error('[WS] Error:', err.message)
    })
  })

  // ─── 转发设备事件到 WebSocket 客户端 ────────────

  eventBus.on('device:state', (data: unknown) => {
    const { deviceId, state } = data as { deviceId: string; state: unknown }
    broadcast({ type: 'state', deviceId, data: state })
  })

  eventBus.on('device:alarm', (data: unknown) => {
    const { deviceId, alarm } = data as { deviceId: string; alarm: unknown }
    broadcast({ type: 'alarm', deviceId, data: alarm })
  })

  eventBus.on('device:runtime-log', (data: unknown) => {
    const payload = data as { deviceId: string; [key: string]: unknown }
    broadcast({ type: 'runtime-log', deviceId: payload.deviceId, data: payload })
  })

  eventBus.on('device:runtime-cursor', (data: unknown) => {
    const payload = data as { deviceId: string; [key: string]: unknown }
    broadcast({ type: 'runtime-cursor', deviceId: payload.deviceId, data: payload })
  })

  eventBus.on('device:connected', (data: unknown) => {
    const { id: deviceId } = data as { id: string }
    broadcast({ type: 'device-online', deviceId })
  })

  eventBus.on('device:disconnected', (data: unknown) => {
    const { id: deviceId } = data as { id: string }
    broadcast({ type: 'device-offline', deviceId })
  })

  function broadcast(msg: WSMessage): void {
    const payload = JSON.stringify(msg)
    for (const [, client] of clients) {
      try {
        client.ws.send(payload)
      } catch {
        // 客户端可能已断开
      }
    }
  }
}
