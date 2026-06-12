<template>
  <div class="user-management" tabindex="0">
    <header class="page-header">
      <div>
        <router-link to="/" class="back-btn">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          DASHBOARD
        </router-link>
        <h2>User Management</h2>
        <p class="header-subtitle">ACCOUNTS · ROLES · ACCESS CONTROL</p>
      </div>
      <div class="header-actions">
        <button class="btn btn-primary" @click="showAddUser = true">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><line x1="8" y1="2" x2="8" y2="14" stroke="currentColor" stroke-width="2"/><line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" stroke-width="2"/></svg>
          ADD USER
        </button>
      </div>
    </header>

    <!-- User Table -->
    <div class="card mt-2">
      <div class="table-header">
        <span class="table-label">REGISTERED USERS</span>
        <span class="table-count">{{ users.length }}</span>
      </div>
      <div class="user-table">
        <div class="user-row user-row--head">
          <span class="user-cell user-cell--name">USERNAME</span>
          <span class="user-cell user-cell--role">ROLE</span>
          <span class="user-cell user-cell--created">CREATED</span>
          <span class="user-cell user-cell--actions">ACTIONS</span>
        </div>
        <div v-for="u in users" :key="u.id" class="user-row" :class="{ 'user-row--self': u.id === currentUserId }">
          <span class="user-cell user-cell--name">
            <span class="user-avatar">{{ u.username.charAt(0).toUpperCase() }}</span>
            <span class="user-name-text">{{ u.username }}</span>
            <span v-if="u.id === currentUserId" class="self-badge">YOU</span>
          </span>
          <span class="user-cell user-cell--role">
            <select
              class="role-select"
              :value="u.role"
              :disabled="u.id === currentUserId"
              @change="changeRole(u.id, ($event.target as HTMLSelectElement).value as UserRole)"
            >
              <option value="admin">ADMIN</option>
              <option value="operator">OPERATOR</option>
              <option value="viewer">VIEWER</option>
            </select>
          </span>
          <span class="user-cell user-cell--created">{{ formatDate(u.createdAt) }}</span>
          <span class="user-cell user-cell--actions">
            <button class="btn btn-sm btn-secondary" @click="openResetPassword(u)">PASSWORD</button>
            <button class="btn btn-sm btn-danger" :disabled="u.id === currentUserId" @click="openDeleteUser(u)">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 5h10M6 5V3h4v2M5 5v8a1 1 0 001 1h4a1 1 0 001-1V5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </span>
        </div>
      </div>

      <div v-if="users.length === 0" class="empty-state">
        <h3>NO USERS FOUND</h3>
      </div>
    </div>

    <!-- Add User Modal -->
    <Transition name="fade">
      <div v-if="showAddUser" class="modal-overlay" @click.self="showAddUser = false">
        <div class="modal card">
          <div class="modal-header">
            <h3>CREATE USER</h3>
            <button class="modal-close" @click="showAddUser = false">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><line x1="3" y1="3" x2="13" y2="13" stroke="currentColor" stroke-width="1.5"/><line x1="13" y1="3" x2="3" y2="13" stroke="currentColor" stroke-width="1.5"/></svg>
            </button>
          </div>
          <form @submit.prevent="doAddUser" class="modal-form mt-1">
            <div class="field-group">
              <label class="field-label">USERNAME</label>
              <input v-model="newUsername" class="input" placeholder="Minimum 3 characters" />
            </div>
            <div class="field-group mt-1">
              <label class="field-label">PASSWORD</label>
              <input v-model="newPassword" class="input" type="password" placeholder="Minimum 4 characters" />
            </div>
            <div class="field-group mt-1">
              <label class="field-label">ROLE</label>
              <select v-model="newRole" class="input">
                <option value="operator">OPERATOR</option>
                <option value="viewer">VIEWER</option>
                <option value="admin">ADMIN</option>
              </select>
            </div>
            <div class="modal-actions mt-2">
              <button type="button" class="btn btn-secondary flex-1" @click="showAddUser = false">CANCEL</button>
              <button type="submit" class="btn btn-primary flex-1" :disabled="!newUsername || !newPassword || newPassword.length < 4">CREATE</button>
            </div>
          </form>
        </div>
      </div>
    </Transition>

    <!-- Reset Password Modal -->
    <Transition name="fade">
      <div v-if="resetTarget" class="modal-overlay" @click.self="resetTarget = null">
        <div class="modal card">
          <div class="modal-header">
            <h3>RESET PASSWORD</h3>
            <button class="modal-close" @click="resetTarget = null">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><line x1="3" y1="3" x2="13" y2="13" stroke="currentColor" stroke-width="1.5"/><line x1="13" y1="3" x2="3" y2="13" stroke="currentColor" stroke-width="1.5"/></svg>
            </button>
          </div>
          <p class="mt-1" style="color:var(--text-secondary);font-size:13px;">
            Reset password for <strong>{{ resetTarget.username }}</strong>.
            This will force the user to log in again.
          </p>
          <form @submit.prevent="doResetPassword" class="modal-form mt-2">
            <div class="field-group">
              <label class="field-label">NEW PASSWORD</label>
              <input v-model="resetPassword" class="input" type="password" placeholder="Minimum 4 characters" />
            </div>
            <div class="field-group mt-1">
              <label class="field-label">CONFIRM PASSWORD</label>
              <input v-model="resetPasswordConfirm" class="input" type="password" placeholder="Repeat new password" />
            </div>
            <div v-if="resetError" class="error-block mt-1">
              <span class="error-icon">⚠</span>
              <span>{{ resetError }}</span>
            </div>
            <div class="modal-actions mt-2">
              <button type="button" class="btn btn-secondary flex-1" @click="resetTarget = null">CANCEL</button>
              <button type="submit" class="btn btn-primary flex-1" :disabled="!resetPassword || resetPassword.length < 4">RESET</button>
            </div>
          </form>
        </div>
      </div>
    </Transition>

    <!-- Delete User Confirm Modal -->
    <Transition name="fade">
      <div v-if="deleteTarget" class="modal-overlay" @click.self="deleteTarget = null">
        <div class="modal card">
          <div class="modal-header">
            <h3>CONFIRM REMOVAL</h3>
            <button class="modal-close" @click="deleteTarget = null">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><line x1="3" y1="3" x2="13" y2="13" stroke="currentColor" stroke-width="1.5"/><line x1="13" y1="3" x2="3" y2="13" stroke="currentColor" stroke-width="1.5"/></svg>
            </button>
          </div>
          <p class="mt-1" style="color:var(--text-secondary);font-size:13px;">
            Remove user <strong>{{ deleteTarget.username }}</strong>? All their scripts and session data will be deleted.
          </p>
          <div class="modal-actions mt-2">
            <button class="btn btn-secondary flex-1" @click="deleteTarget = null">CANCEL</button>
            <button class="btn btn-danger flex-1" @click="doDeleteUser">REMOVE</button>
          </div>
        </div>
      </div>
    </Transition>

    <Toast ref="toastRef" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import * as api from '../services/api'
