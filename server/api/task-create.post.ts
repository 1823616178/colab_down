import { z } from 'zod'
import { createTask, taskToDTO, appendTaskLog } from '../services/TaskService'
import { tryGetRuntime } from '../services/VMService'

const taskCreateSchema = z.object({
  name: z.string().trim().min(1).max(255),
  sourceType: z.enum(['huggingface', 'http', 'github', 'gdrive', 'torrent']),
  sourceUrl: z.string().trim().min(1).max(4096),
  destPath: z.string().trim().min(1).max(512),
  revision: z.string().trim().max(128).optional(),
  allowPatterns: zPatterns.nullish(),
  ignorePatterns: zPatterns.nullish(),
  priority: z.number().int().min(0).max(9999).optional(),
  credentialId: zId.optional(),
  downloadMode: z.enum(['direct', 'staged']).optional(),
  maxRetries: z.number().int().min(0).max(20).optional(),
})

export default defineEventHandler(async (event) => {
  try {
    const body = await validateBody(event, taskCreateSchema)
    const task = await createTask(body)
    await appendTaskLog(task.id, 'info', 'local', `任务已创建：${task.name}`)
    // 通知调度器；运行时未就绪不影响创建
    try {
      tryGetRuntime()?.scheduler.kick()
    } catch (err) {
      logger.warn({ err }, 'scheduler.kick 失败（不影响任务创建）')
    }
    return ok(taskToDTO(task))
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
