import { z } from 'zod'
import { getVM, vmToDTO } from '../services/VMService'
import { listRecentTasksByVm, taskToDTO, getTask } from '../services/TaskService'

const schema = z.object({ vmId: zId })

// VM 详情 + 该 VM 最近 20 条任务
export default defineEventHandler(async (event) => {
  try {
    const { vmId } = await validateBody(event, schema)
    const vm = await getVM(vmId)
    let currentTaskName: string | null = null
    if (vm.currentTaskId) {
      currentTaskName = (await getTask(vm.currentTaskId).catch(() => null))?.name ?? null
    }
    const recentTasks = await listRecentTasksByVm(vmId, 20)
    return ok({ vm: vmToDTO(vm, currentTaskName), recentTasks: recentTasks.map(taskToDTO) })
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
