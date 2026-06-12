<template>
  <div class="device-page" tabindex="0" @keydown="onKeyDown" @keyup="onKeyUp" @click="onPageClick">
    <!-- Top Bar -->
    <header class="workspace-header">
      <div class="workspace-header-left">
        <router-link to="/" class="back-btn">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          DASHBOARD
        </router-link>
        <div class="top-bar-device">
          <h2>{{ device?.name || 'DEVICE' }}</h2>
          <span class="top-bar-ip">{{ device?.ip }}</span>
        </div>
      </div>
      <div class="workspace-header-center">
        <div class="workspace-switch">
          <router-link :to="{ path: `/device/${deviceId}`, query: $route.query }" class="workspace-switch-btn workspace-switch-btn--active">
            CONTROL
          </router-link>
          <router-link :to="{ path: `/device/${deviceId}/programming`, query: $route.query }" class="workspace-switch-btn">
            PROGRAMMING
          </router-link>
        </div>
      </div>
      <div class="workspace-header-actions">
        <span :class="['connection-badge', isLocked ? 'connection-badge--locked' : isVirtualMode ? 'connection-badge--virtual' : isConnected ? (tcpDown ? 'connection-badge--warning' : 'connection-badge--online') : 'connection-badge--offline']">
          <span class="status-dot" :class="`status-dot--${isLocked ? 'locked' : isVirtualMode ? 'virtual' : isConnected ? (tcpDown ? 'warning' : 'connected') : 'disconnected'}`" />
          {{ isLocked ? '🔒 LOCKED' : isVirtualMode ? '🔮 vCONNECTED' : isConnected ? (tcpDown ? '⚠ TCP DOWN' : '🔗 ONLINE') : '⚫ OFFLINE' }}
        </span>
        <!-- Enable Toggle Switch -->
        <label v-if="isConnected" class="toggle-switch" title="使能开关">
          <input type="checkbox" :checked="enabled" @change="toggleEnable" />
          <span class="toggle-track">
            <span class="toggle-thumb" />
          </span>
          <span class="toggle-label">{{ enabling ? 'ENABLING...' : enabled ? 'ENABLED' : 'DISABLED' }}</span>
        </label>
        <button v-if="!isConnected" class="btn btn-success btn-sm" @click="doConnect" :disabled="connecting">
          {{ connecting ? 'CONNECTING...' : 'CONNECT' }}
        </button>
        <template v-if="isConnected">
          <button v-if="!isLocked" class="btn btn-primary btn-sm" @click="doLock">LOCK</button>
          <button v-if="isLocked" class="btn btn-danger btn-sm" @click="doRelease">RELEASE</button>
        </template>
        <button v-if="!isSubscribed" class="btn btn-secondary btn-sm" @click="doSubscribe">SUBSCRIBE</button>
        <button v-else class="btn btn-secondary btn-sm" @click="doUnsubscribe">UNSUBSCRIBE</button>
        <button :class="['btn btn-sm', showLogs ? 'btn-primary' : 'btn-secondary']" @click="toggleLogs">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" stroke-width="1.2"/><line x1="5" y1="6" x2="11" y2="6" stroke="currentColor" stroke-width="1"/><line x1="5" y1="9" x2="10" y2="9" stroke="currentColor" stroke-width="1"/><line x1="5" y1="12" x2="8" y2="12" stroke="currentColor" stroke-width="1"/></svg>
          LOGS{{ deviceLogs.length > 0 ? ` (${deviceLogs.length})` : '' }}
        </button>
        <button class="btn btn-secondary btn-sm" @click="doLogout">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3M11 11l4-4-4-4M15 7H6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </header>

    <!-- Pose HUD -->
    <div class="status-grid mt-2">
      <div class="card pose-card">
        <div class="hud-label">CARTESIAN POSE</div>
        <div class="pose-readout">
          <div v-for="axis in ['x','y','z','r']" :key="axis" class="pose-axis-row">
            <span class="pose-axis-label">{{ axis.toUpperCase() }}</span>
            <span class="pose-axis-value">{{ getPoseVal(axis) }}</span>
            <span class="pose-axis-unit">{{ axis === 'r' ? '°' : 'mm' }}</span>
          </div>
        </div>
      </div>

      <div class="card joint-card">
        <div class="hud-label">JOINT ANGLES</div>
        <div class="joint-readout">
          <div v-for="j in 6" :key="j" class="joint-row">
            <span class="joint-label">J{{ j }}</span>
            <div class="joint-gauge">
              <div class="joint-gauge-track">
                <div class="joint-gauge-fill" :style="{ width: jointPercent(j) + '%' }" />
                <div class="joint-gauge-center" />
              </div>
            </div>
            <span class="joint-value">{{ getJoint(j) }}</span>
          </div>
        </div>
      </div>

      <!-- 3D Model -->
      <div class="card model-panel">
        <div class="model-panel-header">
          <div>
            <div class="hud-label" style="margin-bottom:0">3D MODEL</div>
            <div class="model-subtitle">{{ robotModelType }} · realtime joint pose</div>
          </div>
          <button class="btn btn-secondary btn-sm" @click="reset3DView">RESET VIEW</button>
        </div>
        <div class="model-frame-shell">
          <iframe
            ref="modelIframeRef"
            class="model-frame"
            src="/3d/index.html"
            title="Dobot 3D Model"
            @load="on3DModelLoad"
          />
          <div v-if="!modelReady" class="model-loading">
            <span class="loading-ring"></span>
            <strong>LOADING MODEL</strong>
          </div>
        </div>
      </div>
    </div>

    <!-- Alarms & Warnings -->
    <div v-if="hasAlarms || hasWarnings || isCollision" class="card alarm-panel mt-2">
      <div class="alarm-panel-header">
        <span class="hud-label" style="margin-bottom:0;color:var(--status-danger)">⚠ ALARMS & WARNINGS</span>
        <div class="alarm-actions">
          <button v-if="hasAlarms" class="btn btn-danger btn-sm" @click="doClearAlarm">CLEAR ALARM</button>
          <button v-if="isCollision" class="btn btn-warning btn-sm" @click="doResetCollision">RESET COLLISION</button>
        </div>
      </div>
      <div class="alarm-list">
        <!-- Alarms -->
        <div v-for="a in currentAlarms" :key="'a'+a.id" class="alarm-item alarm-item--error">
          <div class="alarm-item-main">
            <span class="alarm-icon">✗</span>
            <span class="alarm-code">ALARM #{{ a.id }}</span>
            <span v-if="a.level !== ''" class="alarm-level">LEVEL {{ a.level }}</span>
            <span v-if="a.date || a.time" class="alarm-time">{{ a.date }} {{ a.time }}</span>
          </div>
          <div class="alarm-detail">
            <div class="alarm-msg">{{ a.message }}</div>
            <div v-if="a.solution" class="alarm-solution">{{ a.solution }}</div>
          </div>
        </div>
        <!-- Warnings -->
        <div v-for="w in currentWarnings" :key="'w'+w.id" class="alarm-item alarm-item--warn">
          <div class="alarm-item-main">
            <span class="alarm-icon">!</span>
            <span class="alarm-code">WARNING #{{ w.id }}</span>
            <span v-if="w.level !== ''" class="alarm-level">LEVEL {{ w.level }}</span>
            <span v-if="w.date || w.time" class="alarm-time">{{ w.date }} {{ w.time }}</span>
          </div>
          <div class="alarm-detail">
            <div class="alarm-msg">{{ w.message }}</div>
            <div v-if="w.solution" class="alarm-solution">{{ w.solution }}</div>
          </div>
        </div>
        <!-- Collision -->
        <div v-if="isCollision" class="alarm-item alarm-item--error">
          <span class="alarm-icon">⚠</span>
          <span class="alarm-code">COLLISION</span>
          <span class="alarm-msg">碰撞检测触发 — 请确认安全后复位</span>
        </div>
        <!-- Protective Stop -->
        <div v-if="protectiveStop" class="alarm-item alarm-item--warn">
          <span class="alarm-icon">⏸</span>
          <span class="alarm-code">PROTECTIVE STOP</span>
        </div>
        <!-- Emergency Stop -->
        <div v-if="emergencyStop" class="alarm-item alarm-item--error">
          <span class="alarm-icon">🛑</span>
          <span class="alarm-code">E-STOP ACTIVE</span>
        </div>
      </div>
    </div>

    <div class="control-grid mt-2">
      <!-- Jog Control Panel -->
      <div class="card jog-panel">
        <div class="jog-panel-header">
          <div class="hud-label">MANUAL JOG CONTROL</div>
          <div class="jog-settings">
            <!-- Amplitude limit -->
            <div class="amp-limit">
              <span class="amp-limit-label">MAX Δ</span>
              <input v-model.number="ampLimit" type="number" min="1" max="500" step="1" class="amp-input" />
              <span class="amp-limit-unit">{{ jogAxis.startsWith('j') || jogAxis === 'r' ? '°' : 'mm' }}</span>
            </div>
            <div class="jog-mode-selector">
              <button :class="['jog-mode-btn', { 'jog-mode-btn--active': jogMode === 'continuous' }]" @click="changeJogMode('continuous')">CONT</button>
              <button :class="['jog-mode-btn', { 'jog-mode-btn--active': jogMode === 'step' }]" @click="changeJogMode('step')">STEP</button>
            </div>
            <div v-if="jogMode === 'step'" class="inch-setting">
              <span class="amp-limit-label">INCH</span>
              <input v-model.number="jogInch" type="number" min="0.01" step="0.01" class="amp-input" @change="applyTeachInch" />
              <span class="amp-limit-unit">°</span>
              <button v-for="value in inchPresets" :key="value" :class="['inch-preset', { 'inch-preset--active': jogInch === value }]" @click="setTeachInchPreset(value)">
                {{ value }}
              </button>
            </div>
          </div>
        </div>

        <div class="jog-body">
          <div class="jog-grid">
            <div v-for="axis in ['j1','j2','j3','j4','j5','j6']" :key="axis" class="jog-axis-col">
              <span class="jog-axis-name">{{ axis.toUpperCase() }}</span>
              <button class="jog-btn" :class="{ 'jog-btn--active': jogActive && jogAxis === axis && jogDir === '+' }"
                :disabled="!isConnected"
                @mousedown.prevent="jogAxis = axis; startJog('+')" @mouseup="stopJog" @mouseleave="stopJog"
                @touchstart.prevent="jogAxis = axis; startJog('+')" @touchend="stopJog">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M12 5l-6 6M12 5l6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <span class="jog-axis-val">{{ getJoint(Number(axis.slice(1))) }}°</span>
              <button class="jog-btn jog-btn--down" :class="{ 'jog-btn--active': jogActive && jogAxis === axis && jogDir === '-' }"
                :disabled="!isConnected"
                @mousedown.prevent="jogAxis = axis; startJog('-')" @mouseup="stopJog" @mouseleave="stopJog"
                @touchstart.prevent="jogAxis = axis; startJog('-')" @touchend="stopJog">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 19V5M12 19l-6-6M12 19l6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Move To Position (joint angles) -->
      <div class="card move-panel">
        <div class="move-panel-header">
          <span class="hud-label" style="margin-bottom:0">MOVE TO JOINTS</span>
          <div class="move-panel-actions">
            <!-- Quick preset buttons: 3 system + 4 custom -->
            <button v-for="preset in quickPresets" :key="preset.id"
              :class="['btn btn-sm', selectedPresetId === preset.id ? 'btn-primary' : 'btn-secondary', preset.system ? 'btn-quick--sys' : '']"
              @click="applyJointPreset(preset)" :title="preset.joints.map(v=>v.toFixed(1)).join(', ')+'°'">
              {{ preset.name }}
            </button>
            <button class="btn btn-secondary btn-sm" :disabled="!isConnected" @click="readCurrentJoints" title="Read current joint values">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 8a6 6 0 1010.9-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M13 2v3h-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              READ
            </button>
          </div>
        </div>
        <div class="move-grid">
          <div v-for="j in 6" :key="j" class="move-field">
            <label class="move-label">J{{ j }}</label>
            <input v-model.number="moveTarget['j'+j]" type="number" step="0.1" class="move-input" />
            <span class="move-unit">°</span>
          </div>
          <button class="btn btn-primary move-btn" :disabled="!isConnected || moving" @click="doMove">
            {{ moving ? 'MOVING...' : 'MOVE' }}
          </button>
          <button v-if="moving" class="btn btn-danger move-stop-btn" @click="() => stopMoveJoints()">
            STOP
          </button>
        </div>

        <!-- Preset Management -->
        <div class="preset-section mt-2">
          <div class="preset-section-header" @click="presetListExpanded = !presetListExpanded" style="cursor:pointer">
            <div style="display:flex;align-items:center;gap:8px">
              <span class="hud-label" style="margin-bottom:0">PRESETS</span>
              <span class="preset-count-badge">{{ jointPresets.length }}</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px" @click.stop>
              <input v-model.trim="presetName" class="preset-name-input" type="text" placeholder="New preset name"
                @keyup.enter="saveJointPreset" />
              <button class="btn btn-primary btn-sm" :disabled="!presetName" @click="saveJointPreset">SAVE</button>
              <button class="btn-icon" :title="presetListExpanded ? 'Collapse' : 'Expand'"
                @click="presetListExpanded = !presetListExpanded"
                style="font-size:14px;color:var(--text-muted)">
                {{ presetListExpanded ? '▲' : '▼' }}
              </button>
            </div>
          </div>

          <Transition name="preset-collapse">
            <div v-if="presetListExpanded" class="preset-list">
              <!-- Custom presets -->
              <div v-for="(preset, idx) in customPresets" :key="preset.id"
                class="preset-item" :class="{ 'preset-item--selected': selectedPresetId === preset.id, 'preset-item--dragging': dragIdx === idx, 'preset-item--dragover': dragOverIdx === idx && dragIdx !== idx }"
                draggable="true"
                @dragstart="onDragStart($event, idx)"
                @dragover.prevent="onDragOver(idx)"
                @dragleave="onDragLeave"
                @drop="onDrop(idx)"
                @dragend="onDragEnd">
                <div class="preset-item-grip" title="Drag to reorder">⋮⋮</div>
                <div class="preset-item-info" @click="applyJointPreset(preset)">
                  <span class="preset-item-name">{{ preset.name }}</span>
                  <span class="preset-item-joints">{{ preset.joints.map(v => v.toFixed(1)).join(', ') }}°</span>
                </div>
                <div class="preset-item-actions">
                  <button class="btn-icon" title="Rename" @click="startRenamePreset(preset)">✎</button>
                  <button class="btn-icon btn-icon--danger" title="Delete" @click="doDeletePreset(preset)">✕</button>
                </div>
              </div>
              <!-- System presets -->
              <div v-for="preset in systemPresets" :key="preset.id"
                class="preset-item preset-item--system" :class="{ 'preset-item--selected': selectedPresetId === preset.id }"
                @click="applyJointPreset(preset)">
                <div class="preset-item-info">
                  <span class="preset-item-name">{{ preset.name }}</span>
                  <span class="preset-item-joints">{{ preset.joints.map(v => v.toFixed(1)).join(', ') }}°</span>
                </div>
                <span class="preset-item-badge">SYS</span>
              </div>
              <div v-if="!jointPresets.length" class="preset-empty">No presets — save current joints above</div>
            </div>
          </Transition>
        </div>

        <!-- Rename Modal -->
        <Transition name="fade">
          <div v-if="renamingPreset" class="modal-overlay" @click.self="renamingPreset = null">
            <div class="modal card">
              <div class="modal-header">
                <h3>RENAME PRESET</h3>
                <button class="modal-close" @click="renamingPreset = null">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><line x1="3" y1="3" x2="13" y2="13" stroke="currentColor" stroke-width="1.5"/><line x1="13" y1="3" x2="3" y2="13" stroke="currentColor" stroke-width="1.5"/></svg>
                </button>
              </div>
              <p class="mt-1" style="font-size:12px;color:var(--text-secondary)">
                Renaming <strong>{{ renamingPreset.name }}</strong>
              </p>
              <form @submit.prevent="confirmRenamePreset" class="modal-form mt-2">
                <div class="field-group">
                  <label class="field-label">NEW NAME</label>
                  <input v-model.trim="renameValue" class="input" ref="renameInputRef" @keyup.escape="renamingPreset = null" />
                </div>
                <div class="modal-actions mt-3">
                  <button type="button" class="btn btn-secondary" @click="renamingPreset = null">CANCEL</button>
                  <button type="submit" class="btn btn-primary" :disabled="!renameValue || renameValue === renamingPreset.name">RENAME</button>
                </div>
              </form>
            </div>
          </div>
        </Transition>
      </div>
    </div>

    <!-- Action Buttons -->
    <div class="action-bar mt-2">
      <button class="btn btn-primary" :disabled="!isConnected" @click="doPowerOn">⚡ POWER ON</button>
      <button class="btn btn-secondary" :disabled="!isConnected" @click="doPowerOff">⏻ POWER OFF</button>
      <span class="action-sep" />
      <!-- Speed Slider -->
      <div class="speed-control" :class="{ 'speed-control--disabled': !isConnected }">
        <span class="speed-label">SPEED</span>
        <input type="range" min="1" max="100" step="1" v-model.number="speedRatio"
          class="speed-slider" :disabled="!isConnected"
          @pointerdown="isDraggingSpeed = true"
          @pointerup="onSpeedPointerUp"
          @input="onSpeedInput" />
        <span class="speed-value">{{ speedRatio }}%</span>
      </div>
      <span class="action-sep" />
      <button class="btn btn-secondary" :disabled="!isConnected" @click="doHome">🏠 HOME</button>
      <button class="btn btn-secondary" :disabled="!isConnected" @click="doStop">⏹ STOP</button>
      <button class="btn btn-danger estop-btn" :disabled="!isConnected" @click="doEstop">⚠ E-STOP</button>
    </div>

    <!-- Device Log Panel -->
    <Transition name="logs-slide">
      <div v-if="showLogs" class="log-panel card">
        <div class="log-panel-header">
          <div class="log-panel-title">
            <span class="hud-label" style="margin-bottom:0">📋 DEVICE LOGS</span>
            <div class="log-tabs">
              <button :class="['log-tab', { 'log-tab--active': logPanelTab === 'alarms' }]" @click="switchLogTab('alarms')">ALARMS</button>
              <button :class="['log-tab', { 'log-tab--active': logPanelTab === 'history' }]" @click="switchLogTab('history')">HISTORY</button>
            </div>
          </div>
          <div class="log-panel-actions">
            <span class="log-count">{{ logCountText }}</span>
            <button class="btn btn-primary btn-sm" @click="refreshVisibleLogs" :disabled="logRefreshDisabled">
              {{ visibleLogLoading ? 'LOADING...' : 'REFRESH' }}
            </button>
            <button class="btn btn-secondary btn-sm" @click="showLogs = false">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><line x1="4" y1="4" x2="12" y2="12" stroke="currentColor" stroke-width="1.5"/><line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" stroke-width="1.5"/></svg>
            </button>
          </div>
        </div>

        <template v-if="logPanelTab === 'alarms'">
          <div class="log-list" ref="logListRef">
            <div v-if="deviceLogs.length === 0" class="log-empty">No device logs loaded — click REFRESH</div>
            <div v-for="(entry, i) in deviceLogs" :key="i" :class="['log-entry', `log-entry--${entry.type}`]">
              <span class="log-time">{{ entry.date }} {{ entry.time }}</span>
              <span class="log-icon">{{ entry.type === 'alarm' ? '✗' : entry.type === 'warning' ? '!' : 'ℹ' }}</span>
              <div class="log-body">
                <span class="log-title">{{ entry.type === 'alarm' ? 'ALARM' : 'WARNING' }} #{{ entry.id }}</span>
                <span v-if="entry.level !== ''" class="log-level">LEVEL {{ entry.level }}</span>
                <span class="log-desc">{{ entry.description }}</span>
                <span v-if="entry.solution" class="log-solution">{{ entry.solution }}</span>
              </div>
            </div>
          </div>
        </template>

        <template v-else>
          <div class="history-log-controls">
            <div class="history-date-row">
              <input v-model="historyLogStart" type="date" class="history-input" />
              <input v-model="historyLogEnd" type="date" class="history-input" />
            </div>
            <input v-model.trim="historyLogKeyword" type="search" class="history-input history-input--wide" placeholder="Keyword" @keyup.enter="fetchControlLogs" />
            <div class="history-type-row">
              <label v-for="level in historyTypeOptions" :key="level" class="history-type-chip">
                <input v-model="historyLogTypes" type="checkbox" :value="level" />
                <span>{{ level.toUpperCase() }}</span>
              </label>
            </div>
            <div v-if="historyLogFiles.length > 0" class="history-file-summary">
              {{ historyLogFiles.length }} files · {{ historyLogFiles.map(f => f.name).join(', ') }}
            </div>
          </div>
          <div class="log-list history-log-list">
            <div v-if="historyLogEntries.length === 0" class="log-empty">No history logs loaded — click REFRESH</div>
            <div v-for="entry in historyLogEntries" :key="`${entry.file}:${entry.line}`" :class="['log-entry', 'history-log-entry', `log-entry--${entry.level}`]">
              <span class="log-time">{{ entry.file }}:{{ entry.line }}</span>
              <span class="log-icon">{{ historyLogIcon(entry.level) }}</span>
              <div class="log-body">
                <span class="log-title">{{ entry.level.toUpperCase() }}</span>
                <span class="history-log-text">{{ entry.text }}</span>
              </div>
            </div>
          </div>
        </template>
      </div>
    </Transition>

    <!-- Toast -->
    <Toast ref="toastRef" />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as api from '../services/api'
