import { z } from 'zod'
import { getTask, listTaskFiles, taskToDTO, taskFileToDTO } from '../services/TaskService'

const schema = z.object({ taskId: zId })

// 任务详情（含文件列表）
export default defineEventHandler(async (event) => {
  try {
    const { taskId } = await validateBody(event, schema)
    const task = await getTask(taskId)
    const files = await listTaskFiles(taskId)
    return ok({ task: taskToDTO(task), files: files.map(taskFileToDTO) })
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
