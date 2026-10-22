import { driveQuota, driveList } from '../services/DriveService'

// Drive 连通性诊断 = quota + 列根目录（探测本身不抛错，失败体现在 ok/message 上）
export default defineEventHandler(async (event) => {
  try {
    const quota = await driveQuota()
    const entries = await driveList('/')
    const okFlag = quota.freeBytes !== null || entries.length > 0
    return ok({
      ok: okFlag,
      freeBytes: quota.freeBytes,
      totalBytes: quota.totalBytes,
      rootEntries: entries,
      message: okFlag
        ? 'Drive 可访问'
        : '无可用 VM 或探测失败（没有已挂载 Drive 的 VM 时此为预期；mock 模式下同样降级）',
    })
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
