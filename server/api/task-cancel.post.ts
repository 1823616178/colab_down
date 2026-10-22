import { z } from 'zod'
import { requestCancel, taskToDTO, appendTaskLog } from '../services/TaskService'
import { tryGetRuntime } from '../services/VMService'

const schema = z.object({ taskId: zId })

// 取消：pending/retry_wait 直接置 cancelled；
// queued/preparing/downloading 置 cancelRequested 并通知 worker，状态推进由 runtime 负责
export default defineEventHandler(async (event) => {
  try {
    const { taskId } = await validateBody(event, schema)
    const { task, direct } = await requestCancel(taskId)
    await appendTaskLog(taskId, 'info', 'local', direct ? '任务已取消' : '已请求取消，等待运行时停止任务')

    if (!direct && task.vmId) {
      try {
        tryGetRuntime()?.pool.get(task.vmId)?.cancelCurrent()
      } catch (err) {
        logger.warn({ err, taskId }, 'cancelCurrent 调用失败（状态由对账收敛）')
      }
    }
    return ok(taskToDTO(task))
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
