/** 设备通信端口常量 */
export const DEVICE_PORTS = {
  /** 设备控制主通道（连接、设置、运动、IO） */
  HTTP_MAIN: 22000,
  /** DobotPlus 插件系统 */
  HTTP_DOBOT_PLUS: 22001,
  /** 固件更新 */
  HTTP_FIRMWARE: 22002,
  /** 客户端消息（实时状态推送） */
  TCP_CLIENT_MSG: 65501,
  /** 第二光标消息 */
  TCP_2ND_CURSOR: 65502,
  /** 特殊消息 */
  TCP_SPECIAL: 65503,
  /** 弹窗消息 */
  TCP_POPUP: 65525,
  /** SFTP 文件传输 */
  SFTP: 22,
} as const

/** 设备发现默认 IP 列表 */
export const DEFAULT_SCAN_IPS = [
  '192.168.5.1',
  '192.168.200.1',
  '192.168.201.1',
  '127.0.0.1',
] as const

/** 虚拟设备 IP 列表 */
export const VIRTUAL_DEVICE_IPS = ['127.0.0.1'] as const

/** 设备 HTTP API 路径 */
export const DEVICE_API = {
  /** 获取控制器类型（设备发现） */
  CONTROLLER_TYPE: '/properties/controllerType',
  /** 连接状态 */
  CONNECTION_STATE: '/connection/state',
  /** 实时状态交换（轮询） */
  PROTOCOL_EXCHANGE: '/protocol/exchange',
  /** 固件版本 */
  VERSION: '/settings/version',
  /** 坐标系设置 */
  COORDINATES: '/settings/coordinates',
  /** IO 配置 */
  IO_SETTINGS: '/settings/io',
  /** 运动参数 */
  PARAMS: '/settings/params',
  /** 点动 */
  JOG: '/motion/jog',
  /** 移动到目标位姿 */
  MOVE: '/motion/move',
  /** 回零（Magician 机型预留） */
  HOME: '/motion/home',
  /** 停止运动 */
  STOP: '/motion/stop',
  /** 急停 */
  EMERGENCY_STOP: '/motion/emergencyStop',
} as const

/** 状态轮询间隔（毫秒），虚拟设备加长 */
export const POLL_INTERVAL_REAL = 500
export const POLL_INTERVAL_VIRTUAL = 1000

/** 支持的固件版本范围 */
export const FIRMWARE_VERSION_RANGE = {
  min: '4.5.0',
  max: '4.6.5',
} as const

/** 设备类型标识 */
export type DeviceType = 'CR' | 'Nova' | 'MG6' | 'Magician'

/** 连接状态 */
export type ConnectionState = 'connected' | 'unconnected' | 'occupied'

/** 控制器构建类型 */
export enum ControllerBuildType {
  Virtually = 'Virtually',
  Real = 'Real',
}
