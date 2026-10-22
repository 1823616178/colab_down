import { Task } from '../entities/Task'
import { getDataSource } from '../utils/db'
import { logger } from '../utils/logger'
import { getSettingInt } from './settings'
import type { VMWorkerPool } from './VMWorkerPool'

/**
 * TaskScheduler —— 中心队列派发（DESIGN.md §3.2/§5）。
 * 每 2s tick：
 *   ① 唤醒到期 retry_wait（next_retry_at<=now → pending）
 *   ② FOR UPDATE SKIP LOCKED 取 1 个 pending（防多进程/重入重复派发）
 *   ③ 有 idle worker → 先置 queued 再 assign
 *   ④ 无 idle worker 且 activeCount<max_vms 且 awaitingAuthCount==0 → spawn 新 VM
 * 异常只打日志，不中断循环。
 */
export class TaskScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private ticking = false
  private kickTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private pool: VMWorkerPool) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), 2000)
    this.timer.unref?.()
    void this.tick()
    logger.info('TaskScheduler 已启动')
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.kickTimer) clearTimeout(this.kickTimer)
    this.kickTimer = null
  }

  /** 外部事件（建任务/重试）触发一次尽快 tick（100ms 去抖） */
  kick(): void {
    if (this.kickTimer) return
    this.kickTimer = setTimeout(() => {
      this.kickTimer = null
      void this.tick()
    }, 100)
    this.kickTimer.unref?.()
  }

  private async tick(): Promise<void> {
    if (this.ticking) return // 防重入
    this.ticking = true
    try {
      await this.wakeRetryWait()
      await this.dispatch()
    } catch (e) {
      logger.error({ err: e }, 'TaskScheduler tick 异常')
    } finally {
      this.ticking = false
    }
  }

  /** ① 退避到期的 retry_wait → pending */
  private async wakeRetryWait(): Promise<void> {
    await getDataSource()
      .createQueryBuilder()
      .update(Task)
      .set({ status: 'pending', nextRetryAt: null })
      .where("status = 'retry_wait' AND `nextRetryAt` <= :now", { now: new Date() })
      .execute()
  }

  private async dispatch(): Promise<void> {
    // 一轮最多派发有限个，避免单次 tick 过长；剩下的下个 tick 继续
    for (let i = 0; i < 4; i++) {
      const worker = this.pool.acquireIdle()
      if (!worker) {
        await this.maybeSpawn()
        return
      }
      const task = await this.claimNextPending()
      if (!task) return
      // assign 推进 queued → preparing → downloading；任务全程由 worker 负责
      void worker.assign(task).catch((e) => logger.error({ err: e, taskId: task.id }, 'assign 异常'))
    }
  }

  /**
   * ② 取 1 个 pending 并原子置 queued（事务 + FOR UPDATE SKIP LOCKED）。
   * queued 时机：assign 前先置 queued 写库（§5）。
   */
  private async claimNextPending(): Promise<Task | null> {
    return getDataSource().transaction(async (em) => {
      const rows = (await em.query(
        "SELECT id FROM task WHERE status = 'pending' ORDER BY priority ASC, id ASC LIMIT 1 FOR UPDATE SKIP LOCKED",
      )) as Array<{ id: number }>
      const id = rows[0]?.id
      if (!id) return null
      await em.update(Task, { id }, { status: 'queued' })
      return em.findOneBy(Task, { id })
    })
  }

  /** ④ 按需扩容：有 pending 等着才开；一次只开 1 台待授权 VM（§6.0.5） */
  private async maybeSpawn(): Promise<void> {
    const pending = await getDataSource()
      .getRepository(Task)
      .count({ where: { status: 'pending' } })
    if (pending === 0) return
    const maxVms = await getSettingInt('max_vms', 2)
    if (this.pool.activeCount() >= maxVms) return
    if (this.pool.warmingCount() > 0) return
    try {
      await this.pool.spawn({})
      logger.info('按需扩容：已 spawn 新 VM')
    } catch (e) {
      logger.warn({ err: e }, 'spawn 失败（可能已达 Colab 并发上限，C20）')
    }
  }
}
