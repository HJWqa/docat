<template>
  <section class="device-panel">
    <div class="panel-header">
      <span class="panel-title">设备列表</span>
      <span class="panel-count">{{ orchStore.devices.length }}</span>
      <button
        class="btn-icon btn-icon--plus"
        :class="{ 'btn-icon--active': adding }"
        :title="adding ? '收起' : '添加设备'"
        @click="adding = !adding"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" :style="{ transform: adding ? 'rotate(45deg)' : '' }" style="transition: transform 0.15s">
          <line x1="8" y1="2" x2="8" y2="14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
      </button>
    </div>

    <Transition name="orch-collapse">
      <form v-if="adding" class="add-form" @submit.prevent="doAdd">
        <div class="form-row">
          <label class="form-label">名称</label>
          <input v-model.trim="form.name" class="form-input" placeholder="如 vision_cam" spellcheck="false"
            :class="{ 'form-input--error': nameError }" @input="nameError = ''" />
        </div>
        <div class="form-row">
          <label class="form-label">类型</label>
          <select v-model="form.type" class="form-input">
            <option v-for="t in ORCH_DEVICE_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
          </select>
        </div>

        <template v-if="form.type === 'docat-motion'">
          <div class="form-row">
            <label class="form-label">被模拟的设备（可选）</label>
            <select v-model="form.targetDeviceId" class="form-input">
              <option value="">（不选择 — 纯虚拟模拟）</option>
              <option v-for="d in realDevices" :key="d.id" :value="d.id">
                {{ d.name }} · {{ d.ip }}
              </option>
            </select>
          </div>
          <p class="form-hint">模拟 pick_place_tcp.py 行为：接收 GP / MovJ / MovL / Suck 指令，转发到所选真实设备执行并回复 received / reached；未选或未连接时纯模拟。</p>
        </template>

        <template v-else>
          <div class="form-row form-row--split">
            <div class="form-col">
              <label class="form-label">{{ form.type === 'serial' ? '串口号' : 'IP' }}</label>
              <template v-if="form.type === 'serial'">
                <div class="serial-row">
                  <select v-model="form.serialPort" class="form-input">
                    <option value="">选择串口</option>
                    <option v-for="p in serialPorts" :key="p" :value="p">{{ p }}</option>
                  </select>
                  <button class="btn btn-secondary btn-sm" :disabled="loadingPorts" @click="loadSerialPorts" title="刷新串口列表">
                    {{ loadingPorts ? '…' : '↻' }}
                  </button>
                </div>
              </template>
              <template v-else>
                <input :value="form.ip" list="orch-ip-history-device" placeholder="127.0.0.1" spellcheck="false"
                  @input="(e) => { form.ip = (e.target as HTMLInputElement).value }" class="form-input" />
                <datalist id="orch-ip-history-device">
                  <option v-for="ip in ipHistory" :key="ip" :value="ip" />
                </datalist>
              </template>
            </div>
            <div class="form-col">
              <label class="form-label">{{ form.type === 'serial' ? '波特率' : '端口' }}</label>
              <input :value="form.type === 'serial' ? form.baudRate : form.port" type="number"
                :list="form.type === 'serial' ? 'orch-baud-device' : undefined"
                @input="(e) => { const v = Number((e.target as HTMLInputElement).value) || 0; if (form.type === 'serial') form.baudRate = v; else form.port = v }"
                class="form-input" :placeholder="form.type === 'serial' ? '115200' : '7920'" min="1" max="65535" />
              <datalist v-if="form.type === 'serial'" id="orch-baud-device">
                <option v-for="b in BAUD_RATES" :key="b" :value="b" />
              </datalist>
            </div>
          </div>
        </template>

        <div class="form-row form-row--toggles">
          <label class="toggle-label" title="断开后自动重连">
            <span class="toggle-text">自动重连</span>
            <input v-model="form.autoReconnect" type="checkbox" class="toggle-input" />
            <span class="toggle-track"><span class="toggle-thumb" /></span>
          </label>
          <label class="toggle-label" title="连接后周期性心跳">
            <span class="toggle-text">心跳</span>
            <input v-model="form.heartbeat" type="checkbox" class="toggle-input" />
            <span class="toggle-track"><span class="toggle-thumb" /></span>
          </label>
        </div>

        <p v-if="nameError" class="form-error">{{ nameError }}</p>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary btn-sm" @click="adding = false">取消</button>
          <button type="submit" class="btn btn-primary btn-sm">添加</button>
        </div>
      </form>
    </Transition>

    <div class="device-list">
      <div v-if="!orchStore.devices.length" class="list-empty">暂无设备 — 点击 + 添加</div>
      <div
        v-for="d in orchStore.devices"
        :key="d.id"
        class="device-row"
        :class="{ 'device-row--selected': orchStore.selectedDeviceId === d.id }"
        @click="selectDevice(d.id)"
      >
        <span class="status-dot" :class="d.connected ? 'status-dot--connected' : 'status-dot--disconnected'" />
        <div class="device-info">
          <div class="device-name">{{ d.name }}</div>
          <div class="device-meta">{{ deviceMeta(d) }}</div>
        </div>
        <span class="device-type-badge" :class="`device-type-badge--${d.type}`">{{ orchTypeLabel(d.type) }}</span>
        <label class="toggle-label" title="连接意图开关（打开 = 想要连接并自动重连；实际状态看左侧圆点）" @click.stop>
          <input :checked="isDeviceDesired(d.id)" type="checkbox" class="toggle-input" @change="onToggle(d)" />
          <span class="toggle-track"><span class="toggle-thumb" /></span>
        </label>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { deviceStore } from '../../stores/deviceStore'
