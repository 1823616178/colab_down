import { requireRuntime } from '../services/VMService'

// 手动触发与 colab sessions 对账（排障用）
export default defineEventHandler(async (event) => {
  try {
    const rt = requireRuntime()
    return ok(await rt.reconciler.syncNow())
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
