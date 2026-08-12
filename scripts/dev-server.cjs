const { spawn } = require('node:child_process')
const path = require('node:path')

const serverDir = path.resolve(__dirname, '..', 'packages', 'docat-server')
const tsxCli = require.resolve('tsx/cli', { paths: [serverDir] })

const child = spawn(process.execPath, [tsxCli, 'watch', 'src/server.ts'], {
  cwd: serverDir,
  stdio: ['ignore', 'inherit', 'inherit'],
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
