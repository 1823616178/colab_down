import { z } from 'zod'
import { getTask, listTaskLogs, downloadLogToDTO } from '../services/TaskService'

const schema = z.object({
  taskId: zId,
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(500).default(100),
  level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
})

// 任务日志倒序分页（LogViewer 依赖）
export default defineEventHandler(async (event) => {
  try {
    const { taskId, page, pageSize, level } = await validateBody(event, schema)
    await getTask(taskId) // 不存在抛 40401
    const { items, total } = await listTaskLogs(taskId, page, pageSize, level)
    return ok({ items: items.map(downloadLogToDTO), total, page, pageSize })
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
