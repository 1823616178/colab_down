import type { ColabBridge } from './ColabBridge'
import { MockColabBridge } from './MockColabBridge'
import { RealColabBridge } from './RealColabBridge'

/** 按 NUXT_CDM_MOCK=1 选 Mock/Real（DESIGN.md §15.1）。
 *  注意 destr 会把环境变量 "1" 解析成 number 1，必须 String 归一。 */
export function isMockMode(): boolean {
  return String(useRuntimeConfig().cdmMock) === '1'
}

export function createBridge(): ColabBridge {
  if (isMockMode()) {
    // Nitro dev 热重载会重建模块与 runtime，mock 状态（session 表/模拟下载/定时器）必须
    // 跨重载存活，否则对账会把所有 VM 误判为「远端不存在」而停止 —— 全局单例解决
    const g = globalThis as { __cdmMockBridge?: MockColabBridge }
    g.__cdmMockBridge ??= new MockColabBridge()
    return g.__cdmMockBridge
  }
  return new RealColabBridge()
}
