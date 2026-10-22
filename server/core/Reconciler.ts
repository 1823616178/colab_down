import { homedir } from 'node:os'
import { join } from 'node:path'
import { In, LessThan, Not } from 'typeorm'
import { DownloadLog } from '../entities/DownloadLog'
import { Task } from '../entities/Task'
import { VM } from '../entities/VM'
import { getDataSource } from '../utils/db'
import { logger, vmLogger } from '../utils/logger'
import { coreDeps } from './deps'
import { getSettingInt, getSettingString } from './settings'
import { applyTaskFailure } from './taskRules'
import type { VMWorkerPool } from './VMWorkerPool'

/**
 * Reconciler —— 启动对账 + 周期健康检查（DESIGN.md §6.4/§14）。
 * 启动对账必须先于 Scheduler 启动（插件顺序保证）。
 */

/** 心跳超时（busy 时 lastHeartbeatAt 超过该值告警；tail 断连重连由 VMWorker 自己负责） */
const HEARTBEAT_STALE_MS = 180_000
const PERIODIC_MS = 60_000

export interface SyncSummary {
  remoteCount: number
  adopted: string[]
  stopped: string[]
  orphans: { name: string; action: string }[]
  skipped: boolean
}

export class Reconciler {
  private timer: ReturnType<typeof setInterval> | null = null
  private expiryReminded = new Set<number>()
  private lastLogCleanupDay = ''

  constructor(private pool: VMWorkerPool) {}

  /** 启动对账（§6.4），完成后才允许 Scheduler 开始派发 */
  async start(): Promise<void> {
    await this.startupReconcile()
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.periodic().catch((e) => logger.error({ err: e }, 'Reconciler periodic 异常'))
    }, PERIODIC_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** vm-sync API 手动触发：只做远端 diff，不动任务状态 */
  async syncNow(): Promise<SyncSummary> {
    return this.diffSessions(false)
  }

  // ================================================================
  // 启动对账
  // ================================================================

  private async startupReconcile(): Promise<void> {
    const log = logger
    log.info('Reconciler 启动对账开始')

    // ① PTY 随进程死亡：授权会话注册表清空 + 进行中的授权状态重置（§6.0.5）
    coreDeps().driveAuth.resetAll()
    await getDataSource()
      .getRepository(VM)
      .update({ driveAuthState: In(['requesting', 'awaiting_user', 'propagating']) }, { driveAuthState: 'none' })

    // ② 与 colab sessions 双向 diff（含 adopt + reconcile）
    await this.diffSessions(true)

    // ③ queued/preparing 任务无条件退回 pending（这两个状态不可恢复，§6.4）
    await getDataSource()
      .createQueryBuilder()
      .update(Task)
      .set({ status: 'pending', vmId: null })
      .where("status IN ('queued', 'preparing')")
      .execute()

    log.info('Reconciler 启动对账完成')
  }

  // ================================================================
  // sessions 双向 diff
  // ================================================================

  private async diffSessions(isStartup: boolean): Promise<SyncSummary> {
    const { bridge } = coreDeps()
    const summary: SyncSummary = { remoteCount: 0, adopted: [], stopped: [], orphans: [], skipped: false }

    // CLI 失败（认证失效等）时跳过远端 diff：宁可不动，不能把 DB 全杀错
    let remote: Array<{ name: string }>
    try {
      remote = await bridge.listSessions()
    } catch (e) {
      logger.error({ err: e }, 'listSessions 失败，跳过对账 diff')
      summary.skipped = true
      return summary
    }
    summary.remoteCount = remote.length
    const remoteNames = new Set(remote.map((s) => s.name))

    const vmRepo = getDataSource().getRepository(VM)
    const dbVms = await vmRepo.find({ where: { status: Not(In(['stopped'])) } })

    for (const vm of dbVms) {
      if (remoteNames.has(vm.sessionName)) {
        // 两边都有 → 纳管 + 对账（其上有 downloading 任务则走 §6.3 恢复）
        const worker = this.pool.adopt(vm)
        summary.adopted.push(vm.sessionName)
        void worker.reconcile().catch((e) => vmLogger(vm.id).error({ err: e }, 'reconcile 失败'))
      } else {
        // DB 有 / 远端无 → stopped；其上 downloading 任务按真相判定（VM 没了 → failed）
        await vmRepo.update({ id: vm.id }, { status: 'stopped', driveMounted: false, currentTaskId: null })
        summary.stopped.push(vm.sessionName)
        const orphans = await getDataSource().getRepository(Task).find({
          where: { vmId: vm.id, status: 'downloading' },
        })
        for (const t of orphans) {
          await applyTaskFailure(t, 'VM_LOST', `对账：VM ${vm.sessionName} 已不存在`)
        }
      }
    }

    // DB 无 / 远端有 → 孤儿 VM，按 setting.orphan_policy 处理
    const dbNames = new Set(dbVms.map((v) => v.sessionName))
    const orphanNames = [...remoteNames].filter((n) => !dbNames.has(n))
    if (orphanNames.length > 0) {
      const policy = await getSettingString('orphan_policy', 'adopt')
      for (const name of orphanNames) {
        summary.orphans.push({ name, action: policy })
        await this.handleOrphan(name, policy, isStartup)
      }
    }
    return summary
  }

