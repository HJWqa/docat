<template>
  <div class="log-panel">
    <div class="log-header">
      <span class="log-title">日志</span>
      <span class="log-count">{{ orchStore.logs.length }}</span>
    </div>
    <div class="log-main">
      <div ref="logListRef" class="log-list">
        <div v-if="!visibleLogs.length" class="log-empty">暂无日志</div>
        <div v-for="entry in visibleLogs" :key="entry.id" class="log-entry" :class="`log-entry--${entry.direction}`">
          <span class="log-time">{{ formatTime(entry.time) }}</span>
          <span class="log-device">{{ entry.deviceName }}</span>
          <span class="log-arrow">{{ arrow(entry.direction) }}</span>
          <span class="log-text">{{ entry.text }}</span>
        </div>
      </div>

      <div class="log-side">
        <div class="log-filters">
          <button
            v-for="f in filters"
            :key="f.key"
            class="filter-chip"
            :class="{ 'filter-chip--active': activeFilters.includes(f.key) }"
            @click="toggleFilter(f.key)"
            :title="`${f.label}：${countFor(f.key)} 条`"
          >
            {{ f.label }}<span class="filter-count">{{ countFor(f.key) }}</span>
          </button>
          <button
            class="filter-chip"
            :class="{ 'filter-chip--active': showConnectFailures }"
            @click="toggleConnectFailures"
            title="设备连接失败提示（关闭后不显示；脚本发送未连接设备不归此类）"
          >
            连接失败<span class="filter-count">{{ connectFailureCount }}</span>
          </button>
        </div>
        <button class="btn btn-secondary btn-sm log-clear" @click="clearLogs()" title="清空日志 (Ctrl+Shift+L)">清空</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { clearLogs, orchStore, type LogDirection } from '../../stores/orchestrationStore'

const filters: Array<{ key: LogDirection; label: string }> = [
  { key: 'send', label: '发送' },
  { key: 'recv', label: '接收' },
  { key: 'system', label: '系统' },
  { key: 'script', label: '脚本' },
  { key: 'error', label: '错误' },
]

const ALL_DIRECTIONS: LogDirection[] = ['send', 'recv', 'system', 'script', 'error']
const FILTER_KEY = 'docat.orchestration.log-filters'
const CONNECT_FILTER_KEY = 'docat.orchestration.log-filter-connect'

/** 记住筛选项：从 localStorage 恢复，非法值过滤，空则全部 */
function loadSavedFilters(): LogDirection[] {
  try {
    const raw = localStorage.getItem(FILTER_KEY)
    if (!raw) return [...ALL_DIRECTIONS]
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return [...ALL_DIRECTIONS]
    const valid = parsed.filter((k): k is LogDirection => ALL_DIRECTIONS.includes(k as LogDirection))
    return valid.length ? valid : [...ALL_DIRECTIONS]
  } catch {
    return [...ALL_DIRECTIONS]
  }
}

/** 连接失败提示默认显示；关闭后 kind='connect' 的日志不展示 */
function loadConnectFilter(): boolean {
  try {
    return localStorage.getItem(CONNECT_FILTER_KEY) !== '0'
  } catch {
    return true
  }
}

const activeFilters = ref<LogDirection[]>(loadSavedFilters())
const showConnectFailures = ref(loadConnectFilter())
const logListRef = ref<HTMLElement>()

watch(activeFilters, (val) => {
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify(val))
  } catch {
    // ignore
  }
}, { deep: true })

watch(showConnectFailures, (val) => {
  try {
    localStorage.setItem(CONNECT_FILTER_KEY, val ? '1' : '0')
  } catch {
    // ignore
  }
})

/** 倒序：最新的在最上面 */
const visibleLogs = computed(() =>
  orchStore.logs
    .filter(e => activeFilters.value.includes(e.direction))
    .filter(e => showConnectFailures.value || e.kind !== 'connect')
    .reverse()
)

const connectFailureCount = computed(() =>
  orchStore.logs.filter(e => e.kind === 'connect').length
)

