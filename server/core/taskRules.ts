import { Task } from '../entities/Task'
import { getDataSource } from '../utils/db'
import { taskLogger } from '../utils/logger'
import { coreDeps } from './deps'

/**
 * 任务失败/重试规则（§5 状态机 + §6.6 退避），VMWorker 与 Reconciler 共用。
 */

/** 不可重试错误码：重试这些纯属浪费算力（§6.6） */
export const NON_RETRYABLE_ERRORS = new Set([
  'AUTH_REQUIRED',
  'SOURCE_NOT_FOUND',
  'DRIVE_QUOTA_EXCEEDED',
  'INVALID_URL',
  'CANCELLED',
])

/** next_retry_at = now + min(30 * 2^retry_count, 1800)s（30s → 30min 封顶） */
export function nextRetryDelaySec(retryCount: number): number {
  return Math.min(30 * 2 ** retryCount, 1800)
}

/**
 * 统一失败出口：
 * - DRIVE_MOUNT_LOST → retry_wait 且**不消耗 retry_count**（§6.0.6：凭据过期不是任务的错）
 * - 不可重试 / 次数耗尽 → 终态 failed
 * - 其余 → retry_wait + 指数退避（换 VM 重试：清 vmId 绑定，resume_offset 保留续传位点）
 */
export async function applyTaskFailure(task: Task, errorCode: string, errorMsg: string): Promise<Task> {
  const repo = getDataSource().getRepository(Task)
  const log = taskLogger(task.id)
  const now = new Date()

  task.errorCode = errorCode
  task.errorMsg = errorMsg.slice(0, 4000)
  task.speedBps = 0
  task.etaSec = null
  task.resumeOffset = task.downloadedBytes // 重试时凭此续传（§6.8）
  task.completedAt = now

  if (errorCode === 'DRIVE_MOUNT_LOST') {
    task.status = 'retry_wait'
    task.nextRetryAt = new Date(now.getTime() + 30_000)
    task.vmId = null // VM 转重新授权；Drive 上的半成品支持跨 VM 续传
    log.warn('Drive 挂载失效，任务转 retry_wait（不消耗重试次数）')
  } else if (NON_RETRYABLE_ERRORS.has(errorCode) || task.retryCount >= task.maxRetries) {
    task.status = 'failed'
    task.nextRetryAt = null
    task.vmId = null
    log.warn({ errorCode }, '任务终态失败')
  } else {
    const delay = nextRetryDelaySec(task.retryCount)
    task.retryCount += 1
    task.status = 'retry_wait'
    task.nextRetryAt = new Date(now.getTime() + delay * 1000)
    task.vmId = null
    log.warn({ errorCode, retryCount: task.retryCount, delaySec: delay }, '任务失败，等待退避重试')
  }

  const saved = await repo.save(task)
  coreDeps().bus.emitTaskStatus({
    taskId: task.id,
    status: saved.status,
    errorCode,
    error: saved.errorMsg,
  })
  return saved
}
