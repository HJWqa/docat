<template>
  <div class="orch-page">
    <!-- Header -->
    <header class="workspace-header">
      <div class="workspace-header-left">
        <router-link to="/" class="back-btn">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          返回主控台
        </router-link>
        <div>
          <h2>编排</h2>
          <p class="header-subtitle">设备编排 · 脚本驱动 · 消息日志</p>
        </div>
      </div>
      <div class="workspace-header-actions">
        <span v-if="isMock" class="mode-badge mode-badge--mock">模拟模式</span>
      </div>
    </header>

    <!-- Layout -->
    <div class="orch-layout mt-2">
      <aside class="orch-left">
        <div class="card orch-card">
          <DevicePanel />
        </div>
        <div class="card orch-card">
          <SettingsPanel />
        </div>
      </aside>

      <main class="orch-right card">
        <div class="right-tabs">
          <button
            v-for="tab in rightTabs"
            :key="tab.key"
            class="right-tab"
            :class="{ 'right-tab--active': rightTab === tab.key }"
            @click="rightTab = tab.key"
          >
            {{ tab.label }}
            <span v-if="tab.key === 'log' && orchStore.logs.length" class="tab-count">{{ orchStore.logs.length }}</span>
          </button>
        </div>
        <div class="right-body">
          <LogPanel v-if="rightTab === 'log'" />
          <ScriptPanel v-else />
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import * as api from '../services/api'
import { deviceStore } from '../stores/deviceStore'
import { initOrchestration, orchStore, setOrchMockMode } from '../stores/orchestrationStore'
import DevicePanel from '../components/orchestration/DevicePanel.vue'
import SettingsPanel from '../components/orchestration/SettingsPanel.vue'
import LogPanel from '../components/orchestration/LogPanel.vue'
import ScriptPanel from '../components/orchestration/ScriptPanel.vue'

const route = useRoute()
const isMock = computed(() => route.query.mock === '1')

const rightTabs = [
  { key: 'log' as const, label: '日志' },
  { key: 'script' as const, label: '脚本' },
]
const rightTab = ref<'log' | 'script'>('log')

onMounted(async () => {
  setOrchMockMode(isMock.value)
  // 加载已注册设备（Docat Motion 目标下拉框 / 编程面板数据源）
  if (isMock.value) {
    deviceStore.setDevices([{ id: 'mock-dev', ip: '0.0.0.0', name: 'MOCK DEVICE', type: 'MG6', autoConnect: false, createdAt: '' }])
  } else {
    try {
      const res = await api.listDevices()
      if (res.success && res.data) deviceStore.setDevices(res.data)
    } catch { /* 离线时使用已有缓存 */ }
  }
  await initOrchestration()
})
</script>

<style scoped>
.orch-page { padding: 40px 48px; max-width: 1700px; margin-inline: auto; min-height: 100vh; }
.workspace-header {
  display: grid; grid-template-columns: minmax(360px, 1fr) auto minmax(360px, 1fr);
  align-items: center; gap: 16px; padding-bottom: 12px;
}
.workspace-header-left { display: flex; align-items: center; gap: 20px; min-width: 0; }
.workspace-header-left h2 { font-family: var(--font-display); font-size: 1.3rem; font-weight: 600; color: var(--text-primary); letter-spacing: -0.01em; }
.header-subtitle { font-family: var(--font-body); font-size: 0.72rem; color: var(--text-muted); margin-top: 4px; }
.workspace-header-actions { grid-column: 3; display: flex; justify-content: flex-end; align-items: center; gap: 8px; }
.back-btn { display: flex; align-items: center; gap: 6px; font-family: var(--font-body); font-size: 0.82rem; font-weight: 500; color: var(--text-muted); text-decoration: none; transition: color var(--duration-fast); padding: 6px 0; }
.back-btn:hover { color: var(--cyan-300); }
.mode-badge {
  font-family: var(--font-mono); font-size: 0.64rem; font-weight: 600;
  padding: 4px 10px; border-radius: var(--radius-sm);
}
.mode-badge--mock { color: var(--status-virtual); border: 1px solid var(--status-virtual); background: var(--status-virtual-dim); }

.orch-layout { display: grid; grid-template-columns: 390px minmax(0, 1fr); gap: 16px; align-items: start; }
.orch-left { display: flex; flex-direction: column; gap: 16px; }
.orch-card { padding: 16px; }
.orch-right { padding: 16px; display: flex; flex-direction: column; min-height: 640px; height: calc(100vh - 190px); min-width: 0; }

.right-tabs { display: flex; gap: 2px; margin-bottom: 12px; }
.right-tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 18px; border: 1px solid var(--border); background: var(--surface-1);
  color: var(--text-muted); font-family: var(--font-body); font-size: 0.74rem; font-weight: 500;
  cursor: pointer; transition: all var(--duration-fast);
}
.right-tab:first-child { border-radius: var(--radius) 0 0 var(--radius); }
.right-tab:last-child { border-radius: 0 var(--radius) var(--radius) 0; }
.right-tab:hover { color: var(--text-primary); border-color: var(--border-bright); }
.right-tab--active { background: var(--cyan-900); border-color: var(--cyan-500); color: var(--cyan-300); }
.tab-count { font-family: var(--font-mono); font-size: 0.6rem; color: var(--text-muted); }
.right-body { flex: 1; min-height: 0; display: flex; }

@media (max-width: 1100px) {
  .orch-layout { grid-template-columns: 1fr; }
  .orch-right { height: auto; min-height: 480px; }
  .workspace-header { grid-template-columns: 1fr; }
}
</style>
