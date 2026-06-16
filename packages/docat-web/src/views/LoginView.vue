<template>
  <div class="login-scene">
    <div class="login-container">
      <!-- Brand mark -->
      <div class="login-brand">
        <img class="login-logo" src="/docat-logo.png" alt="docat" />
        <h1 class="login-title">docat</h1>
        <p class="login-subtitle">设备编排与控制工具集</p>
        <div class="login-accent" />
        <div class="login-version">v0.1.0 · 工业控制系统</div>
      </div>

      <!-- Login form -->
      <div class="login-card">
        <div class="card-header">
          {{ mode === 'register' ? '创建管理员账号' : '登录' }}
        </div>

        <form @submit.prevent="handleLogin" class="login-form">
          <div v-if="mode === 'register'" class="notice">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.2"/><line x1="8" y1="5" x2="8" y2="9" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="11.5" r="0.8" fill="currentColor"/></svg>
            首次使用 — 创建一个管理员账号
          </div>

          <div class="field-group">
            <label class="field-label">操作员 ID</label>
            <div class="field-wrapper">
              <svg class="field-icon" width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5" r="3" stroke="currentColor" stroke-width="1.2"/><path d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
              <input
                v-model="username"
                class="input field-input"
                placeholder="请输入操作员 ID"
                autocomplete="username"
              />
            </div>
          </div>

          <div class="field-group mt-2">
            <label class="field-label">访问口令</label>
            <div class="field-wrapper">
              <svg class="field-icon" width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="4" r="2" stroke="currentColor" stroke-width="1.2"/></svg>
              <input
                v-model="password"
                class="input field-input"
                type="password"
                placeholder="••••••••"
                autocomplete="current-password"
              />
            </div>
          </div>

          <div v-if="error" class="error-block mt-2">
            <span class="error-icon">⚠</span>
            <span>{{ error }}</span>
          </div>

          <button class="btn btn-primary w-full mt-2 login-btn" :disabled="loading" type="submit">
            <span v-if="loading" class="spinner"></span>
            <svg v-else width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 8l4 4 8-8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            {{ loading ? '登录中…' : (mode === 'register' ? '创建账号' : '登录') }}
          </button>
        </form>

        <div class="card-footer mt-2">
          <button class="mode-toggle" @click="toggleMode">
            {{ mode === 'login' ? '首次使用 →' : '← 返回登录' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { login, register, setToken } from '../services/api'

const router = useRouter()
const mode = ref<'login' | 'register'>('login')
const username = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

function toggleMode() {
  mode.value = mode.value === 'login' ? 'register' : 'login'
  error.value = ''
}

async function handleLogin() {
  error.value = ''
  if (!username.value || !password.value) {
    error.value = '请输入操作员 ID 和访问口令'
    return
  }
  if (username.value.length < 3 || password.value.length < 4) {
    error.value = 'ID 至少 3 位 | 口令至少 4 位'
    return
  }

  loading.value = true
  try {
    if (mode.value === 'register') {
      const res = await register(username.value, password.value)
      if (!res.success) throw new Error(res.error?.message ?? '注册失败')
      const loginRes = await login(username.value, password.value)
      if (!loginRes.success || !loginRes.data) throw new Error(loginRes.error?.message ?? '自动登录失败')
      setToken(loginRes.data.token)
    } else {
      const res = await login(username.value, password.value)
      if (!res.success || !res.data) throw new Error(res.error?.message ?? '登录失败')
      setToken(res.data.token)
    }
    router.push('/')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-scene {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--void-deepest);
  padding: 24px;
}

.login-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 36px;
}

/* ─── Brand ───────────────── */
.login-brand {
  text-align: center;
}
.login-logo {
  width: 72px;
  height: 72px;
  margin: 0 auto 18px;
  display: block;
  object-fit: contain;
}

.login-title {
  font-family: var(--font-display);
  font-size: 1.9rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--text-primary);
}
.login-subtitle {
  font-family: var(--font-body);
  font-size: 0.82rem;
  color: var(--text-secondary);
  margin-top: 4px;
}
.login-accent {
  width: 32px;
  height: 2px;
  margin: 12px auto 0;
  background: var(--accent);
  border-radius: 1px;
}
.login-version {
  font-family: var(--font-mono);
  font-size: 0.62rem;
  color: var(--text-muted);
  margin-top: 10px;
  letter-spacing: 0.01em;
}

/* ─── Card ────────────────── */
.login-card {
  width: 380px;
  max-width: 100%;
  background: var(--surface-0);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  padding: 28px;
  box-shadow: var(--shadow-lg);
}
.card-header {
  font-family: var(--font-body);
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 22px;
}
.card-footer { text-align: center; }
.mode-toggle {
  background: none;
  border: none;
  cursor: pointer;
  font-family: var(--font-body);
  font-size: 0.78rem;
  color: var(--text-muted);
  transition: color var(--duration-fast) var(--ease-out);
}
.mode-toggle:hover { color: var(--cyan-300); }

/* ─── Form ────────────────── */
.login-form { display: flex; flex-direction: column; }
.notice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  margin-bottom: 20px;
  background: var(--status-info-dim);
  border: 1px solid var(--cyan-500);
  border-radius: var(--radius);
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--cyan-200);
}
.field-group { display: flex; flex-direction: column; gap: 6px; }
.field-label {
  font-family: var(--font-body);
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--text-secondary);
  margin-left: 2px;
}
.field-wrapper { position: relative; }
.field-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  pointer-events: none;
}
.field-input { padding-left: 36px !important; }

.error-block {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 14px;
  background: var(--status-danger-dim);
  border: 1px solid var(--status-danger);
  border-radius: var(--radius);
  font-size: 12px;
  color: var(--status-danger);
}
.error-icon { flex-shrink: 0; margin-top: 1px; }

.login-btn {
  padding: 11px 20px;
  font-size: 13px;
  justify-content: center;
  gap: 8px;
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #ffffff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
</style>