import { userStore } from '../stores/userStore'
import Toast from '../components/Toast.vue'
import type { User, UserRole } from 'docat-shared/types'

const toastRef = ref<InstanceType<typeof Toast>>()
const users = ref<User[]>([])
const showAddUser = ref(false)
const newUsername = ref('')
const newPassword = ref('')
const newRole = ref<UserRole>('operator')
const resetTarget = ref<User | null>(null)
const resetPassword = ref('')
const resetPasswordConfirm = ref('')
const resetError = ref('')
const deleteTarget = ref<User | null>(null)

const currentUserId = computed(() => userStore.currentUser?.id ?? '')

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}

async function load() {
  const res = await api.listUsers()
  if (res.success && res.data) {
    users.value = res.data
  }
}

async function doAddUser() {
  if (!newUsername.value || !newPassword.value) return
  const res = await api.register(newUsername.value, newPassword.value, newRole.value)
  if (res.success) {
    toastRef.value?.success(`User "${newUsername.value}" created`)
    showAddUser.value = false
    newUsername.value = ''
    newPassword.value = ''
    newRole.value = 'operator'
    await load()
  } else {
    toastRef.value?.error(`Create failed: ${res.error?.message}`)
  }
}

async function changeRole(userId: string, role: UserRole) {
  const res = await api.updateUser(userId, { role })
  if (res.success) {
    toastRef.value?.success('Role updated')
    await load()
  } else {
    toastRef.value?.error(`Role change failed: ${res.error?.message}`)
    await load()
  }
}

function openResetPassword(user: User) {
  resetTarget.value = user
  resetPassword.value = ''
  resetPasswordConfirm.value = ''
  resetError.value = ''
}

async function doResetPassword() {
  if (!resetTarget.value) return
  if (resetPassword.value !== resetPasswordConfirm.value) {
    resetError.value = 'Passwords do not match'
    return
  }
  if (resetPassword.value.length < 4) {
    resetError.value = 'Password must be at least 4 characters'
    return
  }
  const res = await api.resetUserPassword(resetTarget.value.id, resetPassword.value)
  if (res.success) {
    toastRef.value?.success(`Password reset for "${resetTarget.value.username}"`)
    resetTarget.value = null
  } else {
    resetError.value = res.error?.message ?? 'Reset failed'
  }
}

