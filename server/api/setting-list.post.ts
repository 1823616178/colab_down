import { getAllSettings, settingToDTO } from '../services/SettingService'

// 全部配置（设置页依赖）
export default defineEventHandler(async (event) => {
  try {
    const items = await getAllSettings()
    return ok(items.map(settingToDTO))
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
