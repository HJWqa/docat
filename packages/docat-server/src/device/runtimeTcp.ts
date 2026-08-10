/**
 * 运行数据通道 — 独立监听设备 TCP 65501/65502/65503/65525 端口
 * 脚本运行时光标（65502）/日志（65501/65503/65525）由设备主动推送，
 * 无需 DevicePool 独占连接即可接收，转发到 eventBus → WS → 前端橙线/日志。
 * 注意：日志（65501）只推送给"当前客户端"，必须先 POST /connection/state claim 设备；
 *       光标（65502）是广播的，claim 失败时仍能收到。
 * DevicePool 已持有该设备 TCP 时跳过，避免重复监听。
 */
import { HttpTransport } from './transport/HttpTransport.js'
import { TcpManager } from './transport/TcpTransport.js'
import { eventBus } from '../event/EventBus.js'

interface RuntimeTcpEntry {
  ip: string
  tcp: TcpManager
}

const entries = new Map<string, RuntimeTcpEntry>()
const claiming = new Set<string>()

let poolHasTcp: (deviceId: string) => boolean = () => false

/** 注册 DevicePool 的 TCP 占用检查（server.ts 注入，避免循环依赖） */
export function setRuntimePoolTcpCheck(fn: (deviceId: string) => boolean): void {
  poolHasTcp = fn
}

export async function ensureRuntimeTcp(deviceId: string, ip: string): Promise<void> {
  if (entries.has(deviceId) || poolHasTcp(deviceId)) return
  if (claiming.has(deviceId)) return
  claiming.add(deviceId)

  try {
    // 先 claim 设备成为当前客户端（否则 65501 日志不推送）
    const http = new HttpTransport(ip, 22000, 3000)
    const reply = await http.send({
      method: 'post',
      url: '/connection/state',
      portName: ip,
      params: { currentClient: 1, clientName: 'docat-server' },
    })

    // claim 失败（设备不可达/被其他客户端占用）：不连 TCP，避免无意义连接与重连风暴
    if (!reply.status) {
      claiming.delete(deviceId)
      return
    }
  } catch {
    claiming.delete(deviceId)
    return
  }

  const tcp = new TcpManager(ip)
  tcp.on('notify', ({ port, data }: { port: number; data: string }) => {
    if (port === 65502) {
      eventBus.emit('device:runtime-cursor', {
        deviceId,
        port,
        data: data.trim(),
        timestamp: Date.now(),
      })
      return
    }
    if (port === 65501 || port === 65503 || port === 65525) {
      eventBus.emit('device:runtime-log', {
        deviceId,
        port,
        level: port === 65503 ? 'special' : port === 65525 ? 'popup' : 'client',
        data: port === 65503 ? data.trimStart() : data.trim(),
        timestamp: Date.now(),
      })
    }
  })
  tcp.connectAll()
  entries.set(deviceId, { ip, tcp })
  claiming.delete(deviceId)
}

/** 释放独立监听（DevicePool 独占连接接管时调用，避免重复监听） */
export function releaseRuntimeTcp(deviceId: string): void {
  const entry = entries.get(deviceId)
  if (!entry) return
  entry.tcp.disconnectAll()
  entries.delete(deviceId)
}
