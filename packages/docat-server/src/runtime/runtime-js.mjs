#!/usr/bin/env node
/**
 * 编排脚本运行时（JS）— stdin/stdout JSON-lines 桥接
 *
 * 协议（stdin 收 / stdout 发）：
 *   发 {type:'ready'}
 *   收 {type:'init', poses, devices}   （服务端在 ready 后推送）
 *   收 {type:'script', content}        （init 之后推送，收到后执行）
 *   收 {type:'message', device, text}
 *   收 {type:'device-status', name, connected}
 *   收 {type:'poses', poses}
 *   发 {type:'send', device, text} {type:'log', level, text}
 *
 * 用户 API（与前端 mock 语义一致）：
 *   devices.send(name, text) / onMessage(name, cb) / onConnect / onDisconnect / isConnected
 *   poses.get(name[, sep[, digits]])   utils.toArray(text[, sep]) / utils.toString(arr[, sep[, digits]]) / utils.sleep(ms)
 *   log.info / warn / error
 * 浮点拼接小数位数：init 下发（通用设置），API 可传 digits 覆盖。
 */
import { createInterface } from 'node:readline'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import vm from 'node:vm'
import { imageToWorld, parseIwcaf, parseXml, worldToImage } from './calib.mjs'

const state = {
  poses: [],
  devices: [],
  messages: [],
  processing: false,
  exited: false,
  /** 浮点拼接小数位数（通用设置 init 下发，默认 6） */
  decimalDigits: 6,
}

/** 脚本 require/文件解析的基准目录（服务端脚本目录），init 时下发 */
let requireFromScriptDir = null
let scriptBaseDir = null
/** 回退基准：服务端包目录（docat-server 的 dependencies，如 mathjs） */
const requireFromServer = createRequire(import.meta.url)

/**
 * 内置 mathjs：脚本可直接用全局 math（如 math.add(1,2)），无需 require。
 * 懒加载（首次执行用户脚本时）：mathjs 导入耗时可达数秒，不能阻塞 ready 握手。
 */
let mathjsPromise = null
function loadMathjs() {
  if (!mathjsPromise) {
    mathjsPromise = Promise.resolve()
      .then(() => requireFromServer('mathjs'))
      .catch(() => null)
  }
  return mathjsPromise
}

const listeners = { message: {}, connect: {}, disconnect: {} }
/** 等待应答的 waiter：{ device, matcher, resolve, reject, timer } */
const pendingWaiters = []

function splitFields(text, sep = ';') {
  const t = String(text).replace(/\r/g, '').replace(/\n/g, '').trim()
  if (!t) return []
  const parts = t.split(sep).map(p => p.trim())
  while (parts.length && parts[0] === '') parts.shift()
  while (parts.length && parts[parts.length - 1] === '') parts.pop()
  return parts
}

/** 日志多参数格式化：对象 JSON 化，其余 String()，空格拼接（类似 console.log） */
function toLogText(v) {
  if (v === null) return 'null'
  if (v === undefined) return 'undefined'
  if (typeof v === 'object') {
    try { return JSON.stringify(v) } catch { return String(v) }
  }
  return String(v)
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

/** 浮点固定小数位（去尾零），避免科学计数法（如 8.3e-17）；非 number 原样字符串化；digits 缺省用 init 下发值 */
function fmtNumber(v, digits) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return String(v)
  const n = Math.floor(Number(digits))
  const d = Number.isFinite(n) && n >= 0 ? Math.min(12, n) : state.decimalDigits
  const s = v.toFixed(d).replace(/\.?0+$/, '')
  return s === '' || s === '-0' ? '0' : s
}

function joinValues(arr, sep, digits) {
  return (Array.isArray(arr) ? arr : []).map(v => fmtNumber(v, digits)).join(String(sep))
}

// ─── WSL 路径转换（/mnt/d/... ⇄ D:\...）──────────

