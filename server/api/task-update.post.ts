import { z } from 'zod'
import { updateTask, taskToDTO } from '../services/TaskService'

const schema = z.object({
  taskId: zId,
  name: z.string().trim().min(1).max(255).optional(),
  destPath: z.string().trim().min(1).max(512).optional(),
  priority: z.number().int().min(0).max(9999).optional(),
  maxRetries: z.number().int().min(0).max(20).optional(),
})

// 改名称/路径/优先级/重试上限（仅非终态）
export default defineEventHandler(async (event) => {
  try {
    const { taskId, ...patch } = await validateBody(event, schema)
    const task = await updateTask(taskId, patch)
    return ok(taskToDTO(task))
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
