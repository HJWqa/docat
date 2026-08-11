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
 *   poses.get(name[, sep])   utils.toArray(text[, sep]) / utils.toString(arr[, sep]) / utils.sleep(ms)
 *   log.info / warn / error
 */
import { createInterface } from 'node:readline'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import vm from 'node:vm'

const state = {
  poses: [],
  devices: [],
  messages: [],
  processing: false,
  exited: false,
}

/** 脚本 require 的解析基准（服务端脚本目录），init 时下发 */
let requireFromScriptDir = null
/** 回退基准：服务端包目录（docat-server 的 dependencies，如 mathjs） */
const requireFromServer = createRequire(import.meta.url)

/** 内置 mathjs：脚本可直接用全局 math（如 math.add(1,2)），无需 require */
let mathjs = null
try {
  mathjs = requireFromServer('mathjs')
} catch {
  // mathjs 未安装时忽略，脚本使用 math 会得到明确的 undefined 错误
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

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n')
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
    get(name, sep) {
      const p = state.poses.find(x => x.name === name)
      if (!p) return undefined
      const arr = p.type === 'cartesian'
        ? [p.pose.x, p.pose.y, p.pose.z, p.pose.rx, p.pose.ry, p.pose.rz]
        : [...(p.joint || [])]
      return sep !== undefined && sep !== null ? arr.join(String(sep)) : arr
    },
    list() {
      return state.poses.map(p => p.name)
    },
  },
  utils: {
    toArray(text, sep = ';') {
      return splitFields(text, sep)
    },
    toString(arr, sep = ';') {
      return (Array.isArray(arr) ? arr : []).join(String(sep))
    },
    sleep(ms) {
      return new Promise((resolve) => {
        const wait = (left) => {
          if (state.exited || left <= 0) return resolve()
          setTimeout(() => wait(left - 50), Math.min(50, left))
        }
        wait(Math.max(0, Number(ms) || 0))
      })
    },
  },
  log: {
    info(text) { send({ type: 'log', level: 'info', text: String(text) }) },
    warn(text) { send({ type: 'log', level: 'warn', text: String(text) }) },
    error(text) { send({ type: 'log', level: 'error', text: String(text) }) },
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
      // require 基准目录（服务端脚本目录，可解析其 node_modules 及上层依赖）
      if (msg.requireBase) {
        try {
          requireFromScriptDir = createRequire(join(String(msg.requireBase), '__docat_require__.js'))
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
    const sandbox = {
      docat, console, setInterval, clearInterval, setTimeout, clearTimeout, Promise,
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
    send({ type: 'log', level: 'error', text: `脚本异常：${err instanceof Error ? err.message : String(err)}` })
    process.exit(1)
  }
}

function hasHandlers() {
  return Object.keys(listeners.message).length > 0
    || Object.keys(listeners.connect).length > 0
    || Object.keys(listeners.disconnect).length > 0
}

send({ type: 'ready' })
