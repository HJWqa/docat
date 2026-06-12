import { createRouter, createWebHashHistory } from 'vue-router'
import { getToken } from '../services/api'
import LoginView from '../views/LoginView.vue'
import DashboardView from '../views/DashboardView.vue'
import DeviceView from '../views/DeviceView.vue'
import UserManagementView from '../views/UserManagementView.vue'

const ProgrammingView = () => import('../views/ProgrammingView.vue')

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: LoginView,
    meta: { guest: true, workspaceDepth: 0 },
  },
  {
    path: '/',
    name: 'Dashboard',
    component: DashboardView,
    meta: { auth: true, workspaceDepth: 0 },
  },
  {
    path: '/users',
    name: 'UserManagement',
    component: UserManagementView,
    meta: { auth: true, workspaceDepth: 0 },
  },
  {
    path: '/device/:id',
    name: 'Device',
    component: DeviceView,
    meta: { auth: true, workspaceDepth: 1 },
  },
  {
    path: '/device/:id/programming',
    name: 'DeviceProgramming',
    component: ProgrammingView,
    meta: { auth: true, workspaceDepth: 2 },
  },
  {
    path: '/programming',
    name: 'Programming',
    component: ProgrammingView,
    meta: { auth: true, workspaceDepth: 1 },
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

router.beforeEach((to) => {
  const token = getToken()
  // 已登录用户访问登录页 → 跳转首页
  if (to.meta.guest && token) return '/'
  // 未登录用户访问需认证页 → 跳转登录
  if (to.meta.auth && !token) return '/login'
})

export default router
