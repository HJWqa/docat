/**
 * docat CLI — 命令行工具
 * 用于快速操作 docat-server 管理的设备
 */
import { Command } from 'commander'

const program = new Command()
program
  .name('docat')
  .description('docat 命令行工具 — 设备操作与控制')
  .version('0.1.0')

program
  .command('scan')
  .description('扫描网络中的 Dobot 设备')
  .option('-s, --server <url>', 'docat-server 地址', 'http://localhost:9100')
  .action(async (opts) => {
    console.log(`Scanning devices via ${opts.server}...`)
    // TODO: 实现 HTTP API 调用
    console.log('Not yet implemented')
  })

program
  .command('connect <ip>')
  .description('连接设备')
  .action((ip) => {
    console.log(`Connecting to ${ip}...`)
    // TODO: 实现
  })

program
  .command('jog <device> <axis> <direction>')
  .description('点动控制设备轴')
  .action((device, axis, direction) => {
    console.log(`Jogging ${device} axis=${axis} direction=${direction}`)
    // TODO: 实现
  })

program
  .command('status <device>')
  .description('查看设备状态')
  .action((device) => {
    console.log(`Getting status for ${device}...`)
    // TODO: 实现
  })

program.parse(process.argv)