import { orchListSerialPorts } from '../../services/orchApi'
import {
  addOrchDevice,
  connectDevice,
  disconnectDevice,
  getIpHistory,
  identifierError,
  isOrchMockMode,
  isDeviceDesired,
  orchStore,
  ORCH_DEVICE_TYPES,
  orchTypeLabel,
  recordIp,
  setDeviceDesired,
  type OrchDevice,
  type OrchDeviceType,
} from '../../stores/orchestrationStore'

const adding = ref(false)
const nameError = ref('')
const ipHistory = ref<string[]>([])
const serialPorts = ref<string[]>([])
const loadingPorts = ref(false)

const form = reactive({
  name: '',
  type: 'tcp-client' as OrchDeviceType,
  ip: '',
  port: 7920,
  serialPort: '',
  baudRate: 115200,
  targetDeviceId: '',
  autoReconnect: true,
  heartbeat: false,
})

const MOCK_SERIAL_PORTS = ['/dev/ttyUSB0', '/dev/ttyUSB1', '/dev/ttyACM0', '/dev/ttyS0', 'COM3', 'COM5']

const BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600]

async function loadSerialPorts() {
  loadingPorts.value = true
  try {
    if (isOrchMockMode()) {
      serialPorts.value = [...MOCK_SERIAL_PORTS]
      return
    }
    const res = await orchListSerialPorts()
    if (res.success && res.data) serialPorts.value = res.data
  } finally {
    loadingPorts.value = false
  }
}

const realDevices = computed(() => Object.values(deviceStore.devices))

function deviceMeta(d: OrchDevice): string {
  if (d.type === 'docat-motion') {
    const target = deviceStore.getDevice(d.targetDeviceId)
    return target ? `模拟 ${target.name}` : '纯虚拟模拟'
  }
  if (d.type === 'serial') return `${d.serialPort || '—'} · ${d.baudRate || '—'}`
  return `${d.ip || '—'} : ${d.port || '—'}`
}

async function doAdd() {
  const err = identifierError(form.name, orchStore.devices.map(d => d.name))
  if (err) { nameError.value = err; return }
  const res = await addOrchDevice({
    name: form.name,
    type: form.type,
    ip: form.ip,
    port: form.port,
    serialPort: form.serialPort,
    baudRate: form.baudRate,
    targetDeviceId: form.targetDeviceId,
    autoReconnect: form.autoReconnect,
    heartbeat: form.heartbeat,
  })
  if (!res.ok) { nameError.value = res.error ?? '添加失败'; return }
  recordIp(form.ip)
  ipHistory.value = getIpHistory()
  form.name = ''
  form.ip = ''
  form.port = 7920
  form.serialPort = ''
  form.baudRate = 115200
  form.targetDeviceId = ''
  form.autoReconnect = true
  form.heartbeat = false
  nameError.value = ''
  adding.value = false
}

function selectDevice(id: string) {
  orchStore.selectedDeviceId = orchStore.selectedDeviceId === id ? '' : id
  orchStore.settingsTab = 'device'
}

function onToggle(d: OrchDevice) {
  // 意图开关：打开 = 想连接（可自动重连）；关闭 = 断开并停止重连。
  // 开关不随连接状态回弹，实际连接看左侧圆点。
  const desired = !isDeviceDesired(d.id)
  setDeviceDesired(d.id, desired)
  if (desired) void connectDevice(d.id)
  else void disconnectDevice(d.id)
}

