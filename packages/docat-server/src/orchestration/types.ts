/**
 * 编排设备类型与配置（服务端）
 * 与前端 stores/orchestrationStore 的 OrchDevice 保持一致
 */
export type OrchDeviceType = 'tcp-server' | 'tcp-client' | 'udp' | 'serial' | 'docat-motion'

export interface OrchDeviceConfig {
  id: string
  /** 变量命名规则的名称（脚本按名称寻址），唯一 */
  name: string
  type: OrchDeviceType
  ip: string
  port: number
  serialPort: string
  baudRate: number
  /** docat-motion：被模拟的真实机械臂设备 id */
  targetDeviceId: string
  autoReconnect: boolean
  heartbeat: boolean
  createdAt: string
}

export interface OrchDeviceRuntime extends OrchDeviceConfig {
  /** 运行时连接状态 */
  connected: boolean
}

export interface OrchPose {
  name: string
  type: 'joint' | 'cartesian'
  joint: number[]
  pose: { x: number; y: number; z: number; rx: number; ry: number; rz: number }
  updatedAt: string
}
