import { ensureDefaultSettings } from '../services/SettingService'
import { ensureSeedUser } from '../services/AuthService'

// 引导：写入缺失的默认配置 + 首个管理员账号。
// 注意：Nitro 的 runNitroPlugins 不 await 插件（并发执行），必须先自行等待数据源就绪。
export default defineNitroPlugin(async () => {
  try {
    await initDataSource()
    await ensureDefaultSettings()
    await ensureSeedUser()
  } catch (err) {
    logger.error({ err }, '引导初始化失败，服务无法启动')
    throw err
  }
})
