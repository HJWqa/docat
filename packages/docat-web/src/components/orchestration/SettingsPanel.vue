<template>
  <section class="settings-panel">
    <div class="settings-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="settings-tab"
        :class="{ 'settings-tab--active': orchStore.settingsTab === tab.key }"
        @click="orchStore.settingsTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <div class="settings-body">
      <!-- 通用 -->
      <div v-if="orchStore.settingsTab === 'general'" class="settings-section">
        <div class="field-row">
          <label class="field-label">默认分隔符</label>
          <input v-model="orchStore.settings.defaultSeparator" class="field-input field-input--sm" placeholder=";" spellcheck="false" />
        </div>
        <div class="field-row">
          <label class="field-label">日志保留条数</label>
          <input v-model.number="orchStore.settings.logLimit" type="number" min="50" max="5000" step="50" class="field-input field-input--sm" />
        </div>
        <div class="field-row field-row--toggle">
          <span class="field-label">启动时自动连接</span>
          <label class="toggle-label">
            <input v-model="orchStore.settings.autoConnectOnLoad" type="checkbox" class="toggle-input" />
            <span class="toggle-track"><span class="toggle-thumb" /></span>
          </label>
        </div>
        <div class="field-row field-row--toggle">
          <span class="field-label">跟随脚本文件变动</span>
          <label class="toggle-label">
            <input v-model="orchStore.settings.scriptFollow" type="checkbox" class="toggle-input" />
            <span class="toggle-track"><span class="toggle-thumb" /></span>
          </label>
        </div>
        <div class="field-row field-row--toggle">
          <span class="field-label">轮询对账</span>
          <label class="toggle-label" title="每 4s 与服务端设备状态对账（WS 异常时兜底），出问题可关闭">
            <input v-model="orchStore.settings.pollReconcile" type="checkbox" class="toggle-input" />
            <span class="toggle-track"><span class="toggle-thumb" /></span>
          </label>
          <span class="field-hint">每 4s 与服务端设备状态对账（WS 异常时兜底）</span>
        </div>

        <div class="heartbeat-settings">
          <span class="field-label">自动重连上限</span>
          <div class="field-row field-row--split">
            <div class="field-col">
              <label class="field-label">最大次数</label>
              <input v-model.number="orchStore.settings.reconnectMaxAttempts" type="number" min="0" max="100" step="1" class="field-input" title="0 = 不限次数" />
            </div>
            <div class="field-col">
              <label class="field-label">最长时长 (s)</label>
              <input v-model.number="orchStore.settings.reconnectMaxSeconds" type="number" min="10" max="86400" step="10" class="field-input" />
            </div>
          </div>
          <span class="field-hint">仅在设备列表连接开关打开时自动重连；最大次数设为 0 表示不限次数；达到次数或时长上限后停止，并自动关闭该设备连接开关</span>
        </div>

        <div class="heartbeat-settings">
          <div class="field-row field-row--toggle">
            <span class="field-label">端口恢复快速重连</span>
            <label class="toggle-label" title="仅 TCP Client：固定间隔直接重连（不探测、不打扰对端），恢复即连；不受重连上限约束（开关不自动关闭），手动断开仍停止">
              <input v-model="orchStore.settings.rapidRecovery" type="checkbox" class="toggle-input" />
              <span class="toggle-track"><span class="toggle-thumb" /></span>
            </label>
          </div>
          <div class="field-row field-row--split">
            <div class="field-col">
              <label class="field-label">重连间隔 (ms)</label>
              <input v-model.number="orchStore.settings.rapidRecoveryInterval" type="number" min="200" max="60000" step="100" class="field-input" />
            </div>
          </div>
          <span class="field-hint">仅 TCP Client；开启后每间隔直接重连一次（端口关闭时瞬时失败，不打扰对端），恢复即连；不受重连次数/时长上限约束（开关不会自动关闭）</span>
        </div>

        <div class="heartbeat-settings">
          <span class="field-label">心跳（ping → pong）</span>
          <div class="field-row field-row--split">
            <div class="field-col">
              <label class="field-label">发送内容</label>
              <input v-model="orchStore.settings.heartbeatPing" class="field-input" placeholder="ping;" spellcheck="false" />
            </div>
            <div class="field-col">
              <label class="field-label">应答内容</label>
              <input v-model="orchStore.settings.heartbeatPong" class="field-input" placeholder="pong;" spellcheck="false" />
            </div>
          </div>
          <div class="field-row field-row--split">
            <div class="field-col">
              <label class="field-label">周期 (ms)</label>
              <input v-model.number="orchStore.settings.heartbeatInterval" type="number" min="1000" step="500" class="field-input" />
            </div>
            <div class="field-col">
              <label class="field-label">超时 (ms)</label>
              <input v-model.number="orchStore.settings.heartbeatTimeout" type="number" min="2000" step="1000" class="field-input" />
            </div>
            <div class="field-col">
              <label class="field-label">失活阈值</label>
              <input v-model.number="orchStore.settings.heartbeatMissThreshold" type="number" min="1" step="1" class="field-input" />
            </div>
          </div>
          <span class="field-hint">开启心跳的设备按周期发送内容并期待应答，超时连续达阈值判定链路失活（配合自动重连）；输入框为单行，支持 \n 转义换行</span>
        </div>

        <div class="field-row">
          <label class="field-label">脚本目录（服务端）</label>
          <input v-model="orchStore.settings.scriptsDir" class="field-input" placeholder="./data/orch-scripts" spellcheck="false" />
          <span class="field-hint">服务端本地路径；脚本文件从此目录加载并监听变更，修改后保存即可生效</span>
        </div>
        <div class="field-row">
          <label class="field-label">Python 命令/路径（服务端）</label>
          <input v-model="orchStore.settings.pythonCommand" class="field-input" placeholder="留空自动探测（python3 / python / py -3）" spellcheck="false" />
          <span class="field-hint">自定义 Python 解释器命令或完整路径，可带参数（如 C:\Python311\python.exe -u、/usr/bin/python3.11）；不可用时自动回退自动探测并提示</span>
        </div>
        <div class="field-actions">
          <button class="btn btn-primary btn-sm" @click="saveSettings">保存设置</button>
          <button class="btn btn-secondary btn-sm" @click="clearLogs()">清空日志</button>
        </div>
        <p v-if="settingsMsg" class="field-msg">{{ settingsMsg }}</p>
      </div>

      <!-- 设备 -->
      <div v-else-if="orchStore.settingsTab === 'device'" class="settings-section">
        <template v-if="selectedDevice">
          <div class="field-row">
            <label class="field-label">名称</label>
            <input v-model.trim="editForm.name" class="field-input" spellcheck="false" />
          </div>
          <div class="field-row">
            <label class="field-label">类型</label>
            <select v-model="editForm.type" class="field-input">
              <option v-for="t in ORCH_DEVICE_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
            </select>
          </div>

          <template v-if="editForm.type === 'docat-motion'">
            <div class="field-row">
              <label class="field-label">被模拟的设备（可选）</label>
              <select v-model="editForm.targetDeviceId" class="field-input">
                <option value="">（不选择 — 纯虚拟模拟）</option>
                <option v-for="d in realDevices" :key="d.id" :value="d.id">{{ d.name }} · {{ d.ip }}</option>
              </select>
            </div>
          </template>
          <template v-else>
            <div class="field-row field-row--split">
              <div class="field-col">
                <label class="field-label">{{ editForm.type === 'serial' ? '串口号' : 'IP' }}</label>
                <template v-if="editForm.type === 'serial'">
                  <div class="serial-row">
                    <select v-model="editForm.serialPort" class="field-input">
                      <option value="">选择串口</option>
                      <option v-for="p in serialPorts" :key="p" :value="p">{{ p }}</option>
                    </select>
                    <button class="btn btn-secondary btn-sm" :disabled="loadingPorts" @click="loadSerialPorts" title="刷新串口列表">
                      {{ loadingPorts ? '…' : '↻' }}
                    </button>
                  </div>
                </template>
                <template v-else>
                  <input :value="editForm.ip" list="orch-ip-history-edit" spellcheck="false"
                    @input="(e) => { editForm.ip = (e.target as HTMLInputElement).value }" class="field-input" />
                  <datalist id="orch-ip-history-edit">
                    <option v-for="ip in ipHistory" :key="ip" :value="ip" />
                  </datalist>
                </template>
              </div>
              <div class="field-col">
                <label class="field-label">{{ editForm.type === 'serial' ? '波特率' : '端口' }}</label>
                <input :value="editForm.type === 'serial' ? editForm.baudRate : editForm.port" type="number"
                  :min="editForm.type === 'serial' ? 1200 : 1" :max="editForm.type === 'serial' ? 4000000 : 65535"
                  :list="editForm.type === 'serial' ? 'orch-baud-edit' : undefined"
                  @input="(e) => { const v = Number((e.target as HTMLInputElement).value) || 0; if (editForm.type === 'serial') editForm.baudRate = v; else editForm.port = v }"
                  class="field-input" />
                <datalist v-if="editForm.type === 'serial'" id="orch-baud-edit">
                  <option v-for="b in BAUD_RATES" :key="b" :value="b" />
                </datalist>
              </div>
            </div>
          </template>

          <div class="field-row field-row--toggle">
            <span class="field-label">自动重连</span>
            <label class="toggle-label">
              <input v-model="editForm.autoReconnect" type="checkbox" class="toggle-input" />
              <span class="toggle-track"><span class="toggle-thumb" /></span>
            </label>
          </div>
          <div class="field-row field-row--toggle">
            <span class="field-label">心跳</span>
            <label class="toggle-label">
              <input v-model="editForm.heartbeat" type="checkbox" class="toggle-input" />
              <span class="toggle-track"><span class="toggle-thumb" /></span>
            </label>
          </div>

          <div class="field-row field-row--status">
            <span class="field-label">状态</span>
            <span class="status-text" :class="selectedDevice.connected ? 'status-text--on' : 'status-text--off'">
              {{ selectedDevice.connected ? '已连接' : '未连接' }}
            </span>
          </div>

          <div class="field-actions">
            <button class="btn btn-primary btn-sm" @click="saveEdit">保存</button>
            <button class="btn btn-danger btn-sm" @click="removeDevice">删除</button>
          </div>
          <p v-if="editError" class="field-msg field-msg--error">{{ editError }}</p>
        </template>
        <div v-else class="device-edit-empty">点击左侧设备列表中的设备以编辑配置</div>
      </div>

      <!-- 姿态 -->
      <div v-else-if="orchStore.settingsTab === 'pose'" class="settings-section">
        <PoseTab ref="poseTabRef" />
      </div>

      <!-- 编程 -->
      <div v-else class="settings-section">
        <ProgrammingPanel ref="programmingTabRef" />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { deviceStore } from '../../stores/deviceStore'
