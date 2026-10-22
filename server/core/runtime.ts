import { createBridge } from '../colab'
import type { ColabBridge } from '../colab/ColabBridge'
import { DriveAuthManager } from './DriveAuthManager'
import { registerCoreDeps } from './deps'
import { ProgressBus } from './ProgressBus'
import { Reconciler } from './Reconciler'
import { TaskScheduler } from './TaskScheduler'
import { VMWorkerPool } from './VMWorkerPool'

/**
 * runtime —— 单例组装（其他模块与 API 层统一经它拿实例）。
 *
 * 插件启动顺序（server/plugins/）：
 *   const rt = await ensureRuntime()
 *   await rt.reconciler.start()   // 启动对账先于调度（§6.4）
 *   rt.scheduler.start()
 */

export interface CdmRuntime {
  bridge: ColabBridge
  bus: ProgressBus
  driveAuth: DriveAuthManager
  pool: VMWorkerPool
  scheduler: TaskScheduler
  reconciler: Reconciler
}

let runtime: CdmRuntime | null = null
let initPromise: Promise<CdmRuntime> | null = null

/** 幂等 */
export async function ensureRuntime(): Promise<CdmRuntime> {
  if (runtime) return runtime
  if (initPromise) return initPromise
  initPromise = (async () => {
    const bridge = createBridge()
    const bus = new ProgressBus()
    const driveAuth = new DriveAuthManager(bridge, bus)
    registerCoreDeps({ bridge, bus, driveAuth })
    const pool = new VMWorkerPool()
    const scheduler = new TaskScheduler(pool)
    const reconciler = new Reconciler(pool)
    runtime = { bridge, bus, driveAuth, pool, scheduler, reconciler }
    return runtime
  })()
  try {
    return await initPromise
  } finally {
    initPromise = null
  }
}

export function getRuntime(): CdmRuntime {
  if (!runtime) throw new Error('CdmRuntime 未就绪（应先 await ensureRuntime()）')
  return runtime
}
