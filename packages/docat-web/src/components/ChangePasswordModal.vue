<template>
  <Transition name="fade">
    <div v-if="visible" class="modal-overlay" @click.self="close">
      <div class="modal card">
        <div class="modal-header">
          <h3>修改密码</h3>
          <button class="modal-close" @click="close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><line x1="3" y1="3" x2="13" y2="13" stroke="currentColor" stroke-width="1.5"/><line x1="13" y1="3" x2="3" y2="13" stroke="currentColor" stroke-width="1.5"/></svg>
          </button>
        </div>
        <form @submit.prevent="doChangePassword" class="modal-form mt-1">
          <div class="field-group">
            <label class="field-label">当前密码</label>
            <input v-model="currentPassword" class="input" type="password" placeholder="请输入当前密码" autocomplete="current-password" />
          </div>
          <div class="field-group mt-1">
            <label class="field-label">新密码</label>
            <input v-model="newPassword" class="input" type="password" placeholder="至少 4 位字符" autocomplete="new-password" />
          </div>
          <div class="field-group mt-1">
            <label class="field-label">确认新密码</label>
            <input v-model="confirmPassword" class="input" type="password" placeholder="再次输入新密码" autocomplete="new-password" />
          </div>
          <div v-if="error" class="error-block mt-1">
            <span class="error-icon">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M8 2.5 14.5 13.5h-13L8 2.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
                <path d="M8 6.5v3.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
                <circle cx="8" cy="11.4" r="0.7" fill="currentColor" />
              </svg>
            </span>
            <span>{{ error }}</span>
          </div>
          <div class="modal-actions mt-2">
            <button type="button" class="btn btn-secondary flex-1" @click="close">取消</button>
            <button type="submit" class="btn btn-primary flex-1" :disabled="saving || !currentPassword || !newPassword || newPassword.length < 4">{{ saving ? '保存中…' : '确认修改' }}</button>
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
    error.value = '两次输入的密码不一致'
    return
  }
  if (newPassword.value.length < 4) {
    error.value = '新密码至少需要 4 位字符'
    return
  }

  saving.value = true
  try {
    const res = await api.changePassword(currentPassword.value, newPassword.value)
    if (res.success) {
      emit('changed')
      close()
    } else {
      error.value = res.error?.message ?? '修改失败'
    }
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.modal-overlay { position: fixed; inset: 0; background: rgba(8,9,10,0.72); backdrop-filter: blur(6px); z-index: 100; display: flex; align-items: center; justify-content: center; }
.modal { width: 100%; max-width: 460px; padding: 28px; }
.modal-header { display: flex; justify-content: space-between; align-items: center; }
.modal-close { background: none; border: none; cursor: pointer; color: var(--text-muted); padding: 4px; transition: color var(--duration-fast); }
.modal-close:hover { color: var(--text-primary); }
.modal-form { display: flex; flex-direction: column; }
.modal-actions { display: flex; gap: 8px; }
.field-group { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-family: var(--font-body); font-size: 0.8rem; font-weight: 500; color: var(--text-secondary); }
.error-block {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 10px 14px; background: var(--status-danger-dim); border: 1px solid var(--status-danger);
  border-radius: var(--radius); font-size: 12px; color: var(--status-danger);
}
.error-icon { flex-shrink: 0; margin-top: 1px; display: inline-flex; }
.error-icon svg { display: block; }
h3 { margin: 0; font-family: var(--font-display); font-size: 1rem; font-weight: 600; color: var(--text-primary); }
</style>
