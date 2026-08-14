<template>
  <section class="prog-panel">
    <div class="panel-header">
      <span class="panel-title">编程</span>
      <span class="panel-hint">控制器项目 · 运行监控</span>
    </div>

    <div class="prog-fields">
      <div class="field-row">
        <label class="field-label">设备</label>
        <select v-model="deviceId" class="prog-input" @change="onDeviceChange">
          <option value="">选择设备</option>
          <option v-for="d in devices" :key="d.id" :value="d.id">{{ d.name }} · {{ d.ip }}</option>
        </select>
      </div>

      <div class="field-row">
        <label class="field-label">项目</label>
        <div class="proj-row">
          <select v-model="projectName" class="prog-input" :disabled="!deviceId" @change="onProjectChange">
            <option value="">选择项目</option>
            <option v-for="p in projects" :key="p.name" :value="p.name">{{ p.name }}</option>
          </select>
          <button class="btn btn-secondary btn-sm" :disabled="!deviceId || loadingProjects" @click="refreshProjects" title="刷新项目列表">
            {{ loadingProjects ? '…' : '↻' }}
          </button>
        </div>
        <p class="field-hint">自动加载缓存项目，点击 ↻ 从控制器（SFTP）拉取完整列表</p>
      </div>

      <div class="prog-actions">
        <button class="btn btn-success btn-sm flex-1" :disabled="!canRun || starting || (running && !stopping)" @click="doRun" title="启动所选项目 (Ctrl+B)">
          {{ starting ? '启动中...' : '▶ 运行' }}
        </button>
        <button class="btn btn-danger btn-sm flex-1" :disabled="!deviceId || stopping" @click="doStop" title="停止项目 (Ctrl+M)">
          {{ stopping ? '停止中...' : '⏹ 停止' }}
        </button>
      </div>

      <div class="prog-status">
        <span class="status-label">状态</span>
        <span :class="['run-badge', runtime?.running ? 'run-badge--on' : 'run-badge--off']">
          {{ runtime?.running ? '● 运行中' : '○ 已停止' }}
        </span>
        <span v-if="runtime?.runningProject" class="running-project">{{ runtime.runningProject }}</span>
      </div>
    </div>

    <Toast ref="toastRef" />
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import * as api from '../../services/api'
import type { ControllerProjectSummary } from '../../services/api'
import { deviceStore } from '../../stores/deviceStore'
import { runtimeStore } from '../../stores/runtimeStore'
import { loadWorkspace } from '../../stores/workspaceState'
import { addLog, isOrchMockMode } from '../../stores/orchestrationStore'
import Toast from '../Toast.vue'

const MOCK_PROJECTS: Array<{ name: string; language: string }> = [
  { name: 'robot_test', language: 'lua' },
  { name: 'demo_app', language: 'lua' },
  { name: 'vision_pick', language: 'python' },
  { name: 'calibrate', language: 'python' },
]

const deviceId = ref(loadSavedDevice())
const projectName = ref('')
const projects = ref<ControllerProjectSummary[]>([])
const loadingProjects = ref(false)
const starting = ref(false)
const stopping = ref(false)
const toastRef = ref<InstanceType<typeof Toast>>()

const devices = computed(() => Object.values(deviceStore.devices))
const runtime = computed(() => deviceId.value ? runtimeStore.getState(deviceId.value) : null)
const running = computed(() => runtime.value?.running ?? false)
const canRun = computed(() => Boolean(deviceId.value && projectName.value))

let pollTimer: ReturnType<typeof setInterval> | null = null

// ─── 记住上次选中的设备 + 项目（按设备，前端 localStorage）──

const DEVICE_KEY = 'docat.orchestration.prog-device'

function loadSavedDevice(): string {
  try {
    return localStorage.getItem(DEVICE_KEY) ?? ''
  } catch {
    return ''
  }
}

function saveDevice(id: string) {
  try {
    localStorage.setItem(DEVICE_KEY, id)
  } catch {
    // ignore
  }
}

const SEL_KEY = 'docat.orchestration.prog-selection'

function loadSavedSelection(deviceId: string): string {
  try {
    const raw = localStorage.getItem(SEL_KEY)
    if (!raw) return ''
    const map = JSON.parse(raw) as Record<string, string>
    return map[deviceId] ?? ''
  } catch {
    return ''
  }
}

function saveSelection(deviceId: string, projectName: string) {
  try {
    const raw = localStorage.getItem(SEL_KEY)
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {}
    map[deviceId] = projectName
    localStorage.setItem(SEL_KEY, JSON.stringify(map))
  } catch {
    // ignore
  }
}

function clearSelection(deviceId: string) {
  try {
    const raw = localStorage.getItem(SEL_KEY)
    if (!raw) return
    const map = JSON.parse(raw) as Record<string, string>
    if (deviceId in map) {
      delete map[deviceId]
      localStorage.setItem(SEL_KEY, JSON.stringify(map))
    }
  } catch {
    // ignore
  }
}