import { clearToken } from '../services/api'
import { wsClient } from '../services/ws'
import { deviceStore } from '../stores/deviceStore'
import Toast from '../components/Toast.vue'
import type { DeviceConfig } from 'docat-shared/types'

const route = useRoute()
const router = useRouter()
const deviceId = route.params.id as string
const toastRef = ref<InstanceType<typeof Toast>>()
const modelIframeRef = ref<HTMLIFrameElement | null>(null)

// ─── Mock 模式（URL ?mock=1 激活，无需设备即可调试 jog）───
const isMock = route.query.mock === '1'
if (isMock) {
  console.log('[Mock] Jog debug mode active — API calls will be simulated')
  // 伪装设备已连接 + 已使能
  deviceStore.setConnected(deviceId, true, 'exclusive')
  deviceStore.setEnabled(deviceId, true)
  // 注入 mock 设备配置
  deviceStore.setDevices([{ id: deviceId, ip: '0.0.0.0', name: 'MOCK DEVICE', type: 'MG6', autoConnect: false, createdAt: '' }])
}

const device = ref<DeviceConfig | null>(deviceStore.getDevice(deviceId))

// Mock 状态：包含关节和位姿数据，jog 时本地模拟变化
const mockState = reactive({
  pose: { x: 100, y: 200, z: 300, r: 0, rx: 0, ry: 0, rz: 0 },
  joints: { j1: 0, j2: 0, j3: 0, j4: 0, j5: 0, j6: 0 },
})

