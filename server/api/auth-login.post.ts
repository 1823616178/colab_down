import { z } from 'zod'
import { login } from '../services/AuthService'

const schema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128),
})

// 登录（middleware 白名单，无需 token）
export default defineEventHandler(async (event) => {
  try {
    const body = await validateBody(event, schema)
    return ok(await login(body.username, body.password))
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
