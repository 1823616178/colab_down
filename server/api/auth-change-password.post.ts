import { z } from 'zod'
import { changePassword } from '../services/AuthService'

const schema = z.object({
  oldPassword: z.string().min(1, '请输入原密码'),
  newPassword: z.string().min(6, '新密码长度至少 6 位').max(128),
})

export default defineEventHandler(async (event) => {
  try {
    const payload = requireAuth(event)
    const body = await validateBody(event, schema)
    await changePassword(payload.uid, body.oldPassword, body.newPassword)
    return ok({ success: true })
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
