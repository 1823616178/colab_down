import { z } from 'zod'
import { upsertCredential, findCredentialByName, credentialToDTO } from '../services/CredentialService'

const schema = z.object({ rcloneToken: z.string().trim().min(8).max(16384) })

const RCLONE_CRED_NAME = 'rclone_drive_default'

// 仅 rclone 模式：提交 rclone refresh_token JSON，加密入库（存在则更新）
export default defineEventHandler(async (event) => {
  try {
    const { rcloneToken } = await validateBody(event, schema)
    const existing = await findCredentialByName(RCLONE_CRED_NAME)
    const cred = await upsertCredential({
      id: existing?.id,
      name: RCLONE_CRED_NAME,
      type: 'rclone_drive',
      value: rcloneToken,
    })
    return ok(credentialToDTO(cred))
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
