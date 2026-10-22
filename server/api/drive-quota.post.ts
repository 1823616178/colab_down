import { driveQuota } from '../services/DriveService'

// Drive 剩余空间（下载前预检；探测失败返回 {null,null}）
export default defineEventHandler(async (event) => {
  try {
    return ok(await driveQuota())
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
