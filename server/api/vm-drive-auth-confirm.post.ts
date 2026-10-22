import { z } from 'zod'
import { requireRuntime, getVM, driveAuthToDTO } from '../services/VMService'

const schema = z.object({ vmId: zId })

// 用户已在浏览器完成授权 → 向挂起的 PTY 写回车
export default defineEventHandler(async (event) => {
  try {
    const { vmId } = await validateBody(event, schema)
    const vm = await getVM(vmId) // 40402
    const rt = requireRuntime()
    const rec = await rt.driveAuth.confirm(vmId)
    return ok(driveAuthToDTO(rec, vm.sessionName))
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