/** 切换设备：自动从缓存（最近项目）加载下拉；完整列表由手动 ↻ 刷新（SFTP）拉取 */
function onDeviceChange() {
  projectName.value = ''
  projects.value = []
  if (!deviceId.value) return
  void loadRecentProjects()
}

function cachedProjectItem(name: string, language: ControllerProjectSummary['language'] = 'lua'): ControllerProjectSummary {
  return { name, path: `/${name}`, language, size: 0, modifiedAt: '', files: 1 }
}

/** 自动加载最近项目（缓存，免 SFTP）：先取本页记住的选择，再退回最近列表 */
async function loadRecentProjects() {
  if (!deviceId.value) return
  const remembered = loadSavedSelection(deviceId.value)
  const cached = remembered || loadWorkspace(deviceId.value)?.projectName

  let recent: ControllerProjectSummary[] = []
  if (isOrchMockMode()) {
    recent = MOCK_PROJECTS.map(p => cachedProjectItem(p.name, p.language as ControllerProjectSummary['language']))
  } else {
    const res = await api.listRecentProjects(deviceId.value)
    if (res.success && res.data) {
      recent = res.data.map(r => cachedProjectItem(r.projectName, r.language as ControllerProjectSummary['language']))
    }
  }

  // 合并记住/缓存的项目（列表里没有则补上），并自动选中
  if (cached && !recent.some(p => p.name === cached)) recent.push(cachedProjectItem(cached))
  projects.value = recent
  if (cached) {
    projectName.value = cached
    addLog('编程', 'system', `已自动加载最近项目（${recent.length} 个），选中 ${cached}`)
  } else if (recent.length) {
    projectName.value = recent[0].name
    addLog('编程', 'system', `已自动加载最近项目（${recent.length} 个），选中 ${recent[0].name}`)
  } else {
    addLog('编程', 'system', '暂无最近项目 — 点击 ↻ 从控制器拉取完整列表')
  }
}

/** 仅当选中项目时才监测运行状态 */
watch([deviceId, projectName], ([did, pid]) => {
  stopPoll()
  if (did && pid) {
    pollTimer = setInterval(() => void runtimeStore.syncFromDevice(did), 3000)
    void runtimeStore.syncFromDevice(did)
  }
})

async function refreshProjects() {
  if (!deviceId.value) return
  loadingProjects.value = true
  try {
    if (isOrchMockMode()) {
      const cached = loadSavedSelection(deviceId.value) || loadWorkspace(deviceId.value)?.projectName
      projects.value = MOCK_PROJECTS.map(p => cachedProjectItem(p.name, p.language as ControllerProjectSummary['language']))
      if (cached && !projects.value.some(p => p.name === cached)) {
        projects.value.push(cachedProjectItem(cached))
      }
      if (!projectName.value && cached) projectName.value = cached
      addLog('编程', 'system', '[Mock] 项目列表已刷新')
      return
    }
    const res = await api.listDeviceProjects(deviceId.value)
    if (res.success && res.data) {
      projects.value = res.data
      if (projectName.value && !res.data.some(p => p.name === projectName.value)) {
        const gone = projectName.value
        projectName.value = ''
        clearSelection(deviceId.value)
        addLog('编程', 'system', `项目 ${gone} 不存在，已清除记忆选择`)
      }
      addLog('编程', 'system', `项目列表已刷新（${res.data.length} 个）`)
    } else {
      addLog('编程', 'error', `刷新失败：${res.error?.message}`)
    }
  } finally {
    loadingProjects.value = false
  }
}

/** 启动序号：停止按下时自增，作废在途的启动请求（响应回来不再置为运行） */
let startSeq = 0
/** 停止序号：运行按下时自增，作废在途的停止请求（响应回来不再置为停止） */
let stopSeq = 0

async function doRun() {
  if (!deviceId.value || !projectName.value) return
  // 已在运行且无在途停止：不允许重复启动；「停止中」可打断（作废在途停止）
  if (running.value && !stopping.value) return
  stopSeq++
  stopping.value = false
  const seq = ++startSeq
  starting.value = true
  try {
    if (isOrchMockMode()) {
      runtimeStore.reset(deviceId.value)
      runtimeStore.setRunning(deviceId.value, true)
      runtimeStore.getState(deviceId.value).runningProject = projectName.value
      runtimeStore.addLog(deviceId.value, 'client', '[Mock] 正在运行项目...')
      addLog('编程', 'system', `[Mock] 已启动 ${projectName.value}`)
      return
    }
    const res = await api.runDeviceProject(deviceId.value, projectName.value)
    // 启动期间被「停止」打断：忽略迟到的启动响应
    if (seq !== startSeq) return
    if (res.success) {
      await runtimeStore.syncFromDevice(deviceId.value)
      addLog('编程', 'system', `已启动 ${projectName.value}`)
    } else {
      addLog('编程', 'error', `运行失败：${res.error?.message}`)
    }
  } finally {
    if (seq === startSeq) starting.value = false
  }
}

