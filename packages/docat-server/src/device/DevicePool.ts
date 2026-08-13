/**
 * 设备连接池 — 管理所有在线设备实例
 * @see OpenDobot46/src.dobotlink/http/connection.ts (去单例化)
 */
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index.js'
import { eventBus } from '../event/EventBus.js'
import { DeviceDriver } from './DeviceDriver.js'
import { releaseRuntimeTcp } from './runtimeTcp.js'
import { createDriver } from './DeviceFactory.js'
import { HttpTransport, createDeviceTransports } from './transport/HttpTransport.js'
import { TcpManager } from './transport/TcpTransport.js'
import type { DeviceInfo, TransportReply, DeviceState } from 'docat-shared/types'
import { DEFAULT_SCAN_IPS, VIRTUAL_DEVICE_IPS, ControllerBuildType, POLL_INTERVAL_REAL } from 'docat-shared/protocol'

export type ConnectionMode = 'exclusive' | 'virtual'

export interface DeviceEntry {
  id: string
  driver: DeviceDriver
  http: ReturnType<typeof createDeviceTransports> | null
  tcp: TcpManager | null
  pollTimer: ReturnType<typeof setInterval> | null
  /** exclusive = 完整占用（POST claim + TCP）；virtual = 不占用但仍能发 HTTP 指令 */
  mode: ConnectionMode
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

  getDevice(driverId: string): DeviceEntry | undefined {
    return this.devices.get(driverId)
  }

  /** 扫描网络上的 Dobot 设备（并行探测所有候选 IP） */
  async scan(): Promise<DeviceInfo[]> {
    const results = await Promise.all(
      this.scanIps.map(async (ip) => {
        try {
          const http = new HttpTransport(ip, 22000, 500)
          const reply: TransportReply = await http.send({
            method: 'get',
            url: '/properties/controllerType',
            portName: ip,
            needBaseUrl: true,
            timeout: 500,
          })

          if (!reply.status || !reply.data) return null

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

          return {
            portName: ip,
            status,
            type: (data.name as string) || 'Unknown',
            alias: (data.alias as string) || '',
            buildType: isVirtual ? ControllerBuildType.Virtually : ControllerBuildType.Real,
            controllerTypeExt: (data.controllerTypeExt as string) || '',
          } satisfies DeviceInfo
        } catch {
          // 设备不在线或无响应，跳过
          return null
        }
      })
    )

    return results.filter((r): r is DeviceInfo => r !== null)
  }

