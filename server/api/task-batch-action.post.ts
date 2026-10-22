import { z } from 'zod'
import { requestCancel, resetForRetry, deleteTask } from '../services/TaskService'
import { tryGetRuntime } from '../services/VMService'

const schema = z.object({
  taskIds: z.array(zId).min(1).max(200),
  action: z.enum(['cancel', 'retry', 'delete']),
})

// 批量取消/重试/删除：逐个执行不中断，返回成功与失败明细
export default defineEventHandler(async (event) => {
  try {
    const { taskIds, action } = await validateBody(event, schema)
    const succeeded: number[] = []
    const failed: { id: number; message: string }[] = []
    const rt = tryGetRuntime()

    for (const id of taskIds) {
      try {
        if (action === 'cancel') {
          const { task, direct } = await requestCancel(id)
          if (!direct && task.vmId) {
            try {
              rt?.pool.get(task.vmId)?.cancelCurrent()
            } catch (err) {
              logger.warn({ err, taskId: id }, 'cancelCurrent 调用失败（状态由对账收敛）')
            }
          }
        } else if (action === 'retry') {
          await resetForRetry(id, false)
        } else {
          await deleteTask(id)
        }
        succeeded.push(id)
      } catch (err) {
        failed.push({ id, message: err instanceof Error ? err.message : String(err) })
      }
    }

    if (action === 'retry' && succeeded.length > 0) {
      try {
        rt?.scheduler.kick()
      } catch (err) {
        logger.warn({ err }, 'scheduler.kick 失败（不影响批量重试）')
      }
    }
    return ok({ succeeded, failed })
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
