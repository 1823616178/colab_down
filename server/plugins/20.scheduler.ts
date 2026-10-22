import { ensureRuntime } from '../core/runtime'

// 启动任务调度器。ensureRuntime 是 promise 记忆化的，与 10.reconciler.ts 并发调用安全。
export default defineNitroPlugin(async () => {
  try {
    await initDataSource()
    const runtime = await ensureRuntime()
    runtime.scheduler.start()
    logger.info('任务调度器已启动')
  } catch (err) {
    logger.error({ err }, '调度器启动失败（运行时未就绪）')
  }
})