const state = ref<Record<string, unknown>>(
  isMock
    ? { ...mockState, io: {}, alarm: [], status: { connected: true, mode: 'auto' }, timestamp: Date.now() }
    : (deviceStore.statuses[deviceId]?.state ?? { pose: { x: 0, y: 0, z: 0, r: 0 }, joints: {} })
)
const connecting = ref(false)
const isLocked = ref(false)
const enabled = ref(deviceStore.isEnabled(deviceId))
const enabling = ref(false)
const moving = ref(false)
const moveTargetInit = ref(false)
const moveTarget = reactive<Record<string, number>>({ j1: 0, j2: 0, j3: 0, j4: 0, j5: 0, j6: 0 })
const jointPresets = ref<api.JointPreset[]>([])
const selectedPresetId = ref('')
const presetName = ref('')
const selectedCustomPreset = computed(() => jointPresets.value.find(p => p.id === selectedPresetId.value && !p.system) || null)
const modelReady = ref(false)
let last3DPose = ''

// ─── Alarms ──────────────────────────────────────

interface AlarmItem {
  id: number
  level: string | number
  message: string
  solution: string
  date: string
  time: string
  timestamp: number
}
const currentAlarms = ref<AlarmItem[]>([])
const currentWarnings = ref<AlarmItem[]>([])
const isCollision = ref(false)
const protectiveStop = ref(false)
const emergencyStop = ref(false)

const hasAlarms = computed(() => currentAlarms.value.length > 0)
const hasWarnings = computed(() => currentWarnings.value.length > 0)

function normalizeAlarmItem(raw: Partial<AlarmItem> & { id: number }, fallbackPrefix: string): AlarmItem {
  return {
    id: raw.id,
    level: raw.level ?? '',
    message: raw.message || `${fallbackPrefix} ${raw.id}`,
    solution: raw.solution || '',
    date: raw.date || '',
    time: raw.time || '',
    timestamp: raw.timestamp || Date.now(),
  }
}

function normalizeWarningItem(raw: number | Partial<AlarmItem> & { id: number }): AlarmItem {
  if (typeof raw === 'number') {
    return normalizeAlarmItem({ id: raw }, 'Warning')
  }
  return normalizeAlarmItem(raw, 'Warning')
}

function mergeAlarmDetails(next: AlarmItem[], existing: AlarmItem[]): AlarmItem[] {
  return next.map(item => {
    const previous = existing.find(e => e.id === item.id)
    if (!previous) return item
    return {
      ...item,
      level: item.level !== '' ? item.level : previous.level,
      message: item.message !== `Alarm ${item.id}` && item.message !== `Warning ${item.id}` ? item.message : previous.message,
      solution: item.solution || previous.solution,
      date: item.date || previous.date,
      time: item.time || previous.time,
      timestamp: item.timestamp || previous.timestamp,
    }
  })
}

// ─── Device Log / Alarm Descriptions ─────────────

interface DeviceLogEntry {
  id: number
  type: string
  level: string | number
  description: string
  solution: string
  date: string
  time: string
}
const deviceLogs = ref<DeviceLogEntry[]>([])
const showLogs = ref(false)
const loadingLogs = ref(false)
const logListRef = ref<HTMLElement>()
const logPanelTab = ref<'alarms' | 'history'>('alarms')

const historyTypeOptions = ['error', 'warning', 'info', 'user']
const historyLogStart = ref(todayDateString())
const historyLogEnd = ref(todayDateString())
const historyLogKeyword = ref('')
const historyLogTypes = ref<string[]>([...historyTypeOptions])
const historyLogEntries = ref<api.ControlLogLine[]>([])
const historyLogFiles = ref<api.ControlLogFile[]>([])
const historyLogTotal = ref(0)
const historyLogLimited = ref(false)
const loadingHistoryLogs = ref(false)

const visibleLogLoading = computed(() => logPanelTab.value === 'alarms' ? loadingLogs.value : loadingHistoryLogs.value)
const logRefreshDisabled = computed(() => {
  if (logPanelTab.value === 'alarms') return !isConnected.value || loadingLogs.value
  return loadingHistoryLogs.value || historyLogTypes.value.length === 0
})
const logCountText = computed(() => {
  if (logPanelTab.value === 'alarms') return `${deviceLogs.value.length} entries`
  const suffix = historyLogLimited.value ? ` / ${historyLogTotal.value}` : ''
  return `${historyLogEntries.value.length}${suffix} entries`
})
const robotModelType = computed(() => normalizeRobotModelType(device.value?.type || device.value?.name || 'MG6'))

function normalizeRobotModelType(raw: string): string {
  const value = String(raw || '').toUpperCase().replace(/\s+/g, '')
  if (value.includes('MG6') || value.includes('E6')) return 'MG6'
  if (value.includes('CR30')) return 'CR30'
  if (value.includes('CR20AF')) return 'CR20AF'
  if (value.includes('CR20V')) return 'CR20V'
  if (value.includes('CR20')) return 'CR20'
  if (value.includes('CR16V')) return 'CR16V'
  if (value.includes('CR16')) return 'CR16'
  if (value.includes('CR12V')) return 'CR12V'
  if (value.includes('CR12')) return 'CR12'
  if (value.includes('CR10AF')) return 'CR10AF'
  if (value.includes('CR10V')) return 'CR10V'
  if (value.includes('CR10')) return 'CR10'
  if (value.includes('CR7V')) return 'CR7V'
  if (value.includes('CR7')) return 'CR7'
  if (value.includes('CR5AF')) return 'CR5AF'
  if (value.includes('CR5V')) return 'CR5V'
  if (value.includes('CR5')) return 'CR5'
  if (value.includes('CR3L')) return 'CR3L'
  if (value.includes('CR3V')) return 'CR3V'
  if (value.includes('CR3')) return 'CR3'
  if (value.includes('NC05')) return 'NC05'
  if (value.includes('NC02S')) return 'NC02s'
  if (value.includes('NC02L')) return 'NC02L'
  if (value.includes('NC02')) return 'NC02'
  return 'MG6'
}

function post3DMessage(method: string, data: unknown) {
  const target = modelIframeRef.value?.contentWindow
  if (!target) return
  target.postMessage({ method, data }, '*')
}

function build3DPose(): Record<string, number> {
  const pose = state.value.pose as Record<string, number> | undefined
  const joints = state.value.joints as Record<string, number> | undefined
  return {
    J1: Number(joints?.j1 ?? 0),
    J2: Number(joints?.j2 ?? 0),
    J3: Number(joints?.j3 ?? 0),
    J4: Number(joints?.j4 ?? 0),
    J5: Number(joints?.j5 ?? 0),
    J6: Number(joints?.j6 ?? 0),
    X: Number(pose?.x ?? 0),
    Y: Number(pose?.y ?? 0),
    Z: Number(pose?.z ?? 0),
    Rx: Number(pose?.rx ?? pose?.r ?? 0),
    Ry: Number(pose?.ry ?? 0),
    Rz: Number(pose?.rz ?? 0),
  }
}

function sync3DModelType() {
  post3DMessage('getDeviceType', { type: robotModelType.value })
}

function sync3DPose(force = false) {
  const pose = build3DPose()
  const serialized = JSON.stringify(pose)
  if (!force && serialized === last3DPose) return
  last3DPose = serialized
  post3DMessage('getPose', pose)
}

function reset3DView() {
  post3DMessage('setCameraPosition', robotModelType.value.startsWith('CR')
    ? { y: 600, z: 750 }
    : { x: 100, y: 500, z: 1800 })
  post3DMessage('setZoom', robotModelType.value.startsWith('CR') ? 0.5 : 1.5)
  post3DMessage('changeBgc', 'black')
  sync3DModelType()
  sync3DPose(true)
}

function on3DModelLoad() {
  modelReady.value = false
  last3DPose = ''
  reset3DView()
}

function handle3DModelMessage(event: MessageEvent) {
  const data = event.data
  if (!data || typeof data !== 'object') return
  if ((data as Record<string, unknown>).iframeName === '3dmodelplugin' && (data as Record<string, unknown>).method === 'loadModelOver') {
    modelReady.value = true
    sync3DPose(true)
  }
}

function todayDateString(): string {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function toggleLogs() {
  showLogs.value = !showLogs.value
  if (!showLogs.value) return
  if (logPanelTab.value === 'alarms' && deviceLogs.value.length === 0) fetchDeviceLogs()
  if (logPanelTab.value === 'history' && historyLogEntries.value.length === 0) fetchControlLogs()
}

function switchLogTab(tab: 'alarms' | 'history') {
  logPanelTab.value = tab
  if (tab === 'alarms' && deviceLogs.value.length === 0) fetchDeviceLogs()
  if (tab === 'history' && historyLogEntries.value.length === 0) fetchControlLogs()
}

function refreshVisibleLogs() {
  if (logPanelTab.value === 'alarms') {
    fetchDeviceLogs()
  } else {
    fetchControlLogs()
  }
}

async function fetchDeviceLogs() {
  if (!isConnected.value) return
  loadingLogs.value = true
  try {
    const [alarmRes, warnRes] = await Promise.all([
      api.getDeviceAlarms(deviceId),
      api.getDeviceWarnings(deviceId),
    ])
    const entries: DeviceLogEntry[] = []
    if (alarmRes.success && alarmRes.data) {
      for (const a of alarmRes.data) entries.push({ id: a.id, type: 'alarm', level: a.level ?? '', description: a.description, solution: a.solution || '', date: a.date, time: a.time })
    }
    if (warnRes.success && warnRes.data) {
      for (const w of warnRes.data) entries.push({ id: w.id, type: 'warning', level: w.level ?? '', description: w.description, solution: w.solution || '', date: w.date, time: w.time })
    }
    entries.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))
    deviceLogs.value = entries

    // Also update alarm panel descriptions
    const alarmDescs = entries.filter(e => e.type === 'alarm')
    if (alarmDescs.length > 0) {
      currentAlarms.value = alarmDescs.map(a => ({
        id: a.id,
        level: a.level,
        message: a.description || `Alarm ${a.id}`,
        solution: a.solution,
        date: a.date,
        time: a.time,
        timestamp: Date.now(),
      }))
    }
    const warningDescs = entries.filter(e => e.type === 'warning')
    if (warningDescs.length > 0) {
      currentWarnings.value = warningDescs.map(w => ({
        id: w.id,
        level: w.level,
        message: w.description || `Warning ${w.id}`,
        solution: w.solution,
        date: w.date,
        time: w.time,
        timestamp: Date.now(),
      }))
    }
  } catch { /* ignore */ }
  finally { loadingLogs.value = false }
}

async function fetchControlLogs() {
  if (historyLogTypes.value.length === 0) {
    toastRef.value?.error('Select at least one log type')
    return
  }
  loadingHistoryLogs.value = true
  try {
    const res = await api.queryControlLogs(deviceId, {
      start: historyLogStart.value,
      end: historyLogEnd.value,
      types: historyLogTypes.value,
      keyword: historyLogKeyword.value,
      limit: 1000,
    })
    if (res.success && res.data) {
      historyLogEntries.value = res.data.entries
      historyLogFiles.value = res.data.files
      historyLogTotal.value = res.data.total
      historyLogLimited.value = res.data.limited
      if (res.data.limited) {
        toastRef.value?.info(`Showing first ${res.data.entries.length} of ${res.data.total} matching log lines`)
      } else if (res.data.entries.length === 0) {
        const message = res.data.files.length > 0
          ? `No matching lines in ${res.data.files.length} log file(s)`
          : 'No log files in selected date range'
        toastRef.value?.info(message)
      }
    } else {
      toastRef.value?.error(`History logs failed: ${res.error?.message}`)
    }
  } catch (err) {
    toastRef.value?.error(`History logs error: ${(err as Error).message}`)
  } finally {
    loadingHistoryLogs.value = false
  }
}

