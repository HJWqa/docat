/**
 * 设备状态 Store — 跨页面共享的设备连接状态
 * 解决导航时状态丢失的问题
 */
import { reactive } from 'vue'
import type { DeviceConfig } from 'docat-shared/types'

export type ConnectionMode = 'exclusive' | 'virtual' | null

interface DeviceStatusInfo {
  connected: boolean
  enabled: boolean
  connectionMode: ConnectionMode
  state: Record<string, unknown> | null
}

export const deviceStore = reactive({
  /** deviceId -> registered device config */
  devices: {} as Record<string, DeviceConfig>,

  /** deviceId → status */
  statuses: {} as Record<string, DeviceStatusInfo>,

  setDevices(devices: DeviceConfig[]) {
    for (const device of devices) {
      this.devices[device.id] = device
    }
  },

  getDevice(id: string): DeviceConfig | null {
    return this.devices[id] ?? null
  },

  setConnected(id: string, connected: boolean, mode?: ConnectionMode) {
    if (!this.statuses[id]) {
      this.statuses[id] = { connected: false, enabled: false, connectionMode: null, state: null }
    }
    this.statuses[id].connected = connected
    if (mode !== undefined) this.statuses[id].connectionMode = mode
  },

  setEnabled(id: string, enabled: boolean) {
    if (!this.statuses[id]) {
      this.statuses[id] = { connected: false, enabled: false, connectionMode: null, state: null }
    }
    this.statuses[id].enabled = enabled
  },

  setState(id: string, state: Record<string, unknown>) {
    if (!this.statuses[id]) {
      this.statuses[id] = { connected: true, enabled: false, connectionMode: null, state: null }
    }
    this.statuses[id].state = state
    this.statuses[id].connected = true
  },

  setOffline(id: string) {
    if (!this.statuses[id]) {
      this.statuses[id] = { connected: false, enabled: false, connectionMode: null, state: null }
    }
    this.statuses[id].connected = false
    this.statuses[id].connectionMode = null
  },

  isConnected(id: string): boolean {
    return this.statuses[id]?.connected ?? false
  },

  isVirtual(id: string): boolean {
    return this.statuses[id]?.connectionMode === 'virtual'
  },

  isEnabled(id: string): boolean {
    return this.statuses[id]?.enabled ?? false
  },

  get connectedCount(): number {
    return Object.values(this.statuses).filter(s => s.connected).length
  },

  reset() {
    this.devices = {}
    this.statuses = {}
  },
})