  private async handleOrphan(name: string, policy: string, _isStartup: boolean): Promise<void> {
    const log = logger
    if (policy === 'ignore') {
      log.warn({ sessionName: name }, '发现孤儿 VM（ignore 策略，不处理）')
      return
    }
    if (policy === 'stop') {
      try {
        // config 文件可能不在本机，尽力而为
        await coreDeps().bridge.stopSession(orphanVmStub(name))
        log.warn({ sessionName: name }, '孤儿 VM 已停止')
      } catch (e) {
        log.warn({ err: e, sessionName: name }, '停止孤儿 VM 失败')
      }
      return
    }
    // adopt（默认）：建行纳管，走 reconcile（未知 VM 多半无法复用，会落到 error 可见）
    try {
      const repo = getDataSource().getRepository(VM)
      const vm = repo.create({
        sessionName: name,
        runtimeType: 'cpu',
        status: 'error',
        configPath: orphanVmStub(name).configPath,
        bootstrapped: false,
        driveBackend: 'colab_native',
        driveMounted: false,
        driveAuthState: 'none',
        autoStop: true,
        idleTimeout: 3600,
        expiresAt: new Date(Date.now() + 23 * 3600 * 1000),
        errorMsg: '对账发现的孤儿 VM 已纳管（bootstrapped 未知），请人工确认后复用或停止',
      })
      await repo.save(vm)
      this.pool.adopt(vm)
      log.warn({ sessionName: name }, '孤儿 VM 已纳管')
    } catch (e) {
      log.warn({ err: e, sessionName: name }, '纳管孤儿 VM 失败')
    }
  }

  // ================================================================
  // 周期检查（60s）
  // ================================================================

  private async periodic(): Promise<void> {
    const now = Date.now()
    const vmRepo = getDataSource().getRepository(VM)

    // ① 心跳超时（只告警：tail 断连重连由 VMWorker 自己驱动）
    for (const w of this.pool.all()) {
      if (w.status === 'busy') {
        const vm = await vmRepo.findOneBy({ id: w.vmId })
        if (vm?.lastHeartbeatAt && now - vm.lastHeartbeatAt.getTime() > HEARTBEAT_STALE_MS) {
          vmLogger(w.vmId).warn('busy 但心跳超时（>180s），等待 tail 断连恢复逻辑处理')
        }
      }
      // 回收已停止的 worker
      if (w.status === 'stopped') this.pool.remove(w.vmId)
    }

    // ② expires_at：提前 1h 提醒（一次）；到点 draining（C16 的 24h 硬上限）
    const activeVms = await vmRepo.find({ where: { status: Not(In(['stopped', 'stopping', 'error'])) } })
    for (const vm of activeVms) {
      const remain = vm.expiresAt.getTime() - now
      if (remain <= 0) {
        vmLogger(vm.id).warn('VM 到达 expires_at，转 draining 停止')
        await this.pool.get(vm.id)?.stop(false)
      } else if (remain < 3600_000 && !this.expiryReminded.has(vm.id)) {
        this.expiryReminded.add(vm.id)
        vmLogger(vm.id).warn('VM 将于 1h 内到期，建议现在开新 VM 并授权（§6.0.5）')
      }
    }

    // ③ 空闲回收：autoStop 且超过 idle_timeout（VM.lastActiveAt 随任何落库刷新）
    const idleVms = await vmRepo.find({ where: { status: 'idle', autoStop: true } })
    for (const vm of idleVms) {
      const idleSec = (now - vm.lastActiveAt.getTime()) / 1000
      if (idleSec > vm.idleTimeout) {
        vmLogger(vm.id).info({ idleSec }, '空闲超时，回收 VM')
        const w = this.pool.get(vm.id)
        if (w?.isIdle()) await w.stop(false).catch((e) => vmLogger(vm.id).warn({ err: e }, '空闲回收 stop 失败'))
      }
    }

    // ④ DownloadLog 每日清理：log_retention_days + 单任务 5000 条上限只留 warn/error
    const today = new Date().toISOString().slice(0, 10)
    if (today !== this.lastLogCleanupDay) {
      this.lastLogCleanupDay = today
      await this.cleanupLogs()
    }
  }

  private async cleanupLogs(): Promise<void> {
    try {
      const days = await getSettingInt('log_retention_days', 14)
      const cutoff = new Date(Date.now() - days * 86400_000)
      const r1 = await getDataSource().getRepository(DownloadLog).delete({ createdAt: LessThan(cutoff) })
      // 超 5000 条的任务，debug/info 全删（只留 warn/error，§9.3）
      const r2 = await getDataSource().query(
        'DELETE l FROM download_log l JOIN (SELECT taskId FROM download_log GROUP BY taskId HAVING COUNT(*) > 5000) t ON l.taskId = t.taskId WHERE l.level IN (\'debug\', \'info\')',
      )
      logger.info({ expired: r1.affected ?? 0, trimmed: (r2 as { affectedRows?: number })?.affectedRows ?? 0 }, 'DownloadLog 清理完成')
    } catch (e) {
      logger.warn({ err: e }, 'DownloadLog 清理失败')
    }
  }
}

/** 孤儿 VM 操作所需的最小实体形状（config 路径按 CDM 约定猜测） */
function orphanVmStub(sessionName: string): VM {
  return {
    id: 0,
    sessionName,
    configPath: join(homedir(), '.config', 'colab-cli-cdm', `${sessionName}.json`),
  } as VM
}