  /** 连接设备
   *  exclusive: 完整占用 — POST claim + TCP + 轮询（默认）
   *  virtual: 虚拟连接 — 不占用，仅 HTTP 轮询和指令，不连 TCP
   */
  async connect(ip: string, dbDeviceId?: string, mode: ConnectionMode = 'exclusive'): Promise<TransportReply> {
    // 先检查是否已连接
    for (const [, entry] of this.devices) {
      if (entry.driver.ip === ip && entry.driver.status.connected) {
        return { status: false, code: 40902, message: '设备已连接' }
      }
    }

    try {
      // 获取设备类型（virtual 和 exclusive 都需要）
      let deviceType = 'Unknown'
      let controllerTypeExt = ''
      const http = new HttpTransport(ip, 22000)
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
        // 设备不可达
        return { status: false, code: 1000, message: `设备 ${ip} 无响应` }
      }

      const driverId = dbDeviceId || uuidv4()

      // ─── exclusive 模式：POST 占用 + TCP ──────────
      if (mode === 'exclusive') {
        // 检查设备状态
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
            data: { state: stateData?.value ?? null },
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
      }

      // ─── 创建 Driver ──────────────────────────────
      const { driver, series } = createDriver(driverId, ip, deviceType, controllerTypeExt)
      console.log(`[DevicePool] Creating ${series} driver for ${ip} (${deviceType}) [${mode}]`)
      await driver.connect()

      // ─── TCP（仅 exclusive）──────────────────────
      const tcp = new TcpManager(ip)
      if (mode === 'exclusive') {
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
      }

      // 创建传输层（两种模式都需要 HTTP）
      const transports = createDeviceTransports(ip)

      // ─── TCP 连接状态追踪（exclusive 模式）──────────
      let tcpConnected = mode !== 'exclusive' // virtual 模式视为"TCP已连接"
      let tcpDownSince = 0 // TCP 断开起始时间
      let tcpStopped = false // TCP 已停止重连（设备确认离线）
      const TCP_DISCONNECT_THRESHOLD = 5000 // 5s 无 TCP 视为断开

      /** 停止 TCP 重连（设备已离线，避免无限重连打空转） */
      const stopTcp = () => {
        if (tcpStopped) return
        tcpStopped = true
        tcpConnected = false
        // disconnectAll 会标记 isManual 并清掉重连定时器，彻底终止重连循环
        tcp.disconnectAll()
        console.warn(`[DevicePool] TCP stopped for ${driverId} (device offline)`)
      }

      /** 恢复 TCP 重连（HTTP 轮询确认设备重新在线时调用） */
      const resumeTcp = () => {
        if (!tcpStopped) return
        tcpStopped = false
        tcpDownSince = 0
        console.log(`[DevicePool] TCP resuming for ${driverId}`)
        tcp.connectAll()
      }

      if (mode === 'exclusive') {
        tcp.on('client-connected', () => {
          if (!tcpConnected && tcp.isAllConnected) {
            tcpConnected = true
            tcpDownSince = 0
            console.log(`[DevicePool] TCP fully reconnected for ${driverId}`)
            if (!driver.status.connected) {
              eventBus.emit('device:connected', { id: driverId, ip })
            }
          }
        })
        tcp.on('client-disconnected', () => {
          if (tcp.connectedCount === 0) {
            if (tcpConnected) {
              tcpConnected = false
              tcpDownSince = Date.now()
              console.warn(`[DevicePool] TCP all disconnected for ${driverId}`)
            }
            // 超过阈值则标记设备断开并停止重连
            if (tcpDownSince && Date.now() - tcpDownSince > TCP_DISCONNECT_THRESHOLD) {
              if (driver.status.connected) {
                console.warn(`[DevicePool] Device ${driverId} TCP down > ${TCP_DISCONNECT_THRESHOLD}ms, marking disconnected`)
                eventBus.emit('device:disconnected', { id: driverId })
              }
              stopTcp()
            }
          }
        })
      }

      // ─── 启动状态轮询（两种模式都轮询）────────────
      const isVirtualDevice = (VIRTUAL_DEVICE_IPS as readonly string[]).includes(ip)
      const pollInterval = isVirtualDevice ? 1000 : POLL_INTERVAL_REAL
      let wasConnected = true // 初始为 true
      const pollTimer = setInterval(async () => {
        try {
          const state = await driver.pollState()
          const nowConnected = driver.status.connected

          // 设备经 HTTP 确认重新在线 → 恢复 TCP 连接
          if (mode === 'exclusive' && tcpStopped && nowConnected) {
            resumeTcp()
          }

          // exclusive 模式：额外检查 TCP 状态
          const effectivelyConnected = mode === 'exclusive'
            ? (nowConnected && (tcpConnected || Date.now() - tcpDownSince < TCP_DISCONNECT_THRESHOLD))
            : nowConnected

          if (!wasConnected && effectivelyConnected) {
            console.log(`[DevicePool] Device ${driverId} came back online`)
            eventBus.emit('device:connected', { id: driverId, ip })
          } else if (wasConnected && !effectivelyConnected) {
            console.warn(`[DevicePool] Device ${driverId} went offline (pollState or TCP failed)`)
            eventBus.emit('device:disconnected', { id: driverId })
            // 确认离线后停止 TCP 无限重连，等 HTTP 轮询检测到恢复再重建
            if (mode === 'exclusive' && !tcpStopped) stopTcp()
          }
          wasConnected = effectivelyConnected

          if (nowConnected) {
            const extInfo: Record<string, unknown> = {}
            const rawExchange = (driver as unknown as Record<string, unknown>).rawExchange as Record<string, unknown> | undefined
            if (rawExchange) {
              extInfo.warningList = rawExchange.warningList
              extInfo.isCollision = rawExchange.isCollision
              extInfo.skinCollison = rawExchange.skinCollison
              extInfo.emergencyStop = rawExchange.emergencyStop
              extInfo.protectiveStop = rawExchange.protectiveStop
              extInfo.isAlarmUpdate = rawExchange.isAlarmUpdate
              extInfo.isWarningUpdate = rawExchange.isWarningUpdate
              extInfo.speedRatio = rawExchange.speedRatio
              extInfo.dragMode = rawExchange.dragMode
              extInfo.prjState = rawExchange.prjState
              extInfo.isMotion = rawExchange.isMotion
              // 0=joint, 1=cartesian/tool（控制器 coordinate 字段）
              extInfo.coordinate = rawExchange.coordinate
              extInfo.mode = mode
            }
            extInfo.mode = mode // 告诉前端当前连接模式
            extInfo.autoManual = rawExchange?.autoManual // 1=auto, 0=manual
            extInfo.tcpConnected = tcpConnected
            eventBus.emit('device:state', { deviceId: driverId, state: { ...state, _ext: extInfo } })
          }
        } catch {
          if (wasConnected) {
            wasConnected = false
            console.warn(`[DevicePool] Device ${driverId} poll error, marking offline`)
            eventBus.emit('device:disconnected', { id: driverId })
          }
          if (mode === 'exclusive' && !tcpStopped) stopTcp()
        }
      }, pollInterval)

      // ⭐ 关键：存入池中
      const entry: DeviceEntry = { id: driverId, driver, http: transports, tcp, pollTimer, mode }
      this.devices.set(driverId, entry)

      // 独占连接已接管 TCP，释放独立运行监听避免重复
      releaseRuntimeTcp(driverId)

      eventBus.emit('device:connected', { id: driverId, ip, mode })

      return {
        status: true,
        code: 0,
        data: {
          driverId,
          ip,
          type: deviceType,
          mode,
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

  /** 断开设备 — exclusive 模式下断开 TCP 让控制器自动释放占用 */
  async disconnect(driverId: string): Promise<void> {
    const entry = this.devices.get(driverId)
    if (!entry) return

    if (entry.pollTimer) clearInterval(entry.pollTimer)
    // TCP 断连后控制器会自动检测并释放占用状态
    entry.tcp?.disconnectAll()
    await entry.driver.disconnect()
    this.devices.delete(driverId)

    eventBus.emit('device:disconnected', { id: driverId })
  }

  /** 强制释放设备占用（幽灵占用解除）
   *  策略：直接 POST { currentClient: 1 } 抢占连接 → 建立 TCP → 断开 TCP
   *  控制器靠 TCP 心跳检测客户端存活，TCP 断开后会自动释放占用
   */
  async forceRelease(ip: string): Promise<TransportReply> {
    try {
      const http = new HttpTransport(ip, 22000, 3000)

      // 1. 检查当前状态
      const stateReply = await http.send({
        method: 'get',
        url: '/connection/state',
        portName: ip,
      })

      const stateData = stateReply.data as { value: string } | undefined
      const currentState = stateData?.value ?? 'unknown'

      if (currentState !== 'occupied') {
        return {
          status: false,
          code: 1002,
          message: `设备状态为 "${currentState}"，非占用状态无需释放`,
        }
      }

      // 2. 直接 POST 抢占连接（跳过 GET 检查，强制声明所有权）
      const claimReply = await http.send({
        method: 'post',
        url: '/connection/state',
        portName: ip,
        params: { currentClient: 1, clientName: 'docat-force-release' },
      })

      if (!claimReply.status) {
        return { status: false, code: 1000, message: `抢占连接失败: ${claimReply.message ?? 'controller rejected'}` }
      }

      console.log(`[DevicePool] Force-claimed ghost occupation on ${ip}, now releasing via TCP disconnect`)

      // 3. 建立 TCP 连接让控制器识别我们为合法客户端
      const tcp = new TcpManager(ip)
      try {
        tcp.connectAll()
        // 等一小段时间让控制器完成 TCP 握手
        await new Promise(resolve => setTimeout(resolve, 500))
      } catch {
        // TCP 连不上也没关系，继续尝试释放
      }

      // 4. 断开 TCP — 控制器检测到客户端断连后自动释放占用
      tcp.disconnectAll()

      // 5. 验证释放结果
      await new Promise(resolve => setTimeout(resolve, 500))
      const verifyReply = await http.send({
        method: 'get',
        url: '/connection/state',
        portName: ip,
      })
      const verifyData = verifyReply.data as { value: string } | undefined
      const verifyState = verifyData?.value ?? 'unknown'

      if (verifyState === 'connected') {
        console.log(`[DevicePool] Ghost occupation on ${ip} successfully released`)
        return { status: true, code: 0, message: '幽灵占用已释放，设备可正常连接' }
      }

      // 可能控制器需要更长时间检测 TCP 断连
      console.log(`[DevicePool] Force release on ${ip}: state is now "${verifyState}" (may need more time)`)
      return { status: true, code: 0, message: `抢占成功，当前状态 "${verifyState}"，控制器可能需要数秒释放` }
    } catch (err) {
      return { status: false, code: 1000, message: `强制释放失败: ${(err as Error).message}` }
    }
  }

  /** 断开所有设备（优雅关闭） */
  async disconnectAll(): Promise<void> {
    const ids = [...this.devices.keys()]
    for (const id of ids) {
      await this.disconnect(id)
    }
  }

  /** 该设备是否已由池持有有效 TCP（用于避免独立运行监听重复连接） */
  hasActiveTcp(deviceId: string): boolean {
    const entry = this.devices.get(deviceId)
    return !!entry && !!entry.tcp && entry.tcp.connectedCount > 0
  }

  /** 从数据库加载自动连接的设备列表 */
  loadAutoConnectDevices(): Array<{ id: string; ip: string; name: string; type: string; serialPort: string; baudRate: number }> {
    const db = getDb()
    const rows = db.prepare('SELECT id, ip, name, type, serialPort, baudRate FROM devices WHERE autoConnect = 1').all() as Array<{
      id: string
      ip: string
      name: string
      type: string
      serialPort: string
      baudRate: number
    }>
    return rows
  }

  /**
   * 连接串口设备（Magician）— 无 HTTP/TCP，仅串口指令 + 状态轮询
   * TODO(预留)：后续支持「服务器」模式（DobotServer 中转，UDP JSON-RPC 127.0.0.1:6600）——
   *   串口被官方软件独占时经 DobotServer.exe 转发，见 transport/DobotServerTransport.ts
   *   （参考 find-docs/magician-controller/transport.py DobotServerClient）
   */
  async connectSerial(
    dbDeviceId: string,
    serialPort: string,
    baudRate: number,
    deviceType: string,
    /** TODO(预留)：'serial' | 'server'（DobotServer 中转），当前仅 serial */
    _mode: 'serial' | 'server' = 'serial',
  ): Promise<TransportReply> {
    // TODO(预留)：if (mode === 'server') → DobotServerTransport 连接路径
    for (const [, entry] of this.devices) {
      if (entry.driver.ip === serialPort && entry.driver.status.connected) {
        return { status: false, code: 40902, message: '设备已连接' }
      }
    }

    try {
      const { driver, series } = createDriver(dbDeviceId, serialPort, deviceType || 'Magician', '', {
        serialPort,
        baudRate,
      })
      if (series !== 'Magician') {
        return { status: false, code: 1000, message: `串口设备仅支持 Magician（当前型号识别为 ${series}）` }
      }

      console.log(`[DevicePool] Creating ${series} serial driver for ${serialPort} (${deviceType})`)
      await driver.connect()

      const pollTimer = setInterval(async () => {
        try {
          const state = await driver.pollState()
          if (driver.status.connected) {
            eventBus.emit('device:state', {
              deviceId: dbDeviceId,
              state: { ...state, _ext: { mode: 'exclusive', serial: true, tcpConnected: true } },
            })
          }
        } catch {
          // 轮询异常忽略，pollState 内部维护连接状态
        }
      }, POLL_INTERVAL_REAL)

      const entry: DeviceEntry = {
        id: dbDeviceId,
        driver,
        http: null,
        tcp: null,
        pollTimer,
        mode: 'exclusive',
      }
      this.devices.set(dbDeviceId, entry)

      eventBus.emit('device:connected', { id: dbDeviceId, ip: serialPort, mode: 'exclusive' })

      return {
        status: true,
        code: 0,
        data: {
          driverId: dbDeviceId,
          ip: serialPort,
          type: driver.type,
          mode: 'exclusive',
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
}
