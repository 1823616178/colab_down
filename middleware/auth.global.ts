// 全局路由守卫：无 token → /login；已登录访问 /login → /
// 注意：仅客户端检查（SSR 首刷无 localStorage，避免 hydration 闪烁）
export default defineNuxtRouteMiddleware((to) => {
  if (!process.client) return
  const token = localStorage.getItem('cdm_token')
  if (!token && to.path !== '/login') {
    return navigateTo('/login')
  }
  if (token && to.path === '/login') {
    return navigateTo('/')
  }
})
