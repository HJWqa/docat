<template>
  <div class="log-panel">
    <div class="log-toolbar">
      <div class="log-filters">
        <button
          v-for="f in filters"
          :key="f.key"
          class="filter-chip"
          :class="{ 'filter-chip--active': activeFilters.includes(f.key) }"
          @click="toggleFilter(f.key)"
        >
          {{ f.label }}
        </button>
      </div>
      <button class="btn btn-secondary btn-sm" @click="clearLogs()">清空</button>
    </div>

    <div ref="logListRef" class="log-list">
      <div v-if="!visibleLogs.length" class="log-empty">暂无日志</div>
      <div v-for="entry in visibleLogs" :key="entry.id" class="log-entry" :class="`log-entry--${entry.direction}`">
        <span class="log-time">{{ formatTime(entry.time) }}</span>
        <span class="log-device">{{ entry.deviceName }}</span>
        <span class="log-arrow">{{ arrow(entry.direction) }}</span>
        <span class="log-text">{{ entry.text }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { clearLogs, orchStore, type LogDirection } from '../../stores/orchestrationStore'

const filters: Array<{ key: LogDirection; label: string }> = [
  { key: 'send', label: '发送' },
  { key: 'recv', label: '接收' },
  { key: 'system', label: '系统' },
  { key: 'script', label: '脚本' },
  { key: 'error', label: '错误' },
]

const activeFilters = ref<LogDirection[]>(['send', 'recv', 'system', 'script', 'error'])
const logListRef = ref<HTMLElement>()

const visibleLogs = computed(() => orchStore.logs.filter(e => activeFilters.value.includes(e.direction)))

function toggleFilter(key: LogDirection) {
  if (activeFilters.value.includes(key)) {
    activeFilters.value = activeFilters.value.filter(k => k !== key)
  } else {
    activeFilters.value = [...activeFilters.value, key]
  }
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

watch(visibleLogs, () => {
  nextTick(() => {
    if (logListRef.value) logListRef.value.scrollTop = logListRef.value.scrollHeight
  })
})
</script>

<style scoped>
.log-panel { display: flex; flex-direction: column; gap: 8px; height: 100%; min-height: 0; }
.log-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.log-filters { display: flex; gap: 4px; flex-wrap: wrap; }
.filter-chip {
  padding: 3px 9px; border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--surface-1); color: var(--text-muted);
  font-family: var(--font-body); font-size: 0.62rem; font-weight: 500; cursor: pointer;
  transition: all var(--duration-fast);
}
.filter-chip:hover { border-color: var(--border-bright); color: var(--text-primary); }
.filter-chip--active { border-color: var(--cyan-500); color: var(--cyan-300); background: var(--cyan-900); }

.log-list {
  flex: 1; min-height: 0; overflow-y: auto;
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
</style>
