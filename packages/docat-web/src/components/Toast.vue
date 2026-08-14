<template>
  <Teleport to="body">
    <TransitionGroup name="toast" tag="div" class="toast-container">
      <div
        v-for="t in toasts"
        :key="t.id"
        :class="['toast', `toast--${t.type}`]"
        @mouseenter="pause(t)"
        @mouseleave="resume(t)"
      >
        <span class="toast-icon">
          <svg v-if="t.type === 'success'" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <svg v-else-if="t.type === 'error'" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <line x1="4.5" y1="4.5" x2="11.5" y2="11.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
            <line x1="11.5" y1="4.5" x2="4.5" y2="11.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          </svg>
          <svg v-else width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4" />
            <path d="M8 7.2v3.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
            <circle cx="8" cy="5" r="0.8" fill="currentColor" />
          </svg>
        </span>
        <span class="toast-msg">{{ t.message }}</span>
        <div v-if="t.actions && t.actions.length" class="toast-actions">
          <button v-for="(a, i) in t.actions" :key="i" class="toast-action" :class="a.variant ? `toast-action--${a.variant}` : ''" @click="a.handler(); remove(t.id)">
            {{ a.label }}
          </button>
        </div>
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
  variant?: 'danger' | 'virtual'
}

interface ToastItem {
  id: number
  type: ToastType
  message: string
  actions?: ToastAction[]
  timer?: ReturnType<typeof setTimeout>
  remaining?: number
  deadline?: number
}

const DEFAULTS: Record<ToastType, number> = { success: 3000, info: 4000, error: 8000 }

const toasts = ref<ToastItem[]>([])
let nextId = 0

interface ToastOptions { actions?: ToastAction[]; duration?: number }

function normalizeOpts(opts?: { action?: ToastAction; actions?: ToastAction[]; duration?: number }): ToastOptions {
  const actions = opts?.action ? [opts.action, ...(opts?.actions ?? [])] : opts?.actions
  return { actions, duration: opts?.duration }
}

function add(type: ToastType, message: string, opts?: ToastOptions) {
  const id = nextId++
  const item: ToastItem = { id, type, message, actions: opts?.actions }
  const duration = opts?.duration ?? DEFAULTS[type]
  if (duration > 0) {
    item.remaining = duration
    item.timer = setTimeout(() => remove(id), duration)
    item.deadline = Date.now() + duration
  }
  toasts.value.push(item)
}

function clearTimer(item: ToastItem) {
  if (item.timer) {
    clearTimeout(item.timer)
    item.timer = undefined
  }
}

function remove(id: number) {
  const item = toasts.value.find(t => t.id === id)
  if (item) clearTimer(item)
  toasts.value = toasts.value.filter(t => t.id !== id)
}

function pause(item: ToastItem) {
  if (!item.timer || item.remaining === undefined || item.deadline === undefined) return
  item.remaining = Math.max(0, item.deadline - Date.now())
  clearTimer(item)
}

function resume(item: ToastItem) {
  if (item.remaining === undefined) return
  clearTimer(item)
  if (item.remaining > 0) {
    item.deadline = Date.now() + item.remaining
    item.timer = setTimeout(() => remove(item.id), item.remaining)
  }
}

defineExpose({
  success: (m: string, opts?: { action?: ToastAction; actions?: ToastAction[]; duration?: number }) => add('success', m, normalizeOpts(opts)),
  error: (m: string, opts?: { action?: ToastAction; actions?: ToastAction[]; duration?: number }) => add('error', m, normalizeOpts(opts)),
  info: (m: string, opts?: { action?: ToastAction; actions?: ToastAction[]; duration?: number }) => add('info', m, normalizeOpts(opts)),
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
.toast-icon { display: inline-flex; align-items: center; flex-shrink: 0; }
.toast-icon svg { display: block; }
.toast--success .toast-icon { color: var(--status-online); }
.toast--error   .toast-icon { color: var(--status-danger); }
.toast--info    .toast-icon { color: var(--cyan-300); }
.toast-msg { flex: 1; font-size: 13px; color: var(--text-primary); }
.toast-actions { display: flex; gap: 6px; flex-shrink: 0; }
.toast-action {
  flex-shrink: 0;
  font-family: var(--font-body); font-size: 0.78rem; font-weight: 600;
  color: var(--status-danger);
  background: none; border: 1px solid var(--status-danger); border-radius: var(--radius-sm);
  padding: 4px 12px; cursor: pointer;
  transition: all var(--duration-fast);
}
.toast-action:hover { background: var(--status-danger); color: #fff; }
.toast-action--virtual {
  color: var(--status-virtual);
  border-color: var(--status-virtual);
}
.toast-action--virtual:hover { background: var(--status-virtual); color: #fff; }
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
