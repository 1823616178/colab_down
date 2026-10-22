import { z } from 'zod'
import { requireRuntime } from '../services/VMService'

const schema = z.object({ force: z.boolean().optional() })

// 停止全部 VM
export default defineEventHandler(async (event) => {
  try {
    const { force } = await validateBody(event, schema)
    const rt = requireRuntime()
    await rt.pool.stopAll(force ?? false)
    return ok({ stopped: true })
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