function historyLogIcon(level: string): string {
  if (level === 'error') return '✗'
  if (level === 'warning') return '!'
  if (level === 'user') return '*'
  return 'ℹ'
}

// Auto-fetch device logs when alarms change
watch(currentAlarms, (newVal, oldVal) => {
  const newIds = newVal.map(a => a.id)
  const oldIds = (oldVal || []).map(a => a.id)
  if (newVal.length > 0 && newIds.some(id => !oldIds.includes(id))) {
    fetchDeviceLogs()
  }
})
watch(state, () => sync3DPose(), { deep: true })
watch(robotModelType, () => {
  sync3DModelType()
  reset3DView()
})

const isConnected = computed(() => deviceStore.isConnected(deviceId))
const isVirtualMode = computed(() => deviceStore.isVirtual(deviceId))
const isSubscribed = ref(false)
const tcpDown = ref(false)

// ─── Speed Ratio ─────────────────────────────────
const speedRatio = ref(100)
let speedDebounceTimer: ReturnType<typeof setTimeout> | null = null

// ─── Jog State ───────────────────────────────────

const jogAxis = ref('j1')
const jogDir = ref('+')
const jogMode = ref<'continuous' | 'step'>('continuous')
const jogInch = ref(1)
const inchPresets = [0.01, 0.1, 0.5, 1]
const jogActive = ref(false)
const jogInterval = ref<ReturnType<typeof setInterval> | null>(null)
const stepTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const jogStartPose = ref<Record<string, number>>({})
const ampTravel = ref(0)
const ampLimit = ref(50)  // mm or °
const appliedJogMode = ref<'jog' | 'step' | null>(null)
const appliedTeachInch = ref<number | null>(null)
const moveTimer = ref<ReturnType<typeof setTimeout> | null>(null)
let moveTargetJoints: number[] | null = null

// ─── Keyboard Shortcuts ──────────────────────────

const keyMap: Record<string, { axis: string; dir: string }> = {
  y: { axis: 'j1', dir: '+' }, h: { axis: 'j1', dir: '-' },
  u: { axis: 'j2', dir: '+' }, j: { axis: 'j2', dir: '-' },
  i: { axis: 'j3', dir: '+' }, k: { axis: 'j3', dir: '-' },
  o: { axis: 'j4', dir: '+' }, l: { axis: 'j4', dir: '-' },
  p: { axis: 'j5', dir: '+' }, semicolon: { axis: 'j5', dir: '-' },
  '[': { axis: 'j6', dir: '+' }, "'": { axis: 'j6', dir: '-' },
}

const shortcutHints = [
  { label: 'J1', pos: 'Y', neg: 'H' },
  { label: 'J2', pos: 'U', neg: 'J' },
  { label: 'J3', pos: 'I', neg: 'K' },
  { label: 'J4', pos: 'O', neg: 'L' },
  { label: 'J5', pos: 'P', neg: ';' },
  { label: 'J6', pos: '[', neg: ']' },
]

const keysDown = new Set<string>()

function onKeyDown(e: KeyboardEvent) {
  // 跳过输入框/编辑器，避免打字触发 jog
  const target = e.target as HTMLElement
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.closest('.monaco-editor')) return
  const key = e.key === ';' ? 'semicolon' : e.key.toLowerCase()
  const mapped = keyMap[key]
  if (!mapped) return
  if (keysDown.has(key)) return  // already held
  e.preventDefault()
  keysDown.add(key)
  // 如果已经在 jog（可能是其他轴），先停
  if (jogActive.value) stopJog()
  jogAxis.value = mapped.axis
  startJog(mapped.dir)
}

/** 点击页面时重新聚焦，解决 3D iframe 抢焦点后按键无效 */
function onPageClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return
  if (target.closest('.monaco-editor') || target.closest('iframe')) return
  ;(e.currentTarget as HTMLElement)?.focus()
}

function onKeyUp(e: KeyboardEvent) {
  const key = e.key === ';' ? 'semicolon' : e.key.toLowerCase()
  if (!keyMap[key]) return // 不是 jog 键，忽略
  e.preventDefault()
  // 清理：滑键时旧键可能残留，松手时全部清空
  keysDown.clear()
  stopJog()
}

/** 窗口失焦时强制停止所有 jog，防止 keyup 事件丢失导致失控 */
function onWindowBlur() {
  keysDown.clear()
  if (jogActive.value) stopJog()
}

// ─── Helpers ─────────────────────────────────────

function getPoseVal(axis: string): string {
  const pose = state.value.pose as Record<string, number> | undefined
  const val = pose?.[axis]
  return val != null ? val.toFixed(2) : '--.--'
}
function getJoint(n: number): string {
  const joints = state.value.joints as Record<string, number> | undefined
  const val = joints?.[`j${n}`]
  return val != null ? val.toFixed(2) : '--.--'
}
function jointPercent(n: number): number {
  const joints = state.value.joints as Record<string, number> | undefined
  const val = joints?.[`j${n}`]
  if (val == null) return 50
  return Math.max(5, Math.min(95, ((val + 180) / 360) * 100))
}

function getAxisValue(): number {
  if (jogAxis.value.startsWith('j')) {
    const joints = state.value.joints as Record<string, number> | undefined
    return joints?.[jogAxis.value] ?? 0
  }
  const pose = state.value.pose as Record<string, number> | undefined
  return pose?.[jogAxis.value] ?? 0
}

// ─── Load / Connect ──────────────────────────────

async function load() {
  if (isMock) {
    device.value = deviceStore.getDevice(deviceId)
    enabled.value = true
    return
  }
  const res = await api.listDevices()
  if (res.success && res.data) {
    deviceStore.setDevices(res.data)
    device.value = res.data.find(d => d.id === deviceId) ?? null
  }
  await loadJointPresets()
  try {
    const s = await api.getDeviceStatus(deviceId)
    if (s.success && s.data) {
      const statusData = s.data as Record<string, unknown>
      deviceStore.setConnected(deviceId, s.data.connected, (statusData.mode as 'exclusive' | 'virtual') ?? null)
      if (s.data.state) {
        state.value = s.data.state
        deviceStore.setState(deviceId, s.data.state)
      }
      // Init enabled state
      const status = s.data.status as Record<string, unknown> | undefined
      enabled.value = status?.mode === 'auto'
      deviceStore.setEnabled(deviceId, enabled.value)
      // Parse alarm info
      currentAlarms.value = ((statusData.alarms as Array<Partial<AlarmItem> & { id: number }>) || [])
        .map(a => normalizeAlarmItem(a, 'Alarm'))
      currentWarnings.value = ((statusData.warningList as Array<number | Partial<AlarmItem> & { id: number }>) || [])
        .map(w => normalizeWarningItem(w))
      isCollision.value = (statusData.isCollision as boolean) || false
      protectiveStop.value = (statusData.protectiveStop as boolean) || false
      emergencyStop.value = (statusData.emergencyStop as boolean) || false
      // Fetch device alarm descriptions on load
      if (currentAlarms.value.length > 0) fetchDeviceLogs()
    }
  } catch { /* ignore */ }
}

async function loadJointPresets() {
  const res = await api.listJointPresets(deviceId)
  if (res.success && res.data) {
    jointPresets.value = res.data
  }
}

async function doConnect() {
  if (isMock) {
    deviceStore.setConnected(deviceId, true, 'exclusive')
    enabled.value = true
    toastRef.value?.success('[Mock] Device connected')
    return
  }
  connecting.value = true
  try {
    const res = await api.connectDevice(deviceId)
    if (res.success) {
      deviceStore.setConnected(deviceId, true)
      toastRef.value?.success('Device connected — power on then enable')
    } else {
      const msg = res.error?.message ?? ''
      const code = res.error?.code
      if (code === 1001 || msg.includes('occupied') || msg.includes('无法连接')) {
        toastRef.value?.error(msg, { action: { label: 'FORCE RELEASE', handler: () => doForceRelease() } })
      } else {
        toastRef.value?.error(`Connect failed: ${msg}`)
      }
    }
  } finally { connecting.value = false }
}

async function doForceRelease() {
  const res = await api.forceReleaseDevice(deviceId)
  if (res.success) {
    toastRef.value?.success('Ghost occupation released — try connecting again')
  } else {
    toastRef.value?.error(`Force release failed: ${res.error?.message ?? 'unknown'}`)
  }
}

// ─── Speed ────────────────────────────────────────

const isDraggingSpeed = ref(false)

function onSpeedInput() {
  // @input 实时更新本地值（v-model 已处理），不发请求
}

function onSpeedPointerUp() {
  isDraggingSpeed.value = false
  if (!isConnected.value) return
  if (speedDebounceTimer) clearTimeout(speedDebounceTimer)
  api.setDeviceSpeed(deviceId, speedRatio.value).then(res => {
    if (!res.success) {
      toastRef.value?.error(`Set speed failed: ${res.error?.message}`)
    }
  }).catch(() => {})
}

async function loadSpeed() {
  if (isMock) return
  if (!isConnected.value) return
  try {
    const res = await api.getDeviceSpeed(deviceId)
    if (res.success && res.data) {
      speedRatio.value = res.data.ratio
    }
  } catch { /* ignore */ }
}

// ─── Power / Enable ──────────────────────────────

async function doPowerOn() {
  try {
    const res = await api.powerOnDevice(deviceId)
    if (res.success) {
      toastRef.value?.success('Servo powered on')
    } else {
      toastRef.value?.error(`Power on failed: ${res.error?.message}`)
    }
  } catch (err) {
    toastRef.value?.error(`Power on error: ${(err as Error).message}`)
  }
}

async function doPowerOff() {
  try {
    const res = await api.powerOffDevice(deviceId)
    if (res.success) {
      enabled.value = false
      deviceStore.setEnabled(deviceId, false)
      toastRef.value?.info('Servo powered off')
    } else {
      toastRef.value?.error(`Power off failed: ${res.error?.message}`)
    }
  } catch (err) {
    toastRef.value?.error(`Power off error: ${(err as Error).message}`)
  }
}

async function toggleEnable() {
  if (enabled.value) {
    await doDisable()
  } else {
    await doEnable()
  }
}

function checkEnabled(): boolean {
  if (isMock) return true
  if (!enabled.value) {
    toastRef.value?.error('请先使能设备 (Enable robot first)')
    return false
  }
  return true
}

async function doEnable() {
  enabling.value = true
  try {
    toastRef.value?.info('Enabling... (may need teach pendant switch)')
    const res = await api.enableDevice(deviceId)
    if (res.success) {
      enabled.value = true
      deviceStore.setEnabled(deviceId, true)
      toastRef.value?.success('Robot enabled — ready for motion')
    } else {
      toastRef.value?.error(`Enable failed: ${res.error?.message}`)
    }
  } catch (err) {
    toastRef.value?.error(`Enable error: ${(err as Error).message}`)
  } finally {
    enabling.value = false
  }
}

async function doDisable() {
  try {
    const res = await api.disableDevice(deviceId)
    if (res.success) {
      enabled.value = false
      deviceStore.setEnabled(deviceId, false)
      toastRef.value?.info('Robot disabled')
    } else {
      toastRef.value?.error(`Disable failed: ${res.error?.message}`)
    }
  } catch (err) {
    toastRef.value?.error(`Disable error: ${(err as Error).message}`)
  }
}

