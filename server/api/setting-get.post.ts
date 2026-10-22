import { z } from 'zod'
import { getSetting, settingToDTO } from '../services/SettingService'

const schema = z.object({ keys: z.array(z.string().min(1).max(128)).min(1).max(64) })

// 按 key 读取配置（未找到的 key 跳过）
export default defineEventHandler(async (event) => {
  try {
    const { keys } = await validateBody(event, schema)
    const items = []
    for (const key of keys) {
      const s = await getSetting(key)
      if (s) items.push(settingToDTO(s))
    }
    return ok(items)
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
