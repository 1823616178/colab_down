import { z } from 'zod'
import { createTask, taskToDTO, appendTaskLog } from '../services/TaskService'
import { tryGetRuntime } from '../services/VMService'
import type { TaskDTO } from '../../shared/types/task'

const itemSchema = z.object({
  name: z.string().trim().min(1).max(255),
  sourceType: z.enum(['huggingface', 'http', 'github', 'gdrive', 'torrent']),
  sourceUrl: z.string().trim().min(1).max(4096),
  destPath: z.string().trim().max(512).optional(),
  revision: z.string().trim().max(128).optional(),
  allowPatterns: zPatterns.nullish(),
  ignorePatterns: zPatterns.nullish(),
  priority: z.number().int().min(0).max(9999).optional(),
  credentialId: zId.optional(),
  downloadMode: z.enum(['direct', 'staged']).optional(),
  maxRetries: z.number().int().min(0).max(20).optional(),
})

const schema = z.object({
  tasks: z.array(itemSchema).min(1).max(100),
  commonDestPath: z.string().trim().max(512).optional(),
})

// 批量创建：逐项执行不中断，失败的项随响应返回
export default defineEventHandler(async (event) => {
  try {
    const body = await validateBody(event, schema)
    const items: TaskDTO[] = []
    const failed: { index: number; message: string }[] = []

    for (const [index, item] of body.tasks.entries()) {
      try {
        const destPath = item.destPath || body.commonDestPath
        if (!destPath) throw new Error('缺少目标路径（destPath 与 commonDestPath 均为空）')
        const task = await createTask({ ...item, destPath })
        await appendTaskLog(task.id, 'info', 'local', `任务已创建（批量）：${task.name}`)
        items.push(taskToDTO(task))
      } catch (err) {
        failed.push({ index, message: err instanceof Error ? err.message : String(err) })
      }
    }

    if (items.length > 0) {
      try {
        tryGetRuntime()?.scheduler.kick()
      } catch (err) {
        logger.warn({ err }, 'scheduler.kick 失败（不影响任务创建）')
      }
    }
    return ok({ items, failed })
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
