// 访问控制：所有 /api/* 请求需登录（token 支持 Bearer / X-CDM-Token / ?token=）。
// 白名单：/api/auth-login。未登录返回 401 + fail 包络（不抛 500）。
const WHITELIST = new Set(['/api/auth-login'])

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname
  if (!path.startsWith('/api/')) return
  if (WHITELIST.has(path)) return
  try {
    requireAuth(event)
  } catch (err) {
    if (err instanceof ApiError && err.code === ErrorCodes.UNAUTHORIZED) {
      setResponseStatus(event, 401)
      return fail(err.code, err.message)
    }
    throw err
  }
})
