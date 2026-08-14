<template>
  <div class="pose-tab">
    <!-- 目标设备选择 -->
    <div class="target-row">
      <span class="target-label">目标设备</span>
      <select v-model="target" class="target-select">
        <option value="">未选择 — 无法读取/运动</option>
        <optgroup label="Docat Motion">
          <option v-for="d in motionDevices" :key="d.id" :value="`motion:${d.id}`">
            {{ d.name }}{{ d.connected ? '' : '（未连接）' }}
          </option>
        </optgroup>
        <optgroup label="注册设备">
          <option v-for="d in allRealDevices" :key="d.id" :value="`real:${d.id}`">
            {{ d.connected ? '● ' : '○ ' }}{{ d.name }} · {{ d.ip }}
          </option>
        </optgroup>
      </select>
      <p v-if="!motionDevices.length && !allRealDevices.length" class="target-hint">
        无可用设备 — 先在设备列表添加一个 Docat Motion（无需真实设备），或注册并连接机械臂
      </p>
    </div>

    <!-- 当前姿态 + 保存 -->
    <div class="current-card">
      <div class="current-header">
        <span class="current-title">当前姿态</span>
        <button class="btn btn-secondary btn-sm" :disabled="!target || reading" @click="readCurrent" title="读取当前姿态 (Ctrl+Shift+.)">
          {{ reading ? '读取中...' : '读取' }}
        </button>
      </div>
      <div class="current-values">
        <span v-for="(axis, i) in ['X','Y','Z','RX','RY','RZ']" :key="axis" class="current-value">
          <b>{{ axis }}</b>{{ currentPose[i]?.toFixed(1) ?? '—' }}
        </span>
      </div>
      <div class="save-row">
        <input ref="nameInputRef" v-model.trim="newName" class="save-name" placeholder="姿态名（变量命名规则）" spellcheck="false"
          :class="{ 'save-name--error': nameErr }" @input="nameErr = ''" @keyup.enter="saveCurrent" />
        <select v-model="newType" class="save-type">
          <option value="cartesian">位姿</option>
          <option value="joint">关节角</option>
        </select>
        <button class="btn btn-primary btn-sm" :disabled="(!hasRead && !manualParsed) || !newName" @click="saveCurrent">
          保存
        </button>
      </div>

      <div class="manual-row">
        <label class="manual-label">或手动输入坐标</label>
        <input v-model.trim="manualInput" class="manual-input" spellcheck="false"
          placeholder="6 个数值，空格/逗号/分号分隔均可，首尾可加 [ ] 或 ( )，如 [100, 0, 50, 0, 0, 0]" />
        <div class="manual-preview" :class="{ 'manual-preview--ok': manualParsed !== null, 'manual-preview--bad': manualInput && manualParsed === null }">
          {{ manualInput ? (manualParsed ? `已解析: [${manualParsed.map(v => Number(v).toFixed(1)).join(', ')}]` : '需恰好 6 个数值') : '留空则使用读取的当前姿态' }}
        </div>
      </div>
      <p v-if="nameErr" class="save-error">{{ nameErr }}</p>
      <p class="save-hint">同名再次保存将覆盖，10 秒内可撤销；名称供脚本 poses.get() 调用。快捷键 Ctrl+Shift+.：读取当前姿态并聚焦名称框，输入名称后回车保存</p>
    </div>

    <!-- 姿态列表 -->
    <div class="pose-list">
      <div class="pose-list-header">
        <span class="pose-list-title">姿态存储（独立于设备页姿态）</span>
        <span class="pose-count">{{ orchStore.poses.length }}</span>
      </div>
      <div v-if="!orchStore.poses.length" class="list-empty">暂无姿态 — 读取后保存一个</div>
      <div v-for="p in orchStore.poses" :key="p.name" class="pose-row">
        <div class="pose-info">
          <template v-if="renamingName === p.name">
            <input v-model.trim="renamingNew" class="rename-input" spellcheck="false"
              @keyup.enter="confirmRename" @keyup.esc="renamingName = ''" @blur="confirmRename" />
          </template>
          <template v-else>
            <span class="pose-name">
              {{ p.name }}
              <span class="pose-type-badge" :class="p.type === 'cartesian' ? 'pose-type-badge--cart' : 'pose-type-badge--joint'">
                {{ p.type === 'cartesian' ? '位姿' : '关节角' }}
              </span>
            </span>
            <span class="pose-values">{{ formatPose(p) }}</span>
          </template>
        </div>
        <div class="pose-actions">
          <button class="btn btn-secondary btn-xs" :disabled="!canMove(p)" @click="moveToPose(p)" title="一键运动到该姿态">运动到</button>
          <button class="btn btn-secondary btn-xs" :disabled="!target || reading" @click="overwriteFromCurrent(p)" title="读取当前姿态覆盖保存（可撤销）">读取更新</button>
          <button class="btn-icon" title="重命名" @click="startRename(p)">✎</button>
          <button class="btn-icon btn-icon--danger" title="删除" @click="removePose(p.name)">✕</button>
        </div>
      </div>
    </div>

    <Toast ref="toastRef" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import * as api from '../../services/api'
