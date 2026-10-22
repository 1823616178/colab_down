import { z } from 'zod'
import { parseUrls } from '../services/UrlParser'

const schema = z.object({
  urls: z.array(z.string().max(4096)).min(1).max(200),
})

// URL 智能识别（创建页依赖）
export default defineEventHandler(async (event) => {
  try {
    const body = await validateBody(event, schema)
    return ok(parseUrls(body.urls))
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
