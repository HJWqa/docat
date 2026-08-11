<template>
  <div class="dashboard">
    <!-- Header -->
    <header class="page-header">
      <div>
        <h2>总览</h2>
        <p class="header-subtitle">系统状态 · 设备管理</p>
      </div>
      <div class="header-actions">
        <a href="#/orchestration" target="_blank" rel="noopener" class="btn btn-secondary">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1" y="2.5" width="4.5" height="3.2" rx="0.6" stroke="currentColor" stroke-width="1.1"/><rect x="10.5" y="2.5" width="4.5" height="3.2" rx="0.6" stroke="currentColor" stroke-width="1.1"/><rect x="5.75" y="10.3" width="4.5" height="3.2" rx="0.6" stroke="currentColor" stroke-width="1.1"/><path d="M3.2 5.7v1.6a1 1 0 001 1h1.5M12.8 5.7v1.6a1 1 0 01-1 1h-1.5M6.5 9a2.2 2.2 0 003 0M8 9.3v1" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>
          编排
        </a>
        <router-link to="/programming" class="btn btn-secondary">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 4L2 8l4 4M10 4l4 4-4 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 2L7 14" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>
          编程
        </router-link>
        <button class="btn btn-secondary" @click="scan" :disabled="scanning">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 2"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>
          {{ scanning ? '扫描中...' : '扫描网络' }}
        </button>
        <button class="btn btn-primary" @click="showAdd = true">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><line x1="8" y1="2" x2="8" y2="14" stroke="currentColor" stroke-width="2"/><line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" stroke-width="2"/></svg>
          添加设备
        </button>
        <div class="user-menu-wrapper">
          <button class="btn btn-secondary" @click="showUserDropdown = !showUserDropdown">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5" r="2.5" stroke="currentColor" stroke-width="1.2"/><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
            {{ currentUser?.username?.toUpperCase() || '用户' }}
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" :style="{ transform: showUserDropdown ? 'rotate(180deg)' : '' }" style="transition:transform 0.15s"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <Transition name="menu">
            <div v-if="showUserDropdown" class="dropdown-menu">
              <div class="dropdown-header">
                <span class="dropdown-username">{{ currentUser?.username }}</span>
                <span class="dropdown-role">{{ currentUser?.role?.toUpperCase() }}</span>
              </div>
              <button class="dropdown-item" @click="showChangePassword = true; showUserDropdown = false">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="4" r="2" stroke="currentColor" stroke-width="1.2"/></svg>
                修改密码
              </button>
              <button class="dropdown-item" @click="showSwitchUser = true; showUserDropdown = false">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="6" cy="5" r="2.5" stroke="currentColor" stroke-width="1.2"/><circle cx="12" cy="6" r="2" stroke="currentColor" stroke-width="1.2"/><path d="M1 13c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M12 11a3 3 0 013 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
                切换用户
              </button>
              <router-link v-if="currentUser?.role === 'admin'" to="/users" class="dropdown-item" @click="showUserDropdown = false">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="4" r="2.5" stroke="currentColor" stroke-width="1.2"/><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
                用户管理
              </router-link>
              <div class="dropdown-divider" />
              <button class="dropdown-item dropdown-item--danger" @click="doLogout">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3M11 11l4-4-4-4M15 7H6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                登出
              </button>
            </div>
          </Transition>
        </div>
      </div>
    </header>

    <!-- Stats Tiles -->
    <div class="stats-row mt-2">
      <div class="stat-tile">
        <div class="stat-value">{{ devices.length }}</div>
        <div class="stat-label">已注册</div>
        <div class="stat-bar"><div class="stat-bar-fill" :style="{ width: '100%' }" /></div>
      </div>
      <div class="stat-tile stat-tile--online">
        <div class="stat-value">{{ deviceStore.connectedCount }}</div>
        <div class="stat-label">在线</div>
        <div class="stat-bar"><div class="stat-bar-fill" :style="{ width: pct(deviceStore.connectedCount) }" /></div>
      </div>
      <div class="stat-tile stat-tile--locked">
        <div class="stat-value">{{ deviceStore.lockedCount }}</div>
        <div class="stat-label">已锁定</div>
        <div class="stat-bar"><div class="stat-bar-fill" :style="{ width: pct(deviceStore.lockedCount) }" /></div>
      </div>
      <div class="stat-tile stat-tile--offline">
        <div class="stat-value">{{ offlineCount }}</div>
        <div class="stat-label">离线</div>
        <div class="stat-bar"><div class="stat-bar-fill" :style="{ width: pct(offlineCount) }" /></div>
      </div>
    </div>

    <!-- Scan Results -->
    <Transition name="slide">
      <div v-if="scanResults.length" class="card mt-2">
        <div class="card-section-header">
          <span class="status-dot status-dot--connected" />
          <span class="card-section-title">网络扫描结果</span>
          <span class="card-section-count">{{ scanResults.length }}</span>
        </div>
        <div class="scan-list mt-1">
          <div v-for="d in scanResults" :key="d.portName" class="scan-row">
            <div class="scan-row-info">
              <span class="status-dot" :class="d.status === 'unconnected' ? 'status-dot--connected' : 'status-dot--disconnected'" />
              <div class="scan-row-details">
                <span class="scan-row-name">{{ d.alias || d.type || '未知设备' }}</span>
                <span class="scan-row-meta">{{ d.portName }} · {{ d.type }} · {{ d.controllerTypeExt }}</span>
              </div>
            </div>
            <button class="btn btn-sm" :class="d.status === 'unconnected' ? 'btn-success' : 'btn-secondary'"
              :disabled="d.status !== 'unconnected'" @click="addFromScan(d)">
              {{ d.status === 'unconnected' ? '注册' : d.status.toUpperCase() }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Device Grid -->
    <div class="mt-3">
      <div class="card-section-header">
        <span class="status-dot status-dot--connected" />
        <span class="card-section-title">已注册设备</span>
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
                  <span class="status-dot" :class="`status-dot--${getStatusClass(d.id) === 'online' ? 'connected' : getStatusClass(d.id) === 'virtual' ? 'virtual' : getStatusClass(d.id) === 'locked' ? 'locked' : 'disconnected'}`" />
                  {{ getStatusLabel(d.id) }}
                </span>
              </div>
              <h3 class="device-card-name">{{ d.name }}</h3>
              <div class="device-card-ip">
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><circle cx="6" cy="4" r="1.5" fill="currentColor"/><circle cx="10" cy="12" r="1.5" fill="currentColor"/><path d="M2 8l4-4 4 4 4-4" stroke="currentColor" stroke-width="1" fill="none"/></svg>
                {{ d.ip }}
              </div>
              <div class="device-card-actions">
                <template v-if="!deviceStore.isConnected(d.id)">
                  <button class="btn btn-sm btn-success flex-1" @click.stop="doConnect(d.id, 'exclusive')">
                    连接
                  </button>
                  <button class="btn btn-sm btn-secondary" @click.stop="doConnect(d.id, 'virtual')" title="虚拟连接：不占用设备，仅 HTTP">
                    vCONN
                  </button>
                </template>
                <button v-else class="btn btn-sm btn-secondary flex-1" @click.stop="doDisconnect(d.id)">
                  断开
                </button>
                <button class="btn btn-sm btn-secondary" @click.stop="doEdit(d)" title="编辑设备">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
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
        <h3>暂无已注册设备</h3>
        <p>扫描网络或手动添加设备以开始监控</p>
      </div>
    </div>

    <!-- Delete Confirm Modal -->
    <Transition name="fade">
      <div v-if="showDelete" class="modal-overlay" @click.self="showDelete = null">
        <div class="modal card">
          <div class="modal-header"><h3>确认移除</h3>
            <button class="modal-close" @click="showDelete = null">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><line x1="3" y1="3" x2="13" y2="13" stroke="currentColor" stroke-width="1.5"/><line x1="13" y1="3" x2="3" y2="13" stroke="currentColor" stroke-width="1.5"/></svg>
            </button>
          </div>
          <p class="mt-1" style="color:var(--text-secondary);font-size:14px;">
            确定从注册表中移除设备 <strong>{{ deletingDevice?.name || deletingDevice?.ip }}</strong> 吗？
          </p>
          <p style="color:var(--text-muted);font-size:12px;margin-top:6px;">
            此操作不会影响物理设备 — 仅从 docat 中移除注册记录。
          </p>
          <div class="modal-actions mt-2">
            <button class="btn btn-secondary flex-1" @click="showDelete = null">取消</button>
            <button class="btn btn-danger flex-1" @click="confirmDelete">移除</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Toast -->
    <Toast ref="toastRef" />

    <!-- User Modals -->
    <ChangePasswordModal :visible="showChangePassword" @close="showChangePassword = false" @changed="onPasswordChanged" />
    <SwitchUserModal :visible="showSwitchUser" @close="showSwitchUser = false" @switched="onUserSwitched" />

    <!-- Add Device Modal -->
    <Transition name="fade">
      <div v-if="showAdd" class="modal-overlay" @click.self="showAdd = false">
        <div class="modal card">
          <div class="modal-header"><h3>注册设备</h3>
            <button class="modal-close" @click="showAdd = false">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><line x1="3" y1="3" x2="13" y2="13" stroke="currentColor" stroke-width="1.5"/><line x1="13" y1="3" x2="3" y2="13" stroke="currentColor" stroke-width="1.5"/></svg>
            </button>
          </div>
          <form @submit.prevent="addDevice" class="modal-form mt-1">
            <div class="field-group"><label class="field-label">IP 地址</label><input v-model="newIp" class="input" placeholder="192.168.5.1" /></div>
            <div class="field-group mt-1"><label class="field-label">设备名称</label><input v-model="newName" class="input" placeholder="产线 A — CR5" /></div>
            <div class="field-group mt-1"><label class="field-label">型号 <span class="field-hint">（自动检测）</span></label><input v-model="newType" class="input" placeholder="留空则自动检测" /></div>
            <label class="checkbox-row mt-2"><input v-model="newAutoConnect" type="checkbox" class="checkbox" /><span class="checkbox-label">服务启动时自动连接</span></label>
            <div class="modal-actions mt-2">
              <button type="button" class="btn btn-secondary flex-1" @click="showAdd = false">取消</button>
              <button type="submit" class="btn btn-primary flex-1" :disabled="!newIp || !newName">注册</button>
            </div>
          </form>
        </div>
      </div>
    </Transition>

    <!-- Edit Device Modal -->
    <Transition name="fade">
      <div v-if="editingDevice" class="modal-overlay" @click.self="editingDevice = null">
        <div class="modal card">
          <div class="modal-header"><h3>编辑设备</h3>
            <button class="modal-close" @click="editingDevice = null">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><line x1="3" y1="3" x2="13" y2="13" stroke="currentColor" stroke-width="1.5"/><line x1="13" y1="3" x2="3" y2="13" stroke="currentColor" stroke-width="1.5"/></svg>
            </button>
          </div>
          <form @submit.prevent="saveEdit" class="modal-form mt-1">
            <div class="field-group"><label class="field-label">IP 地址</label><input v-model="editIp" class="input" placeholder="192.168.5.1" /></div>
            <div class="field-group mt-1"><label class="field-label">设备名称</label><input v-model="editName" class="input" placeholder="产线 A — CR5" /></div>
            <label class="checkbox-row mt-2"><input v-model="editAutoConnect" type="checkbox" class="checkbox" /><span class="checkbox-label">服务启动时自动连接</span></label>
            <div class="modal-actions mt-2">
              <button type="button" class="btn btn-secondary flex-1" @click="editingDevice = null">取消</button>
              <button type="submit" class="btn btn-primary flex-1" :disabled="!editIp || !editName">保存</button>
            </div>
          </form>
        </div>
      </div>
    </Transition>

    <!-- Duplicate Device Confirm Modal -->
    <Transition name="fade">
      <div v-if="showDup && dupExisting" class="modal-overlay" @click.self="cancelDup">
        <div class="modal card">
          <div class="modal-header">
            <h3>检测到重复设备</h3>
            <button class="modal-close" @click="cancelDup">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><line x1="3" y1="3" x2="13" y2="13" stroke="currentColor" stroke-width="1.5"/><line x1="13" y1="3" x2="3" y2="13" stroke="currentColor" stroke-width="1.5"/></svg>
            </button>
          </div>
          <p class="mt-1" style="color:var(--status-danger);font-size:13px;">
            已存在名称与 IP 完全相同的设备：
            <strong>{{ dupExisting.name }}</strong>（{{ dupExisting.ip }}）
          </p>
          <p style="color:var(--text-secondary);font-size:13px;margin-top:6px;">
            是否仍然添加？可修改名称以区分；若不修改直接提交，将允许同名同 IP。
          </p>
          <div class="field-group mt-2">
            <label class="field-label">设备名称</label>
            <input v-model="dupName" class="input" placeholder="设备名称" />
          </div>
          <div class="modal-actions mt-2">
            <button type="button" class="btn btn-secondary flex-1" @click="cancelDup">取消</button>
            <button type="button" class="btn btn-primary flex-1" @click="confirmDup">仍然添加</button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import * as api from '../services/api'
import { clearToken, setToken } from '../services/api'
import { wsClient } from '../services/ws'
import { deviceStore } from '../stores/deviceStore'
import { userStore } from '../stores/userStore'
import { clearWorkspace } from '../stores/workspaceState'
import Toast from '../components/Toast.vue'
import ChangePasswordModal from '../components/ChangePasswordModal.vue'
import SwitchUserModal from '../components/SwitchUserModal.vue'
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
const newAutoConnect = ref(false)
const showUserDropdown = ref(false)
const showChangePassword = ref(false)
const showSwitchUser = ref(false)

// Edit device state
const editingDevice = ref<DeviceConfig | null>(null)
const editIp = ref('')
const editName = ref('')
const editAutoConnect = ref(true)

// Duplicate device confirm state
const showDup = ref(false)
const dupExisting = ref<DeviceConfig | null>(null)
const dupName = ref('')
let dupContinue: ((finalName: string) => Promise<void>) | null = null

const currentUser = computed(() => userStore.currentUser)

function doLogout() { clearToken(); wsClient.destroy(); deviceStore.reset(); userStore.reset(); clearWorkspace(); router.push('/login') }

async function onPasswordChanged() {
  toastRef.value?.success('密码修改成功')
}

async function onUserSwitched() {
  showUserDropdown.value = false
  // Reload user info
  const res = await api.me()
  if (res.success && res.data) {
    userStore.setCurrentUser(res.data)
    toastRef.value?.success(`已切换到 ${res.data.username}`)
  }
}

const offlineCount = computed(() => devices.value.length - deviceStore.connectedCount)
const pct = (v: number) => devices.value.length ? `${(v / devices.value.length) * 100}%` : '0%'

type StatusClass = 'online' | 'offline' | 'locked' | 'virtual'

function getStatusClass(deviceId: string): StatusClass {
  if (deviceStore.isLocked(deviceId)) return 'locked'
  if (deviceStore.isConnected(deviceId)) {
    return deviceStore.isVirtual(deviceId) ? 'virtual' : 'online'
  }
  return 'offline'
}
function getStatusLabel(deviceId: string): string {
  const cls = getStatusClass(deviceId)
  if (cls === 'virtual') return '虚拟连接'
  if (cls === 'online') return '在线'
  if (cls === 'locked') return '已锁定'
  return '离线'
}

async function load() {
  const res = await api.listDevices()
  if (res.success && res.data) {
    devices.value = res.data
    deviceStore.setDevices(res.data)
    // 刷新/导航后 store 为空，主动向服务端同步每台设备的连接状态
    await syncConnectionStatuses(res.data)
  }
}

/** 从服务端拉取每台设备的实时连接状态，覆盖刷新后 store 丢失的问题 */
async function syncConnectionStatuses(list: DeviceConfig[]) {
  await Promise.all(list.map(async (d) => {
    try {
      const s = await api.getDeviceStatus(d.id)
      if (s.success && s.data) {
        if (s.data.connected) {
          deviceStore.setConnected(d.id, true, s.data.mode ?? null)
        } else {
          deviceStore.setOffline(d.id)
        }
      }
    } catch {
      // 单台设备状态拉取失败不影响整体
    }
  }))
}

async function scan() {
  scanning.value = true
  try { const res = await api.scanDevices(); if (res.success && res.data) scanResults.value = res.data }
  finally { scanning.value = false }
}

async function addDevice() {
  if (!newIp.value || !newName.value) return
  const ip = newIp.value.trim()
  const name = newName.value.trim()
  const dup = findDuplicate(name, ip)
  if (dup) {
    promptDuplicate(dup, name, (finalName) => doAdd(finalName, ip))
    return
  }
  await doAdd(name, ip)
}

async function doAdd(name: string, ip: string) {
  await api.registerDevice(ip, name, newAutoConnect.value)
  showAdd.value = false; newIp.value = ''; newName.value = ''
  await load()
}

async function addFromScan(d: DeviceInfo) {
  const ip = d.portName
  const name = d.alias || d.type
  const dup = findDuplicate(name, ip)
  if (dup) {
    promptDuplicate(dup, name, (finalName) => doRegisterFromScan(finalName, ip))
    return
  }
  await doRegisterFromScan(name, ip)
}

async function doRegisterFromScan(name: string, ip: string) {
  await api.registerDevice(ip, name, false)
  scanResults.value = scanResults.value.filter(s => s.portName !== ip)
  await load()
}

function findDuplicate(name: string, ip: string): DeviceConfig | null {
  return devices.value.find(d => d.name === name && d.ip === ip) ?? null
}

function promptDuplicate(existing: DeviceConfig, name: string, onContinue: (finalName: string) => Promise<void>) {
  dupExisting.value = existing
  dupName.value = name
  dupContinue = onContinue
  showDup.value = true
}

async function confirmDup() {
  const onContinue = dupContinue
  const fallbackName = dupExisting.value?.name ?? dupName.value
  showDup.value = false
  dupExisting.value = null
  dupContinue = null
  if (!onContinue) return
  // 用户不改编辑框（为空则回退原名）也直接提交，允许同名同 IP
  await onContinue(dupName.value.trim() || fallbackName)
}

function cancelDup() {
  showDup.value = false
  dupExisting.value = null
  dupContinue = null
}

async function doConnect(id: string, mode: 'exclusive' | 'virtual' = 'exclusive') {
  const res = await api.connectDevice(id, mode)
  if (res.success) {
    deviceStore.setConnected(id, true, mode)
    toastRef.value?.success(mode === 'virtual' ? '虚拟连接成功（未占用设备）' : '设备已连接')
  } else {
    const msg = res.error?.message ?? ''
    const code = res.error?.code
    if (code === 40902 || msg.includes('设备已连接')) {
      // 服务端仍持有连接（如刷新后本地状态丢失），同步而非报错
      const s = await api.getDeviceStatus(id)
      if (s.success && s.data?.connected) {
        deviceStore.setConnected(id, true, s.data.mode ?? mode)
        toastRef.value?.info('设备已连接')
        return
      }
      toastRef.value?.error(msg)
    } else if (code === 1001 || msg.includes('occupied') || msg.includes('无法连接')) {
      if (res.error?.status === 'occupied') {
        toastRef.value?.error(msg, {
          action: { label: 'vConnect', variant: 'virtual', handler: () => doConnect(id, 'virtual') },
        })
      } else {
        toastRef.value?.error(msg)
      }
    } else {
      toastRef.value?.error(`连接失败：${msg}`)
    }
  }
}

async function doDisconnect(id: string) {
  await api.disconnectDevice(id)
  deviceStore.setOffline(id)
  toastRef.value?.info('设备已断开')
}

function doEdit(device: DeviceConfig) {
  editingDevice.value = device
  editIp.value = device.ip
  editName.value = device.name
  editAutoConnect.value = !!device.autoConnect
}

async function saveEdit() {
  if (!editingDevice.value || !editIp.value || !editName.value) return
  const res = await api.updateDevice(editingDevice.value.id, {
    ip: editIp.value,
    name: editName.value,
    autoConnect: editAutoConnect.value,
  })
  if (res.success) {
    editingDevice.value = null
    toastRef.value?.success('设备已更新')
    await load()
  } else {
    toastRef.value?.error(`更新失败：${res.error?.message}`)
  }
}

function doDelete(device: DeviceConfig) { showDelete.value = device }

async function confirmDelete() {
  if (!showDelete.value) return
  const d = showDelete.value
  showDelete.value = null
  const res = await api.deleteDevice(d.id)
  if (res.success) {
    deviceStore.setOffline(d.id)
    toastRef.value?.success(`已移除"${d.name}"`)
    await load()
  } else {
    toastRef.value?.error(`失败：${res.error?.message}`)
  }
}

onMounted(() => {
  load()
  // WS 驱动设备在线/离线状态
  wsClient.onOnline((id) => deviceStore.setConnected(id, true))
  wsClient.onOffline((id) => deviceStore.setOffline(id))
})
</script>

<style scoped>
.dashboard { padding: 40px 48px; max-width: 1400px; margin-inline: auto; min-height: 100vh; }
.page-header { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 16px; }
.header-subtitle { font-family: var(--font-body); font-size: 0.82rem; color: var(--text-muted); margin-top: 6px; }
.header-actions { display: flex; gap: 8px; }
.stats-row { display: flex; gap: 16px; flex-wrap: wrap; }
.stat-tile { flex: 1; min-width: 140px; max-width: 240px; padding: 24px; background: var(--surface-0); border: 1px solid var(--border); border-radius: var(--radius-lg); position: relative; overflow: hidden; }
.stat-value { font-family: var(--font-mono); font-size: 2.4rem; font-weight: 500; color: var(--text-primary); line-height: 1; letter-spacing: -0.02em; }
.stat-label { font-family: var(--font-body); font-size: 0.72rem; font-weight: 500; color: var(--text-muted); margin-top: 8px; }
.stat-bar { height: 2px; background: var(--border); margin-top: 12px; border-radius: 1px; }
.stat-bar-fill { height: 100%; border-radius: 1px; transition: width 0.5s var(--ease-out); }
.stat-tile--online .stat-value { color: var(--status-online); }
.stat-tile--online .stat-bar-fill { background: var(--status-online); }
.stat-tile--locked .stat-value { color: var(--status-locked); }
.stat-tile--locked .stat-bar-fill { background: var(--status-locked); }
.stat-tile--offline .stat-value { color: var(--text-muted); }
.stat-tile--offline .stat-bar-fill { background: var(--text-muted); }
.card-section-header { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
.card-section-title { font-family: var(--font-body); font-size: 0.78rem; font-weight: 600; color: var(--text-muted); flex: 1; }
.card-section-count { font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-muted); }
.scan-list { display: flex; flex-direction: column; gap: 4px; }
.scan-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; background: var(--surface-1); border-radius: var(--radius); border: 1px solid transparent; transition: border-color var(--duration-fast); }
.scan-row:hover { border-color: var(--border-bright); background: var(--surface-1); }
.scan-row:active { transform: scale(0.997); }
.scan-row-info { display: flex; align-items: center; gap: 10px; min-width: 0; }
.scan-row-details { display: flex; flex-direction: column; min-width: 0; }
.scan-row-name { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.scan-row-meta { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.device-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
.device-card { cursor: pointer; padding: 0; overflow: hidden; transition: transform var(--duration-normal) var(--ease-out), border-color var(--duration-normal) var(--ease-out), box-shadow var(--duration-normal) var(--ease-out); }
.device-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); }
.device-card:active { transform: translateY(0) scale(0.995); }
.device-accent { height: 2px; width: 100%; transition: height var(--duration-fast); }
.device-card:hover .device-accent { height: 3px; }
.device-accent--online { background: var(--status-online); }
.device-accent--locked { background: var(--status-locked); }
.device-accent--virtual { background: var(--status-virtual); }
.device-accent--offline { background: var(--status-offline); }
.device-card-body { padding: 20px; }
.device-card-top { display: flex; justify-content: space-between; align-items: center; }
.device-model-badge { font-family: var(--font-body); font-size: 0.68rem; font-weight: 600; padding: 2px 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text-muted); }
.device-card-name { font-family: var(--font-display); font-size: 1.05rem; font-weight: 600; color: var(--text-primary); margin-top: 12px; letter-spacing: -0.01em; }
.device-card-ip { display: flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 12px; color: var(--text-muted); margin-top: 4px; }
.device-card-actions { display: flex; gap: 6px; margin-top: 16px; }
.empty-state { text-align: center; padding: 80px 20px; }
.empty-hex { color: var(--border); margin-bottom: 16px; }
.empty-state h3 { font-family: var(--font-display); color: var(--text-muted); font-size: 0.95rem; }
.empty-state p { color: var(--text-muted); font-size: 0.82rem; margin-top: 8px; }
.modal-overlay { position: fixed; inset: 0; background: rgba(8,9,10,0.72); backdrop-filter: blur(6px); z-index: 100; display: flex; align-items: center; justify-content: center; }
.modal { width: 100%; max-width: 460px; padding: 28px; }
.modal-header { display: flex; justify-content: space-between; align-items: center; }
.modal-close { background: none; border: none; cursor: pointer; color: var(--text-muted); padding: 4px; transition: color var(--duration-fast); }
.modal-close:hover { color: var(--text-primary); }
.modal-form { display: flex; flex-direction: column; }
.modal-actions { display: flex; gap: 8px; }
.field-group { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-family: var(--font-body); font-size: 0.8rem; font-weight: 500; color: var(--text-secondary); }
.field-hint { font-weight: 400; color: var(--text-muted); opacity: 0.6; }
.checkbox-row { display: flex; align-items: center; gap: 10px; cursor: pointer; }
.checkbox { appearance: none; width: 16px; height: 16px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--void-deep); cursor: pointer; position: relative; transition: border-color var(--duration-fast); }
.checkbox:checked { border-color: var(--accent); background: var(--accent); }
.checkbox:checked::after { content: ''; position: absolute; left: 4px; top: 1px; width: 5px; height: 9px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg); }
.checkbox-label { font-family: var(--font-body); font-size: 0.8rem; font-weight: 500; color: var(--text-secondary); }
h3 { margin: 0; }

