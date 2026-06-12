<template>
  <div class="layout">
    <!-- Sidebar — Command Console -->
    <aside class="sidebar">
      <!-- Brand Block -->
      <div class="brand" @click="$router.push('/')">
        <div class="brand-hex">
          <img class="brand-logo" src="/docat-logo.png" alt="docat logo" />
        </div>
        <div class="brand-text">
          <span class="brand-name">docat</span>
          <span class="brand-ver">v0.1.0</span>
        </div>
      </div>

      <!-- Nav Section -->
      <nav class="nav">
        <div class="nav-section-label">NAVIGATION</div>
        <router-link to="/" class="nav-item" active-class="nav-item--active" exact>
          <span class="nav-icon">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="9" y="1" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="1" y="9" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="9" y="9" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.2"/></svg>
          </span>
          <span class="nav-label">Dashboard</span>
          <span class="nav-badge">{{ devices.length }}</span>
        </router-link>

        <router-link to="/programming" class="nav-item" active-class="nav-item--active">
          <span class="nav-icon">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4L2 8l4 4M10 4l4 4-4 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 2L7 14" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>
          </span>
          <span class="nav-label">Programming</span>
        </router-link>

        <div class="nav-section-label mt-2">DEVICES</div>
        <router-link
          v-for="d in devices"
          :key="d.id"
          :to="`/device/${d.id}`"
          class="nav-item nav-item--device"
          active-class="nav-item--active"
        >
          <span :class="`status-dot status-dot--${d.status}`" />
          <span class="nav-device-name">{{ d.name || d.ip }}</span>
          <span class="nav-device-meta">{{ d.type || d.ip }}</span>
        </router-link>

        <div v-if="!devices.length" class="nav-empty">
          <span>— No devices registered —</span>
        </div>
      </nav>

      <!-- User Block -->
      <div class="user-block">
        <div class="user-divider" />
        <div class="user-info" @click="showUserMenu = !showUserMenu">
          <div class="user-avatar">
            <span>{{ username?.[0]?.toUpperCase() || '?' }}</span>
          </div>
          <div class="user-details">
            <span class="user-name">{{ username || 'Unknown' }}</span>
            <span class="user-role">{{ role?.toUpperCase() }}</span>
          </div>
          <svg class="user-chevron" :class="{ 'user-chevron--open': showUserMenu }" width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <!-- User Menu Dropdown -->
        <Transition name="menu">
          <div v-if="showUserMenu" class="user-menu">
            <button class="user-menu-item" @click="$emit('changePassword'); showUserMenu = false">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="4" r="2" stroke="currentColor" stroke-width="1.2"/></svg>
              CHANGE PASSWORD
            </button>
            <button class="user-menu-item" @click="$emit('switchUser'); showUserMenu = false">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="6" cy="5" r="2.5" stroke="currentColor" stroke-width="1.2"/><circle cx="12" cy="6" r="2" stroke="currentColor" stroke-width="1.2"/><path d="M1 13c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M12 11a3 3 0 013 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
              SWITCH USER
            </button>
            <router-link v-if="role === 'admin'" to="/users" class="user-menu-item" @click="showUserMenu = false">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="4" r="2.5" stroke="currentColor" stroke-width="1.2"/><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
              USER MANAGEMENT
            </router-link>
            <div class="user-menu-divider" />
            <button class="user-menu-item user-menu-item--danger" @click="$emit('logout'); showUserMenu = false">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3M11 11l4-4-4-4M15 7H6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              LOGOUT
            </button>
          </div>
        </Transition>
      </div>
    </aside>

    <!-- Main Content Area -->
    <main class="main">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  username: string
  role: string
  devices: Array<{ id: string; name?: string; ip?: string; type?: string; status: string }>
}>()

defineEmits<{ logout: []; changePassword: []; switchUser: [] }>()

const showUserMenu = ref(false)
</script>

<style scoped>
.layout { display: flex; min-height: 100vh; }

/* ─── Sidebar ────────────────── */
.sidebar {
  width: 272px;
  background: var(--void-deep);
  border-right: 1px solid var(--border);
  display: flex; flex-direction: column;
  position: fixed; top: 0; left: 0; bottom: 0; z-index: 50;
  backdrop-filter: blur(12px);
}

/* Brand */
.brand {
  display: flex; align-items: center; gap: 14px;
  padding: 24px 20px 20px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: border-color var(--duration-normal);
}
.brand:hover { border-color: var(--border-bright); }
.brand-hex {
  width: 48px; height: 48px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 14px;
  overflow: hidden;
  background: linear-gradient(135deg, rgba(0, 229, 255, 0.12), rgba(0, 229, 255, 0.03));
  border: 1px solid rgba(0, 229, 255, 0.18);
  box-shadow: 0 0 14px rgba(0, 229, 255, 0.18);
}
.brand-logo { width: 100%; height: 100%; object-fit: cover; display: block; }
.brand-text { display: flex; flex-direction: column; }
.brand-name {
  font-family: var(--font-display); font-size: 1.4rem; font-weight: 800;
  color: var(--cyan-300); letter-spacing: 0.12em; text-transform: lowercase;
}
.brand-ver {
  font-family: var(--font-mono); font-size: 0.6rem;
  color: var(--text-muted); letter-spacing: 0.1em;
}

