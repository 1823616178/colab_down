import { z } from 'zod'
import { deleteCredential } from '../services/CredentialService'

const schema = z.object({ id: zId })

export default defineEventHandler(async (event) => {
  try {
    const { id } = await validateBody(event, schema)
    await deleteCredential(id)
    return ok({ id })
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
