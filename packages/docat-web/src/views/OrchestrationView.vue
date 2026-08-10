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

      <main class="orch-right">
        <section class="orch-script card">
          <ScriptPanel />
        </section>
        <section class="orch-log card">
          <LogPanel />
        </section>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import * as api from '../services/api'
import { deviceStore } from '../stores/deviceStore'
import { initOrchestration, setOrchMockMode } from '../stores/orchestrationStore'
import DevicePanel from '../components/orchestration/DevicePanel.vue'
import SettingsPanel from '../components/orchestration/SettingsPanel.vue'
import LogPanel from '../components/orchestration/LogPanel.vue'
import ScriptPanel from '../components/orchestration/ScriptPanel.vue'

const route = useRoute()
const isMock = computed(() => route.query.mock === '1')
// 同步设置模式：子组件 setup 先于父组件 onMounted 执行，
// 必须在此处立即生效，否则真实模式下子组件会读到 mock 默认值
setOrchMockMode(isMock.value)

onMounted(async () => {
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
/* 脚本与日志各自固定高度，互不挤压；视口不够时页面整体滚动 */
.orch-right { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.orch-script { flex: 0 0 auto; height: 620px; padding: 16px; display: flex; }
.orch-log { flex: 0 0 auto; height: 240px; padding: 16px; display: flex; }
.orch-script > *, .orch-log > * { flex: 1; min-height: 0; }

@media (max-width: 1100px) {
  .orch-layout { grid-template-columns: 1fr; }
  .workspace-header { grid-template-columns: 1fr; }
}
</style>
