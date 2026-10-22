import { listVMs, vmToDTO } from '../services/VMService'
import { listTasksByIds } from '../services/TaskService'

// VM 列表（附当前任务名）
export default defineEventHandler(async (event) => {
  try {
    const vms = await listVMs()
    const taskIds = vms.map((v) => v.currentTaskId).filter((id): id is number => id !== null)
    const tasks = await listTasksByIds(taskIds)
    const nameById = new Map(tasks.map((t) => [t.id, t.name]))
    return ok(vms.map((v) => vmToDTO(v, v.currentTaskId ? (nameById.get(v.currentTaskId) ?? null) : null)))
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