/* Navigation */
.nav { flex: 1; overflow-y: auto; padding: 12px; }
.nav-section-label {
  font-family: var(--font-display); font-size: 0.55rem; font-weight: 700;
  letter-spacing: 0.18em; color: var(--text-muted);
  padding: 12px 12px 6px;
  user-select: none;
}
.nav-item {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 12px; margin-bottom: 2px;
  border-radius: var(--radius);
  color: var(--text-secondary); font-size: 12px;
  transition: all var(--duration-fast) var(--ease-out);
  text-decoration: none;
  position: relative;
}
.nav-item:hover {
  background: var(--surface-1); color: var(--text-primary);
}
.nav-item--active {
  background: var(--cyan-800); color: var(--cyan-300);
  box-shadow: 0 0 12px #00e5ff18;
}
.nav-item--active::before {
  content: '';
  position: absolute; left: 0; top: 50%; transform: translateY(-50%);
  width: 2px; height: 16px;
  background: var(--cyan-300);
  border-radius: 0 2px 2px 0;
  box-shadow: 0 0 6px var(--cyan-300);
}
.nav-icon { display: flex; align-items: center; color: inherit; flex-shrink: 0; }
.nav-label { flex: 1; font-size: 12px; }
.nav-badge {
  font-family: var(--font-mono); font-size: 10px; font-weight: 600;
  padding: 1px 6px; border-radius: 10px;
  background: var(--surface-2); color: var(--text-muted);
}
.nav-item--active .nav-badge {
  background: var(--cyan-700); color: var(--cyan-300);
}

.nav-device-name {
  flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 12px;
}
.nav-device-meta {
  font-family: var(--font-mono); font-size: 9px; color: var(--text-muted);
  max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.nav-empty {
  padding: 16px 12px; text-align: center;
  font-size: 11px; color: var(--text-muted);
}

/* User Block */
.user-block { padding: 16px 20px 20px; }
.user-divider {
  height: 1px; background: linear-gradient(90deg, transparent, var(--border), transparent);
  margin-bottom: 14px;
}
.user-info { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; cursor: pointer; padding: 4px; border-radius: var(--radius); transition: background var(--duration-fast); }
.user-info:hover { background: var(--surface-1); }
.user-chevron { color: var(--text-muted); transition: transform var(--duration-fast); flex-shrink: 0; }
.user-chevron--open { transform: rotate(180deg); }
.user-avatar {
  width: 34px; height: 34px; border-radius: 3px;
  background: linear-gradient(135deg, var(--cyan-700), var(--cyan-900));
  border: 1px solid var(--cyan-500);
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-display); font-size: 13px; font-weight: 700;
  color: var(--cyan-300);
  box-shadow: 0 0 12px #00e5ff22;
}
.user-details { display: flex; flex-direction: column; flex: 1; overflow: hidden; }
.user-name {
  font-size: 12px; font-weight: 500; color: var(--text-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.user-role {
  font-family: var(--font-display); font-size: 8px; font-weight: 700;
  letter-spacing: 0.15em; color: var(--text-muted);
}

/* User Menu Dropdown */
.user-menu {
  display: flex; flex-direction: column; gap: 2px;
  padding: 6px; margin-top: 4px;
  background: var(--surface-0); border: 1px solid var(--border);
  border-radius: var(--radius); box-shadow: var(--shadow-lg);
}
.user-menu-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px; border-radius: var(--radius);
  font-family: var(--font-display); font-size: 0.55rem; font-weight: 700;
  letter-spacing: 0.1em; color: var(--text-secondary);
  background: none; border: none; cursor: pointer; text-decoration: none;
  transition: all var(--duration-fast);
  width: 100%; text-align: left;
}
.user-menu-item:hover { background: var(--surface-1); color: var(--text-primary); }
.user-menu-item--danger { color: var(--status-danger); }
.user-menu-item--danger:hover { background: #ff174411; color: #ff6b6b; }
.user-menu-divider { height: 1px; background: var(--border); margin: 4px 8px; }

.menu-enter-active { transition: all 0.15s var(--ease-out); }
.menu-leave-active { transition: all 0.1s var(--ease-in); }
.menu-enter-from, .menu-leave-to { opacity: 0; transform: translateY(-4px); }

/* Main */
.main {
  flex: 1; margin-left: 272px; padding: 40px 48px;
  min-width: 0; min-height: 100vh;
  max-width: 1400px; margin-right: auto;
}
</style>
