<template>
  <div class="login-scene">
    <!-- Animated background grid -->
    <div class="bg-grid" />
    <div class="bg-glow bg-glow--1" />
    <div class="bg-glow bg-glow--2" />

    <div class="login-container">
      <!-- Brand mark -->
      <div class="login-brand">
        <div class="login-hex">
          <svg viewBox="0 0 48 48" class="hex-svg">
            <polygon points="24,6 42,16 42,32 24,42 6,32 6,16" fill="none" stroke="currentColor" stroke-width="1.2"/>
            <circle cx="24" cy="24" r="8" fill="currentColor" opacity="0.15"/>
            <circle cx="24" cy="24" r="3" fill="currentColor"/>
            <line x1="24" y1="16" x2="24" y2="10" stroke="currentColor" stroke-width="0.8" opacity="0.5"/>
            <line x1="24" y1="38" x2="24" y2="32" stroke="currentColor" stroke-width="0.8" opacity="0.5"/>
            <line x1="16" y1="24" x2="10" y2="24" stroke="currentColor" stroke-width="0.8" opacity="0.5"/>
            <line x1="38" y1="24" x2="32" y2="24" stroke="currentColor" stroke-width="0.8" opacity="0.5"/>
          </svg>
        </div>
        <h1 class="login-title">docat</h1>
        <p class="login-subtitle">Device Orchestration & Control Toolkit</p>
        <div class="login-version">BUILD 0.1.0 — INDUSTRIAL CONTROL SYSTEM</div>
      </div>

      <!-- Login form -->
      <div class="login-card">
        <div class="card-header">
          <span class="card-header-dot" />
          <span>{{ mode === 'register' ? 'INITIALIZE SYSTEM' : 'AUTHENTICATION REQUIRED' }}</span>
        </div>

        <form @submit.prevent="handleLogin" class="login-form">
          <div v-if="mode === 'register'" class="notice">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.2"/><line x1="8" y1="5" x2="8" y2="9" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="11.5" r="0.8" fill="currentColor"/></svg>
            First-time setup — create an administrator account
          </div>

          <div class="field-group">
            <label class="field-label">OPERATOR ID</label>
            <div class="field-wrapper">
              <svg class="field-icon" width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5" r="3" stroke="currentColor" stroke-width="1.2"/><path d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
              <input
                v-model="username"
                class="input field-input"
                placeholder="Enter operator ID"
                autocomplete="username"
              />
            </div>
          </div>

          <div class="field-group mt-2">
            <label class="field-label">ACCESS CODE</label>
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
            {{ loading ? 'AUTHENTICATING...' : (mode === 'register' ? 'INITIALIZE' : 'AUTHENTICATE') }}
          </button>
        </form>

        <div class="card-footer mt-2">
          <button class="mode-toggle" @click="toggleMode">
            {{ mode === 'login' ? '→ FIRST TIME SETUP' : '← RETURN TO LOGIN' }}
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
    error.value = 'Operator ID and access code required'
    return
  }
  if (username.value.length < 3 || password.value.length < 4) {
    error.value = 'ID: min 3 chars | Code: min 4 chars'
    return
  }

  loading.value = true
  try {
    if (mode.value === 'register') {
      const res = await register(username.value, password.value)
      if (!res.success) throw new Error(res.error?.message ?? 'Registration failed')
      const loginRes = await login(username.value, password.value)
      if (!loginRes.success || !loginRes.data) throw new Error(loginRes.error?.message ?? 'Auto-login failed')
      setToken(loginRes.data.token)
    } else {
      const res = await login(username.value, password.value)
      if (!res.success || !res.data) throw new Error(res.error?.message ?? 'Authentication failed')
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
  min-height: 100vh; display: flex; align-items: center; justify-content: center;
  background: var(--void-deepest);
  position: relative; overflow: hidden;
}

/* ─── Background Effects ──── */
.bg-grid {
  position: absolute; inset: 0; opacity: 0.04;
  background-image:
    linear-gradient(rgba(0,229,255,0.3) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0,229,255,0.3) 1px, transparent 1px);
  background-size: 60px 60px;
  animation: data-stream 20s linear infinite;
}
.bg-glow {
  position: absolute; width: 600px; height: 600px; border-radius: 50%;
  filter: blur(180px); opacity: 0.08; pointer-events: none;
}
.bg-glow--1 {
  top: -200px; left: -200px; background: var(--cyan-300);
  animation: glow-breath 8s ease-in-out infinite;
}
.bg-glow--2 {
  bottom: -200px; right: -200px; background: var(--cyan-600);
  animation: glow-breath 8s ease-in-out 4s infinite;
}

