<template>
  <router-view v-slot="{ Component, route }">
    <Transition :name="transitionName" mode="out-in">
      <KeepAlive include="ProgrammingView">
        <component :is="Component" :key="getRouteKey(route)" />
      </KeepAlive>
    </Transition>
  </router-view>
  <Toast ref="toastRef" />
</template>

<script setup lang="ts">
import { provide, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import type { RouteLocationNormalizedLoaded } from 'vue-router'
import { me, clearToken, getToken } from './services/api'
import { wsClient } from './services/ws'
import { initRuntimeStore } from './stores/runtimeStore'
import { clearWorkspace } from './stores/workspaceState'
import { userStore } from './stores/userStore'
import Toast from './components/Toast.vue'

const router = useRouter()
const transitionName = ref('workspace-forward')
let lastDepth = Number(router.currentRoute.value.meta.workspaceDepth ?? 0)
const toastRef = ref<InstanceType<typeof Toast> | null>(null)

function getRouteKey(route: RouteLocationNormalizedLoaded): string {
  if (route.name === 'Programming' || route.name === 'DeviceProgramming') return 'ProgrammingView'
  return route.fullPath
}

router.beforeEach((to) => {
  const nextDepth = Number(to.meta.workspaceDepth ?? 0)
  transitionName.value = nextDepth < lastDepth ? 'workspace-back' : 'workspace-forward'
  lastDepth = nextDepth
})

const auth = ref({
  username: '',
  role: 'operator',
  loaded: false,
})

provide('auth', auth)

async function checkAuth() {
  if (!getToken()) { auth.value.loaded = true; return }
  try {
    const res = await me()
    if (res.success && res.data) {
      auth.value.username = res.data.username
      auth.value.role = res.data.role
      userStore.setCurrentUser(res.data)
      wsClient.onDeviceError((deviceId, data) => {
        const payload = data as { ip?: string; port?: number; error?: { message?: string } }
        const address = payload.ip && payload.port ? `${payload.ip}:${payload.port}` : deviceId
        const message = payload.error?.message || 'TCP connection error'
        toastRef.value?.error(`${address} · ${message}`)
      })
      wsClient.connect()
      initRuntimeStore()
    } else {
      clearToken()
      userStore.reset()
    }
  } catch {
    clearToken()
    userStore.reset()
  }
  auth.value.loaded = true
}

function doLogout() {
  clearToken()
  wsClient.destroy()
  clearWorkspace()
  auth.value.username = ''
  userStore.reset()
  router.push('/login')
}

provide('logout', doLogout)

onMounted(checkAuth)
</script>

<style>
body {
  overflow-x: hidden;
}

.workspace-forward-enter-active,
.workspace-forward-leave-active,
.workspace-back-enter-active,
.workspace-back-leave-active {
  transition: opacity 160ms ease, transform 160ms ease;
}

.workspace-forward-enter-from {
  opacity: 0;
  transform: translateX(28px);
}

.workspace-forward-leave-to {
  opacity: 0;
  transform: translateX(-18px);
}

.workspace-back-enter-from {
  opacity: 0;
  transform: translateX(-28px);
}

.workspace-back-leave-to {
  opacity: 0;
  transform: translateX(18px);
}
</style>
