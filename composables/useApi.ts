// 统一 API 请求封装：自动带 token、解包络、40100 跳转登录
import type { ApiEnvelope, ApiOk, ApiFail } from '~/shared/types/api'

/** 带错误码的业务异常 */
export class ApiClientError extends Error {
  code: number
  detail?: unknown
  constructor(fail: ApiFail) {
    super(fail.message || `请求失败 (${fail.code})`)
    this.name = 'ApiClientError'
    this.code = fail.code
    this.detail = fail.detail
  }
}

function getToken(): string | null {
  if (!process.client) return null
  return localStorage.getItem('cdm_token')
}

function clearTokenAndLogin() {
  if (!process.client) return
  localStorage.removeItem('cdm_token')
  // 避免在登录页重复跳转
  if (window.location.pathname !== '/login') {
    navigateTo('/login')
  }
}

export function useApi() {
  /**
   * 统一 POST 请求（项目约定：除 SSE 外全部 POST）。
   * 成功返回 data；业务失败抛 ApiClientError（附 code）；40100 清 token 并跳 /login。
   */
  async function request<T>(url: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {}
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`

    let res: ApiEnvelope<T>
    try {
      res = await $fetch<ApiEnvelope<T>>(url, {
        method: 'POST',
        body: (body ?? {}) as Record<string, unknown>,
        headers,
      })
    } catch (e: any) {
      // Nitro 返回非 2xx 时 $fetch 会抛错，包络在 e.data 上
      const env = e?.data as ApiFail | undefined
      if (env && typeof env.code === 'number') {
        if (env.code === 40100) clearTokenAndLogin()
        throw new ApiClientError(env)
      }
      throw new ApiClientError({ code: -1, message: e?.message || '网络请求失败，请检查服务是否在线' })
    }

    if (res.code === 0) return (res as ApiOk<T>).data
    if (res.code === 40100) clearTokenAndLogin()
    throw new ApiClientError(res as ApiFail)
  }

  return { request }
}