.login-container {
  position: relative; z-index: 1;
  display: flex; flex-direction: column; align-items: center; gap: 32px;
  padding: 20px;
}

/* ─── Brand ───────────────── */
.login-brand { text-align: center; }
.login-hex {
  width: 80px; height: 80px; margin: 0 auto 20px;
  color: var(--cyan-300);
  filter: drop-shadow(0 0 20px var(--cyan-glow));
  animation: glow-breath 4s ease-in-out infinite;
}
.hex-svg { width: 80px; height: 80px; }
.login-title {
  font-family: var(--font-display); font-size: 2.8rem; font-weight: 900;
  color: var(--cyan-300); letter-spacing: 0.18em; text-transform: lowercase;
  text-shadow: 0 0 40px var(--cyan-glow), 0 0 80px #00e5ff11;
}
.login-subtitle {
  font-family: var(--font-body); font-size: 0.8rem;
  color: var(--text-secondary); margin-top: 6px;
  letter-spacing: 0.04em;
}
.login-version {
  font-family: var(--font-mono); font-size: 0.55rem; font-weight: 600;
  letter-spacing: 0.2em; color: var(--text-muted); margin-top: 12px;
}

/* ─── Card ────────────────── */
.login-card {
  width: 420px;
  background: var(--surface-0);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  padding: 28px;
  box-shadow: var(--shadow-lg), 0 0 40px #00e5ff06;
}
.card-header {
  display: flex; align-items: center; gap: 10px; margin-bottom: 24px;
  font-family: var(--font-display); font-size: 0.6rem; font-weight: 700;
  letter-spacing: 0.15em; color: var(--text-secondary);
}
.card-header-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--cyan-300);
  box-shadow: 0 0 6px var(--cyan-300);
  animation: pulse-ring 2s ease-out infinite;
}
.card-footer { text-align: center; }
.mode-toggle {
  background: none; border: none; cursor: pointer;
  font-family: var(--font-mono); font-size: 0.6rem; font-weight: 600;
  letter-spacing: 0.12em; color: var(--text-muted);
  transition: color var(--duration-fast);
}
.mode-toggle:hover { color: var(--cyan-300); }

/* ─── Form ────────────────── */
.login-form { display: flex; flex-direction: column; }
.notice {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px; margin-bottom: 20px;
  background: var(--cyan-800); border: 1px solid var(--cyan-500);
  border-radius: var(--radius);
  font-family: var(--font-mono); font-size: 11px; color: var(--cyan-200);
}
.field-group { display: flex; flex-direction: column; gap: 5px; }
.field-label {
  font-family: var(--font-display); font-size: 0.55rem; font-weight: 700;
  letter-spacing: 0.18em; color: var(--text-muted);
  margin-left: 2px;
}
.field-wrapper { position: relative; }
.field-icon {
  position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
  color: var(--text-muted); pointer-events: none;
}
.field-input { padding-left: 36px !important; }

.error-block {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 10px 14px;
  background: var(--status-danger-dim); border: 1px solid var(--status-danger);
  border-radius: var(--radius);
  font-size: 11px; color: var(--status-danger);
}
.error-icon { flex-shrink: 0; margin-top: 1px; }

.login-btn {
  padding: 14px 20px; font-size: 12px; justify-content: center; gap: 10px;
}

.spinner {
  width: 14px; height: 14px; border: 2px solid rgba(0,0,0,0.3);
  border-top-color: #000; border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
