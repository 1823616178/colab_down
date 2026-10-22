import { z } from 'zod'
import { resetForRetry, taskToDTO, appendTaskLog } from '../services/TaskService'
import { tryGetRuntime } from '../services/VMService'

const schema = z.object({
  taskId: zId,
  resetRetryCount: z.boolean().optional(),
})

// 重试：终态（failed/cancelled）→ 清 error/progress 置 pending；成功后唤醒调度器
export default defineEventHandler(async (event) => {
  try {
    const { taskId, resetRetryCount } = await validateBody(event, schema)
    const task = await resetForRetry(taskId, resetRetryCount ?? false)
    await appendTaskLog(taskId, 'info', 'local', '任务已重新入队')
    try {
      tryGetRuntime()?.scheduler.kick()
    } catch (err) {
      logger.warn({ err }, 'scheduler.kick 失败（不影响重试）')
    }
    return ok(taskToDTO(task))
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
