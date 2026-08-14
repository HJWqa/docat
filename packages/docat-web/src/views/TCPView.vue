<template>
  <div class="tcp-page">
    <!-- Header -->
    <header class="workspace-header">
      <div class="workspace-header-left">
        <router-link to="/" class="back-btn">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          仪表盘
        </router-link>
        <div class="top-bar-device">
          <h2>{{ device?.name || '设备' }}</h2>
          <span class="top-bar-ip">{{ device?.ip }}</span>
        </div>
      </div>
      <div class="workspace-header-center">
        <div class="workspace-switch">
          <router-link :to="{ path: `/device/${deviceId}`, query: $route.query }" class="workspace-switch-btn">控制</router-link>
          <router-link :to="{ path: `/device/${deviceId}/programming`, query: $route.query }" class="workspace-switch-btn">编程</router-link>
          <router-link :to="{ path: `/device/${deviceId}/tcp`, query: $route.query }" class="workspace-switch-btn workspace-switch-btn--active">TCP</router-link>
        </div>
      </div>
      <div class="workspace-header-actions">
        <span :class="['connection-badge', connected ? 'connection-badge--online' : 'connection-badge--offline']">
          <span class="status-dot" :class="`status-dot--${connected ? 'connected' : 'disconnected'}`" />
          <span class="bic">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </span>
          {{ connected ? 'TCP 在线' : 'TCP 离线' }}
        </span>
      </div>
    </header>

    <div class="tcp-layout">
      <!-- Row 1: Connect + Dashboard -->
      <div class="tcp-top-row">
        <!-- Connect Panel -->
        <div class="card tcp-connect">
          <div class="card-title">机器人连接</div>
          <div class="connect-fields">
            <div class="connect-field">
              <label>地址</label>
              <input :value="device?.ip" class="connect-input" readonly />
            </div>
            <div class="connect-field">
              <label>仪表盘</label>
              <input value="29999" class="connect-input" readonly />
            </div>
            <div class="connect-field">
              <label>反馈</label>
              <input value="30004" class="connect-input" readonly />
            </div>
          </div>
          <div class="connect-actions">
            <button v-if="!connected" class="btn btn-success btn-sm" @click="connectTcp" :disabled="connecting">
              {{ connecting ? '连接中...' : '连接' }}
            </button>
            <template v-else>
              <button class="btn btn-secondary btn-sm" @click="disconnectTcp">断开</button>
              <label class="auto-toggle" title="自动重连">
                <input type="checkbox" :checked="autoReconnect" @change="toggleAutoReconnect" />
                <span class="auto-toggle-label">自动</span>
              </label>
            </template>
          </div>
        </div>

        <!-- Dashboard Panel -->
        <div class="card tcp-dashboard">
          <div class="card-title">仪表盘</div>
          <div class="dash-row">
            <span class="dash-key">速度</span>
            <input type="range" min="1" max="100" step="1" v-model.number="speedRatio" class="dash-slider"
              @change="sendCommandStr(`SpeedFactor(${speedRatio})`)" :disabled="!connected" />
            <span class="dash-val">{{ speedRatio }}%</span>
          </div>
          <div class="dash-buttons">
            <button class="btn btn-success btn-sm" :disabled="!connected" @click="sendCommandStr('EnableRobot()')">使能</button>
            <button class="btn btn-secondary btn-sm" :disabled="!connected" @click="sendCommandStr('DisableRobot()')">去使能</button>
            <button class="btn btn-secondary btn-sm" :disabled="!connected" @click="sendCommandStr('ResetRobot()')">复位</button>
            <button class="btn btn-secondary btn-sm" :disabled="!connected" @click="sendCommandStr('ClearError()')">清错误</button>
          </div>
          <div class="dash-io">
            <span>数字输入 <code>{{ fmtHex(feedback?.DigitalInputs) }}</code></span>
            <span>数字输出 <code>{{ fmtHex(feedback?.DigitalOutputs) }}</code></span>
            <span>模式 <code :class="modeClass(feedback?.robotMode)">{{ modeLabel(feedback?.robotMode) }}</code></span>
            <span>状态
              <code :class="feedback?.ErrorStatus ? 'err' : ''">{{ feedback?.ErrorStatus ? '错误' : feedback?.EnableStatus ? '已使能' : '—' }}</code>
            </span>
          </div>
          <!-- Custom command -->
          <div class="dash-cmd-row">
            <input v-model.trim="tcpCommand" class="connect-input dash-cmd-input" placeholder="例如 MovJ(0,0,0,0,0,0)"
              @keyup.enter="sendCommand" :disabled="!connected || sending" />
            <button class="btn btn-primary btn-sm" :disabled="!connected || !tcpCommand || sending" @click="sendCommand">
              {{ sending ? '...' : '发送' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Row 2: Move Panel -->
      <div class="card tcp-move">
        <div class="card-title">移动功能</div>
        <div class="move-section">
          <div class="move-row-label">关节</div>
          <div v-for="j in 6" :key="'j'+j" class="move-field">
            <label>J{{ j }}</label>
            <input v-model.number="moveJoints['j'+j]" type="number" step="0.1" class="move-input" />
            <div class="move-jog-btns">
              <button class="btn btn-secondary jog-btn" :disabled="!connected"
                @pointerdown="startJog(`J${j}+`)" @pointerup="stopJog" @pointerleave="stopJog">+</button>
              <button class="btn btn-secondary jog-btn" :disabled="!connected"
                @pointerdown="startJog(`J${j}-`)" @pointerup="stopJog" @pointerleave="stopJog">−</button>
            </div>
          </div>
          <button class="btn btn-primary btn-sm move-go" :disabled="!connected" @click="moveToJoints">关节运动</button>
        </div>
        <div class="move-section">
          <div class="move-row-label">坐标</div>
          <div v-for="(axis, ai) in ['X','Y','Z','RX','RY','RZ']" :key="'c'+ai" class="move-field">
            <label>{{ axis }}</label>
            <input v-model.number="moveCoord[axis.toLowerCase()]" type="number" step="0.1" class="move-input"
              @blur="onCoordIkBlur" />
            <div class="move-jog-btns">
              <button class="btn btn-secondary jog-btn" :disabled="!connected"
                @pointerdown="startJog(`${axis}+`)" @pointerup="stopJog" @pointerleave="stopJog">+</button>
              <button class="btn btn-secondary jog-btn" :disabled="!connected"
                @pointerdown="startJog(`${axis}-`)" @pointerup="stopJog" @pointerleave="stopJog">−</button>
            </div>
          </div>
          <button class="btn btn-primary btn-sm move-go" :disabled="!connected" @click="moveToCoord">直线运动</button>
          <span v-if="coordIkOk" class="check-label check-label--ok">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </span>
          <span v-if="coordIkFail" class="check-label check-label--fail">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><line x1="4" y1="4" x2="12" y2="12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /><line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
            {{ coordIkMsg }}
          </span>
        </div>
      </div>

      <!-- Row 3: Feedback + Log -->
      <div class="tcp-bottom-row">
        <!-- Feedback Panel -->
        <div class="card tcp-feedback">
          <div class="card-title">反馈</div>
          <div class="feed-compact">
            <div class="feed-col">
              <div class="feed-kv"><span>速度</span><span>{{ (feedback?.SpeedScaling ?? 0 * 100).toFixed(0) }}%</span></div>
              <div class="feed-kv"><span>模式</span><span :class="modeClass(feedback?.robotMode)">{{ modeLabel(feedback?.robotMode) }}</span></div>
              <div class="feed-kv"><span>数字输入</span><span class="feed-mono">{{ fmtHex(feedback?.DigitalInputs) }}</span></div>
              <div class="feed-kv"><span>数字输出</span><span class="feed-mono">{{ fmtHex(feedback?.DigitalOutputs) }}</span></div>
            </div>
            <div class="feed-col">
              <div v-for="(v, i) in (feedback?.QActual ?? [])" :key="'q'+i" class="feed-kv">
                <span>J{{ i + 1 }}</span><span class="feed-mono">{{ v?.toFixed(2) }}</span>
              </div>
            </div>
            <div class="feed-col">
              <div class="feed-kv"><span>X</span><span class="feed-mono">{{ feedback?.ToolVectorActual?.[0]?.toFixed(1) ?? '—' }}</span></div>
              <div class="feed-kv"><span>Y</span><span class="feed-mono">{{ feedback?.ToolVectorActual?.[1]?.toFixed(1) ?? '—' }}</span></div>
              <div class="feed-kv"><span>Z</span><span class="feed-mono">{{ feedback?.ToolVectorActual?.[2]?.toFixed(1) ?? '—' }}</span></div>
              <div class="feed-kv"><span>RX</span><span class="feed-mono">{{ feedback?.ToolVectorActual?.[3]?.toFixed(1) ?? '—' }}</span></div>
              <div class="feed-kv"><span>RY</span><span class="feed-mono">{{ feedback?.ToolVectorActual?.[4]?.toFixed(1) ?? '—' }}</span></div>
              <div class="feed-kv"><span>RZ</span><span class="feed-mono">{{ feedback?.ToolVectorActual?.[5]?.toFixed(1) ?? '—' }}</span></div>
            </div>
          </div>
          <!-- Error Info -->
          <div v-if="feedback?.ErrorStatus" class="feed-error">
            <div class="card-title" style="margin-bottom:4px">错误信息</div>
            <div class="feed-error-text">检测到机器人错误 — 请通过清错误或控制页面查看告警</div>
          </div>
        </div>

        <!-- Log Panel -->
        <div class="card tcp-log">
          <div class="card-title">日志</div>
          <div class="log-list" ref="logListRef">
            <div v-for="(entry, i) in tcpLog" :key="i" class="log-entry">
              <span :class="['log-arrow', entry.type === 'send' ? 'log-arrow--send' : 'log-arrow--recv']">
                {{ entry.type === 'send' ? '>' : '<' }}
              </span>
              <span class="log-text">{{ entry.text }}</span>
            </div>
            <div v-if="tcpLog.length === 0" class="log-empty">发送命令以查看日志</div>
          </div>
        </div>
      </div>
    </div>

    <Toast ref="toastRef" />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import * as api from '../services/api'
import { deviceStore } from '../stores/deviceStore'
import Toast from '../components/Toast.vue'
import type { DeviceConfig } from 'docat-shared/types'

const route = useRoute()
const deviceId = route.params.id as string
const toastRef = ref<InstanceType<typeof Toast>>()
const device = ref<DeviceConfig | null>(deviceStore.getDevice(deviceId))
const logListRef = ref<HTMLElement>()

const connected = ref(false)
const connecting = ref(false)
const autoReconnect = ref(false)
const tcpCommand = ref('')
const sending = ref(false)
const speedRatio = ref(50)
const pollCount = ref(0)
let pollTimer: ReturnType<typeof setInterval> | null = null

interface FeedData {
  robotMode: number; DigitalInputs: number; DigitalOutputs: number
  SpeedScaling: number; ProgramState: number
  QActual: number[]; ToolVectorActual: number[]
  EnableStatus: number; ErrorStatus: number
}
const feedback = ref<FeedData | null>(null)

// Move
const moveJoints = reactive<Record<string, number>>({ j1:0,j2:0,j3:0,j4:0,j5:0,j6:0 })
const moveCoord = reactive<Record<string, number>>({ x:0,y:0,z:0,rx:0,ry:0,rz:0 })
const coordIkOk = ref(false)
const coordIkFail = ref(false)
const coordIkMsg = ref('')
let coordIkTimer: ReturnType<typeof setTimeout> | null = null

// Log
interface LogEntry { type: 'send' | 'recv'; text: string }
const tcpLog = ref<LogEntry[]>([])

function fmtHex(v: number | undefined): string {
  return v !== undefined ? '0x' + v.toString(16).toUpperCase().padStart(4, '0') : '—'
}
function modeLabel(m: number | undefined): string {
  const map: Record<number, string> = { 1:'INIT',2:'BRAKE_OPEN',3:'OFF',4:'DISABLED',5:'ENABLED',6:'BACKDRIVE',7:'RUNNING',8:'MOVING',9:'FW_UPD',10:'ERROR',11:'PAUSED',12:'JOG',13:'ESTOP' }
  return m !== undefined ? (map[m] || `?${m}`) : '—'
}
function modeClass(m: number | undefined): string {
  if (m === 5 || m === 7) return 'feed-mode--on'
  if (m === 10 || m === 13) return 'feed-mode--err'
  return ''
}

async function connectTcp() {
  connecting.value = true
  coordIkOk.value = false; coordIkFail.value = false
  try {
    await pollStatus()
    // 轮询直到连上或超时（10s）
    const start = Date.now()
    while (!connected.value && Date.now() - start < 10000) {
      await new Promise(r => setTimeout(r, 500))
      await pollStatus()
    }
    if (!connected.value) {
      toastRef.value?.error('连接超时 — 请检查设备端口 29999/30004 是否可达')
    }
    if (!pollTimer) pollTimer = setInterval(pollStatus, 500)
  } finally {
    connecting.value = false
  }
}
async function disconnectTcp() {
  await api.disconnectCRTcp(deviceId)
  connected.value = false; feedback.value = null
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}
async function toggleAutoReconnect() {
  autoReconnect.value = !autoReconnect.value
  await api.setCRAutoReconnect(deviceId, autoReconnect.value)
}
async function pollStatus() {
  try {
    const res = await api.getCRTcpStatus(deviceId)
    if (res.success && res.data) {
      connected.value = res.data.dashboard === 'connected'
      if (res.data.feedback) feedback.value = res.data.feedback as unknown as FeedData
      pollCount.value++
    }
  } catch { /* ignore */ }
}

async function sendCommandStr(cmd: string) {
  tcpCommand.value = cmd
  await sendCommand()
}
async function sendCommand() {
  if (!tcpCommand.value.trim()) return
  sending.value = true
  const cmd = tcpCommand.value.trim()
  tcpLog.value.push({ type: 'send', text: cmd })
  try {
    const res = await api.sendCRDashboard(deviceId, cmd)
    const reply = res.success ? res.data?.reply || '(空)' : `错误: ${res.error?.message}`
    tcpLog.value.push({ type: 'recv', text: reply })
  } catch (err) {
    tcpLog.value.push({ type: 'recv', text: `错误: ${(err as Error).message}` })
  } finally {
    sending.value = false
    // Scroll log to bottom
    requestAnimationFrame(() => {
      if (logListRef.value) logListRef.value.scrollTop = logListRef.value.scrollHeight
    })
  }
}

// Jog
let jogTimer: ReturnType<typeof setInterval> | null = null
function startJog(dir: string) {
  if (!connected.value) return
  tcpLog.value.push({ type:'send', text:`MoveJog(${dir})` })
  sendCommandStr(`MoveJog(${dir})`)
}
function stopJog() {
  if (!connected.value) return
  sendCommandStr('MoveJog()')
}

function moveToJoints() {
  const j = moveJoints
  sendCommandStr(`MovJ(${j.j1},${j.j2},${j.j3},${j.j4},${j.j5},${j.j6})`)
}
function moveToCoord() {
  const c = moveCoord
  sendCommandStr(`MovL(${c.x},${c.y},${c.z},${c.rx},${c.ry},${c.rz})`)
}
async function onCoordIkBlur() {
  coordIkOk.value = false; coordIkFail.value = false
  if (coordIkTimer) clearTimeout(coordIkTimer)
  coordIkTimer = setTimeout(async () => {
    try {
      const c = moveCoord
      const cmd = `InverseSolution(${c.x},${c.y},${c.z},${c.rx},${c.ry},${c.rz})`
      const res = await api.sendCRDashboard(deviceId, cmd)
      const reply = res.success ? (res.data?.reply ?? '') : ''
      if (reply.includes('Error') || reply.includes('fail') || reply === '') {
        coordIkOk.value = false; coordIkFail.value = true
        coordIkMsg.value = reply.substring(0, 60) || '不可达'
      } else {
        coordIkOk.value = true; coordIkFail.value = false
      }
    } catch { /* ignore */ }
  }, 400)
}

onMounted(async () => {
  const res = await api.listDevices()
  if (res.success && res.data) {
    device.value = res.data.find(d => d.id === deviceId) ?? null
  }
})

onUnmounted(() => {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
})
</script>

<style scoped>
.tcp-page { padding: 40px 48px; max-width: 1600px; margin-inline: auto; min-height: 100vh; outline: none; }
.workspace-header {
  display: grid; grid-template-columns: minmax(360px, 1fr) auto minmax(360px, 1fr);
  align-items: center; gap: 16px; padding-bottom: 12px;
}
.workspace-header-left { display: flex; align-items: center; gap: 20px; min-width: 0; }
.workspace-header-center { display: flex; align-items: center; justify-content: center; min-width: 0; }
.workspace-header-actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.back-btn { display: flex; align-items: center; gap: 6px; font-family: var(--font-body); font-size: 0.82rem; font-weight: 500; color: var(--text-muted); text-decoration: none; transition: color var(--duration-fast); padding: 6px 0; }
.back-btn:hover { color: var(--cyan-300); }
.top-bar-device h2 { font-family: var(--font-display); font-size: 1.3rem; font-weight: 600; color: var(--text-primary); letter-spacing: -0.01em; }
.top-bar-ip { font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-muted); margin-top: 2px; display: block; }
.workspace-switch { display: flex; align-items: center; gap: 2px; }
.workspace-switch-btn {
  display: inline-flex; align-items: center; justify-content: center; min-height: 30px; padding: 0 12px;
  border: 1px solid var(--border); background: var(--surface-1); color: var(--text-muted);
  font-family: var(--font-body); font-size: 0.72rem; font-weight: 500;
  text-decoration: none; white-space: nowrap;
}
.workspace-switch-btn:first-child { border-radius: var(--radius) 0 0 var(--radius); }
.workspace-switch-btn:last-child { border-radius: 0 var(--radius) var(--radius) 0; }
.workspace-switch-btn:hover { border-color: var(--border-bright); color: var(--text-primary); }
.workspace-switch-btn:active { transform: translateY(1px); }
.workspace-switch-btn--active { border-color: var(--cyan-500); background: var(--cyan-900); color: var(--cyan-300); }
.connection-badge { display: flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: var(--radius); font-family: var(--font-body); font-size: 0.78rem; font-weight: 600; border: 1px solid; }
.bic { display: inline-flex; align-items: center; }
.bic svg { display: block; }
.connection-badge--online { border-color: var(--status-online); color: var(--status-online); background: var(--status-online-dim); }
.connection-badge--offline { border-color: var(--status-offline); color: var(--status-offline); background: var(--status-offline-dim); }
.status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.status-dot--connected { background: var(--status-success); }
.status-dot--disconnected { background: var(--status-offline); }

/* Layout */
.tcp-layout { padding: 16px; max-width: 1100px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; }

/* Card */
.card { background: var(--surface-0); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 14px 18px; }
.card-title { font-family: var(--font-body); font-size: 0.72rem; font-weight: 600; color: var(--text-muted); margin-bottom: 10px; }

/* Row 1: Connect + Dashboard */
.tcp-top-row { display: flex; gap: 12px; }
.tcp-connect { flex: 0 0 280px; }
.tcp-dashboard { flex: 1; }

.connect-fields { display: flex; gap: 8px; margin-bottom: 8px; }
.connect-field { display: flex; flex-direction: column; gap: 2px; flex: 1; }
.connect-field label { font-family: var(--font-body); font-size: 0.62rem; font-weight: 500; color: var(--text-muted); }
.connect-input { padding: 5px 8px; font-family: var(--font-mono); font-size: 0.72rem; background: var(--void-deep); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text-primary); outline: none; width: 100%; box-sizing: border-box; transition: border-color var(--duration-fast), box-shadow var(--duration-fast); }
.connect-input:focus { border-color: var(--accent); box-shadow: var(--ring); }
.connect-input[readonly] { opacity: 0.6; }
.connect-actions { display: flex; align-items: center; gap: 8px; }
.auto-toggle { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
.auto-toggle input { accent-color: var(--cyan-500); width: 14px; height: 14px; }
.auto-toggle-label { font-family: var(--font-body); font-size: 0.68rem; font-weight: 500; color: var(--text-muted); }

/* Dashboard */
.dash-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.dash-key { font-family: var(--font-body); font-size: 0.66rem; font-weight: 600; color: var(--text-muted); min-width: 38px; }
.dash-slider { flex: 1; height: 4px; accent-color: var(--cyan-500); }
.dash-val { font-family: var(--font-mono); font-size: 0.7rem; color: var(--text-primary); min-width: 36px; text-align: right; }
.dash-buttons { display: flex; gap: 6px; margin-bottom: 8px; }
.dash-io { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 8px; font-size: 0.68rem; color: var(--text-muted); }
.dash-io code { font-family: var(--font-mono); font-size: 0.68rem; color: var(--cyan-300); margin-left: 3px; }
.dash-io code.err { color: var(--status-danger); }
.dash-cmd-row { display: flex; gap: 6px; }
.dash-cmd-input { flex: 1; }

/* Move Panel */
.tcp-move { }
.move-section { display: flex; align-items: flex-end; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
.move-row-label { font-family: var(--font-body); font-size: 0.64rem; font-weight: 600; color: var(--text-muted); padding-bottom: 20px; min-width: 32px; }
.move-field { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.move-field label { font-family: var(--font-body); font-size: 0.6rem; font-weight: 600; color: var(--text-muted); }
.move-input { width: 58px; padding: 3px 5px; font-family: var(--font-mono); font-size: 0.68rem; background: var(--void-deep); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text-primary); outline: none; text-align: center; transition: border-color var(--duration-fast); }
.move-input:focus { border-color: var(--accent); }
.move-jog-btns { display: flex; gap: 1px; }
.jog-btn { width: 26px; height: 18px; padding: 0; font-size: 0.6rem; line-height: 1; display: flex; align-items: center; justify-content: center; }
.move-go { align-self: flex-end; margin-bottom: 2px; }

/* Row 3: Feedback + Log */
.tcp-bottom-row { display: flex; gap: 12px; height: 280px; }
.tcp-feedback { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.tcp-log { flex: 0 0 320px; display: flex; flex-direction: column; overflow: hidden; }

.feed-compact { display: flex; gap: 20px; flex: 1; }
.feed-col { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.feed-kv { display: flex; justify-content: space-between; gap: 12px; font-size: 0.66rem; padding: 1px 0; }
.feed-kv span:first-child { color: var(--text-muted); }
.feed-mono { font-family: var(--font-mono); font-size: 0.64rem; color: var(--text-secondary); }
.feed-mode--on { color: var(--cyan-300); font-weight: 600; }
.feed-mode--err { color: var(--status-danger); font-weight: 600; }

.feed-error { margin-top: auto; padding-top: 8px; border-top: 1px solid var(--border-subtle); }
.feed-error-text { font-family: var(--font-mono); font-size: 0.64rem; color: var(--status-danger); }

.log-list { flex: 1; overflow-y: auto; font-family: var(--font-mono); font-size: 0.66rem; }
.log-entry { display: flex; gap: 6px; padding: 2px 0; align-items: baseline; }
.log-arrow { flex-shrink: 0; font-weight: 700; font-size: 0.6rem; width: 10px; }
.log-arrow--send { color: var(--cyan-400); }
.log-arrow--recv { color: var(--text-muted); }
.log-text { color: var(--text-secondary); word-break: break-all; line-height: 1.4; }
.log-empty { color: var(--text-muted); padding: 8px 0; font-style: italic; }
</style>
