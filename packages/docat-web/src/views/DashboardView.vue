<template>
  <div class="dashboard">
    <!-- Header -->
    <header class="page-header">
      <div>
        <h2>Dashboard</h2>
        <p class="header-subtitle">SYSTEM STATUS · DEVICE MANAGEMENT</p>
      </div>
      <div class="header-actions">
        <router-link to="/programming" class="btn btn-secondary">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 4L2 8l4 4M10 4l4 4-4 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 2L7 14" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>
          PROGRAMMING
        </router-link>
        <button class="btn btn-secondary" @click="scan" :disabled="scanning">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 2"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>
          {{ scanning ? 'SCANNING...' : 'SCAN NETWORK' }}
        </button>
        <button class="btn btn-primary" @click="showAdd = true">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><line x1="8" y1="2" x2="8" y2="14" stroke="currentColor" stroke-width="2"/><line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" stroke-width="2"/></svg>
          ADD DEVICE
        </button>
        <button class="btn btn-secondary" @click="doLogout">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3M11 11l4-4-4-4M15 7H6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          LOGOUT
        </button>
      </div>
    </header>

    <!-- Stats Tiles -->
    <div class="stats-row mt-2">
      <div class="stat-tile">
        <div class="stat-value">{{ devices.length }}</div>
        <div class="stat-label">REGISTERED</div>
        <div class="stat-bar"><div class="stat-bar-fill" :style="{ width: '100%' }" /></div>
      </div>
      <div class="stat-tile stat-tile--online">
        <div class="stat-value">{{ deviceStore.connectedCount }}</div>
        <div class="stat-label">ONLINE</div>
        <div class="stat-bar"><div class="stat-bar-fill" :style="{ width: pct(deviceStore.connectedCount) }" /></div>
      </div>
      <div class="stat-tile stat-tile--locked">
        <div class="stat-value">{{ deviceStore.lockedCount }}</div>
        <div class="stat-label">LOCKED</div>
        <div class="stat-bar"><div class="stat-bar-fill" :style="{ width: pct(deviceStore.lockedCount) }" /></div>
      </div>
      <div class="stat-tile stat-tile--offline">
        <div class="stat-value">{{ offlineCount }}</div>
        <div class="stat-label">OFFLINE</div>
        <div class="stat-bar"><div class="stat-bar-fill" :style="{ width: pct(offlineCount) }" /></div>
      </div>
    </div>

    <!-- Scan Results -->
    <Transition name="slide">
      <div v-if="scanResults.length" class="card mt-2">
        <div class="card-section-header">
          <span class="status-dot status-dot--connected" />
          <span class="card-section-title">NETWORK SCAN RESULTS</span>
          <span class="card-section-count">{{ scanResults.length }}</span>
        </div>
        <div class="scan-list mt-1">
          <div v-for="d in scanResults" :key="d.portName" class="scan-row">
            <div class="scan-row-info">
              <span class="status-dot" :class="d.status === 'unconnected' ? 'status-dot--connected' : 'status-dot--disconnected'" />
              <div class="scan-row-details">
                <span class="scan-row-name">{{ d.alias || d.type || 'Unknown Device' }}</span>
                <span class="scan-row-meta">{{ d.portName }} · {{ d.type }} · {{ d.controllerTypeExt }}</span>
              </div>
            </div>
            <button class="btn btn-sm" :class="d.status === 'unconnected' ? 'btn-success' : 'btn-secondary'"
              :disabled="d.status !== 'unconnected'" @click="addFromScan(d)">
              {{ d.status === 'unconnected' ? 'REGISTER' : d.status.toUpperCase() }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Device Grid -->
    <div class="mt-3">
      <div class="card-section-header">
        <span class="status-dot status-dot--connected" />
        <span class="card-section-title">REGISTERED DEVICES</span>
        <span class="card-section-count">{{ devices.length }}</span>
      </div>

      <div class="device-grid mt-1">
        <TransitionGroup name="fade">
          <div v-for="d in devices" :key="d.id" class="card device-card" @click="$router.push(`/device/${d.id}`)">
            <div class="device-accent" :class="`device-accent--${getStatusClass(d.id)}`" />
            <div class="device-card-body">
              <div class="device-card-top">
                <div class="device-model-badge">{{ d.type || '---' }}</div>
                <span class="badge" :class="`badge-${getStatusClass(d.id)}`">
                  <span class="status-dot" :class="`status-dot--${getStatusClass(d.id) === 'online' ? 'connected' : getStatusClass(d.id) === 'locked' ? 'locked' : 'disconnected'}`" />
                  {{ getStatusLabel(d.id) }}
                </span>
              </div>
              <h3 class="device-card-name">{{ d.name }}</h3>
              <div class="device-card-ip">
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><circle cx="6" cy="4" r="1.5" fill="currentColor"/><circle cx="10" cy="12" r="1.5" fill="currentColor"/><path d="M2 8l4-4 4 4 4-4" stroke="currentColor" stroke-width="1" fill="none"/></svg>
                {{ d.ip }}
              </div>
              <div class="device-card-actions">
                <button v-if="!deviceStore.isConnected(d.id)" class="btn btn-sm btn-success flex-1" @click.stop="doConnect(d.id)">
                  CONNECT
                </button>
                <button v-else class="btn btn-sm btn-secondary flex-1" @click.stop="doDisconnect(d.id)">
                  DISCONNECT
                </button>
                <button class="btn btn-sm btn-danger" @click.stop="doDelete(d)">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 5h10M6 5V3h4v2M5 5v8a1 1 0 001 1h4a1 1 0 001-1V5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
              </div>
            </div>
          </div>
        </TransitionGroup>
      </div>

      <div v-if="!devices.length" class="empty-state">
        <div class="empty-hex">
          <svg width="60" height="60" viewBox="0 0 48 48" fill="none"><polygon points="24,6 42,16 42,32 24,42 6,32 6,16" stroke="currentColor" stroke-width="1"/></svg>
        </div>
        <h3>NO DEVICES REGISTERED</h3>
        <p>Scan the network or manually add a device to begin monitoring</p>
      </div>
    </div>

    <!-- Delete Confirm Modal -->
    <Transition name="fade">
      <div v-if="showDelete" class="modal-overlay" @click.self="showDelete = null">
        <div class="modal card">
          <div class="modal-header"><h3>CONFIRM REMOVAL</h3>
            <button class="modal-close" @click="showDelete = null">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><line x1="3" y1="3" x2="13" y2="13" stroke="currentColor" stroke-width="1.5"/><line x1="13" y1="3" x2="3" y2="13" stroke="currentColor" stroke-width="1.5"/></svg>
            </button>
          </div>
          <p class="mt-1" style="color:var(--text-secondary);font-size:14px;">
            Remove device <strong>{{ deletingDevice?.name || deletingDevice?.ip }}</strong> from the registry?
          </p>
          <p style="color:var(--text-muted);font-size:12px;margin-top:6px;">
            This does not affect the physical device — it only removes the registration from docat.
          </p>
          <div class="modal-actions mt-2">
            <button class="btn btn-secondary flex-1" @click="showDelete = null">CANCEL</button>
            <button class="btn btn-danger flex-1" @click="confirmDelete">REMOVE</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Toast -->
    <Toast ref="toastRef" />

    <!-- Add Device Modal -->
    <Transition name="fade">
      <div v-if="showAdd" class="modal-overlay" @click.self="showAdd = false">
        <div class="modal card">
          <div class="modal-header"><h3>REGISTER DEVICE</h3>
            <button class="modal-close" @click="showAdd = false">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><line x1="3" y1="3" x2="13" y2="13" stroke="currentColor" stroke-width="1.5"/><line x1="13" y1="3" x2="3" y2="13" stroke="currentColor" stroke-width="1.5"/></svg>
            </button>
          </div>
          <form @submit.prevent="addDevice" class="modal-form mt-1">
            <div class="field-group"><label class="field-label">IP ADDRESS</label><input v-model="newIp" class="input" placeholder="192.168.5.1" /></div>
            <div class="field-group mt-1"><label class="field-label">DEVICE NAME</label><input v-model="newName" class="input" placeholder="Production Line A — CR5" /></div>
            <div class="field-group mt-1"><label class="field-label">TYPE <span class="field-hint">(AUTO-DETECT)</span></label><input v-model="newType" class="input" placeholder="Leave empty for auto-detection" /></div>
            <label class="checkbox-row mt-2"><input v-model="newAutoConnect" type="checkbox" class="checkbox" /><span class="checkbox-label">AUTO-CONNECT ON SERVER START</span></label>
            <div class="modal-actions mt-2">
              <button type="button" class="btn btn-secondary flex-1" @click="showAdd = false">CANCEL</button>
              <button type="submit" class="btn btn-primary flex-1" :disabled="!newIp || !newName">REGISTER</button>
            </div>
          </form>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import * as api from '../services/api'
import { clearToken } from '../services/api'
import { wsClient } from '../services/ws'
import { deviceStore } from '../stores/deviceStore'
import Toast from '../components/Toast.vue'
import type { DeviceConfig, DeviceInfo } from 'docat-shared/types'

const router = useRouter()
const devices = ref<DeviceConfig[]>([])
const scanResults = ref<DeviceInfo[]>([])
const scanning = ref(false)
const showAdd = ref(false)
const showDelete = ref<DeviceConfig | null>(null)
const deletingDevice = computed(() => showDelete.value)
const toastRef = ref<InstanceType<typeof Toast>>()
const newIp = ref('')
const newName = ref('')
const newType = ref('')
const newAutoConnect = ref(true)

const offlineCount = computed(() => devices.value.length - deviceStore.connectedCount)
const pct = (v: number) => devices.value.length ? `${(v / devices.value.length) * 100}%` : '0%'

type StatusClass = 'online' | 'offline' | 'locked'

function getStatusClass(deviceId: string): StatusClass {
  if (deviceStore.isLocked(deviceId)) return 'locked'
  if (deviceStore.isConnected(deviceId)) return 'online'
  return 'offline'
}
function getStatusLabel(deviceId: string): string {
  return getStatusClass(deviceId).toUpperCase()
}

async function load() {
  const res = await api.listDevices()
  if (res.success && res.data) {
    devices.value = res.data
    deviceStore.setDevices(res.data)
  }
  // 同步 deviceStore
  for (const d of devices.value) {
    try {
      const s = await api.getDeviceStatus(d.id)
      if (s.success && s.data) {
        deviceStore.setConnected(d.id, s.data.connected)
      }
    } catch { /* ignore */ }
  }
}

async function scan() {
  scanning.value = true
  try { const res = await api.scanDevices(); if (res.success && res.data) scanResults.value = res.data }
  finally { scanning.value = false }
}

async function addDevice() {
  if (!newIp.value || !newName.value) return
  await api.registerDevice(newIp.value, newName.value, newAutoConnect.value)
  showAdd.value = false; newIp.value = ''; newName.value = ''
  await load()
}

async function addFromScan(d: DeviceInfo) {
  await api.registerDevice(d.portName, d.alias || d.type, true)
  scanResults.value = scanResults.value.filter(s => s.portName !== d.portName)
  await load()
}

async function doConnect(id: string) {
  const res = await api.connectDevice(id)
  if (res.success) {
    deviceStore.setConnected(id, true)
    toastRef.value?.success('Device connected')
  } else {
    toastRef.value?.error(`Connect failed: ${res.error?.message}`)
  }
}

async function doDisconnect(id: string) {
  await api.disconnectDevice(id)
  deviceStore.setOffline(id)
  toastRef.value?.info('Device disconnected')
}

function doDelete(device: DeviceConfig) { showDelete.value = device }

async function confirmDelete() {
  if (!showDelete.value) return
  const d = showDelete.value
  showDelete.value = null
  const res = await api.deleteDevice(d.id)
  if (res.success) {
    deviceStore.setOffline(d.id)
    toastRef.value?.success(`"${d.name}" removed`)
    await load()
  } else {
    toastRef.value?.error(`Failed: ${res.error?.message}`)
  }
}

function doLogout() { clearToken(); wsClient.disconnect(); deviceStore.reset(); router.push('/login') }

onMounted(() => {
  load()
  wsClient.onOnline((id) => deviceStore.setConnected(id, true))
  wsClient.onOffline((id) => deviceStore.setOffline(id))
})
</script>

<style scoped>
.dashboard { padding: 40px 48px; max-width: 1400px; min-height: 100vh; }
.page-header { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 16px; }
.header-subtitle { font-family: var(--font-mono); font-size: 0.6rem; font-weight: 600; letter-spacing: 0.15em; color: var(--text-muted); margin-top: 4px; }
.header-actions { display: flex; gap: 8px; }
.stats-row { display: flex; gap: 16px; flex-wrap: wrap; }
.stat-tile { flex: 1; min-width: 140px; max-width: 240px; padding: 24px; background: var(--surface-0); border: 1px solid var(--border); border-radius: var(--radius-lg); position: relative; overflow: hidden; }
.stat-value { font-family: var(--font-mono); font-size: 2.4rem; font-weight: 400; color: var(--text-primary); line-height: 1; }
.stat-label { font-family: var(--font-display); font-size: 0.55rem; font-weight: 700; letter-spacing: 0.15em; color: var(--text-muted); margin-top: 6px; }
.stat-bar { height: 2px; background: var(--border); margin-top: 12px; border-radius: 1px; }
.stat-bar-fill { height: 100%; border-radius: 1px; transition: width 0.5s var(--ease-out); }
.stat-tile--online .stat-value { color: var(--status-online); }
.stat-tile--online .stat-bar-fill { background: var(--status-online); box-shadow: 0 0 6px var(--status-online); }
.stat-tile--locked .stat-value { color: var(--status-locked); }
.stat-tile--locked .stat-bar-fill { background: var(--status-locked); box-shadow: 0 0 6px var(--status-locked); }
.stat-tile--offline .stat-value { color: var(--text-muted); }
.stat-tile--offline .stat-bar-fill { background: var(--text-muted); }
.card-section-header { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
.card-section-title { font-family: var(--font-display); font-size: 0.6rem; font-weight: 700; letter-spacing: 0.15em; color: var(--text-muted); flex: 1; }
.card-section-count { font-family: var(--font-mono); font-size: 0.7rem; color: var(--text-muted); }
.scan-list { display: flex; flex-direction: column; gap: 4px; }
.scan-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; background: var(--void-surface); border-radius: var(--radius); border: 1px solid transparent; transition: border-color var(--duration-fast); }
.scan-row:hover { border-color: var(--border); }
.scan-row-info { display: flex; align-items: center; gap: 10px; min-width: 0; }
.scan-row-details { display: flex; flex-direction: column; min-width: 0; }
.scan-row-name { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.scan-row-meta { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.device-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
.device-card { cursor: pointer; padding: 0; overflow: hidden; transition: transform var(--duration-normal) var(--ease-out), border-color var(--duration-normal) var(--ease-out), box-shadow var(--duration-normal) var(--ease-out); }
.device-card:hover { transform: translateY(-2px); }
.device-accent { height: 2px; width: 100%; transition: height var(--duration-fast), box-shadow var(--duration-fast); }
.device-card:hover .device-accent { height: 3px; }
.device-accent--online { background: var(--status-online); box-shadow: 0 0 8px var(--status-online); }
.device-accent--locked { background: var(--status-locked); box-shadow: 0 0 8px var(--status-locked); }
.device-accent--offline { background: var(--status-offline); }
.device-card-body { padding: 20px; }
.device-card-top { display: flex; justify-content: space-between; align-items: center; }
.device-model-badge { font-family: var(--font-display); font-size: 0.55rem; font-weight: 700; letter-spacing: 0.12em; padding: 2px 8px; border: 1px solid var(--border); border-radius: 2px; color: var(--text-muted); }
.device-card-name { font-family: var(--font-display); font-size: 1rem; font-weight: 600; color: var(--text-primary); margin-top: 12px; letter-spacing: 0.06em; }
.device-card-ip { display: flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); margin-top: 4px; }
.device-card-actions { display: flex; gap: 6px; margin-top: 16px; }
.empty-state { text-align: center; padding: 80px 20px; }
.empty-hex { color: var(--border); margin-bottom: 16px; }
.empty-state h3 { font-family: var(--font-display); color: var(--text-muted); font-size: 0.8rem; letter-spacing: 0.12em; }
.empty-state p { color: var(--text-muted); font-size: 0.75rem; margin-top: 8px; }
.modal-overlay { position: fixed; inset: 0; background: rgba(4,10,20,0.85); backdrop-filter: blur(6px); z-index: 100; display: flex; align-items: center; justify-content: center; }
.modal { width: 100%; max-width: 460px; padding: 28px; }
.modal-header { display: flex; justify-content: space-between; align-items: center; }
.modal-close { background: none; border: none; cursor: pointer; color: var(--text-muted); padding: 4px; transition: color var(--duration-fast); }
.modal-close:hover { color: var(--text-primary); }
.modal-form { display: flex; flex-direction: column; }
.modal-actions { display: flex; gap: 8px; }
.field-group { display: flex; flex-direction: column; gap: 4px; }
.field-label { font-family: var(--font-display); font-size: 0.55rem; font-weight: 700; letter-spacing: 0.15em; color: var(--text-muted); }
.field-hint { font-weight: 400; color: var(--text-muted); opacity: 0.6; }
.checkbox-row { display: flex; align-items: center; gap: 10px; cursor: pointer; }
.checkbox { appearance: none; width: 16px; height: 16px; border: 1px solid var(--border); border-radius: 2px; background: var(--void-deep); cursor: pointer; position: relative; transition: border-color var(--duration-fast); }
.checkbox:checked { border-color: var(--cyan-300); background: var(--cyan-700); }
.checkbox:checked::after { content: ''; position: absolute; left: 4px; top: 1px; width: 5px; height: 9px; border: solid var(--cyan-300); border-width: 0 2px 2px 0; transform: rotate(45deg); }
.checkbox-label { font-family: var(--font-display); font-size: 0.55rem; font-weight: 600; letter-spacing: 0.1em; color: var(--text-secondary); }
h3 { margin: 0; }
</style>
