/**
 * 设备连接池 — 管理所有在线设备实例
 * @see OpenDobot46/src.dobotlink/http/connection.ts (去单例化)
 */
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import { eventBus } from '../event/EventBus.js'
import { DeviceDriver } from './DeviceDriver.js'
import { createDriver } from './DeviceFactory.js'
import { HttpTransport, createDeviceTransports } from './transport/HttpTransport.js'
import { TcpManager } from './transport/TcpTransport.js'
import type { DeviceInfo, TransportReply, DeviceState } from 'docat-shared/types'
import { DEFAULT_SCAN_IPS, VIRTUAL_DEVICE_IPS, ControllerBuildType, POLL_INTERVAL_REAL } from 'docat-shared/protocol'

export interface DeviceEntry {
  id: string
  driver: DeviceDriver
  http: ReturnType<typeof createDeviceTransports>
  tcp: TcpManager
  pollTimer: ReturnType<typeof setInterval> | null
}

export class DevicePool {
  private devices: Map<string, DeviceEntry> = new Map()
  private scanIps: string[]

  constructor(scanIps: string[] = [...DEFAULT_SCAN_IPS]) {
    this.scanIps = scanIps
  }

  get deviceIds(): string[] {
    return [...this.devices.keys()]
  }

  get onlineCount(): number {
    let count = 0
    for (const [, entry] of this.devices) {
      if (entry.driver.status.connected) count++
    }
    return count
  }

  /** 获取所有设备的状态摘要 */
  getDeviceStatuses(): Array<{ id: string; ip: string; connected: boolean; locked: boolean }> {
    return [...this.devices.entries()].map(([id, entry]) => ({
      id,
      ip: entry.driver.ip,
      connected: entry.driver.status.connected,
      locked: false, // TODO: query AccessScheduler
    }))
  }

  getDevice(driverId: string): DeviceEntry | undefined {
    return this.devices.get(driverId)
  }

  /** 扫描网络上的 Dobot 设备 */
  async scan(): Promise<DeviceInfo[]> {
    const results: DeviceInfo[] = []

    for (const ip of this.scanIps) {
      try {
        const http = new HttpTransport(ip, 22000, 500)
        const reply: TransportReply = await http.send({
          method: 'get',
          url: '/properties/controllerType',
          portName: ip,
          needBaseUrl: true,
          timeout: 500,
        })

        if (reply.status && reply.data) {
          const data = reply.data as Record<string, unknown>
          const isVirtual = (VIRTUAL_DEVICE_IPS as readonly string[]).includes(ip)

          const stateReply = await http.send({
            method: 'get',
            url: '/connection/state',
            portName: ip,
          })

          const stateData = stateReply.data as { value: string } | undefined
          let status = stateData?.value ?? 'unconnected'
          if (status === 'connected') status = 'unconnected'

          results.push({
            portName: ip,
            status,
            type: (data.name as string) || 'Unknown',
            alias: (data.alias as string) || '',
            buildType: isVirtual ? ControllerBuildType.Virtually : ControllerBuildType.Real,
            controllerTypeExt: (data.controllerTypeExt as string) || '',
          })
        }
      } catch {
        // 设备不在线或无响应，跳过
      }
    }

    return results
  }