import { deviceStore } from '../../stores/deviceStore'
import {
  addLog,
  getMotionPose,
  identifierError,
  manualMoveMotion,
  orchStore,
  parsePoseText,
  removeOrchPose,
  renameOrchPose,
  saveOrchPoseFromCurrent,
  undoPoseOverwrite,
  type OrchPose,
} from '../../stores/orchestrationStore'
import Toast from '../Toast.vue'

const toastRef = ref<InstanceType<typeof Toast>>()
const nameInputRef = ref<HTMLInputElement | null>(null)

// ─── 记住上次选中的目标设备（motion:/real: 前缀，localStorage）──

const TARGET_KEY = 'docat.orchestration.pose-target'

function loadSavedTarget(): string {
  try {
    return localStorage.getItem(TARGET_KEY) ?? ''
  } catch {
    return ''
  }
}

const target = ref(loadSavedTarget())

watch(target, (v) => {
  try {
    localStorage.setItem(TARGET_KEY, v)
  } catch {
    // ignore
  }
})

/** 校验记住的目标设备是否仍存在；列表未就绪时无法判断，等下一次变化再校验 */
function validateTarget() {
  if (!target.value) return
  if (target.value.startsWith('motion:')) {
    const id = target.value.slice(7)
    if (!id || !orchStore.devices.some(d => d.id === id)) target.value = ''
    return
  }
  if (target.value.startsWith('real:')) {
    const id = target.value.slice(5)
    if (!id || !(id in deviceStore.devices)) target.value = ''
    return
  }
  target.value = ''
}

// 列表已就绪立即校验；异步加载时等首次变化（watch 在 computeds 声明后注册）
validateTarget()

const reading = ref(false)
const hasRead = ref(false)
const currentPose = ref<number[]>([0, 0, 0, 0, 0, 0])
const currentJoints = ref<number[]>([0, 0, 0, 0, 0, 0])
const newName = ref('')
const newType = ref<'cartesian' | 'joint'>('cartesian')
const nameErr = ref('')
const renamingName = ref('')
const renamingNew = ref('')
const manualInput = ref('')

const manualParsed = computed(() => parsePoseText(manualInput.value))

const motionDevices = computed(() => orchStore.devices.filter(d => d.type === 'docat-motion'))
const allRealDevices = computed(() => {
  const out: Array<{ id: string; name: string; ip: string; connected: boolean }> = []
  for (const [id, cfg] of Object.entries(deviceStore.devices)) {
    out.push({ id, name: cfg.name, ip: cfg.ip, connected: deviceStore.isConnected(id) })
  }
  return out.sort((a, b) => Number(b.connected) - Number(a.connected))
})

// 记住的目标设备失效校验：列表变化时检查；先于 computeds 的立即校验在异步加载前为空表，等首次变化
watch([motionDevices, allRealDevices], validateTarget)

