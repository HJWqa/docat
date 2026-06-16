<template>
  <Transition name="fade">
    <div v-if="visible" class="modal-overlay" @click.self="close">
      <div class="modal card">
        <div class="modal-header">
          <h3>CHANGE PASSWORD</h3>
          <button class="modal-close" @click="close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><line x1="3" y1="3" x2="13" y2="13" stroke="currentColor" stroke-width="1.5"/><line x1="13" y1="3" x2="3" y2="13" stroke="currentColor" stroke-width="1.5"/></svg>
          </button>
        </div>
        <form @submit.prevent="doChangePassword" class="modal-form mt-1">
          <div class="field-group">
            <label class="field-label">CURRENT PASSWORD</label>
            <input v-model="currentPassword" class="input" type="password" placeholder="Enter current password" autocomplete="current-password" />
          </div>
          <div class="field-group mt-1">
            <label class="field-label">NEW PASSWORD</label>
            <input v-model="newPassword" class="input" type="password" placeholder="Minimum 4 characters" autocomplete="new-password" />
          </div>
          <div class="field-group mt-1">
            <label class="field-label">CONFIRM NEW PASSWORD</label>
            <input v-model="confirmPassword" class="input" type="password" placeholder="Repeat new password" autocomplete="new-password" />
          </div>
          <div v-if="error" class="error-block mt-1">
            <span class="error-icon">⚠</span>
            <span>{{ error }}</span>
          </div>
          <div class="modal-actions mt-2">
            <button type="button" class="btn btn-secondary flex-1" @click="close">CANCEL</button>
            <button type="submit" class="btn btn-primary flex-1" :disabled="saving || !currentPassword || !newPassword || newPassword.length < 4">{{ saving ? 'SAVING...' : 'CHANGE' }}</button>
          </div>
        </form>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import * as api from '../services/api'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'changed'): void }>()

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const error = ref('')
const saving = ref(false)

function close() {
  currentPassword.value = ''
  newPassword.value = ''
  confirmPassword.value = ''
  error.value = ''
  emit('close')
}

async function doChangePassword() {
  error.value = ''
  if (newPassword.value !== confirmPassword.value) {
    error.value = 'Passwords do not match'
    return
  }
  if (newPassword.value.length < 4) {
    error.value = 'New password must be at least 4 characters'
    return
  }

  saving.value = true
  try {
    const res = await api.changePassword(currentPassword.value, newPassword.value)
    if (res.success) {
      emit('changed')
      close()
    } else {
      error.value = res.error?.message ?? 'Change failed'
    }
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.modal-overlay { position: fixed; inset: 0; background: rgba(4,10,20,0.85); backdrop-filter: blur(6px); z-index: 100; display: flex; align-items: center; justify-content: center; }
.modal { width: 100%; max-width: 460px; padding: 28px; }
.modal-header { display: flex; justify-content: space-between; align-items: center; }
.modal-close { background: none; border: none; cursor: pointer; color: var(--text-muted); padding: 4px; transition: color var(--duration-fast); }
.modal-close:hover { color: var(--text-primary); }
.modal-form { display: flex; flex-direction: column; }
.modal-actions { display: flex; gap: 8px; }
.field-group { display: flex; flex-direction: column; gap: 4px; }
.field-label { font-family: var(--font-display); font-size: 0.55rem; font-weight: 700; letter-spacing: 0.15em; color: var(--text-muted); }
.error-block {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 10px 14px; background: var(--status-danger-dim); border: 1px solid var(--status-danger);
  border-radius: var(--radius); font-size: 11px; color: var(--status-danger);
}
.error-icon { flex-shrink: 0; margin-top: 1px; }
h3 { margin: 0; }
</style>