function wslToWinPath(path) {
  const p = String(path ?? '')
  const m = /^\/mnt\/([a-zA-Z])(\/.*)?$/.exec(p)
  if (!m) return p
  const drive = m[1].toUpperCase()
  const rest = (m[2] || '').replace(/\//g, '\\')
  return `${drive}:${rest || '\\'}`
}

function winToWslPath(path) {
  const p = String(path ?? '')
  const m = /^([a-zA-Z]):[\\/](.*)$/.exec(p)
  if (!m) return p
  const drive = m[1].toLowerCase()
  const rest = (m[2] || '').replace(/[\\/]/g, '/')
  return `/mnt/${drive}/${rest}`
}

// ─── 内置 barcode：二维码/条码识别（zxing-wasm + jimp）──────────
// 依赖懒加载（首次 decode 调用才加载，不阻塞 ready 握手——mathjs 教训）；
// 由 docat-server 的 dependencies 解析（pnpm --filter docat-server add zxing-wasm jimp）。

let barcodeDepsPromise = null

function loadBarcodeDeps() {
  if (!barcodeDepsPromise) {
    barcodeDepsPromise = Promise.resolve()
      .then(() => {
        const zxingWasm = requireFromServer('zxing-wasm')
        // 本地加载 wasm 字节：zxing-wasm 默认 locateFile 指向 jsdelivr CDN，
        // Node 环境无网/内网会挂起或偶发失败——改为本地字节彻底离线可用
        try {
          const wasmBinary = readFileSync(requireFromServer.resolve('zxing-wasm/full/zxing_full.wasm'))
          zxingWasm.setZXingModuleOverrides({ wasmBinary })
        } catch {
          // 覆盖失败时保持默认行为（可能走 CDN），不阻断使用
        }
        // jimp v1 与 v0.22 的 require 形态不同，两种都兼容
        let Jimp
        try {
          ;({ Jimp } = requireFromServer('jimp'))
        } catch {
          Jimp = requireFromServer('jimp')
        }
        return { zxingWasm, Jimp }
      })
      .catch((err) => {
        barcodeDepsPromise = null // 允许下次重试
        throw new Error(`识别依赖加载失败（docat-server 需安装 zxing-wasm / jimp）：${err.message}`)
      })
  }
  return barcodeDepsPromise
}

/** 解析图片路径：原路径 + WSL⇄Windows 自动转换（同 utils.calib 语义），不存在则报错 */
function resolveImageFile(path) {
  const candidates = [path, wslToWinPath(path), winToWslPath(path)]
    .filter((p, i, arr) => p && arr.indexOf(p) === i)
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  const tried = candidates.length > 1 ? `（已尝试：${candidates.slice(1).join(' / ')}）` : ''
  throw new Error(`图片文件不存在：${path}${tried}`)
}

// ─── 用户 API ────────────────────────────────────────

const docat = {
  devices: {
    send(name, text) {
      send({ type: 'send', device: String(name), text: String(text) })
    },
    onMessage(name, cb) {
      if (!listeners.message[name]) listeners.message[name] = []
      listeners.message[name].push(cb)
    },
    onConnect(name, cb) {
      if (!listeners.connect[name]) listeners.connect[name] = []
      listeners.connect[name].push(cb)
    },
    onDisconnect(name, cb) {
      if (!listeners.disconnect[name]) listeners.disconnect[name] = []
      listeners.disconnect[name].push(cb)
    },
    isConnected(name) {
      const d = state.devices.find(x => x.name === name)
      return !!d && !!d.connected
    },
    /**
     * 等待设备下一条匹配的消息（Promise）
     * matcher: 字符串按前缀匹配（startsWith），或函数 (text) => boolean
     * 超时（默认 10s）未匹配则 reject
     */
    waitFor(name, matcher, timeoutMs = 10000) {
      return waitForMessage(String(name), matcher, Number(timeoutMs) || 10000)
    },
    /** 发送并等待匹配应答：devices.sendAndWait('am', 'GP;...', 'GP;reached;') */
    sendAndWait(name, text, matcher, timeoutMs = 10000) {
      this.send(name, text)
      return waitForMessage(String(name), matcher, Number(timeoutMs) || 10000)
    },
  },
  poses: {
    get(name, sep, digits) {
      const p = state.poses.find(x => x.name === name)
      if (!p) return undefined
      const arr = p.type === 'cartesian'
        ? [p.pose.x, p.pose.y, p.pose.z, p.pose.rx, p.pose.ry, p.pose.rz]
        : [...(p.joint || [])]
      return sep !== undefined && sep !== null ? joinValues(arr, sep, digits) : arr
    },
    list() {
      return state.poses.map(p => p.name)
    },
  },
  utils: {
    toArray(text, sep = ';') {
      return splitFields(text, sep)
    },
    toString(arr, sep = ';', digits) {
      return joinValues(arr, sep, digits)
    },
    sleep(ms) {
      return new Promise((resolve) => {
        const wait = (left) => {
          if (state.exited || left <= 0) return resolve()
          setTimeout(() => wait(left - 50), Math.min(50, left))
        }
        wait(Math.max(0, Number(ms) || 0))      })
    },
    // ─── WSL 路径转换（/mnt/d/... ⇄ D:\...）──────────
    wslToWin(path) {
      return wslToWinPath(path)
    },
    winToWsl(path) {
      return winToWslPath(path)
    },
    // ─── 标定转换（图像坐标 ⇄ 物理坐标）──────────────
    calib: {
      parseIwcaf(path) {
        return parseIwcaf(String(path ?? ''), scriptBaseDir || undefined)
      },
      parseXml(path) {
        return parseXml(String(path ?? ''), scriptBaseDir || undefined)
      },
      imageToWorld(m, x, y, sep, digits) {
        return imageToWorld(m, Number(x), Number(y), sep, digits)
      },
      worldToImage(m, wx, wy, sep, digits) {
        return worldToImage(m, Number(wx), Number(wy), sep, digits)
      },
    },
    // ─── 二维码/条码识别 ─────────────────────────────
    barcode: {
      /**
       * 识别图片中的二维码/条码 → [{ format, text, corners }]（无码返回 []）
       * corners 为四角像素坐标 [{x,y}×4]，可接 utils.calib.imageToWorld 转物理坐标。
       * 路径支持 WSL⇄Windows 自动转换（同 utils.calib）。
       */
      async decode(path) {
        const { zxingWasm, Jimp } = await loadBarcodeDeps()
        const file = resolveImageFile(String(path ?? ''))
        const img = await Jimp.read(file)
        const { width, height, data } = img.bitmap   // RGBA 像素
        const results = await zxingWasm.readBarcodes({
          data: new Uint8ClampedArray(data),
          width,
          height,
        })
        return results
          .filter((r) => r.isValid)
          .map((r) => ({
            format: r.format,
            text: r.text,
            corners: [
              { x: r.position.topLeft.x, y: r.position.topLeft.y },
              { x: r.position.topRight.x, y: r.position.topRight.y },
              { x: r.position.bottomRight.x, y: r.position.bottomRight.y },
              { x: r.position.bottomLeft.x, y: r.position.bottomLeft.y },
            ],
          }))
      },
    },
  },
  log: {
    info(...args) { send({ type: 'log', level: 'info', text: args.map(toLogText).join(' ') }) },
    warn(...args) { send({ type: 'log', level: 'warn', text: args.map(toLogText).join(' ') }) },
    error(...args) { send({ type: 'log', level: 'error', text: args.map(toLogText).join(' ') }) },
  },
}

// ─── 脚本 console：转发到日志面板 ──────────────────────
// console.log/info/debug/trace → info；warn → warn；error → error；assert 失败 → error。
// 输出不落进程 stdout，避免被父进程误当协议消息执行或报"非 JSON"错误。

const scriptConsole = {
  log(...args) { send({ type: 'log', level: 'info', text: args.map(toLogText).join(' ') }) },
  info(...args) { send({ type: 'log', level: 'info', text: args.map(toLogText).join(' ') }) },
  debug(...args) { send({ type: 'log', level: 'info', text: args.map(toLogText).join(' ') }) },
  trace(...args) { send({ type: 'log', level: 'info', text: args.map(toLogText).join(' ') }) },
  warn(...args) { send({ type: 'log', level: 'warn', text: args.map(toLogText).join(' ') }) },
  error(...args) { send({ type: 'log', level: 'error', text: args.map(toLogText).join(' ') }) },
  assert(cond, ...args) {
    if (!cond) {
      send({ type: 'log', level: 'error', text: args.map(toLogText).join(' ') || 'Assertion failed' })
    }
  },
}

// ─── 事件顺序处理 ────────────────────────────────────

async function processNext() {
  if (state.processing) return
  state.processing = true
  try {
    while (state.messages.length && !state.exited) {
      await dispatch(state.messages.shift())
    }
  } catch (err) {
    send({ type: 'log', level: 'error', text: `脚本异常：${err.message}` })
  } finally {
    state.processing = false
  }
}

async function dispatch(ev) {
  if (ev.type === 'message') {
    for (const cb of listeners.message[ev.device] || []) await cb(String(ev.text))
  } else if (ev.type === 'connect') {
    for (const cb of listeners.connect[ev.name] || []) await cb()
  } else if (ev.type === 'disconnect') {
    for (const cb of listeners.disconnect[ev.name] || []) await cb()
  }
}

// ─── 等待应答（waitFor / sendAndWait）────────────────

function normalizeMatcher(matcher) {
  return typeof matcher === 'function'
    ? matcher
    : (text) => String(text).startsWith(String(matcher))
}

function waitForMessage(device, matcher, timeoutMs) {
  const match = normalizeMatcher(matcher)

  // 先扫描已排队消息（顺序处理期间队列不会被消费）
  const queuedIdx = state.messages.findIndex(ev =>
    ev.type === 'message' && ev.device === device && match(String(ev.text)))
  if (queuedIdx >= 0) {
    const [ev] = state.messages.splice(queuedIdx, 1)
    return Promise.resolve(String(ev.text))
  }

  return new Promise((resolve, reject) => {
    const waiter = { device, matcher: match, resolve, reject, timer: null }
    waiter.timer = setTimeout(() => {
      const idx = pendingWaiters.indexOf(waiter)
      if (idx >= 0) pendingWaiters.splice(idx, 1)
      reject(new Error(`等待 ${device} 应答超时（${timeoutMs}ms）`))
    }, timeoutMs)
    pendingWaiters.push(waiter)
  })
}

/** 将消息投递给匹配的 waiter（消费）或普通消息队列 */
function deliverMessage(device, text) {
  const idx = pendingWaiters.findIndex(w => w.device === device && w.matcher(String(text)))
  if (idx >= 0) {
    const [waiter] = pendingWaiters.splice(idx, 1)
    clearTimeout(waiter.timer)
    waiter.resolve(String(text))
    return
  }
  state.messages.push({ type: 'message', device, text })
  void processNext()
}

// ─── 输入处理 ────────────────────────────────────────

const rl = createInterface({ input: process.stdin, terminal: false })

rl.on('line', (line) => {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  switch (msg.type) {
    case 'init':
      state.poses = msg.poses || []
      state.devices = msg.devices || []
      // 浮点拼接小数位数（通用设置；缺省 6）
      if (msg.decimalDigits !== undefined) {
        const n = Math.floor(Number(msg.decimalDigits))
        state.decimalDigits = Number.isFinite(n) && n >= 0 ? Math.min(12, n) : 6
      }
      // require 基准目录（服务端脚本目录，可解析其 node_modules 及上层依赖）
      if (msg.requireBase) {
        scriptBaseDir = String(msg.requireBase)
        try {
          // 相对路径（如 "data\\orch-scripts"）需先按服务端 CWD 解析为绝对路径，
          // 否则 createRequire 解析不到脚本目录的 node_modules
          requireFromScriptDir = createRequire(join(resolve(scriptBaseDir), '__docat_require__.js'))
        } catch {
          requireFromScriptDir = null
        }
      }
      break
    case 'poses':
      state.poses = msg.poses || []
      break
    case 'message':
      deliverMessage(String(msg.device ?? ''), String(msg.text ?? ''))
      break
    case 'device-status':
      state.devices = state.devices.map(d => d.name === msg.name ? { ...d, connected: msg.connected } : d)
      state.messages.push({ type: msg.connected ? 'connect' : 'disconnect', name: msg.name })
      void processNext()
      break
    case 'script':
      void runUserScript(String(msg.content ?? ''))
      break
  }
})

process.stdin.on('end', () => { state.exited = true })

// ─── 用户脚本执行 ────────────────────────────────────

async function runUserScript(code) {
  try {
    const body = `(async () => {\n"use strict";\n${code}\n})()`
    const script = new vm.Script(`(docat) => ${body}`, { filename: 'user-script.js' })
    // mathjs 懒加载：脚本实际执行前才同步就绪，不阻塞 ready 握手
    const mathjs = await loadMathjs()
    const sandbox = {
      docat, console: scriptConsole, setInterval, clearInterval, setTimeout, clearTimeout, Promise,
      Math, JSON, Date, Number, String, Boolean, Array, Object, RegExp, Error, undefined,
      // 与前端 mock 语义一致：裸名可用
      devices: docat.devices,
      poses: docat.poses,
      utils: docat.utils,
      log: docat.log,
      // 内置 mathjs（全局 math，无需 require；require('mathjs') 同样可用）
      math: mathjs,
      // 第三方库：优先从服务端脚本目录解析 node_modules（如 require('mathjs')），
      // 找不到时回退到服务端包目录（docat-server 的 dependencies）
      require: (id) => {
        const target = String(id)
        if (requireFromScriptDir) {
          try {
            return requireFromScriptDir(target)
          } catch (err) {
            if (err && err.code !== 'MODULE_NOT_FOUND') throw err
            return requireFromServer(target)
          }
        }
        return requireFromServer(target)
      },
    }
    const ctx = vm.createContext(sandbox)
    const fn = script.runInContext(ctx)
    await fn(docat)
    if (state.exited) return
    if (!hasHandlers()) {
      send({ type: 'log', level: 'info', text: '脚本运行结束' })
      process.exit(0)
    }
    send({ type: 'log', level: 'info', text: '顶层代码执行完毕（脚本保持监听）' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    let hint = ''
    // 常见坑提示：Windows 路径在 JS 字符串里被当成转义
    if (/Octal escape|Invalid(?: hexadecimal)? escape|Unexpected token|Invalid character/.test(msg)
      && /[A-Za-z]:[\\/]|\/\w+\\/.test(code)) {
      hint = '（提示：Windows 路径字符串请用双反斜杠 "D:\\\\..." 或正斜杠 "D:/..."，推荐正斜杠）'
    }
    // 编译/运行时错误行号：从 stack 解析用户代码位置（如 "user-script.js:4" 或 "at user-script.js:5:12"），
    // 减去包装行偏移（第 1 行包裹、第 2 行 "use strict"，用户代码从第 3 行起）
    let line, column
    {
      const stackLines = (err.stack || '').split('\n')
      for (let i = 0; i < Math.min(8, stackLines.length); i++) {
        const sm = /^\s*(?:at\s+)?(?:user-script\.js|<anonymous>|evalmachine\.<anonymous>):(\d+)(?::(\d+))?$/
          .exec(stackLines[i].trim())
        if (sm) {
          line = Math.max(1, Number(sm[1]) - 2)
          column = sm[2] ? Number(sm[2]) : undefined
          break
        }
      }
    }
    const lineText = line !== undefined
      ? `（第 ${line} 行${column !== undefined ? `，第 ${column} 列` : ''}）`
      : ''
    send({ type: 'log', level: 'error', text: `脚本异常：${msg}${hint}${lineText}`, line, column })
    process.exit(1)
  }
}

function hasHandlers() {
  return Object.keys(listeners.message).length > 0
    || Object.keys(listeners.connect).length > 0
    || Object.keys(listeners.disconnect).length > 0
}

send({ type: 'ready' })
