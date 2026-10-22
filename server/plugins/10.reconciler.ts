import { ensureRuntime } from '../core/runtime'

// 启动对账 + 周期健康检查（Reconciler.start 内含启动对账与 60s 周期循环）。
// 注意：Nitro 的 runNitroPlugins 不 await 插件（并发执行），必须先自行等待数据源就绪。
export default defineNitroPlugin(async () => {
  try {
    await initDataSource()
  } catch (err) {
    logger.error({ err }, '数据库未就绪，对账与周期检查跳过')
    return
  }
  let runtime
  try {
    runtime = await ensureRuntime()
  } catch (err) {
    logger.error({ err }, '运行时初始化失败：调度与 VM 功能不可用，API 仍提供服务')
    return
  }
  try {
    await runtime.reconciler.start()
    logger.info('启动对账完成，周期健康检查已启动')
  } catch (err) {
    logger.error({ err }, '启动对账失败（不阻塞服务启动）')
  }
})
