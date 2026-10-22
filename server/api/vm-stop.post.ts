import { z } from 'zod'
import { getVM, vmToDTO, tryGetRuntime } from '../services/VMService'

const schema = z.object({
  vmId: zId,
  force: z.boolean().optional(),
})

// 停止 VM（force=false 时等当前任务跑完，由 worker 实现）
export default defineEventHandler(async (event) => {
  try {
    const { vmId, force } = await validateBody(event, schema)
    await getVM(vmId) // 不存在抛 40402
    const rt = tryGetRuntime()
    const worker = rt?.pool.get(vmId)
    if (worker) {
      await worker.stop(force ?? false)
    } else {
      logger.warn({ vmId }, 'vm-stop：运行时未就绪或 worker 不在池中，仅返回当前状态')
    }
    return ok(vmToDTO(await getVM(vmId)))
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