import { orchListSerialPorts } from '../../services/orchApi'
import {
  clearLogs,
  getIpHistory,
  identifierError,
  isOrchMockMode,
  orchStore,
  ORCH_DEVICE_TYPES,
  recordIp,
  removeOrchDevice,
  saveOrchSettings,
  updateOrchDevice,
  type OrchDeviceType,
} from '../../stores/orchestrationStore'
import PoseTab from './PoseTab.vue'
import ProgrammingPanel from './ProgrammingPanel.vue'

const tabs = [
  { key: 'general' as const, label: '通用' },
  { key: 'device' as const, label: '设备' },
  { key: 'pose' as const, label: '姿态' },
  { key: 'programming' as const, label: '编程' },
]

const selectedDevice = computed(() => orchStore.devices.find(d => d.id === orchStore.selectedDeviceId) ?? null)
const realDevices = computed(() => Object.values(deviceStore.devices))
const ipHistory = ref<string[]>([])
const serialPorts = ref<string[]>([])
const loadingPorts = ref(false)
const poseTabRef = ref<InstanceType<typeof PoseTab>>()
const programmingTabRef = ref<InstanceType<typeof ProgrammingPanel>>()

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

onMounted(() => {
  ipHistory.value = getIpHistory()
  void loadSerialPorts()
  window.addEventListener('keydown', onGlobalKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
})

/**
 * 全局快捷键（window 级，姿态/编程 tab 未打开时自动切换）：
 * Ctrl+Shift+. 切「姿态」tab + 添加当前姿态
 * Ctrl+B      切「编程」tab + 启动最近项目
 * Ctrl+M      切「编程」tab + 停止项目
 * 注意按 Shift 后 e.key 为 '>'，须用 e.code 判断。
 */
async function onGlobalKeydown(e: KeyboardEvent) {
  if (e.defaultPrevented) return
  const mod = e.ctrlKey || e.metaKey
  if (!mod || e.altKey) return
  if (e.shiftKey) {
    if (e.code === 'Period') {
      e.preventDefault()
      orchStore.settingsTab = 'pose'
      await nextTick()
      await poseTabRef.value?.addCurrentPose()
    }
    return
  }
  if (e.code === 'KeyB') {
    e.preventDefault()
    orchStore.settingsTab = 'programming'
    await nextTick()
    programmingTabRef.value?.runRecent()
    return
  }
  if (e.code === 'KeyM') {
    e.preventDefault()
    orchStore.settingsTab = 'programming'
    await nextTick()
    programmingTabRef.value?.stopCurrent()
  }
}

const editForm = reactive({
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

const editError = ref('')
const settingsMsg = ref('')
let settingsMsgTimer: ReturnType<typeof setTimeout> | null = null

watch(selectedDevice, (d) => {
  editError.value = ''
  if (!d) return
  editForm.name = d.name
  editForm.type = d.type
  editForm.ip = d.ip
  editForm.port = d.port
  editForm.serialPort = d.serialPort
  editForm.baudRate = d.baudRate
  editForm.targetDeviceId = d.targetDeviceId
  editForm.autoReconnect = d.autoReconnect
  editForm.heartbeat = d.heartbeat
}, { immediate: true })

function flashSettingsMsg(msg: string, isError = false) {
  settingsMsg.value = msg
  if (settingsMsgTimer) clearTimeout(settingsMsgTimer)
  settingsMsgTimer = setTimeout(() => { settingsMsg.value = '' }, 3000)
}

function saveSettings() {
  void saveOrchSettings()
  flashSettingsMsg('设置已保存')
}

async function saveEdit() {
  if (!selectedDevice.value) return
  const err = identifierError(editForm.name, orchStore.devices.filter(d => d.id !== selectedDevice.value!.id).map(d => d.name))
  if (err) { editError.value = err; return }
  const res = await updateOrchDevice(selectedDevice.value.id, {
    name: editForm.name,
    type: editForm.type,
    ip: editForm.ip,
    port: editForm.port,
    serialPort: editForm.serialPort,
    baudRate: editForm.baudRate,
    targetDeviceId: editForm.targetDeviceId,
    autoReconnect: editForm.autoReconnect,
    heartbeat: editForm.heartbeat,
  })
  if (res.ok) {
    editError.value = ''
    recordIp(editForm.ip)
    ipHistory.value = getIpHistory()
  } else {
    editError.value = res.error ?? '保存失败'
  }
}

function removeDevice() {
  if (!selectedDevice.value) return
  removeOrchDevice(selectedDevice.value.id)
  orchStore.selectedDeviceId = ''
}
</script>

<style scoped>
.settings-panel { display: flex; flex-direction: column; gap: 8px; }
.settings-tabs { display: flex; gap: 2px; }
.settings-tab {
  flex: 1; padding: 6px 0; border: 1px solid var(--border); background: var(--surface-1);
  color: var(--text-muted); font-family: var(--font-body); font-size: 0.7rem; font-weight: 500;
  cursor: pointer; transition: all var(--duration-fast);
}
.settings-tab:first-child { border-radius: var(--radius) 0 0 var(--radius); }
.settings-tab:last-child { border-radius: 0 var(--radius) var(--radius) 0; }
.settings-tab:hover { color: var(--text-primary); border-color: var(--border-bright); }
.settings-tab--active { background: var(--cyan-900); border-color: var(--cyan-500); color: var(--cyan-300); }

.settings-body { padding: 10px; background: var(--surface-1); border: 1px solid var(--border); border-radius: var(--radius); }
.settings-section { display: flex; flex-direction: column; gap: 8px; }
.field-row { display: flex; flex-direction: column; gap: 4px; }
.field-row--split { flex-direction: row; gap: 8px; }
.field-col { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.serial-row { display: flex; gap: 5px; align-items: center; }
.serial-row .field-input { flex: 1; min-width: 0; }
.field-row--toggle { flex-direction: row; align-items: center; justify-content: space-between; }
.field-row--status { flex-direction: row; align-items: center; justify-content: space-between; }
.field-label { font-family: var(--font-body); font-size: 0.68rem; font-weight: 500; color: var(--text-muted); }
.field-input {
  width: 100%; padding: 6px 9px; font-family: var(--font-mono); font-size: 0.7rem;
  background: var(--void-deep); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text-primary); outline: none;
}
.field-input:focus { border-color: var(--accent); box-shadow: var(--ring); }
.field-input--sm { width: 120px; }
.field-hint { font-size: 0.6rem; color: var(--text-muted); line-height: 1.5; }
.heartbeat-settings {
  display: flex; flex-direction: column; gap: 6px;
  padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--void-surface);
}
.field-actions { display: flex; gap: 8px; margin-top: 4px; }
.field-msg { font-size: 0.64rem; color: var(--status-online); }
.field-msg--error { color: var(--status-danger); }
.status-text { font-family: var(--font-mono); font-size: 0.68rem; font-weight: 600; }
.status-text--on { color: var(--status-online); }
.status-text--off { color: var(--status-offline); }
.device-edit-empty { font-family: var(--font-mono); font-size: 0.64rem; color: var(--text-muted); text-align: center; padding: 22px 0; }

.toggle-label { display: inline-flex; align-items: center; cursor: pointer; }
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
</style>