// ─── Lock / Subscribe ────────────────────────────

async function doClearAlarm() {
  try {
    const res = await api.clearAlarm(deviceId)
    if (res.success) {
      currentAlarms.value = []
      toastRef.value?.success('Alarms cleared')
    } else {
      toastRef.value?.error(`Clear alarm failed: ${res.error?.message}`)
    }
  } catch (err) {
    toastRef.value?.error(`Clear alarm error: ${(err as Error).message}`)
  }
}

async function doResetCollision() {
  try {
    const res = await api.resetCollision(deviceId)
    if (res.success) {
      isCollision.value = false
      toastRef.value?.success('Collision reset')
    } else {
      toastRef.value?.error(`Reset collision failed: ${res.error?.message}`)
    }
  } catch (err) {
    toastRef.value?.error(`Reset collision error: ${(err as Error).message}`)
  }
}

async function doLock() {
  const res = await api.lockDevice(deviceId, 300000)
  if (res.success) { isLocked.value = true; toastRef.value?.success('Device locked') }
  else { toastRef.value?.error(`Lock failed: ${res.error?.message}`) }
}

async function doRelease() {
  await api.releaseDevice(deviceId)
  isLocked.value = false
  toastRef.value?.info('Lock released')
}

async function doSubscribe() {
  await api.subscribeDevice(deviceId)
  isSubscribed.value = true
  wsClient.subscribe(deviceId)
  toastRef.value?.info('Subscribed to device state')
}

function doUnsubscribe() {
  isSubscribed.value = false
  wsClient.unsubscribe(deviceId)
  toastRef.value?.info('Unsubscribed')
}

// ─── Jog Control ────────────────────────────────

async function changeJogMode(mode: 'continuous' | 'step') {
  jogMode.value = mode
  if (!isConnected.value) return
  if (mode === 'continuous') {
    await applyJogMode()
  } else {
    await applyTeachInch()
  }
}

async function applyJogMode(): Promise<boolean> {
  if (isMock) { appliedJogMode.value = 'jog'; return true }
  if (appliedJogMode.value === 'jog') return true
  const res = await api.setJogMode(deviceId, 'jog')
  if (res.success) {
    appliedJogMode.value = 'jog'
    return true
  }
  toastRef.value?.error(`Jog mode failed: ${res.error?.message}`)
  return false
}

async function applyTeachInch(): Promise<boolean> {
  if (isMock) { appliedJogMode.value = 'step'; appliedTeachInch.value = jogInch.value; return true }
  const distance = Number(jogInch.value)
  if (!Number.isFinite(distance) || distance <= 0) {
    toastRef.value?.error('Invalid inch distance')
    return false
  }
  if (appliedJogMode.value !== 'step') {
    const modeRes = await api.setJogMode(deviceId, 'step')
    if (!modeRes.success) {
      toastRef.value?.error(`Step mode failed: ${modeRes.error?.message}`)
      return false
    }
    appliedJogMode.value = 'step'
  }
  if (appliedTeachInch.value === distance) return true
  const res = await api.setTeachInch(deviceId, distance)
  if (res.success) {
    appliedTeachInch.value = distance
    return true
  } else {
    toastRef.value?.error(`Teach inch failed: ${res.error?.message}`)
    return false
  }
}

async function setTeachInchPreset(value: number) {
  jogInch.value = value
  await applyTeachInch()
}

async function startJog(dir: string) {
  if (!isConnected.value) { toastRef.value?.error('Device not connected'); return }
  if (!checkEnabled()) return

  // 先停掉旧的 jog（防止重复启动）
  if (jogActive.value) stopJog()

  jogDir.value = dir
  jogActive.value = true

  // Record start position for amplitude protection
  jogStartPose.value = {
    ...(state.value.pose as Record<string, number>),
    ...(state.value.joints as Record<string, number>),
  }
  ampTravel.value = 0

  if (jogMode.value === 'continuous') {
    if (!await applyJogMode()) {
      jogActive.value = false
      return
    }
    // await 期间用户可能已松手
    if (!jogActive.value) return
  } else {
    if (!await applyTeachInch()) {
      jogActive.value = false
      return
    }
    if (!jogActive.value) return
  }

  sendJogCmd(dir)

  if (jogMode.value === 'step') {
    // OpenDobot46 does not send a stop command for inch jog.
    stepTimer.value = setTimeout(() => {
      jogActive.value = false
    }, 150)
  } else {
    // Continuous: repeated jog commands every 150ms
    jogInterval.value = setInterval(() => {
      // 每次发送前检查是否仍活跃（stopJog 可能已清掉标志）
      if (!jogActive.value) {
        if (jogInterval.value) { clearInterval(jogInterval.value); jogInterval.value = null }
        return
      }
      sendJogCmd(dir)
      checkAmplitude()
    }, 150)
  }
}

function sendJogCmd(dir: string) {
  if (isMock) {
    // Mock: 本地模拟关节值变化
    const axis = jogAxis.value
    const delta = dir === '+' ? 1.5 : -1.5
    if (axis.startsWith('j')) {
      const joints = state.value.joints as Record<string, number>
      const prev = joints[axis] ?? 0
      joints[axis] = prev + delta
      console.log(`[Mock Jog] ${axis} ${dir}: ${prev} → ${joints[axis]}`)
      state.value = { ...state.value, joints: { ...joints }, timestamp: Date.now() }
    } else {
      const pose = state.value.pose as Record<string, number>
      const prev = pose[axis] ?? 0
      pose[axis] = prev + delta
      console.log(`[Mock Jog] ${axis} ${dir}: ${prev} → ${pose[axis]}`)
      state.value = { ...state.value, pose: { ...pose }, timestamp: Date.now() }
    }
    return
  }
  api.jogDevice(deviceId, jogAxis.value, dir, jogMode.value).catch(err => {
    console.error('[Jog] send failed:', err)
  })
}

function stopJog() {
  if (stepTimer.value) { clearTimeout(stepTimer.value); stepTimer.value = null }
  if (jogInterval.value) { clearInterval(jogInterval.value); jogInterval.value = null }
  const wasActive = jogActive.value
  jogActive.value = false
  ampTravel.value = 0
  // 发送停止指令（仅 continuous 模式且之前在活跃状态）
  if (wasActive && jogMode.value === 'continuous') {
    sendJogStop()
  }
}

function sendJogStop() {
  if (isMock) return
  api.stopDevice(deviceId).catch(err => {
    console.error('[Jog] stop failed:', err)
  })
}

function checkAmplitude() {
  if (!jogActive.value) return // 已停止，不再检查
  const current = getAxisValue()
  const start = jogStartPose.value[jogAxis.value]
  if (start == null) return
  const delta = Math.abs(current - start)
  ampTravel.value = delta
  if (delta >= ampLimit.value) {
    toastRef.value?.error(`Amplitude limit reached: ${delta.toFixed(1)} >= ${ampLimit.value}`)
    stopJog()
  }
}

// ─── Motion Actions ─────────────────────────────

function setMoveTargetJoints(joints: number[]) {
  for (let j = 1; j <= 6; j++) {
    moveTarget['j' + j] = joints[j - 1] || 0
  }
}

function getMoveTargetJoints() {
  return [1,2,3,4,5,6].map(j => Number(moveTarget['j'+j] || 0))
}

function applyJointPreset(preset: api.JointPreset) {
  setMoveTargetJoints(preset.joints)
  selectedPresetId.value = preset.id
  presetName.value = preset.name
}

// ─── Preset Management ────────────────────────────

const systemPresets = computed(() => jointPresets.value.filter(p => p.system))
const customPresets = computed(() => jointPresets.value.filter(p => !p.system))
/** 系统预设（前3）+ 自定义预设（前4）= 最多7个快速按钮 */
const quickPresets = computed(() => [
  ...systemPresets.value.slice(0, 3),
  ...customPresets.value.slice(0, 4),
])
const presetListExpanded = ref(false)
const renameInputRef = ref<HTMLInputElement | null>(null)

/** 读取当前关节值到编辑框 */
function readCurrentJoints() {
  const joints = state.value.joints as Record<string, number> | undefined
  if (!joints) return
  for (let j = 1; j <= 6; j++) {
    moveTarget['j' + j] = Math.round((joints['j' + j] ?? 0) * 10) / 10
  }
  toastRef.value?.info('Current joint values loaded')
}

async function saveJointPreset() {
  const name = presetName.value.trim()
  if (!name) {
    toastRef.value?.error('Preset name required')
    return
  }
  if (jointPresets.value.some(p => !p.system && p.name.toLowerCase() === name.toLowerCase())) {
    toastRef.value?.error('Preset name already exists')
    return
  }
  const res = await api.createJointPreset(deviceId, name, getMoveTargetJoints())
  if (res.success && res.data) {
    await loadJointPresets()
    selectedPresetId.value = res.data.id
    presetName.value = ''
    toastRef.value?.success('Preset saved')
  } else {
    toastRef.value?.error(`Save preset failed: ${res.error?.message}`)
  }
}

async function doDeletePreset(preset: api.JointPreset) {
  if (preset.system) return
  const res = await api.deleteJointPreset(deviceId, preset.id)
  if (res.success) {
    if (selectedPresetId.value === preset.id) selectedPresetId.value = ''
    await loadJointPresets()
    toastRef.value?.success('Preset deleted')
  } else {
    toastRef.value?.error(`Delete failed: ${res.error?.message}`)
  }
}

// Rename
const renamingPreset = ref<api.JointPreset | null>(null)
const renameValue = ref('')

function startRenamePreset(preset: api.JointPreset) {
  renamingPreset.value = preset
  renameValue.value = preset.name
}

async function confirmRenamePreset() {
  if (!renamingPreset.value || !renameValue.value) return
  if (jointPresets.value.some(p => !p.system && p.id !== renamingPreset.value!.id && p.name.toLowerCase() === renameValue.value.toLowerCase())) {
    toastRef.value?.error('Preset name already exists')
    return
  }
  const res = await api.updateJointPreset(deviceId, renamingPreset.value.id, { name: renameValue.value })
  if (res.success) {
    toastRef.value?.success('Preset renamed')
    renamingPreset.value = null
    await loadJointPresets()
  } else {
    toastRef.value?.error(`Rename failed: ${res.error?.message}`)
  }
}

// ─── Drag & Drop Reorder ────────────────────────────

const dragIdx = ref(-1)
const dragOverIdx = ref(-1)

function onDragStart(e: DragEvent, idx: number) {
  dragIdx.value = idx
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(idx))
  }
}

function onDragOver(idx: number) {
  if (dragIdx.value < 0 || dragIdx.value === idx) return
  dragOverIdx.value = idx
}

function onDragLeave() {
  dragOverIdx.value = -1
}

async function onDrop(targetIdx: number) {
  const srcIdx = dragIdx.value
  dragIdx.value = -1
  dragOverIdx.value = -1
  if (srcIdx < 0 || srcIdx === targetIdx) return
  const presets = [...customPresets.value]
  const [moved] = presets.splice(srcIdx, 1)
  presets.splice(targetIdx, 0, moved)
  await api.reorderJointPresets(deviceId, presets.map(p => p.id))
  await loadJointPresets()
}

function onDragEnd() {
  dragIdx.value = -1
  dragOverIdx.value = -1
}

async function doMove() {
  if (!isConnected.value) { toastRef.value?.error('Device not connected'); return }
  if (!checkEnabled()) return
  if (moving.value) return
  moving.value = true
  moveTargetJoints = getMoveTargetJoints()
  runMoveJointsTick()
}

