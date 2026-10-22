import { z } from 'zod'
import { listTasks, taskToDTO } from '../services/TaskService'
import type { TaskListQuery } from '../../shared/types/task'

const schema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(20),
  status: z
    .array(z.enum(['pending', 'queued', 'preparing', 'downloading', 'completed', 'failed', 'cancelled', 'retry_wait']))
    .optional(),
  sourceType: z.array(z.enum(['huggingface', 'http', 'github', 'gdrive', 'torrent'])).optional(),
  keyword: z.string().trim().max(255).optional(),
  createdFrom: z.string().max(40).optional(),
  createdTo: z.string().max(40).optional(),
  sortBy: z.enum(['id', 'createdAt', 'priority', 'downloadedBytes', 'speedBps', 'status']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
})

export default defineEventHandler(async (event) => {
  try {
    const q = await validateBody(event, schema)
    const query: TaskListQuery = { ...q, sortBy: q.sortBy ?? 'id', sortOrder: q.sortOrder ?? 'desc' }
    const { items, total } = await listTasks(query)
    return ok({ items: items.map(taskToDTO), total, page: q.page, pageSize: q.pageSize })
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