function targetMotionId(): string | null {
  return target.value.startsWith('motion:') ? target.value.slice(7) : null
}
function targetRealId(): string | null {
  return target.value.startsWith('real:') ? target.value.slice(5) : null
}

/** 读取当前姿态；成功返回 true，失败返回 false（失败时已 toast 原因） */
async function readCurrent(): Promise<boolean> {
  if (!target.value) return false
  reading.value = true
  try {
    const motionId = targetMotionId()
    if (motionId) {
      const pose = getMotionPose(motionId)
      if (!pose) {
        toastRef.value?.error('Docat Motion 未连接，无法读取')
        return false
      }
      currentPose.value = [...pose]
      currentJoints.value = [0, 0, 0, 0, 0, 0]
    } else {
      const realId = targetRealId()
      if (!realId) return false
      const res = await api.getDeviceStatus(realId)
      if (!res.data?.connected) {
        toastRef.value?.error('设备未连接，无法读取姿态')
        return false
      }
      const state = res.data.state as { pose?: { x?: number; y?: number; z?: number; rx?: number; ry?: number; rz?: number }; joints?: Record<string, number> } | null
      if (!state || !state.pose) {
        toastRef.value?.error('读取姿态失败：无实时位姿')
        return false
      }
      currentPose.value = [state.pose.x ?? 0, state.pose.y ?? 0, state.pose.z ?? 0, state.pose.rx ?? 0, state.pose.ry ?? 0, state.pose.rz ?? 0]
      const j = state.joints
      currentJoints.value = [1, 2, 3, 4, 5, 6].map(i => j?.[`j${i}`] ?? 0)
    }
    hasRead.value = true
    addLog('姿态', 'system', '已读取当前姿态')
    return true
  } finally {
    reading.value = false
  }
}

/**
 * Ctrl+Shift+. / Cmd+Shift+.：添加当前姿态 —
 * 读取目标设备当前姿态 → 聚焦名称输入框并全选 → 输入名称后回车保存。
 * 快捷键由父组件 SettingsPanel 统一监听（姿态 tab 未打开时自动切换），此处仅提供动作。
 */
async function addCurrentPose() {
  if (!target.value) {
    toastRef.value?.info('请先选择目标设备')
    return
  }
  const ok = await readCurrent()
  if (!ok) return
  await nextTick()
  nameInputRef.value?.focus()
  nameInputRef.value?.select()
  toastRef.value?.info('已读取当前姿态 — 输入名称后回车保存')
}

defineExpose({ addCurrentPose })

function saveCurrent() {
  const err = identifierError(newName.value, [])
  if (err) { nameErr.value = err; return }

  // 数值来源：手动输入优先；否则用读取的当前姿态
  let poseValues: number[]
  let jointValues: number[]
  const manual = manualParsed.value
  if (manual) {
    poseValues = manual
    jointValues = manual
  } else if (hasRead.value) {
    poseValues = [...currentPose.value]
    jointValues = [...currentJoints.value]
  } else {
    toastRef.value?.info('请先读取当前姿态，或手动输入坐标')
    return
  }

  void (async () => {
    const res = await saveOrchPoseFromCurrent(
      newName.value,
      newType.value,
      newType.value === 'joint' ? jointValues : currentJoints.value,
      newType.value === 'cartesian'
        ? { x: poseValues[0], y: poseValues[1], z: poseValues[2], rx: poseValues[3], ry: poseValues[4], rz: poseValues[5] }
        : { x: currentPose.value[0], y: currentPose.value[1], z: currentPose.value[2], rx: currentPose.value[3], ry: currentPose.value[4], rz: currentPose.value[5] }
    )
    if (!res.ok) { nameErr.value = res.error ?? '保存失败'; return }
    if (res.overwritten) {
      toastRef.value?.error(`姿态 "${newName.value}" 已覆盖`, {
        duration: 10000,
        action: { label: '撤销', handler: () => { void undoPoseOverwrite().then(ok => { if (ok) toastRef.value?.info('已恢复原姿态') }) } },
      })
    } else {
      toastRef.value?.success(`姿态 "${newName.value}" 已保存`)
    }
    newName.value = ''
    manualInput.value = ''
  })()
}

