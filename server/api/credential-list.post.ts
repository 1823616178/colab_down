import { listCredentials, credentialToDTO } from '../services/CredentialService'

// 凭据列表（只返回 hint，绝不返回明文）
export default defineEventHandler(async (event) => {
  try {
    const items = await listCredentials()
    return ok(items.map(credentialToDTO))
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
