/**
 * 用户状态 Store — 跨页面共享的当前用户信息
 */
import { reactive } from 'vue'
import type { User } from 'docat-shared/types'

export const userStore = reactive({
  currentUser: null as User | null,

  setCurrentUser(user: User | null) {
    this.currentUser = user
  },

  get isAdmin(): boolean {
    return this.currentUser?.role === 'admin'
  },

  get isLoggedIn(): boolean {
    return this.currentUser !== null
  },

  reset() {
    this.currentUser = null
  },
})