async function runMoveJointsTick() {
  if (!moving.value || !moveTargetJoints) return
  try {
    const joints = moveTargetJoints
    const res = await api.moveJointsCommand(deviceId, joints, true)
    if (res.success) {
      if (res.data?.isAlarms) {
        toastRef.value?.error('Move stopped by alarm')
        await stopMoveJoints()
        return
      }
      if (res.data?.value) {
        await stopMoveJoints(false)
        toastRef.value?.success(`Reached J[${joints.map(v => v.toFixed(1)).join(', ')}]`)
        return
      }
      moveTimer.value = setTimeout(runMoveJointsTick, 200)
    } else {
      toastRef.value?.error(`Move failed: ${res.error?.message}`)
      await stopMoveJoints(false)
    }
  } catch (err) {
    toastRef.value?.error(`Move error: ${(err as Error).message}`)
    await stopMoveJoints(false)
  }
}

async function stopMoveJoints(showToast = true) {
  if (moveTimer.value) {
    clearTimeout(moveTimer.value)
    moveTimer.value = null
  }
  const joints = moveTargetJoints
  moveTargetJoints = null
  const wasMoving = moving.value
  moving.value = false
  if (joints) {
    await api.moveJointsCommand(deviceId, joints, false).catch(err => {
      console.error('[Move] stop failed:', err)
    })
  }
  if (showToast && wasMoving) {
    toastRef.value?.info('Move stopped')
  }
}

async function doHome() {
  if (!checkEnabled()) return
  try {
    const res = await api.homeDevice(deviceId)
    if (res.success) { toastRef.value?.success('Homing started') }
    else toastRef.value?.error(`Home failed: ${res.error?.message}`)
  } catch (err) {
    toastRef.value?.error(`Home error: ${(err as Error).message}`)
  }
}

async function doStop() {
  try {
    const res = await api.stopDevice(deviceId)
    if (res.success) { toastRef.value?.info('Motion stopped') }
    else toastRef.value?.error(`Stop failed: ${res.error?.message}`)
  } catch (err) {
    toastRef.value?.error(`Stop error: ${(err as Error).message}`)
  }
}

async function doEstop() {
  try {
    const res = await api.estopDevice(deviceId)
    if (res.success) { toastRef.value?.error('⚠ E-STOP ACTIVATED') }
    else toastRef.value?.error(`E-Stop failed: ${res.error?.message}`)
  } catch (err) {
    toastRef.value?.error(`E-Stop error: ${(err as Error).message}`)
  }
}

function doLogout() { clearToken(); wsClient.destroy(); deviceStore.reset(); router.push('/login') }

// ─── Lifecycle ──────────────────────────────────

let fallbackTimer: ReturnType<typeof setInterval> | null = null
let wsDisconnected = false

onMounted(async () => {
  void import('./ProgrammingView.vue')
  window.addEventListener('message', handle3DModelMessage)
  window.addEventListener('blur', onWindowBlur)
  await load()
  if (!isMock && !isConnected.value) await doConnect()
  if (!isMock && isConnected.value) loadSpeed()

  // Mock 模式跳过 WS 订阅和 REST 兜底轮询，避免覆盖 mock 状态
  if (isMock) {
    await loadJointPresets()
    ;(document.querySelector('.device-page') as HTMLElement)?.focus()
    return
  }

  // WS 主通道：订阅设备状态
  wsClient.subscribe(deviceId)

  wsClient.onState((devId, s) => {
    if (devId !== deviceId || !s) return
    const raw = s as unknown as Record<string, unknown>
    if (isMock) { console.warn('[Mock] WS onState unexpectedly fired — ignoring'); return }
    console.log('[State] WS onState update')
    const ext = raw._ext as Record<string, unknown> | undefined
    state.value = raw
    deviceStore.setState(deviceId, raw)
    // Init moveTarget from current joints (once)
    if (!moveTargetInit.value) {
      const joints = (raw as Record<string, unknown>).joints as Record<string, number> | undefined
      if (joints) {
        for (let j = 1; j <= 6; j++) moveTarget['j' + j] = Math.round((joints['j' + j] || 0) * 10) / 10
        moveTargetInit.value = true
      }
    }
    // Update enabled state
    const status = raw.status as Record<string, unknown> | undefined
    enabled.value = status?.mode === 'auto'
    deviceStore.setEnabled(deviceId, enabled.value)
    // Parse alarm info from WS ext payload
    if (ext) {
      // 只在控制器标记更新时才刷新 alarms/warnings
      // 控制器的 raw.alarms 仅在 isAlarmUpdate=true 时包含有效数据
      const isAlarmUpdate = (ext.isAlarmUpdate as boolean) || false
      const isWarningUpdate = (ext.isWarningUpdate as boolean) || false
      if (isAlarmUpdate) {
        const newAlarms = ((raw.alarms as Array<Partial<AlarmItem> & { id: number }>) || [])
          .map(a => normalizeAlarmItem(a, 'Alarm'))
        const prevIds = currentAlarms.value.map(a => a.id)
        const hasNew = newAlarms.some(a => !prevIds.includes(a.id))
        currentAlarms.value = mergeAlarmDetails(newAlarms, currentAlarms.value)
        if (hasNew) fetchDeviceLogs()
      }
      if (isWarningUpdate) {
        const newWarnings = ((ext.warningList as Array<number | Partial<AlarmItem> & { id: number }>) || [])
          .map(w => normalizeWarningItem(w))
        const prevWarningIds = currentWarnings.value.map(w => w.id)
        const hasNewWarning = newWarnings.some(w => !prevWarningIds.includes(w.id))
        currentWarnings.value = mergeAlarmDetails(newWarnings, currentWarnings.value)
        if (hasNewWarning) fetchDeviceLogs()
      }
      isCollision.value = (ext.isCollision as boolean) || false
      protectiveStop.value = (ext.protectiveStop as boolean) || false
      emergencyStop.value = (ext.emergencyStop as boolean) || false
      // TCP 状态（exclusive 模式）
      if (ext.mode === 'exclusive') {
        tcpDown.value = !(ext.tcpConnected as boolean)
      } else {
        tcpDown.value = false
      }
    }
  })
  wsClient.onOnline((id) => { if (id === deviceId) deviceStore.setConnected(deviceId, true) })
  wsClient.onOffline((id) => { if (id === deviceId) deviceStore.setOffline(deviceId) })

  // WS 断线兜底：低频 REST 轮询
  wsDisconnected = wsClient.isDisconnected
  fallbackTimer = setInterval(async () => {
    if (!wsClient.isDisconnected) {
      wsDisconnected = false
      return
    }
    wsDisconnected = true
    try {
      const s = await api.getDeviceStatus(deviceId)
      if (s.success && s.data) {
        const fb = s.data as Record<string, unknown>
        deviceStore.setConnected(deviceId, s.data.connected, (fb.mode as 'exclusive' | 'virtual') ?? null)
        if (s.data.state) {
          if (isMock) { console.warn('[Mock] REST fallback unexpectedly set state — skipping'); }
          else { state.value = s.data.state; deviceStore.setState(deviceId, s.data.state) }
          if (!moveTargetInit.value) {
            const joints = s.data.state.joints as Record<string, number> | undefined
            if (joints) {
              for (let j = 1; j <= 6; j++) moveTarget['j' + j] = Math.round((joints['j' + j] || 0) * 10) / 10
              moveTargetInit.value = true
            }
          }
        }
        const status = s.data.status as Record<string, unknown> | undefined
        enabled.value = status?.mode === 'auto'
        deviceStore.setEnabled(deviceId, enabled.value)
        // 只在 isAlarmUpdate/isWarningUpdate 时刷新，避免空数组覆盖
        const isAlarmUpd = (fb.isAlarmUpdate as boolean) || false
        const isWarningUpd = (fb.isWarningUpdate as boolean) || false
        if (isAlarmUpd) {
          const newAlarms = ((fb.alarms as Array<Partial<AlarmItem> & { id: number }>) || [])
            .map(a => normalizeAlarmItem(a, 'Alarm'))
          currentAlarms.value = mergeAlarmDetails(newAlarms, currentAlarms.value)
        }
        if (isWarningUpd) {
          const newWarnings = ((fb.warningList as Array<number | Partial<AlarmItem> & { id: number }>) || [])
            .map(w => normalizeWarningItem(w))
          currentWarnings.value = mergeAlarmDetails(newWarnings, currentWarnings.value)
        }
        isCollision.value = (fb.isCollision as boolean) || false
        protectiveStop.value = (fb.protectiveStop as boolean) || false
        emergencyStop.value = (fb.emergencyStop as boolean) || false
        // TCP 状态
        if (fb.mode === 'exclusive') {
          tcpDown.value = !(fb.tcpConnected as boolean)
        } else {
          tcpDown.value = false
        }
      }
    } catch { /* ignore */ }
  }, 3000) // 兜底轮询 3s，比 REST 主通道慢 6 倍
})

onUnmounted(() => {
  window.removeEventListener('message', handle3DModelMessage)
  window.removeEventListener('blur', onWindowBlur)
  if (fallbackTimer) clearInterval(fallbackTimer)
  stopJog()
  keysDown.clear()
  wsClient.unsubscribe(deviceId)
})
</script>

