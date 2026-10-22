import { z } from 'zod'
import { deleteTask } from '../services/TaskService'

const schema = z.object({
  taskId: zId,
  // 预留：是否同时删除 Drive 上的产物（由 runtime/worker 实现，此处仅透传接收）
  deleteRemoteFile: z.boolean().optional(),
})

// 删除任务记录（终态或 pending 才能删，级联删文件与日志）
export default defineEventHandler(async (event) => {
  try {
    const { taskId } = await validateBody(event, schema)
    await deleteTask(taskId)
    return ok({ id: taskId })
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
