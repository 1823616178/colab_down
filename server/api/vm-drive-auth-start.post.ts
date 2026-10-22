import { z } from 'zod'
import { requireRuntime, getVM, driveAuthToDTO } from '../services/VMService'

const schema = z.object({ vmId: zId })

// 启动 Drive 授权（PTY 跑 drivemount），返回 {authUri, expiresAt}；幂等
export default defineEventHandler(async (event) => {
  try {
    const { vmId } = await validateBody(event, schema)
    const vm = await getVM(vmId) // 40402
    const rt = requireRuntime()
    const rec = await rt.driveAuth.start(vmId)
    return ok(driveAuthToDTO(rec, vm.sessionName))
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
