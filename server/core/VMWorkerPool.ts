import { homedir } from 'node:os'
import { join } from 'node:path'
import { VM, type RuntimeType } from '../entities/VM'
import { getDataSource } from '../utils/db'
import { logger } from '../utils/logger'
import { getSettingInt, getSettingString } from './settings'
import { VMWorker } from './VMWorker'

/**
 * VMWorkerPool —— 持有全部 VMWorker（DESIGN.md §3.2）。
 * 不做业务决策：选任务由 TaskScheduler 负责。
 * spawn 时直接读 setting 表检查 max_vms（不 import services，保持无环依赖）。
 */

const RUNTIME_TYPES = new Set(['cpu', 'T4', 'L4', 'G4', 'H100', 'A100', 'v5e1', 'v6e1'])

export interface SpawnOptions {
  sessionName?: string
  runtimeType?: string
  autoStop?: boolean
  idleTimeout?: number
}

export class VMWorkerPool {
  private workers = new Map<number, VMWorker>()

  all(): VMWorker[] {
    return [...this.workers.values()]
  }

  get(vmId: number): VMWorker | undefined {
    return this.workers.get(vmId)
  }

  /** 取一台可派发的空闲 Worker（awaiting_drive_auth 的不算，§4） */
  acquireIdle(): VMWorker | undefined {
    for (const w of this.workers.values()) {
      if (w.isIdle()) return w
    }
    return undefined
  }

  /** 存活 VM 数（不含 stopped/stopping/error） */
  activeCount(): number {
    let n = 0
    for (const w of this.workers.values()) {
      const s = w.status
      if (s !== 'stopped' && s !== 'stopping' && s !== 'error') n++
    }
    return n
  }

  awaitingAuthCount(): number {
    let n = 0
    for (const w of this.workers.values()) {
      if (w.status === 'awaiting_drive_auth') n++
    }
    return n
  }

  /** 仍在「升温」的 VM 数（creating/bootstrapping/awaiting_drive_auth）。
   *  扩容门禁用它而非仅 awaitingAuthCount——否则新 VM 还没走到待授权态，
   *  下个 tick 又会再开一台（实测连续两 tick 连开两台） */
  warmingCount(): number {
    let n = 0
    for (const w of this.workers.values()) {
      const s = w.status
      if (s === 'creating' || s === 'bootstrapping' || s === 'awaiting_drive_auth') n++
    }
    return n
  }

  async spawn(opts: SpawnOptions = {}): Promise<VMWorker> {
    // max_vms 上限（C20：免费档常见 1-2，默认 2）
    const maxVms = await getSettingInt('max_vms', 2)
    if (this.activeCount() >= maxVms) {
      throw new Error(`已达最大 VM 数（${maxVms}），不能再开`)
    }
    // 调度保守化：一次只允许 1 台升温中的 VM（§6.0.5，避免同时弹多个授权请求）
    if (this.warmingCount() >= 1) {
      throw new Error('已有 1 台 VM 正在创建或等待 Drive 授权，请先完成授权')
    }

    const sessionName = opts.sessionName?.trim() || `cdm-vm-${Date.now().toString(36)}`
    const runtimeType = (RUNTIME_TYPES.has(opts.runtimeType ?? '') ? opts.runtimeType : 'cpu') as RuntimeType
    const idleTimeout = opts.idleTimeout ?? (await getSettingInt('idle_timeout', 3600))
    const driveBackend = (await getSettingString('drive_backend', 'colab_native')) === 'rclone' ? 'rclone' : 'colab_native'

    const repo = getDataSource().getRepository(VM)
    const vm = repo.create({
      sessionName,
      runtimeType,
      status: 'creating',
      // C13：每台 VM 独立 --config 文件
      configPath: join(homedir(), '.config', 'colab-cli-cdm', `${sessionName}.json`),
      bootstrapped: false,
      driveBackend,
      driveMounted: false,
      driveRoot: null,
      driveAuthState: 'none',
      autoStop: opts.autoStop ?? true,
      idleTimeout,
      // C16：24h keep-alive 硬上限，留 1h 余量
      expiresAt: new Date(Date.now() + 23 * 3600 * 1000),
    })
    await repo.save(vm)

    const worker = new VMWorker(vm)
    this.workers.set(vm.id, worker)
    // 生命周期后台推进（含等待人工授权），失败由 runLifecycle 自己落 error 状态
    void worker.start().catch((e) => logger.error({ err: e, vmId: vm.id }, 'VMWorker.start 异常'))
    return worker
  }

  /** Reconciler 对账时纳管已有 DB 行（不在本进程内的 VM） */
  adopt(vm: VM): VMWorker {
    const existing = this.workers.get(vm.id)
    if (existing) return existing
    const worker = new VMWorker(vm)
    this.workers.set(vm.id, worker)
    return worker
  }

  remove(vmId: number): void {
    this.workers.delete(vmId)
  }

  async stopAll(force = false): Promise<void> {
    await Promise.all(this.all().map((w) => w.stop(force).catch((e) => logger.warn({ err: e }, 'stop 失败'))))
  }
}