onMounted(() => {
  ipHistory.value = getIpHistory()
  void loadSerialPorts()
})
</script>

<style scoped>
.device-panel { display: flex; flex-direction: column; gap: 4px; }
.panel-header { display: flex; align-items: center; gap: 8px; }
.panel-title { font-family: var(--font-display); font-size: 0.8rem; font-weight: 600; color: var(--text-primary); flex: 1; }
.panel-count { font-family: var(--font-mono); font-size: 0.65rem; color: var(--text-muted); }
.btn-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--surface-1); color: var(--text-muted); cursor: pointer;
  transition: all var(--duration-fast);
}
.btn-icon:hover { border-color: var(--cyan-400); color: var(--cyan-300); }
.btn-icon--active { border-color: var(--cyan-500); background: var(--cyan-900); color: var(--cyan-300); }

.add-form {
  display: flex; flex-direction: column; gap: 8px;
  padding: 12px; margin-top: 8px;
  background: var(--surface-1); border: 1px solid var(--border); border-radius: var(--radius);
}
.form-row { display: flex; flex-direction: column; gap: 4px; }
.form-row--split { flex-direction: row; gap: 8px; }
.form-col { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.serial-row { display: flex; gap: 5px; align-items: center; }
.serial-row .form-input { flex: 1; min-width: 0; }
.form-row--toggles { flex-direction: row; gap: 14px; align-items: center; }
.form-label { font-family: var(--font-body); font-size: 0.68rem; font-weight: 500; color: var(--text-muted); }
.form-input {
  width: 100%; padding: 6px 9px; font-family: var(--font-mono); font-size: 0.72rem;
  background: var(--void-deep); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text-primary); outline: none;
}
.form-input:focus { border-color: var(--accent); box-shadow: var(--ring); }
.form-input--error { border-color: var(--status-danger); }
.form-hint { font-size: 0.62rem; color: var(--text-muted); line-height: 1.5; }
.form-error { font-size: 0.66rem; color: var(--status-danger); }
.form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 2px; }

.toggle-label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
.toggle-text { font-family: var(--font-body); font-size: 0.68rem; font-weight: 500; color: var(--text-secondary); }
.toggle-input { display: none; }
.toggle-track {
  position: relative; width: 36px; height: 20px; border-radius: 10px;
  background: var(--surface-2); border: 1px solid var(--border); transition: all var(--duration-fast); flex-shrink: 0;
}
.toggle-thumb {
  position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%;
  background: var(--text-muted); transition: all var(--duration-fast) var(--ease-out);
}
.toggle-input:checked + .toggle-track { background: var(--cyan-900); border-color: var(--cyan-500); }
.toggle-input:checked + .toggle-track .toggle-thumb { left: 18px; background: var(--cyan-300); }

.device-list { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; }
.list-empty { font-family: var(--font-mono); font-size: 0.66rem; color: var(--text-muted); text-align: center; padding: 18px 0; }
.device-row {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px;
  background: var(--surface-1); border: 1px solid transparent; border-radius: var(--radius);
  cursor: pointer; transition: border-color var(--duration-fast), background var(--duration-fast);
}
.device-row:hover { border-color: var(--border-bright); }
.device-row--selected { border-color: var(--cyan-500); background: var(--cyan-900); }
.device-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.device-name { font-family: var(--font-mono); font-size: 0.72rem; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.device-meta { font-family: var(--font-mono); font-size: 0.58rem; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.device-type-badge {
  font-family: var(--font-body); font-size: 0.56rem; font-weight: 600; flex-shrink: 0;
  padding: 2px 6px; border-radius: var(--radius-sm); border: 1px solid var(--border); color: var(--text-muted);
}
.device-type-badge--docat-motion { color: var(--status-virtual); border-color: var(--status-virtual); background: var(--status-virtual-dim); }
.device-type-badge--tcp-server { color: var(--cyan-300); border-color: var(--cyan-800); background: var(--cyan-900); }
.device-type-badge--tcp-client { color: var(--cyan-300); border-color: var(--cyan-800); background: var(--cyan-900); }
.device-type-badge--udp { color: var(--status-warning); border-color: var(--status-warning-dim); background: var(--status-warning-dim); }
.device-type-badge--serial { color: var(--status-online); border-color: var(--status-online-dim); background: var(--status-online-dim); }

.orch-collapse-enter-active { animation: slide-down 0.18s var(--ease-out); }
.orch-collapse-leave-active { animation: slide-down 0.12s var(--ease-out) reverse; }
</style>
