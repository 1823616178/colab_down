import type { ColabBridge } from '../colab/ColabBridge'
import type { DriveAuthManager } from './DriveAuthManager'
import type { ProgressBus } from './ProgressBus'

/**
 * core 内部共享依赖（bridge/bus/driveAuth），由 runtime.ensureRuntime() 注册。
 * 用它而不是 import runtime，避免 runtime → pool → VMWorker → runtime 的环依赖。
 */

export interface CoreDeps {
  bridge: ColabBridge
  bus: ProgressBus
  driveAuth: DriveAuthManager
}

let deps: CoreDeps | null = null

export function registerCoreDeps(d: CoreDeps): void {
  deps = d
}

export function coreDeps(): CoreDeps {
  if (!deps) throw new Error('core deps 未初始化（应先调 runtime.ensureRuntime()）')
  return deps
}
