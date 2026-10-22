import { z } from 'zod'
import { requireRuntime, nextSessionName, findVMBySessionName, vmToDTO } from '../services/VMService'

const schema = z.object({
  sessionName: z
    .string()
    .trim()
    .regex(/^[\w-]{1,64}$/, '会话名仅允许字母数字下划线连字符')
    .optional(),
  runtimeType: z.enum(['cpu', 'T4', 'L4', 'G4', 'H100', 'A100', 'v5e1', 'v6e1']).default('cpu'),
  autoStop: z.boolean().optional(),
  idleTimeout: z.number().int().min(60).max(86400).optional(),
})

// 手动创建 VM（pool.spawn；未指定会话名时自动分配 cdm-vm-N）
export default defineEventHandler(async (event) => {
  try {
    const body = await validateBody(event, schema)
    const rt = requireRuntime()
    const sessionName = body.sessionName ?? (await nextSessionName())
    await rt.pool.spawn({
      sessionName,
      runtimeType: body.runtimeType,
      autoStop: body.autoStop,
      idleTimeout: body.idleTimeout,
    })
    const vm = await findVMBySessionName(sessionName)
    if (!vm) throw new ApiError(ErrorCodes.INTERNAL, 'VM 已创建但未能读取到记录')
    return ok(vmToDTO(vm))
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