function countFor(key: LogDirection): number {
  return orchStore.logs.filter(e => e.direction === key).length
}

function toggleFilter(key: LogDirection) {
  if (activeFilters.value.includes(key)) {
    activeFilters.value = activeFilters.value.filter(k => k !== key)
  } else {
    activeFilters.value = [...activeFilters.value, key]
  }
}

function toggleConnectFailures() {
  showConnectFailures.value = !showConnectFailures.value
}

function formatTime(t: number): string {
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function arrow(dir: LogDirection): string {
  if (dir === 'send') return '→'
  if (dir === 'recv') return '←'
  return '·'
}

/** Ctrl+Shift+L / Cmd+Shift+L：清空日志 */
function onGlobalKeydown(e: KeyboardEvent) {
  if (e.defaultPrevented) return
  const mod = e.ctrlKey || e.metaKey
  if (!mod || !e.shiftKey || e.altKey) return
  if (e.key.toLowerCase() === 'l') {
    e.preventDefault()
    clearLogs()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
})
</script>

<style scoped>
.log-panel { display: flex; flex-direction: column; gap: 8px; min-height: 0; width: 100%; }
.log-header { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.log-title { font-family: var(--font-display); font-size: 0.78rem; font-weight: 600; color: var(--text-primary); }
.log-count { font-family: var(--font-mono); font-size: 0.62rem; color: var(--text-muted); }
.log-main { display: flex; gap: 8px; flex: 1; min-height: 0; }

.log-list {
  flex: 1; min-width: 0; overflow-y: auto;
  display: flex; flex-direction: column; gap: 3px;
  padding: 8px; background: var(--void-deep); border: 1px solid var(--border); border-radius: var(--radius);
  font-family: var(--font-mono); font-size: 0.66rem;
}
.log-empty { color: var(--text-muted); text-align: center; padding: 30px 0; font-size: 0.64rem; }
.log-entry { display: flex; gap: 8px; align-items: baseline; padding: 2px 4px; border-radius: 3px; line-height: 1.5; }
.log-time { color: var(--text-muted); flex-shrink: 0; }
.log-device { color: var(--cyan-300); font-weight: 600; flex-shrink: 0; }
.log-arrow { flex-shrink: 0; font-weight: 700; }
.log-text { color: var(--text-secondary); word-break: break-all; white-space: pre-wrap; }

.log-entry--send .log-arrow { color: var(--cyan-400); }
.log-entry--send .log-text { color: var(--cyan-200); }
.log-entry--recv .log-arrow { color: var(--text-muted); }
.log-entry--recv .log-text { color: var(--green-300); }
.log-entry--system .log-arrow { color: var(--text-muted); }
.log-entry--system .log-text { color: var(--text-muted); }
.log-entry--script .log-arrow { color: var(--amber-400); }
.log-entry--script .log-text { color: var(--amber-300); }
.log-entry--error .log-arrow, .log-entry--error .log-text { color: var(--status-danger); }
.log-entry--error .log-device { color: var(--status-danger); }

/* 筛选选项：日志右侧纵向排列 */
.log-side {
  flex-shrink: 0; display: flex; flex-direction: column; gap: 8px;
  width: 64px; align-items: stretch;
}
.log-filters { display: flex; flex-direction: column; gap: 4px; flex: 1; }
.filter-chip {
  display: flex; align-items: center; justify-content: center; gap: 3px;
  padding: 4px 2px; border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--surface-1); color: var(--text-muted);
  font-family: var(--font-body); font-size: 0.6rem; font-weight: 500; cursor: pointer;
  transition: all var(--duration-fast);
}
.filter-chip:hover { border-color: var(--border-bright); color: var(--text-primary); }
.filter-chip--active { border-color: var(--cyan-500); color: var(--cyan-300); background: var(--cyan-900); }
.filter-count { font-family: var(--font-mono); font-size: 0.54rem; opacity: 0.75; }
.log-clear { width: 100%; }
</style>
