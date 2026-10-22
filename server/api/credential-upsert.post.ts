import { z } from 'zod'
import { upsertCredential, credentialToDTO } from '../services/CredentialService'

const schema = z.object({
  id: zId.optional(),
  name: z.string().trim().min(1).max(128),
  type: z.enum(['rclone_drive', 'hf_token', 'github_token', 'other']),
  // 更新时传空字符串表示保持原值不变
  value: z.string().max(16384),
})

// 新增/更新凭据（value 加密入库）
export default defineEventHandler(async (event) => {
  try {
    const body = await validateBody(event, schema)
    const cred = await upsertCredential(body)
    return ok(credentialToDTO(cred))
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
