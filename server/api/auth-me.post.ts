import { getUser } from '../services/AuthService'

// 当前登录用户（token payload + DB 查 displayName）
export default defineEventHandler(async (event) => {
  try {
    const payload = requireAuth(event)
    const user = await getUser(payload.uid)
    return ok({
      id: payload.uid,
      username: payload.username,
      displayName: user?.displayName ?? '',
    })
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
