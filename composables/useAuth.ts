// 登录态管理：token 存 localStorage，模块级单例 user
import { computed, ref } from 'vue'
import { useApi } from './useApi'

export interface AuthUser {
  id: number
  username: string
  displayName: string
}

interface LoginResult {
  token: string
  user: AuthUser
}

const TOKEN_KEY = 'cdm_token'
const user = ref<AuthUser | null>(null)

export function useAuth() {
  const token = computed<string | null>(() =>
    process.client ? localStorage.getItem(TOKEN_KEY) : null,
  )
  const isLoggedIn = computed(() => !!token.value)

  /** 登录：成功写 token 并缓存用户 */
  async function login(username: string, password: string) {
    const { request } = useApi()
    const data = await request<LoginResult>('/api/auth-login', { username, password })
    if (process.client) localStorage.setItem(TOKEN_KEY, data.token)
    user.value = data.user
    return data.user
  }

  /** 拉取当前用户（layout 挂载时调用一次） */
  async function fetchMe(): Promise<AuthUser | null> {
    if (!token.value) return null
    try {
      const { request } = useApi()
      user.value = await request<AuthUser>('/api/auth-me', {})
    } catch {
      // token 失效时 useApi 已处理跳转，这里静默
    }
    return user.value
  }

  /** 退出登录：清 token → /login */
  function logout() {
    if (process.client) localStorage.removeItem(TOKEN_KEY)
    user.value = null
    navigateTo('/login')
  }

  return { user, token, isLoggedIn, login, logout, fetchMe }
}