<style scoped>
.device-page { padding: 40px 48px; max-width: 1600px; min-height: 100vh; outline: none; }
.workspace-header {
  display: grid; grid-template-columns: minmax(360px, 1fr) auto minmax(360px, 1fr);
  align-items: center; gap: 16px; padding-bottom: 12px;
}
.workspace-header-left { display: flex; align-items: center; gap: 20px; min-width: 0; }
.workspace-header-center { display: flex; align-items: center; justify-content: center; min-width: 0; }
.workspace-header-actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.back-btn { display: flex; align-items: center; gap: 6px; font-family: var(--font-display); font-size: 0.6rem; font-weight: 700; letter-spacing: 0.12em; color: var(--text-muted); text-decoration: none; transition: color var(--duration-fast); padding: 6px 0; }
.back-btn:hover { color: var(--cyan-300); }
.top-bar-device h2 { font-family: var(--font-display); font-size: 1.3rem; font-weight: 700; color: var(--text-primary); letter-spacing: 0.06em; }
.top-bar-ip { font-family: var(--font-mono); font-size: 0.65rem; color: var(--text-muted); margin-top: 2px; display: block; }
.workspace-switch { display: flex; align-items: center; gap: 2px; }
.workspace-switch-btn {
  display: inline-flex; align-items: center; justify-content: center; min-height: 30px; padding: 0 12px;
  border: 1px solid var(--border); background: var(--void-surface); color: var(--text-muted);
  font-family: var(--font-display); font-size: 0.55rem; font-weight: 800; letter-spacing: 0.08em;
  text-decoration: none; white-space: nowrap;
}
.workspace-switch-btn:first-child { border-radius: var(--radius) 0 0 var(--radius); }
.workspace-switch-btn:last-child { border-radius: 0 var(--radius) var(--radius) 0; }
.workspace-switch-btn:hover { border-color: var(--border-bright); color: var(--text-primary); }
.workspace-switch-btn--active { border-color: var(--cyan-400); background: var(--cyan-800); color: var(--cyan-300); }
.connection-badge { display: flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: var(--radius); font-family: var(--font-display); font-size: 0.6rem; font-weight: 700; letter-spacing: 0.1em; border: 1px solid; }
.connection-badge--online { border-color: var(--status-online); color: var(--status-online); background: var(--status-online-dim); box-shadow: 0 0 8px #00e67622; }
.connection-badge--locked { border-color: var(--status-locked); color: var(--status-locked); background: var(--status-locked-dim); box-shadow: 0 0 8px #00e5ff22; }
.connection-badge--virtual { border-color: #a855f7; color: #a855f7; background: rgba(168, 85, 247, 0.08); box-shadow: 0 0 8px #a855f722; }
.connection-badge--warning { border-color: #f59e0b; color: #f59e0b; background: rgba(245, 158, 11, 0.08); box-shadow: 0 0 8px #f59e0b22; animation: pulse-warning 2s ease-in-out infinite; }
.connection-badge--offline { border-color: var(--status-offline); color: var(--status-offline); background: var(--status-offline-dim); }

/* Enable Toggle Switch */
.toggle-switch { display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
.toggle-switch input { display: none; }
.toggle-track {
  width: 36px; height: 20px; border-radius: 10px;
  background: var(--void-surface); border: 1px solid var(--border);
  position: relative; transition: all var(--duration-fast);
}
.toggle-switch input:checked + .toggle-track {
  background: var(--cyan-800); border-color: var(--cyan-400);
  box-shadow: 0 0 8px var(--cyan-glow);
}
.toggle-thumb {
  position: absolute; top: 2px; left: 2px; width: 14px; height: 14px;
  border-radius: 50%; background: var(--text-muted);
  transition: all var(--duration-fast) var(--ease-out);
}
.toggle-switch input:checked + .toggle-track .toggle-thumb {
  left: 18px; background: var(--cyan-300);
  box-shadow: 0 0 6px var(--cyan-glow);
}
.toggle-label {
  font-family: var(--font-display); font-size: 0.5rem; font-weight: 700;
  letter-spacing: 0.12em; color: var(--text-muted);
  min-width: 56px;
}
.toggle-switch input:checked ~ .toggle-label { color: var(--cyan-300); }

.status-grid { display: grid; grid-template-columns: minmax(240px, 0.85fr) minmax(300px, 1fr) minmax(420px, 1.45fr); gap: 16px; align-items: stretch; }
.control-grid { display: grid; grid-template-columns: minmax(420px, 1.05fr) minmax(420px, 0.95fr); gap: 16px; align-items: stretch; }
.pose-card, .joint-card, .model-panel, .jog-panel, .move-panel { min-width: 0; }
@media (max-width: 1200px) {
  .workspace-header { grid-template-columns: 1fr; align-items: stretch; }
  .workspace-header-center { justify-content: flex-start; }
  .workspace-header-actions { justify-content: flex-start; }
  .status-grid { grid-template-columns: 1fr 1fr; }
  .model-panel { grid-column: 1 / -1; }
  .control-grid { grid-template-columns: 1fr; }
}
@media (max-width: 768px) {
  .status-grid { grid-template-columns: 1fr; }
  .model-panel { grid-column: auto; }
}
.hud-label { font-family: var(--font-display); font-size: 0.55rem; font-weight: 700; letter-spacing: 0.18em; color: var(--text-muted); margin-bottom: 16px; }
.pose-readout { display: flex; flex-direction: column; gap: 6px; }
.pose-axis-row { display: flex; align-items: baseline; gap: 12px; padding: 8px 12px; background: var(--void-surface); border-radius: var(--radius); }
.pose-axis-label { font-family: var(--font-display); font-size: 0.7rem; font-weight: 700; color: var(--text-muted); width: 20px; }
.pose-axis-value { font-family: var(--font-mono); font-size: 1.6rem; font-weight: 400; color: var(--cyan-300); flex: 1; text-align: right; text-shadow: 0 0 8px var(--cyan-glow); }
.pose-axis-unit { font-size: 0.65rem; color: var(--text-muted); width: 24px; }
.model-panel { position: relative; padding: 0; overflow: hidden; }
.model-panel-header {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 14px; border-bottom: 1px solid var(--border);
}
.model-subtitle { margin-top: 3px; font-family: var(--font-mono); font-size: 0.58rem; color: var(--text-muted); }
.model-frame-shell { position: relative; height: 320px; background: #202228; }
.model-frame { display: block; width: 100%; height: 100%; border: 0; background: #202228; }
.model-loading {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 10px;
  background: rgba(11, 15, 20, 0.78); color: var(--text-muted); pointer-events: none;
  font-family: var(--font-display); font-size: 0.62rem; letter-spacing: 0.08em;
}
.loading-ring {
  width: 18px; height: 18px; border: 2px solid rgba(34, 211, 238, 0.22);
  border-top-color: var(--cyan-300); border-radius: 50%; animation: spin 0.8s linear infinite;
}
.joint-readout { display: flex; flex-direction: column; gap: 5px; }
.joint-row { display: flex; align-items: center; gap: 10px; }
.joint-label { font-family: var(--font-display); font-size: 0.6rem; font-weight: 700; color: var(--text-muted); width: 22px; text-align: right; }
.joint-gauge { flex: 1; }
.joint-gauge-track { height: 4px; background: var(--void-surface); border-radius: 2px; position: relative; overflow: hidden; }
.joint-gauge-fill { height: 100%; background: linear-gradient(90deg, var(--cyan-700), var(--cyan-400)); border-radius: 2px; transition: width 0.3s var(--ease-out); box-shadow: 0 0 6px var(--cyan-glow); }
.joint-gauge-center { position: absolute; top: -3px; left: 50%; transform: translateX(-50%); width: 2px; height: 10px; background: var(--text-muted); border-radius: 1px; }
.joint-value { font-family: var(--font-mono); font-size: 0.7rem; color: var(--text-secondary); width: 60px; text-align: right; }

.jog-panel-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
.jog-settings { display: flex; align-items: center; gap: 16px; }.amp-limit { display: flex; align-items: center; gap: 4px; }
.amp-limit-label { font-family: var(--font-display); font-size: 0.5rem; font-weight: 700; letter-spacing: 0.1em; color: var(--text-muted); }
.amp-input {
  width: 48px; padding: 2px 6px; font-family: var(--font-mono); font-size: 0.7rem;
  background: var(--void-surface); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text-primary); text-align: center; outline: none;
}
.amp-input:focus { border-color: var(--cyan-400); box-shadow: 0 0 6px var(--cyan-glow); }
.amp-limit-unit { font-family: var(--font-display); font-size: 0.45rem; letter-spacing: 0.08em; color: var(--text-muted); }

.jog-mode-selector { display: flex; gap: 2px; }
.jog-mode-btn { padding: 4px 12px; border: 1px solid var(--border); background: transparent; cursor: pointer; font-family: var(--font-display); font-size: 0.5rem; font-weight: 700; letter-spacing: 0.1em; color: var(--text-muted); transition: all var(--duration-fast); }
.jog-mode-btn:first-child { border-radius: var(--radius) 0 0 var(--radius); }
.jog-mode-btn:last-child { border-radius: 0 var(--radius) var(--radius) 0; }
.jog-mode-btn--active { background: var(--cyan-800); border-color: var(--cyan-500); color: var(--cyan-300); box-shadow: 0 0 8px #00e5ff22; }
.inch-setting { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.inch-preset {
  min-width: 38px; height: 22px; padding: 0 6px; border: 1px solid var(--border);
  background: var(--void-surface); color: var(--text-muted); border-radius: var(--radius);
  cursor: pointer; font-family: var(--font-mono); font-size: 0.6rem;
}
.inch-preset--active { border-color: var(--cyan-400); color: var(--cyan-300); background: var(--cyan-800); }

/* Jog Grid — 六轴横排，每轴纵向一列 */
.jog-grid { display: flex; gap: 8px; justify-content: center; padding: 8px 0; }
.jog-axis-col { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 56px; }
.jog-axis-name { font-family: var(--font-display); font-size: 0.65rem; font-weight: 700; letter-spacing: 0.1em; color: var(--text-secondary); }
.jog-axis-val { font-family: var(--font-mono); font-size: 0.7rem; color: var(--cyan-300); text-shadow: 0 0 4px var(--cyan-glow); }
/* 模拟键盘键位错位：↓ 按钮整排右移 */
.jog-btn--down { transform: translateX(16px); }
.jog-btn { width: 48px; height: 40px; display: flex; align-items: center; justify-content: center; background: var(--surface-1); border: 1px solid var(--border); border-radius: var(--radius); cursor: pointer; color: var(--text-secondary); transition: all 80ms var(--ease-out); user-select: none; touch-action: none; }
.jog-btn:hover:not(:disabled) { border-color: var(--border-bright); color: var(--text-primary); box-shadow: 0 0 8px #00e5ff11; }
.jog-btn:active:not(:disabled), .jog-btn--active { background: var(--cyan-800); border-color: var(--cyan-400); color: var(--cyan-300); box-shadow: 0 0 16px var(--cyan-glow); }
.jog-btn:active:not(:disabled):not(.jog-btn--down), .jog-btn--active:not(.jog-btn--down) { transform: scale(0.95); }
.jog-btn--active.jog-btn--down { transform: translateX(16px) scale(0.95); }
.jog-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.jog-btn:disabled { opacity: 0.3; cursor: not-allowed; }

.action-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

/* Speed Slider */
.speed-control {
  display: flex; align-items: center; gap: 10px;
  padding: 4px 14px; border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--surface-0);
}
.speed-control--disabled { opacity: 0.35; pointer-events: none; }
.speed-label {
  font-family: var(--font-display); font-size: 0.55rem; font-weight: 700;
  letter-spacing: 0.12em; color: var(--text-muted); white-space: nowrap;
}
.speed-slider {
  -webkit-appearance: none; appearance: none;
  width: 140px; height: 4px; border-radius: 2px; outline: none;
  background: var(--void-surface); cursor: pointer;
}
.speed-slider::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 16px; height: 16px; border-radius: 50%;
  background: var(--cyan-400); border: 2px solid var(--cyan-300);
  box-shadow: 0 0 8px var(--cyan-glow); cursor: pointer;
  transition: transform 0.1s var(--ease-out);
}
.speed-slider::-webkit-slider-thumb:hover { transform: scale(1.2); }
.speed-slider::-moz-range-thumb {
  width: 14px; height: 14px; border-radius: 50%;
  background: var(--cyan-400); border: 2px solid var(--cyan-300);
  box-shadow: 0 0 8px var(--cyan-glow); cursor: pointer;
}
.speed-value {
  font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700;
  color: var(--cyan-300); min-width: 42px; text-align: right;
  text-shadow: 0 0 6px var(--cyan-glow);
}
.action-sep { width: 1px; height: 24px; background: var(--border); margin: 0 4px; }

/* Move Panel */
.move-panel-header { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
.move-panel-actions { display: flex; gap: 6px; }
.preset-name-input {
  width: 160px; padding: 6px 8px; font-family: var(--font-mono); font-size: 0.7rem;
  background: var(--void-surface); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text-primary); outline: none;
}
.preset-name-input:focus { border-color: var(--cyan-400); box-shadow: 0 0 6px var(--cyan-glow); }
.move-grid { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; }
.move-field { display: flex; flex-direction: column; gap: 3px; min-width: 80px; }
.move-label { font-family: var(--font-display); font-size: 0.5rem; font-weight: 700; letter-spacing: 0.1em; color: var(--text-muted); }
.move-input {
  padding: 6px 8px; font-family: var(--font-mono); font-size: 0.8rem;
  background: var(--void-surface); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--cyan-300); width: 80px; outline: none; text-align: right;
}
.move-input:focus { border-color: var(--cyan-400); box-shadow: 0 0 6px var(--cyan-glow); }
.move-unit { font-family: var(--font-display); font-size: 0.45rem; color: var(--text-muted); letter-spacing: 0.08em; }
.move-btn { align-self: flex-end; margin-left: auto; }

/* Preset Management */
.preset-section { border-top: 1px solid var(--border); padding-top: 12px; }
.preset-section-header { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.preset-section-actions { display: flex; gap: 6px; align-items: center; }
.preset-list { display: flex; flex-direction: column; gap: 4px; max-height: 240px; overflow-y: auto; }
.preset-list::-webkit-scrollbar { width: 4px; }
.preset-list::-webkit-scrollbar-track { background: transparent; }
.preset-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
.preset-item {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 8px 10px; border-radius: var(--radius);
  border: 1px solid transparent; transition: all var(--duration-fast);
}
.preset-item:not(.preset-item--system):hover { border-color: var(--border); background: var(--void-surface); }
.preset-item--selected { border-color: var(--cyan-700); background: var(--cyan-800); }
.preset-item--system { opacity: 0.6; cursor: default; }
.preset-item--dragging { opacity: 0.4; }
.preset-item--dragover { border-color: var(--cyan-400); box-shadow: 0 0 8px var(--cyan-glow); }
.preset-item-grip {
  color: var(--text-muted); cursor: grab; font-size: 14px; letter-spacing: -2px;
  user-select: none; padding: 0 4px; line-height: 1;
}
.preset-item-grip:active { cursor: grabbing; }
.preset-item-info { display: flex; flex-direction: column; min-width: 0; cursor: pointer; flex: 1; }
.preset-item-name { font-size: 13px; font-weight: 500; color: var(--text-primary); }
.preset-item-joints { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.preset-item-actions { display: flex; gap: 2px; flex-shrink: 0; }
.btn-icon {
  width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
  background: none; border: 1px solid transparent; border-radius: 2px; cursor: pointer;
  font-size: 11px; color: var(--text-muted); transition: all var(--duration-fast);
}
.btn-icon:hover:not(:disabled) { border-color: var(--border); color: var(--text-primary); background: var(--surface-1); }
.btn-icon:disabled { opacity: 0.25; cursor: not-allowed; }
.btn-icon--danger:hover:not(:disabled) { color: var(--status-danger); border-color: var(--status-danger); }
.preset-item-badge {
  font-family: var(--font-display); font-size: 0.45rem; font-weight: 700; letter-spacing: 0.1em;
  padding: 1px 5px; border: 1px solid var(--border); border-radius: 2px; color: var(--text-muted);
}
.preset-empty { text-align: center; padding: 16px; font-family: var(--font-mono); font-size: 0.7rem; color: var(--text-muted); }
.modal-overlay--inline { position: absolute; inset: 0; border-radius: var(--radius-lg); }

/* Modal (for rename preset) */
.modal-overlay { position: fixed; inset: 0; background: rgba(4,10,20,0.85); backdrop-filter: blur(6px); z-index: 200; display: flex; align-items: center; justify-content: center; }
.modal { width: 100%; max-width: 400px; padding: 28px; }
.modal-header { display: flex; justify-content: space-between; align-items: center; }
.modal-header h3 { margin: 0; font-family: var(--font-display); font-size: 0.7rem; font-weight: 700; letter-spacing: 0.12em; color: var(--text-primary); }
.modal-close {
  background: none; border: 1px solid var(--border); border-radius: var(--radius);
  cursor: pointer; color: var(--text-muted); padding: 4px; display: flex;
  transition: all var(--duration-fast);
}
.modal-close:hover { color: var(--text-primary); border-color: var(--border-bright); background: var(--surface-1); }
.modal-form { display: flex; flex-direction: column; }
.modal-actions { display: flex; gap: 12px; }
.modal-actions .btn { flex: 1; }
.field-group { display: flex; flex-direction: column; gap: 4px; }
.field-label { font-family: var(--font-display); font-size: 0.5rem; font-weight: 700; letter-spacing: 0.15em; color: var(--text-muted); }
.btn-quick--sys { border-color: var(--cyan-700); color: var(--cyan-300); background: var(--cyan-800); }

.estop-btn { padding: 12px 28px; font-size: 13px; background: linear-gradient(180deg, #e01133 0%, #990022 100%); animation: glow-breath 2s ease-in-out infinite; }
.estop-btn:hover:not(:disabled) { background: linear-gradient(180deg, #ff2244 0%, #bb0033 100%); animation: none; box-shadow: 0 0 32px #ff174466, 0 4px 12px rgba(0,0,0,0.6); }

/* Alarm Panel */
.alarm-panel { border: 1px solid var(--status-danger); box-shadow: 0 0 16px #ff174422; }
.alarm-panel-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
.alarm-actions { display: flex; gap: 6px; }
.alarm-list { display: flex; flex-direction: column; gap: 6px; }
.alarm-item { display: flex; flex-direction: column; gap: 6px; padding: 9px 12px; border-radius: var(--radius); font-family: var(--font-mono); font-size: 0.65rem; }
.alarm-item--error { background: #ff174411; border: 1px solid #ff174433; color: #ff6b6b; }
.alarm-item--warn { background: #ffaa0011; border: 1px solid #ffaa0033; color: #ffd93d; }
.alarm-item-main { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.alarm-icon { font-size: 0.8rem; flex-shrink: 0; }
.alarm-code { font-weight: 700; font-family: var(--font-display); font-size: 0.55rem; letter-spacing: 0.08em; }
.alarm-level { padding: 2px 5px; border: 1px solid currentColor; border-radius: 3px; font-size: 0.5rem; opacity: 0.9; }
.alarm-time { color: var(--text-muted); font-size: 0.55rem; }
.alarm-detail { display: flex; flex-direction: column; gap: 3px; min-width: 0; padding-left: 22px; }
.alarm-msg { color: var(--text-primary); line-height: 1.35; overflow-wrap: anywhere; }
.alarm-solution { color: var(--text-muted); line-height: 1.35; overflow-wrap: anywhere; }

/* Warning button variant */
.btn-warning { background: var(--void-surface); border-color: #ffaa00; color: #ffd93d; }
.btn-warning:hover:not(:disabled) { background: #ffaa0022; box-shadow: 0 0 8px #ffaa0044; }

/* Device Log Panel */
.log-panel {
  position: fixed; top: 0; right: 0; width: 420px; max-width: 90vw; height: 100vh;
  z-index: 100; overflow: hidden; display: flex; flex-direction: column;
  border-left: 1px solid var(--border); background: var(--surface-0);
  box-shadow: -8px 0 32px rgba(0,0,0,0.5);
}
.log-panel-header {
  display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;
  padding: 14px 18px 10px; border-bottom: 1px solid var(--border);
}
.log-panel-title { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.log-tabs { display: flex; gap: 2px; }
.log-tab {
  padding: 4px 10px; border: 1px solid var(--border); background: var(--void-surface);
  color: var(--text-muted); cursor: pointer; font-family: var(--font-display);
  font-size: 0.5rem; font-weight: 700; letter-spacing: 0.1em;
}
.log-tab:first-child { border-radius: var(--radius) 0 0 var(--radius); }
.log-tab:last-child { border-radius: 0 var(--radius) var(--radius) 0; }
.log-tab--active { border-color: var(--cyan-400); background: var(--cyan-800); color: var(--cyan-300); }
.log-panel-actions { display: flex; align-items: center; gap: 8px; }
.log-count { font-family: var(--font-mono); font-size: 0.6rem; color: var(--text-muted); }
.history-log-controls { flex-shrink: 0; display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
.history-date-row, .history-type-row { display: flex; gap: 6px; flex-wrap: wrap; }
.history-input {
  flex: 1; min-width: 0; padding: 6px 8px; font-family: var(--font-mono); font-size: 0.65rem;
  background: var(--void-surface); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text-primary); outline: none;
}
.history-input:focus { border-color: var(--cyan-400); box-shadow: 0 0 6px var(--cyan-glow); }
.history-input--wide { width: 100%; flex: none; }
.history-type-chip { display: flex; align-items: center; gap: 5px; cursor: pointer; user-select: none; }
.history-type-chip input { accent-color: var(--cyan-400); }
.history-type-chip span { font-family: var(--font-display); font-size: 0.5rem; font-weight: 700; letter-spacing: 0.08em; color: var(--text-muted); }
.history-file-summary {
  font-family: var(--font-mono); font-size: 0.55rem; color: var(--text-muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.log-list { flex: 1; overflow-y: auto; padding: 8px 12px; }
.log-list::-webkit-scrollbar { width: 4px; }
.log-list::-webkit-scrollbar-track { background: var(--void-surface); }
.log-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
.log-empty { font-family: var(--font-mono); font-size: 0.7rem; color: var(--text-muted); text-align: center; padding: 40px 0; }
.log-entry { display: flex; align-items: flex-start; gap: 8px; padding: 8px; border-radius: var(--radius); transition: background var(--duration-fast); }
.log-entry:hover { background: var(--void-surface); }
.log-entry--alarm { background: #ff174408; border: 1px solid #ff174422; margin-bottom: 4px; }
.log-entry--warning { background: #ffaa0008; border: 1px solid #ffaa0022; margin-bottom: 4px; }
.log-entry--error { background: #ff174408; border: 1px solid #ff174422; margin-bottom: 4px; }
.log-entry--info { background: #00e5ff08; border: 1px solid #00e5ff22; margin-bottom: 4px; }
.log-entry--user { background: #7ee78708; border: 1px solid #7ee78722; margin-bottom: 4px; }
.log-entry--plain { background: #ffffff05; border: 1px solid #ffffff14; margin-bottom: 4px; }
.log-time { font-family: var(--font-mono); font-size: 0.5rem; color: var(--text-muted); flex-shrink: 0; min-width: 70px; white-space: nowrap; }
.log-icon { flex-shrink: 0; width: 16px; text-align: center; font-size: 0.7rem; }
.log-entry--alarm .log-icon { color: #ff6b6b; }
.log-entry--warning .log-icon { color: #ffd93d; }
.log-entry--error .log-icon { color: #ff6b6b; }
.log-entry--info .log-icon { color: var(--cyan-300); }
.log-entry--user .log-icon { color: #7ee787; }
.log-entry--plain .log-icon { color: var(--text-muted); }
.log-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.log-title { font-family: var(--font-display); font-size: 0.55rem; font-weight: 700; letter-spacing: 0.06em; }
.log-entry--alarm .log-title { color: #ff6b6b; }
.log-entry--warning .log-title { color: #ffd93d; }
.log-entry--error .log-title { color: #ff6b6b; }
.log-entry--info .log-title { color: var(--cyan-300); }
.log-entry--user .log-title { color: #7ee787; }
.log-entry--plain .log-title { color: var(--text-muted); }
.log-level { font-family: var(--font-mono); font-size: 0.5rem; color: var(--text-muted); }
.log-desc { font-size: 0.6rem; color: var(--text-primary); line-height: 1.3; }
.log-solution { font-size: 0.55rem; color: var(--text-muted); line-height: 1.3; padding-top: 2px; }
.history-log-list { padding-top: 10px; }
.history-log-entry .log-time { min-width: 92px; overflow: hidden; text-overflow: ellipsis; }
.history-log-text {
  font-family: var(--font-mono); font-size: 0.58rem; color: var(--text-primary);
  line-height: 1.35; overflow-wrap: anywhere; white-space: pre-wrap;
}

@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pulse-warning { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
.status-dot--warning { background: #f59e0b; box-shadow: 0 0 4px #f59e0b; }

.logs-slide-enter-active { transition: transform 0.25s var(--ease-out); }
.logs-slide-leave-active { transition: transform 0.2s var(--ease-in); }
.logs-slide-enter-from, .logs-slide-leave-to { transform: translateX(100%); }
</style>
