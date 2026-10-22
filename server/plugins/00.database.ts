// Nitro 启动钩子：初始化 MySQL 数据源。失败则拒绝启动（没 DB 不起服务）。
export default defineNitroPlugin(async () => {
  try {
    await initDataSource()
    logger.info('数据库连接成功')
  } catch (err) {
    logger.error({ err }, '数据库初始化失败，服务无法启动')
    throw err
  }
})