function formatPose(p: OrchPose): string {
  if (p.type === 'cartesian') {
    const { x, y, z, rx, ry, rz } = p.pose
    return `X${x.toFixed(1)} Y${y.toFixed(1)} Z${z.toFixed(1)} RX${rx.toFixed(1)} RY${ry.toFixed(1)} RZ${rz.toFixed(1)}`
  }
  return (p.joint || []).map(v => `${Number(v).toFixed(1)}°`).join(' ')
}

function canMove(p: OrchPose): boolean {
  if (!target.value) return false
  if (targetMotionId()) return p.type === 'cartesian' && orchStore.devices.some(d => d.id === targetMotionId() && d.connected)
  return !!targetRealId()
}

async function moveToPose(p: OrchPose) {
  const motionId = targetMotionId()
  if (motionId) {
    const device = orchStore.devices.find(d => d.id === motionId)
    if (!device?.connected) {
      toastRef.value?.error('Docat Motion 未连接，无法运动')
      return
    }
    const pose = [p.pose.x, p.pose.y, p.pose.z, p.pose.rx, p.pose.ry, p.pose.rz]
    toastRef.value?.info(`正在运动到 ${p.name}...`)
    await new Promise(r => setTimeout(r, 500))
    manualMoveMotion(motionId, pose)
    toastRef.value?.success(`已运动到 ${p.name}`)
    return
  }
  const realId = targetRealId()
  if (!realId) return
  if (!deviceStore.isConnected(realId)) {
    toastRef.value?.error('设备未连接，无法运动')
    return
  }
  if (p.type === 'cartesian') {
    const res = await api.moveCartesian(realId, { x: p.pose.x, y: p.pose.y, z: p.pose.z, rx: p.pose.rx, ry: p.pose.ry, rz: p.pose.rz })
    if (res.success) toastRef.value?.success(`已运动到 ${p.name}`)
    else toastRef.value?.error(`运动失败：${res.error?.message}`)
  } else {
    const res = await api.moveJoints(realId, [...p.joint])
    if (res.success) toastRef.value?.success(`已运动到 ${p.name}`)
    else toastRef.value?.error(`运动失败：${res.error?.message}`)
  }
}

async function overwriteFromCurrent(p: OrchPose) {
  if (!target.value) return
  await readCurrent()
  const res = await saveOrchPoseFromCurrent(
    p.name,
    p.type,
    currentJoints.value,
    { x: currentPose.value[0], y: currentPose.value[1], z: currentPose.value[2], rx: currentPose.value[3], ry: currentPose.value[4], rz: currentPose.value[5] }
  )
  if (res.ok && res.overwritten) {
    toastRef.value?.error(`姿态 "${p.name}" 已覆盖为当前姿态`, {
      duration: 10000,
      action: { label: '撤销', handler: () => { void undoPoseOverwrite().then(ok => { if (ok) toastRef.value?.info('已恢复原姿态') }) } },
    })
  }
}

function startRename(p: OrchPose) {
  renamingName.value = p.name
  renamingNew.value = p.name
}

function confirmRename() {
  if (!renamingName.value || !renamingNew.value.trim() || renamingNew.value === renamingName.value) return
  void (async () => {
    const res = await renameOrchPose(renamingName.value, renamingNew.value)
    if (res.ok) toastRef.value?.success(`已重命名为 ${renamingNew.value.trim()}`)
    else toastRef.value?.error(res.error ?? '重命名失败')
    renamingName.value = ''
  })()
}

function removePose(name: string) {
  removeOrchPose(name)
  toastRef.value?.success(`姿态 "${name}" 已删除`)
}
</script>