async function doStop() {
  if (!deviceId.value) return
  // 立即结束「启动中」状态，并作废在途的启动请求
  startSeq++
  starting.value = false
  const seq = ++stopSeq
  stopping.value = true
  try {
    if (isOrchMockMode()) {
      runtimeStore.setRunning(deviceId.value, false)
      runtimeStore.clearLine(deviceId.value)
      runtimeStore.getState(deviceId.value).cursorText = '已停止'
      addLog('编程', 'system', '[Mock] 已停止')
      return
    }
    const res = await api.debuggerStop(deviceId.value)
    // 停止期间被「运行」打断：忽略迟到的停止响应，不把新启动的项目置为停止
    if (seq !== stopSeq) return
    if (res.success) {
      runtimeStore.setRunning(deviceId.value, false)
      runtimeStore.clearLine(deviceId.value)
      addLog('编程', 'system', '已停止')
    } else {
      addLog('编程', 'error', `停止失败：${res.error?.message}`)
    }
  } finally {
    if (seq === stopSeq) stopping.value = false
  }
}

function onProjectChange() {
  if (!deviceId.value) return
  if (projectName.value) {
    saveSelection(deviceId.value, projectName.value)
    addLog('编程', 'system', `选中项目 ${projectName.value}（已记住选择）`)
  }
}

/** Ctrl+B / Cmd+B：启动最近项目（无设备/无项目/已在运行 → toast 反馈） */
function runRecent() {
  if (!deviceId.value) {
    toastRef.value?.info('请先选择设备')
    return
  }
  if (!projectName.value) {
    toastRef.value?.info('暂无可用项目，请先在编程面板选择项目')
    return
  }
  if (running.value && !stopping.value) {
    toastRef.value?.info('项目已在运行')
    return
  }
  void doRun()
}

/** Ctrl+M / Cmd+M：停止当前项目（无设备/未运行 → toast 反馈） */
function stopCurrent() {
  if (!deviceId.value) {
    toastRef.value?.info('请先选择设备')
    return
  }
  if (!running.value) {
    toastRef.value?.info('项目未在运行')
    return
  }
  void doStop()
}

// 快捷键由父组件 SettingsPanel 统一监听（tab 未打开时自动切换），此处仅提供动作
defineExpose({ runRecent, stopCurrent })

function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

let devicesReady = false

// 设备列表就绪（含刷新页面后异步加载完成）→ 恢复记住的设备（已删除则退回第一个）并加载缓存项目
watch(() => devices.value.length, (len) => {
  if (len === 0) { devicesReady = false; return }
  if (devicesReady) return
  devicesReady = true
  if (deviceId.value && !devices.value.some(d => d.id === deviceId.value)) {
    deviceId.value = '' // 记住的设备已删除，退回默认
  }
  if (!deviceId.value) {
    deviceId.value = devices.value[0]?.id ?? ''
  }
  void loadRecentProjects()
}, { immediate: true })

// 记住设备选择（含恢复/自动选中，user 手动切换经 onDeviceChange）
watch(deviceId, (id) => saveDevice(id))

onBeforeUnmount(stopPoll)</script>

<style scoped>
.prog-panel { display: flex; flex-direction: column; gap: 10px; }
.panel-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.panel-title { font-family: var(--font-display); font-size: 0.8rem; font-weight: 600; color: var(--text-primary); }
.panel-hint { font-family: var(--font-mono); font-size: 0.56rem; color: var(--text-muted); }
.prog-fields { display: flex; flex-direction: column; gap: 8px; }
.field-row { display: flex; flex-direction: column; gap: 4px; }
.field-label { font-family: var(--font-body); font-size: 0.68rem; font-weight: 500; color: var(--text-muted); }
.field-hint { font-size: 0.58rem; color: var(--text-muted); }
.prog-input {
  width: 100%; padding: 6px 9px; font-family: var(--font-mono); font-size: 0.7rem;
  background: var(--void-deep); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text-primary); outline: none;
}
.prog-input:focus { border-color: var(--accent); box-shadow: var(--ring); }
.proj-row { display: flex; gap: 6px; align-items: center; }
.proj-row .prog-input { flex: 1; min-width: 0; }
.prog-actions { display: flex; gap: 8px; }
.prog-status { display: flex; align-items: center; gap: 8px; padding: 7px 9px; background: var(--surface-1); border: 1px solid var(--border); border-radius: var(--radius); }
.status-label { font-size: 0.64rem; color: var(--text-muted); }
.run-badge { font-family: var(--font-mono); font-size: 0.64rem; font-weight: 600; }
.run-badge--on { color: var(--status-online); }
.run-badge--off { color: var(--status-offline); }
.running-project { font-family: var(--font-mono); font-size: 0.6rem; color: var(--cyan-300); margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
