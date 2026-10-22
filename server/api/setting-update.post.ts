import { z } from 'zod'
import { setSetting, getAllSettings, settingToDTO } from '../services/SettingService'

const schema = z.object({
  items: z.array(z.object({ key: z.string().min(1).max(128), value: z.string().max(4096) })).min(1).max(64),
})

// 批量更新配置（未知 key 或格式非法整体失败）；成功后返回全量列表
export default defineEventHandler(async (event) => {
  try {
    const { items } = await validateBody(event, schema)
    for (const item of items) {
      await setSetting(item.key, item.value)
    }
    return ok((await getAllSettings()).map(settingToDTO))
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
