import { z } from 'zod'
import { driveList } from '../services/DriveService'

const schema = z.object({ path: z.string().trim().max(1024).default('') })

// 浏览 Drive 目录（无可用 VM 时返回空数组，前端容错）
export default defineEventHandler(async (event) => {
  try {
    const { path } = await validateBody(event, schema)
    return ok(await driveList(path))
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
