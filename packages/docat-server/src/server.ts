/**
 * docat-server 主入口
 * 启动 Fastify HTTP 服务 + WebSocket + 设备池
 */
import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifyWebsocket from '@fastify/websocket'
import { Command } from 'commander'
import { loadConfig } from './config/index.js'
import { initDb, closeDb } from './db/index.js'
import { DevicePool } from './device/DevicePool.js'
import { setRuntimePoolTcpCheck } from './device/runtimeTcp.js'
import { AccessScheduler } from './access/AccessScheduler.js'
import { initProjectCache } from './api/rest/projectCache.js'
import { authRoutes } from './auth/routes.js'
import { deviceRoutes } from './api/rest/devices.js'
import { scriptRoutes } from './api/rest/scripts.js'
import { systemRoutes } from './api/rest/system.js'
import { userRoutes } from './api/rest/users.js'
import { websocketRoutes } from './api/websocket/ws.js'

// ─── CLI 参数 ────────────────────────────────────

const program = new Command()
program
  .name('docat-server')
  .description('docat 设备编排服务端')
  .version('0.1.0')
  .option('-p, --port <port>', '服务端口')
  .option('-H, --host <host>', '监听地址')
  .option('--db <path>', '数据库文件路径')
  .option('--no-auto-connect', '启动时不自动连接设备')
  .parse(process.argv)

const opts = program.opts<{
  port?: string
  host?: string
  db?: string
  autoConnect?: boolean
}>()

// ─── 初始化 ──────────────────────────────────────

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════╗')
  console.log('║   docat-server v0.1.0                    ║')
  console.log('║   Device Orchestration & Control Toolkit ║')
  console.log('╚══════════════════════════════════════════╝')

  // 1. 加载配置
  const config = loadConfig()
  if (opts.port !== undefined) config.port = parseInt(opts.port, 10) || config.port
  if (opts.host !== undefined) config.host = opts.host
  if (opts.db !== undefined) config.dbPath = opts.db
  if (opts.autoConnect === false) config.autoConnect = false
  console.log('[Config]', JSON.stringify(config, null, 2))

  // 2. 初始化数据库
  initDb(config)

  // 2.1 初始化项目缓存目录（缓存打开过的项目文件内容/列表，退出不清理）
  initProjectCache(config.cacheDir)

  // 3. 创建核心模块
  const pool = new DevicePool(config.scanIps)
  const scheduler = new AccessScheduler()
  setRuntimePoolTcpCheck(deviceId => pool.hasActiveTcp(deviceId))

  // 4. 创建 Fastify 服务
  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport: config.logLevel === 'debug' ? { target: 'pino-pretty' } : undefined,
    },
  })

  // 允许上传插件 zip 等二进制内容（body 以 Buffer 形式进入路由）
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: 200 * 1024 * 1024 },
    (_request, body, done) => done(null, body)
  )

  // 5. 注册插件
  await app.register(cors, { origin: true, credentials: true })
  await app.register(fastifyWebsocket)

  // 6. 注册路由
  await authRoutes(app)
  deviceRoutes(app, pool, scheduler)
  scriptRoutes(app, pool)
  systemRoutes(app, pool)
  userRoutes(app)
  websocketRoutes(app, pool, scheduler)

  // 7. 健康检查
  app.get('/api/health', async () => ({ status: 'ok', timestamp: Date.now() }))

  // 8. 优雅关闭
  const gracefulShutdown = async (signal: string) => {
    console.log(`\n[Server] Received ${signal}, shutting down gracefully...`)
    await pool.disconnectAll()
    closeDb()
    await app.close()
    process.exit(0)
  }

  process.on('SIGINT', () => gracefulShutdown('SIGINT'))
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))

  // 9. 启动服务
  try {
    await app.listen({ port: config.port, host: config.host })
    console.log(`[Server] Listening on http://${config.host}:${config.port}`)
    console.log(`[Server] WebSocket on ws://${config.host}:${config.port}/ws`)

    // 10. 自动连接已注册设备
    if (config.autoConnect) {
      const autoDevices = pool.loadAutoConnectDevices()
      console.log(`\n[DevicePool] Auto-connecting to ${autoDevices.length} registered devices...`)

      for (const device of autoDevices) {
        try {
          const result = await pool.connect(device.ip, device.id)
          if (result.status) {
            console.log(`  ✓ Connected: ${device.name} (${device.ip})`)
          } else {
            console.log(`  ✗ Failed: ${device.name} (${device.ip}) - ${result.message}`)
          }
        } catch (err) {
          console.log(`  ✗ Error: ${device.name} (${device.ip}) - ${(err as Error).message}`)
        }
      }
    }

    console.log('\n[Server] Ready ✓')
  } catch (err) {
    console.error('[Server] Failed to start:', err)
    process.exit(1)
  }
}

main()