/* Virtual (purple) status */
.status-dot--virtual { background: var(--status-virtual); }
.badge-virtual { border-color: var(--status-virtual); color: var(--status-virtual); background: var(--status-virtual-dim); }

/* User Menu Dropdown */
.user-menu-wrapper { position: relative; }
.dropdown-menu {
  position: absolute; top: 100%; right: 0; margin-top: 6px;
  min-width: 220px; padding: 6px; z-index: 80;
  background: var(--surface-2); border: 1px solid var(--border);
  border-radius: var(--radius); box-shadow: var(--shadow-lg);
}
.dropdown-header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; }
.dropdown-username { font-size: 13px; font-weight: 500; color: var(--text-primary); }
.dropdown-role { font-family: var(--font-body); font-size: 0.68rem; font-weight: 600; color: var(--text-muted); padding: 2px 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); }
.dropdown-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px; border-radius: var(--radius);
  font-family: var(--font-body); font-size: 0.82rem; font-weight: 500;
  color: var(--text-secondary);
  background: none; border: none; cursor: pointer; text-decoration: none;
  transition: all var(--duration-fast); width: 100%; text-align: left;
}
.dropdown-item:hover { background: var(--surface-1); color: var(--text-primary); }
.dropdown-item--danger { color: var(--status-danger); }
.dropdown-item--danger:hover { background: var(--status-danger-dim); color: var(--status-danger); }
.dropdown-divider { height: 1px; background: var(--border); margin: 4px 8px; }
.menu-enter-active { transition: all 0.15s var(--ease-out); }
.menu-leave-active { transition: all 0.1s var(--ease-in); }
.menu-enter-from, .menu-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