function openDeleteUser(user: User) {
  deleteTarget.value = user
}

async function doDeleteUser() {
  if (!deleteTarget.value) return
  const user = deleteTarget.value
  deleteTarget.value = null
  const res = await api.deleteUser(user.id)
  if (res.success) {
    toastRef.value?.success(`User "${user.username}" removed`)
    await load()
  } else {
    toastRef.value?.error(`Delete failed: ${res.error?.message}`)
  }
}

onMounted(() => {
  load()
})
</script>

<style scoped>
.user-management { padding: 40px 48px; max-width: 1000px; min-height: 100vh; }
.page-header { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 16px; }
.back-btn { display: flex; align-items: center; gap: 6px; font-family: var(--font-display); font-size: 0.6rem; font-weight: 700; letter-spacing: 0.12em; color: var(--text-muted); text-decoration: none; transition: color var(--duration-fast); padding: 6px 0; }
.back-btn:hover { color: var(--cyan-300); }
.header-subtitle { font-family: var(--font-mono); font-size: 0.6rem; font-weight: 600; letter-spacing: 0.15em; color: var(--text-muted); margin-top: 4px; }
.header-actions { display: flex; gap: 8px; }

.table-header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.table-label { font-family: var(--font-display); font-size: 0.6rem; font-weight: 700; letter-spacing: 0.15em; color: var(--text-muted); }
.table-count { font-family: var(--font-mono); font-size: 0.7rem; color: var(--text-muted); }

.user-table { display: flex; flex-direction: column; }
.user-row { display: grid; grid-template-columns: minmax(160px, 1fr) 140px 140px minmax(140px, auto); gap: 12px; align-items: center; padding: 12px 16px; border-radius: var(--radius); transition: background var(--duration-fast); }
.user-row:hover { background: var(--void-surface); }
.user-row--head { font-family: var(--font-display); font-size: 0.5rem; font-weight: 700; letter-spacing: 0.15em; color: var(--text-muted); border-bottom: 1px solid var(--border); border-radius: 0; }
.user-row--head:hover { background: transparent; }
.user-row--self { background: var(--cyan-800); border: 1px solid var(--cyan-500); }
.user-row--self:hover { background: var(--cyan-800); }

.user-cell--name { display: flex; align-items: center; gap: 10px; min-width: 0; }
.user-avatar {
  width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: var(--void-surface); border: 1px solid var(--border); font-family: var(--font-display);
  font-size: 0.7rem; font-weight: 700; color: var(--text-secondary); flex-shrink: 0;
}
.user-row--self .user-avatar { background: var(--cyan-700); border-color: var(--cyan-400); color: var(--cyan-300); }
.user-name-text { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.self-badge {
  font-family: var(--font-display); font-size: 0.45rem; font-weight: 800; letter-spacing: 0.1em;
  padding: 2px 6px; border-radius: 2px; background: var(--cyan-400); color: #000; flex-shrink: 0;
}

.role-select {
  padding: 4px 8px; font-family: var(--font-display); font-size: 0.6rem; font-weight: 700;
  letter-spacing: 0.08em; background: var(--void-surface); border: 1px solid var(--border);
  border-radius: var(--radius); color: var(--text-primary); outline: none; cursor: pointer;
  appearance: none; -webkit-appearance: none; width: 100%;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6' fill='%236b7280'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 8px center; padding-right: 24px;
}
.role-select:focus { border-color: var(--cyan-400); box-shadow: 0 0 6px var(--cyan-glow); }
.role-select:disabled { opacity: 0.5; cursor: not-allowed; }

.user-cell--created { font-family: var(--font-mono); font-size: 0.65rem; color: var(--text-muted); }
.user-cell--actions { display: flex; gap: 6px; justify-content: flex-end; }

.empty-state { text-align: center; padding: 60px 20px; }
.empty-state h3 { font-family: var(--font-display); color: var(--text-muted); font-size: 0.8rem; letter-spacing: 0.12em; }

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
  padding: 10px 14px;
  background: var(--status-danger-dim); border: 1px solid var(--status-danger);
  border-radius: var(--radius);
  font-size: 11px; color: var(--status-danger);
}
.error-icon { flex-shrink: 0; margin-top: 1px; }

h2 { margin: 6px 0 0; font-family: var(--font-display); font-size: 1.3rem; font-weight: 700; color: var(--text-primary); letter-spacing: 0.06em; }
h3 { margin: 0; }
</style>
