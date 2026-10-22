import { z } from 'zod'
import { requireRuntime, getVM } from '../services/VMService'

const schema = z.object({ vmId: zId })

// 放弃授权并杀掉 PTY
export default defineEventHandler(async (event) => {
  try {
    const { vmId } = await validateBody(event, schema)
    await getVM(vmId) // 40402
    const rt = requireRuntime()
    await rt.driveAuth.cancel(vmId)
    return ok({ vmId })
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
