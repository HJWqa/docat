/**
 * docat-server 配置管理
 * 优先级：命令行参数 > 环境变量 > 默认值
 */
import { DEFAULT_SCAN_IPS, POLL_INTERVAL_REAL } from 'docat-shared/protocol'

export interface ServerConfig {
  /** 服务端口 */
  port: number
  /** 监听地址 */
  host: string
  /** 数据库文件路径 */
  dbPath: string
  /** 设备扫描 IP 列表 */
  scanIps: string[]
  /** 状态轮询间隔（毫秒） */
  pollInterval: number
  /** 日志级别 */
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  /** 是否自动连接已注册设备 */
  autoConnect: boolean
  /** 会话过期天数 */
  sessionExpireDays: number
}

export function loadConfig(): ServerConfig {
  return {
    port: parseInt(process.env.DOCAT_PORT ?? '9100', 10),
    host: process.env.DOCAT_HOST ?? '0.0.0.0',
    dbPath: process.env.DOCAT_DB_PATH ?? './data/docat.db',
    scanIps: process.env.DOCAT_SCAN_IPS?.split(',') ?? [...DEFAULT_SCAN_IPS],
    pollInterval: parseInt(process.env.DOCAT_POLL_INTERVAL ?? `${POLL_INTERVAL_REAL}`, 10),
    logLevel: (process.env.DOCAT_LOG_LEVEL as ServerConfig['logLevel']) ?? 'info',
    autoConnect: process.env.DOCAT_AUTO_CONNECT !== 'false',
    sessionExpireDays: parseInt(process.env.DOCAT_SESSION_EXPIRE_DAYS ?? '30', 10),
  }
}
