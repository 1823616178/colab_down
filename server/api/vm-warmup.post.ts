import { z } from 'zod'
import { requireRuntime, nextSessionName, findVMBySessionName, vmToDTO } from '../services/VMService'
import type { VMDTO } from '../../shared/types/vm'

const schema = z.object({
  count: z.number().int().min(1).max(5),
  runtimeType: z.enum(['cpu', 'T4', 'L4', 'G4', 'H100', 'A100', 'v5e1', 'v6e1']).default('cpu'),
})

// 预热：串行 spawn N 台（待授权并发上限由 pool 保证）；授权引导由前端逐台走 auth-start
export default defineEventHandler(async (event) => {
  try {
    const { count, runtimeType } = await validateBody(event, schema)
    const rt = requireRuntime()
    const items: VMDTO[] = []
    const failed: { index: number; message: string }[] = []

    for (let i = 0; i < count; i++) {
      try {
        const sessionName = await nextSessionName()
        await rt.pool.spawn({ sessionName, runtimeType })
        const vm = await findVMBySessionName(sessionName)
        if (vm) items.push(vmToDTO(vm))
      } catch (err) {
        // 失败（常见为待授权上限/配额）后续也会失败，直接中断
        failed.push({ index: i, message: err instanceof Error ? err.message : String(err) })
        break
      }
    }
    return ok({ items, failed })
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