<style scoped>
.pose-tab { display: flex; flex-direction: column; gap: 12px; }
.target-row { display: flex; flex-direction: column; gap: 4px; }
.target-label { font-family: var(--font-body); font-size: 0.68rem; font-weight: 500; color: var(--text-muted); }
.target-select {
  padding: 6px 9px; font-family: var(--font-mono); font-size: 0.7rem;
  background: var(--void-deep); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text-primary); outline: none;
}
.target-select:focus { border-color: var(--accent); }
.target-hint { font-size: 0.6rem; color: var(--text-muted); line-height: 1.5; }

.current-card { padding: 10px; background: var(--surface-1); border: 1px solid var(--border); border-radius: var(--radius); }
.current-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.current-title { font-size: 0.7rem; font-weight: 600; color: var(--text-secondary); }
.current-values { display: flex; gap: 10px; flex-wrap: wrap; margin: 8px 0 10px; }
.current-value { font-family: var(--font-mono); font-size: 0.62rem; color: var(--text-secondary); }
.current-value b { color: var(--text-muted); font-weight: 500; margin-right: 3px; }
.save-row { display: flex; gap: 6px; align-items: center; }
.save-name { flex: 1; min-width: 0; padding: 6px 9px; font-family: var(--font-mono); font-size: 0.68rem; background: var(--void-deep); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text-primary); outline: none; }
.save-name:focus { border-color: var(--accent); }
.save-name--error { border-color: var(--status-danger); }
.save-type { padding: 6px 8px; font-size: 0.66rem; background: var(--void-deep); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text-primary); outline: none; }
.manual-row { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
.manual-label { font-size: 0.66rem; color: var(--text-muted); }
.manual-input {
  width: 100%; padding: 6px 9px; font-family: var(--font-mono); font-size: 0.66rem;
  background: var(--void-deep); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text-primary); outline: none;
}
.manual-input:focus { border-color: var(--accent); }
.manual-preview { font-family: var(--font-mono); font-size: 0.6rem; color: var(--text-muted); }
.manual-preview--ok { color: var(--status-online); }
.manual-preview--bad { color: var(--status-danger); }
.save-error { font-size: 0.62rem; color: var(--status-danger); margin-top: 6px; }
.save-hint { font-size: 0.6rem; color: var(--text-muted); margin-top: 6px; line-height: 1.5; }

.pose-list-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.pose-list-title { font-size: 0.7rem; font-weight: 600; color: var(--text-secondary); }
.pose-count { font-family: var(--font-mono); font-size: 0.62rem; color: var(--text-muted); }
.list-empty { font-family: var(--font-mono); font-size: 0.62rem; color: var(--text-muted); text-align: center; padding: 12px 0; }
.pose-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 9px; background: var(--surface-1); border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 4px; }
.pose-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.rename-input {
  width: 100%; padding: 4px 7px; font-family: var(--font-mono); font-size: 0.68rem;
  background: var(--void-deep); border: 1px solid var(--cyan-500); border-radius: var(--radius);
  color: var(--cyan-300); outline: none;
}
.pose-name { font-family: var(--font-mono); font-size: 0.7rem; font-weight: 600; color: var(--cyan-300); display: flex; align-items: center; gap: 6px; }
.pose-type-badge { font-size: 0.52rem; font-weight: 600; padding: 1px 5px; border-radius: var(--radius-sm); }
.pose-type-badge--cart { color: var(--status-online); border: 1px solid var(--status-online-dim); background: var(--status-online-dim); }
.pose-type-badge--joint { color: var(--text-muted); border: 1px solid var(--border); }
.pose-values { font-family: var(--font-mono); font-size: 0.56rem; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pose-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.btn-xs { padding: 3px 7px; font-size: 10px; }
.btn-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; border: none; background: none; color: var(--text-muted);
  cursor: pointer; font-size: 11px; border-radius: var(--radius-sm); transition: all var(--duration-fast);
}
.btn-icon:hover { color: var(--cyan-300); background: var(--surface-hover); }
.btn-icon--danger:hover { color: var(--status-danger); }
</style>
