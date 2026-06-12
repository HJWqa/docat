<template>
  <Teleport to="body">
    <TransitionGroup name="toast" tag="div" class="toast-container">
      <div
        v-for="t in toasts"
        :key="t.id"
        :class="['toast', `toast--${t.type}`]"
      >
        <span class="toast-icon">{{ iconMap[t.type] }}</span>
        <span class="toast-msg">{{ t.message }}</span>
        <button v-if="t.action" class="toast-action" @click="t.action.handler(); remove(t.id)">
          {{ t.action.label }}
        </button>
        <button class="toast-close" @click="remove(t.id)">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><line x1="4" y1="4" x2="12" y2="12" stroke="currentColor" stroke-width="1.5"/><line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" stroke-width="1.5"/></svg>
        </button>
      </div>
    </TransitionGroup>
  </Teleport>
</template>

<script setup lang="ts">
import { ref } from 'vue'

type ToastType = 'success' | 'error' | 'info'

interface ToastAction {
  label: string
  handler: () => void
}

interface ToastItem { id: number; type: ToastType; message: string; action?: ToastAction }

const toasts = ref<ToastItem[]>([])
let nextId = 0
const iconMap: Record<ToastType, string> = { success: '✓', error: '✗', info: 'ℹ' }

function add(type: ToastType, message: string, duration = 3000, action?: ToastAction) {
  const id = nextId++
  toasts.value.push({ id, type, message, action })
  setTimeout(() => remove(id), duration)
}

function remove(id: number) {
  toasts.value = toasts.value.filter(t => t.id !== id)
}

defineExpose({
  success: (m: string) => add('success', m),
  error: (m: string, opts?: { action?: ToastAction }) => add('error', m, 8000, opts?.action),
  info: (m: string) => add('info', m),
})
</script>

<style scoped>
.toast-container {
  position: fixed; bottom: 24px; right: 24px; z-index: 9999;
  display: flex; flex-direction: column-reverse; gap: 8px; pointer-events: none;
}
.toast {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 18px; min-width: 300px; max-width: 520px;
  background: var(--surface-1); border: 1px solid var(--border);
  border-radius: var(--radius); pointer-events: auto;
  box-shadow: var(--shadow-lg);
}
.toast--success { border-color: var(--status-online); }
.toast--error   { border-color: var(--status-danger); }
.toast--info    { border-color: var(--cyan-400); }
.toast-icon { font-size: 16px; flex-shrink: 0; }
.toast--success .toast-icon { color: var(--status-online); }
.toast--error   .toast-icon { color: var(--status-danger); }
.toast--info    .toast-icon { color: var(--cyan-300); }
.toast-msg { flex: 1; font-size: 13px; color: var(--text-primary); }
.toast-action {
  flex-shrink: 0;
  font-family: var(--font-display); font-size: 0.55rem; font-weight: 700;
  letter-spacing: 0.1em; color: var(--status-danger);
  background: none; border: 1px solid var(--status-danger); border-radius: 2px;
  padding: 4px 10px; cursor: pointer;
  transition: all var(--duration-fast);
}
.toast-action:hover { background: var(--status-danger); color: #fff; }
.toast-close {
  background: none; border: none; cursor: pointer; color: var(--text-muted);
  padding: 2px; flex-shrink: 0; transition: color var(--duration-fast);
}
.toast-close:hover { color: var(--text-primary); }

.toast-enter-active { transition: all 0.3s var(--ease-spring); }
.toast-leave-active { transition: all 0.2s var(--ease-out); }
.toast-enter-from { opacity: 0; transform: translateX(40px); }
.toast-leave-to { opacity: 0; transform: translateX(40px); }
</style>