  /** 连接设备 */
  async connect(ip: string, dbDeviceId?: string): Promise<TransportReply> {
    // 先检查是否已连接
    for (const [, entry] of this.devices) {
      if (entry.driver.ip === ip && entry.driver.status.connected) {
        return { status: false, code: 40902, message: '设备已连接' }
      }
    }

    try {
      // 检查设备状态
      const http = new HttpTransport(ip, 22000)
      const stateReply = await http.send({
        method: 'get',
        url: '/connection/state',
        portName: ip,
      })

      const stateData = stateReply.data as { value: string } | undefined

      if (!stateReply.status || stateData?.value !== 'connected') {
        return {
          status: false,
          code: 1001,
          message: `设备 ${ip} 状态为 "${stateData?.value ?? 'unknown'}"，无法连接`,
        }
      }

      // POST 告知控制器建立连接
      const connectReply = await http.send({
        method: 'post',
        url: '/connection/state',
        portName: ip,
        params: { currentClient: 1, clientName: 'docat-server' },
      })

      if (!connectReply.status) {
        return { status: false, code: 1000, message: '设备连接失败' }
      }

      // 获取设备类型
      let deviceType = 'Unknown'
      let controllerTypeExt = ''
      try {
        const typeReply = await http.send({
          method: 'get',
          url: '/properties/controllerType',
          portName: ip,
          needBaseUrl: true,
          timeout: 2000,
        })
        if (typeReply.status && typeReply.data) {
          const td = typeReply.data as Record<string, string>
          deviceType = td.name || 'Unknown'
          controllerTypeExt = td.controllerTypeExt || ''
        }
      } catch {
        // 非关键
      }

      // 用 DeviceFactory 选择正确的驱动
      const driverId = dbDeviceId || uuidv4()

      // 建立 TCP 连接
      const tcp = new TcpManager(ip)
      tcp.on('notify', ({ port, data }: { port: number; data: string }) => {
        if (port === 65502) {
          eventBus.emit('device:runtime-cursor', {
            deviceId: driverId,
            port,
            data: data.trim(),
            timestamp: Date.now(),
          })
          return
        }

        if (port === 65501 || port === 65503 || port === 65525) {
          eventBus.emit('device:runtime-log', {
            deviceId: driverId,
            port,
            level: port === 65503 ? 'special' : port === 65525 ? 'popup' : 'client',
            data: port === 65503 ? data.trimStart() : data.trim(),
            timestamp: Date.now(),
          })
        }
      })
      tcp.on('error', ({ port, error }: { port: number; error: Error }) => {
        console.error(`[DevicePool] TCP error on ${ip}:${port}:`, error.message)
        eventBus.emit('device:error', {
          deviceId: driverId,
          ip,
          port,
          error,
          timestamp: Date.now(),
        })
      })
      tcp.connectAll()

      // 创建传输层
      const transports = createDeviceTransports(ip)

      const { driver, series } = createDriver(driverId, ip, deviceType, controllerTypeExt)
      console.log(`[DevicePool] Creating ${series} driver for ${ip} (${deviceType})`)
      await driver.connect()

      // 启动状态轮询
      const isVirtual = (VIRTUAL_DEVICE_IPS as readonly string[]).includes(ip)
      const pollInterval = isVirtual ? 1000 : POLL_INTERVAL_REAL
      const pollTimer = setInterval(async () => {
        try {
          const state = await driver.pollState()
          eventBus.emit('device:state', { deviceId: driverId, state })
        } catch {
          // 轮询失败不中断
        }
      }, pollInterval)

      // ⭐ 关键：存入池中
      const entry: DeviceEntry = { id: driverId, driver, http: transports, tcp, pollTimer }
      this.devices.set(driverId, entry)

      eventBus.emit('device:connected', { id: driverId, ip })

      return {
        status: true,
        code: 0,
        data: {
          driverId,
          ip,
          type: deviceType,
          status: driver.status,
          pose: driver.state.pose,
        },
      }
    } catch (error) {
      return {
        status: false,
        code: 1000,
        message: (error as Error).message,
      }
    }
  }

  /** 断开设备 */
  async disconnect(driverId: string): Promise<void> {
    const entry = this.devices.get(driverId)
    if (!entry) return

    if (entry.pollTimer) clearInterval(entry.pollTimer)
    entry.tcp.disconnectAll()
    await entry.driver.disconnect()
    this.devices.delete(driverId)

    eventBus.emit('device:disconnected', { id: driverId })
  }

  /** 断开所有设备（优雅关闭） */
  async disconnectAll(): Promise<void> {
    const ids = [...this.devices.keys()]
    for (const id of ids) {
      await this.disconnect(id)
    }
  }

  /** 从数据库加载自动连接的设备列表 */
  loadAutoConnectDevices(): Array<{ id: string; ip: string; name: string }> {
    const db = getDb()
    const rows = db.prepare('SELECT id, ip, name FROM devices WHERE autoConnect = 1').all() as Array<{
      id: string
      ip: string
      name: string
    }>
    return rows
  }
}
