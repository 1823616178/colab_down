import 'reflect-metadata'
import { DataSource } from 'typeorm'
import { Credential } from '../entities/Credential'
import { DownloadLog } from '../entities/DownloadLog'
import { Setting } from '../entities/Setting'
import { Task } from '../entities/Task'
import { TaskFile } from '../entities/TaskFile'
import { User } from '../entities/User'
import { VM } from '../entities/VM'

let dataSource: DataSource | null = null
let initPromise: Promise<DataSource> | null = null

export function getDataSource(): DataSource {
  if (!dataSource) throw new Error('DataSource 未初始化（server/plugins/00.database.ts 应先执行）')
  return dataSource
}

export async function initDataSource(): Promise<DataSource> {
  if (dataSource?.isInitialized) return dataSource
  if (initPromise) return initPromise

  initPromise = (async () => {
    const config = useRuntimeConfig()
    const ds = new DataSource({
      type: 'mysql',
      // NUXT_ 环境变量经 destr 解析，纯数字密码会变 number，必须 String 兜底
      host: String(config.dbHost),
      port: Number(config.dbPort),
      username: String(config.dbUser),
      password: String(config.dbPassword),
      database: String(config.dbName),
      entities: [Task, TaskFile, VM, DownloadLog, Setting, Credential, User],
      // 单人本地工具：由 TypeORM 自动同步 schema（当前阶段不走手写 migration，见 README）
      synchronize: true,
      charset: 'utf8mb4',
      supportBigNumbers: true,
      bigNumberStrings: false,
      logging: false,
    })
    await ds.initialize()
    dataSource = ds
    return ds
  })()

  try {
    return await initPromise
  } finally {
    initPromise = null
  }
}
