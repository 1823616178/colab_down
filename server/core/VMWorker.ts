import { buildWorkersBundle } from '../colab/assets'
import type { StreamHandle } from '../colab/ColabBridge'
import { Credential } from '../entities/Credential'
import { DownloadLog } from '../entities/DownloadLog'
import { Task } from '../entities/Task'
import { TaskFile } from '../entities/TaskFile'
import { VM, type VMStatus } from '../entities/VM'
import type { WorkerMessage } from '~~/shared/types/progress'
import { decrypt } from '../utils/crypto'
import { getDataSource } from '../utils/db'
import { taskLogger, vmLogger } from '../utils/logger'
import { coreDeps } from './deps'
import { parseTailLine, type ParsedTail } from './ProtocolParser'
import { getSettingBool } from './settings'
import { applyTaskFailure } from './taskRules'

/**
 * VMWorker —— 一台 VM 的完整生命周期 actor（DESIGN.md §3.2/§4/§6）。
 *
 * 生命周期：create → bootstrap → awaiting_drive_auth → idle ⇄ busy。
 * 任务执行走两段式 exec（§6.2）：短 exec 写 job/启动 → 长 exec tail 流式收进度；
 * 断连恢复真相来源顺序：status.json → pid 活着 → failed（§6.3）。
 */

const TASK_DIR_BASE = '/content/cdm'
/** C4：流式 tail 用显式大正数（与 VM 24h 上限对齐），绝不传 0 */
const TAIL_TIMEOUT_SEC = 86400
const TAIL_IDLE_SEC = 300
/** 断连指数退避 3/6/12/24/48s，最多 5 次（§6.3） */
const RECONNECT_BACKOFF_SEC = [3, 6, 12, 24, 48]
const DB_FLUSH_MS = 5000 // 进度落库节流（三级节流第 3 层）
const NOISE_FLUSH_MS = 2000

/** C12：apt 包要走 exec；kernel exec 里 `!` 是 IPython 魔法，保险起见用 subprocess */
const APT_INSTALL_CODE = `import subprocess
r = subprocess.run(["bash", "-c", "apt-get -qq update && apt-get -qq install -y aria2"], capture_output=True, text=True)
print("rc=", r.returncode)
print((r.stdout or "")[-1500:])
print((r.stderr or "")[-1500:])
import shutil
print("@@ARIA2@@", bool(shutil.which("aria2c")))
`

interface TerminalPayload {
  status: 'completed' | 'failed' | 'cancelled'
  bytes?: number
  duration_sec?: number
  error_code?: string
  error?: string
}

interface TruthProbe {
  statusJson: string | null
  alive: boolean
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class VMWorker {
  readonly vmId: number
  private vm: VM
  private vmStatus: VMStatus
  private currentTask: Task | null = null
  private tail: StreamHandle | null = null
  /** 代数：cancelCurrent/stop 使在跑的 assign/tail 逻辑失效 */
  private runId = 0
  private lifecyclePromise: Promise<void> | null = null
  private stopMode: 'none' | 'drain' | 'force' = 'none'
  private lastSeq = 0
  private lastDbFlush = 0
  private lastHeartbeatSave = 0
  private noiseBuf: string[] = []
  private lastNoiseFlush = 0
  private vmSaveChain: Promise<void> = Promise.resolve()

  constructor(vm: VM) {
    this.vm = vm
    this.vmId = vm.id
    this.vmStatus = vm.status
  }

  get status(): VMStatus {
    return this.vmStatus
  }

  isIdle(): boolean {
    return this.vmStatus === 'idle'
  }

  // ================================================================
  // 生命周期：create → bootstrap → awaiting_drive_auth → idle
  // ================================================================

  /** pool.spawn() 后调用；幂等 */
  start(): Promise<void> {
    if (!this.lifecyclePromise) this.lifecyclePromise = this.runLifecycle()
    return this.lifecyclePromise
  }

  private async runLifecycle(): Promise<void> {
    const { bridge } = coreDeps()
    const log = vmLogger(this.vmId)
    try {
      // ① create
      if (this.vmStatus === 'creating') {
        await bridge.newSession(this.vm)
        await this.patchVm({ status: 'bootstrapping' }, 'bootstrapping')
      }

      // ② bootstrap
      if (!this.vm.bootstrapped) {
        await this.patchVm({ status: 'bootstrapping' }, 'bootstrapping')
        // worker 包：base64 tar.gz 单次送达（spike-report §4：比 N 次 upload 快 5.7 倍且原子）
        const deploy = await bridge.execTemplate(this.vm, 'deploy_lib', { BLOB: buildWorkersBundle() }, 180)
        if (deploy.code !== 0) throw new Error(`deploy_lib 失败: ${tail(deploy.stderr, 300)}`)
        const pip = await bridge.install(this.vm, ['huggingface_hub', 'hf_transfer', 'gdown', 'requests'])
        if (pip.code !== 0) throw new Error(`pip install 失败: ${tail(pip.stderr || pip.stdout, 300)}`)
        const apt = await bridge.exec(this.vm, APT_INSTALL_CODE, 600)
        if (apt.code !== 0 || !apt.stdout.includes('@@ARIA2@@ True')) {
          // aria2 缺失仍有 requests 兜底，不致命（http 降速；torrent 本就默认禁用）
          log.warn({ detail: tail(apt.stdout, 200) }, 'aria2 安装未确认，http 源将退化为单连接')
        }
        await this.patchVm({ bootstrapped: true, bootstrappedAt: new Date() })
      }

      if (this.isStopping()) return

      // ③ Drive 授权 + 挂载探针
      if (this.vm.driveBackend === 'rclone') {
        throw new Error('rclone 后端是 Phase 8 可选项，当前未实现')
      }
      if (!this.vm.driveMounted) {
        await this.runDriveAuth()
      }
      if (this.isStopping()) return
      await this.patchVm({ status: 'idle' }, 'idle')
      log.info('VM 就绪（idle）')
    } catch (e) {
      if (this.isStopping()) return
      const msg = e instanceof Error ? e.message : String(e)
      log.error({ err: msg }, 'VM 生命周期失败')
      // error 状态不复用，也不自动重建（§6.0.5：重建照样要人工授权）
      await this.patchVm({ status: 'error', errorMsg: msg.slice(0, 2000) }, 'error')
    }
  }

  /** awaiting_drive_auth 子流程：DriveAuthManager → 等 mounted → 挂载探针（§6.0.5 双重判定） */
  private async runDriveAuth(): Promise<void> {
    const { bridge, driveAuth } = coreDeps()
    await this.patchVm({ status: 'awaiting_drive_auth', driveMounted: false }, 'awaiting_drive_auth')
    const session = await driveAuth.start(this.vmId) // 幂等：已有活跃会话直接复用
    if (session.state !== 'mounted') {
      await driveAuth.waitUntilMounted(this.vmId)
    }
    const probe = await bridge.execTemplate(this.vm, 'probe_mount', { DRIVE_ROOT: this.driveRoot() }, 60)
    if (!probe.stdout.includes('OK')) {
      throw new Error(`挂载探针失败: ${tail(probe.stdout, 200)}`)
    }
    await this.patchVm({
      driveMounted: true,
      driveRoot: this.driveRoot(),
      driveAuthorizedAt: new Date(),
    })
  }

  /** DRIVE_MOUNT_LOST 后重新授权（§6.0.6），成功后回 idle */
  private reauthPending = false

  private reauthInBackground(): void {
    this.reauthPending = true
    void (async () => {
      try {
        await this.runDriveAuth()
        if (!this.isStopping()) await this.patchVm({ status: 'idle' }, 'idle')
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (!this.isStopping()) await this.patchVm({ status: 'error', errorMsg: msg.slice(0, 2000) }, 'error')
      } finally {
        this.reauthPending = false
      }
    })()
  }

  private driveRoot(): string {
    // colab_native 挂载点约定（§6.7）；drivemount 固定挂 /content/drive
    return this.vm.driveRoot ?? '/content/drive/MyDrive'
  }

  // ================================================================
  // 任务执行：assign → preflight → write_job → launch → tail 流
  // ================================================================

  async assign(task: Task): Promise<void> {
    if (this.vmStatus !== 'idle') throw new Error(`VM ${this.vmId} 状态 ${this.vmStatus} 不可派发`)
    const myRun = ++this.runId
    const { bridge } = coreDeps()
    const repo = getDataSource().getRepository(Task)
    const log = taskLogger(task.id)
    const t = await repo.findOneByOrFail({ id: task.id })
    this.currentTask = t
    this.lastSeq = 0
    this.lastDbFlush = 0
    const taskDir = `${TASK_DIR_BASE}/${t.id}`

    try {
      // queued → preparing（§5）
      t.status = 'preparing'
      t.vmId = this.vmId
      t.vmSessionName = this.vm.sessionName
      t.startedAt = new Date()
      t.errorCode = null
      t.errorMsg = null
      await repo.save(t)
      coreDeps().bus.emitTaskStatus({ taskId: t.id, status: 'preparing' })
      await this.patchVm({ status: 'busy', currentTaskId: t.id }, 'busy')

      // ① 预检（§13.1：任一失败快速失败）
      const pre = await bridge.execTemplate(
        this.vm,
        'preflight',
        {
          TASK_DIR: taskDir,
          DRIVE_ROOT: this.driveRoot(),
          TOTAL_BYTES: t.totalBytes ?? 0,
          MODE: t.downloadMode,
        },
        120,
      )
      if (this.isStaleRun(myRun)) return
      const pf = parsePreflight(pre.stdout)
      if (!pf.ok) {
        await applyTaskFailure(t, pf.errorCode, pf.error)
        if (pf.errorCode === 'DRIVE_MOUNT_LOST') this.reauthInBackground()
        await this.releaseSlot()
        return
      }

      // ② 写 job.json（凭据 decrypt 后只进 job.json，绝不进日志/命令行，§12）
      const job = await this.buildJob(t)
      const wj = await bridge.execTemplate(this.vm, 'write_job', { TASK_DIR: taskDir, JOB_JSON: JSON.stringify(job) }, 60)
      if (wj.code !== 0) throw new Error(`write_job 失败: ${tail(wj.stderr || wj.stdout, 300)}`)
      if (this.isStaleRun(myRun)) return

      // ③ 启动后台 worker（setsid nohup，kernel 重启不死，C30）
      const lw = await bridge.execTemplate(this.vm, 'launch_worker', { TASK_DIR: taskDir, JOB: job }, 60)
      if (lw.code !== 0 || !lw.stdout.includes('@@PID@@')) {
        throw new Error(`launch_worker 失败: ${tail(lw.stderr || lw.stdout, 300)}`)
      }
      if (this.isStaleRun(myRun)) {
        // 取消发生在下发途中：补杀刚启动的 worker
        await bridge.execTemplate(this.vm, 'kill_worker', { TASK_DIR: taskDir }, 60).catch(() => {})
        return
      }
      log.info('worker 已启动，挂 tail 流')

      // ④ tail 流（含断连重连），直到终态/失败
      await this.runTailLoop(t, taskDir, myRun)
    } catch (e) {
      if (this.isStaleRun(myRun)) return
      const msg = e instanceof Error ? e.message : String(e)
      log.error({ err: msg }, '任务下发/执行失败')
      await applyTaskFailure(t, 'EXEC_ERROR', msg)
      await this.releaseSlot()
    }
  }

  // ================================================================
  // tail 流与断连恢复（§6.2 第③段 + §6.3）
  // ================================================================

  private async runTailLoop(t: Task, taskDir: string, myRun: number): Promise<void> {
    const { bridge } = coreDeps()
    for (let disconnects = 0; ; ) {
      if (this.isStaleRun(myRun)) return
      const outcome = await this.attachTail(t, taskDir, myRun)
      this.flushNoise(t)
      await this.flushTaskDb(t, true)
      if (this.isStaleRun(myRun)) return
      if (outcome === 'terminal') {
        await this.releaseSlot()
        return
      }

      // 断连：tail done 但无终态。任务保持 downloading，VM → reconnecting（§4：不改任务状态）
      disconnects += 1
      if (disconnects > RECONNECT_BACKOFF_SEC.length) {
        const truth = await this.probeTruth(taskDir)
        if (truth.statusJson) {
          await this.finalizeFromStatusJson(t, truth.statusJson, taskDir)
          await this.releaseSlot()
          return
        }
        await applyTaskFailure(t, 'VM_UNREACHABLE', 'tail 断连重试耗尽')
        await this.patchVm({ status: 'error', errorMsg: 'tail 断连重试耗尽' }, 'error')
        return
      }
      taskLogger(t.id).warn({ disconnects }, 'tail 断连，进入 reconnecting')
      await this.patchVm({ status: 'reconnecting' }, 'reconnecting')
      await sleep(RECONNECT_BACKOFF_SEC[disconnects - 1]! * 1000)
      if (this.isStaleRun(myRun)) return

      if (!(await bridge.sessionExists(this.vm))) {
        await applyTaskFailure(t, 'VM_LOST', 'Colab session 已丢失')
        await this.patchVm({ status: 'error', errorMsg: 'session 丢失' }, 'error')
        return
      }
      // 真相来源顺序：status.json → pid 活着 → failed（§6.3）
      const truth = await this.probeTruth(taskDir)
      if (truth.statusJson) {
        await this.finalizeFromStatusJson(t, truth.statusJson, taskDir)
        await this.releaseSlot()
        return
      }
      if (!truth.alive) {
        await applyTaskFailure(t, 'WORKER_VANISHED', 'worker process vanished')
        await this.releaseSlot()
        return
      }
      await this.patchVm({ status: 'busy' }, 'busy') // 恢复：下一轮带最新 offset 重 tail
    }
  }

  /** 挂一次 tail 流；'terminal' = 已处理终态，'lost' = 流断了但无终态 */
  private attachTail(t: Task, taskDir: string, myRun: number): Promise<'terminal' | 'lost'> {
    const { bridge } = coreDeps()
    const code = bridge.renderTemplate('tail_stream', { WD: taskDir, OFFSET: t.logOffset, IDLE: TAIL_IDLE_SEC })
    return new Promise<'terminal' | 'lost'>((resolve) => {
      let resolved = false
      let lineChain: Promise<void> = Promise.resolve()
      const finish = (kind: 'terminal' | 'lost') => {
        if (resolved) return
        resolved = true
        resolve(kind)
      }
      bridge
        .execStream(this.vm, code, TAIL_TIMEOUT_SEC)
        .then((handle) => {
          if (this.isStaleRun(myRun)) {
            void handle.close().then(() => finish('lost'))
            return
          }
          this.tail = handle
          handle.onLine((line) => {
            // 串行处理行，避免异步 DB 写交错；单行失败不阻断后续行
            lineChain = lineChain
              .then(() => this.onTailLine(t, taskDir, myRun, line, finish))
              .catch((e) => taskLogger(t.id).warn({ err: e }, 'tail 行处理失败（跳过）'))
          })
          handle.done
            .then(() => lineChain)
            .then(() => {
              if (this.tail === handle) this.tail = null
              finish('lost') // 若已 terminal，finish 是幂等空操作
            })
        })
        .catch(() => finish('lost'))
    })
  }

  private async onTailLine(
    t: Task,
    taskDir: string,
    myRun: number,
    line: string,
    finish: (kind: 'terminal' | 'lost') => void,
  ): Promise<void> {
    const parsed = parseTailLine(line)
    if (!parsed) {
      this.pushNoise(t, line)
      return
    }
    if (parsed.offset !== null) t.logOffset = parsed.offset
    if (parsed.noise) this.pushNoise(t, parsed.noise)
    if (parsed.control) {
      await this.onControlLine(t, taskDir, parsed, finish)
      return
    }
    for (const msg of parsed.messages) {
      if (this.isStaleRun(myRun)) return
      if (msg.seq <= this.lastSeq) continue // 重连重放去重（seq 单调，§7.1）
      this.lastSeq = msg.seq
      await this.onWorkerMessage(t, taskDir, msg, finish)
    }
    await this.flushTaskDb(t, false)
  }

  private async onControlLine(
    t: Task,
    taskDir: string,
    parsed: ParsedTail,
    finish: (kind: 'terminal' | 'lost') => void,
  ): Promise<void> {
    const control = parsed.control!
    if (control.type === 'done') {
      // TAILDONE：status.json 内容，幂等判定的唯一依据（即使没收到过流式消息）
      await this.finalizeFromStatusJson(t, control.statusJson ?? '', taskDir)
      finish('terminal')
      return
    }
    if (control.type === 'dead') {
      await applyTaskFailure(t, 'WORKER_VANISHED', 'worker process vanished')
      await this.cleanupTaskDir(taskDir)
      finish('terminal')
      return
    }
    finish('lost') // TAILIDLE：长时间无输出，按断连处理
  }

  private async onWorkerMessage(
    t: Task,
    taskDir: string,
    msg: WorkerMessage,
    finish: (kind: 'terminal' | 'lost') => void,
  ): Promise<void> {
    const { bus } = coreDeps()
    switch (msg.type) {
      case 'hello': {
        t.fileTotal = msg.files_planned
        // preparing → downloading 的依据（§5：worker 回报 hello）
        t.status = 'downloading'
        await getDataSource().getRepository(Task).save(t)
        bus.emitTaskStatus({ taskId: t.id, status: 'downloading' })
        break
      }
      case 'progress': {
        t.downloadedBytes = msg.downloaded
        t.totalBytes = msg.total ?? t.totalBytes
        t.speedBps = msg.speed_bps
        t.etaSec = msg.eta_sec
        t.currentFile = msg.file
        t.fileTotal = msg.file_total || t.fileTotal
        t.progress = t.totalBytes ? Math.min(100, Math.floor((t.downloadedBytes * 100) / t.totalBytes)) : t.progress
        bus.emitProgress({
          taskId: t.id,
          downloaded: t.downloadedBytes,
          total: t.totalBytes,
          speedBps: t.speedBps,
          etaSec: t.etaSec,
          file: t.currentFile,
          fileIndex: msg.file_index,
          fileTotal: t.fileTotal,
          progress: t.progress,
        })
        break
      }
      case 'file': {
        await this.upsertTaskFile(t, msg.file, msg.bytes, msg.status === 'done' ? 'done' : 'failed')
        t.fileDone += 1
        break
      }
      case 'log': {
        const level = msg.level
        await getDataSource()
          .getRepository(DownloadLog)
          .save({ taskId: t.id, level, source: 'vm', message: msg.message.slice(0, 4000) })
        bus.emitLog({ taskId: t.id, level, message: msg.message, ts: Date.now() })
        break
      }
      case 'heartbeat': {
        // 区分「慢」和「死」（§9：last_heartbeat_at）
        this.vm.lastHeartbeatAt = new Date()
        const now = Date.now()
        if (now - this.lastHeartbeatSave >= 30_000) {
          this.lastHeartbeatSave = now
          await this.saveVm()
        }
        break
      }
      case 'status': {
        await this.finalizeTerminal(t, msg, taskDir)
        finish('terminal')
        break
      }
    }
  }

  // ================================================================
  // 终态与恢复判定
  // ================================================================

  /** status.json 内容 → 终态落库（断连恢复的唯一权威依据，§6.3） */
  private async finalizeFromStatusJson(t: Task, statusJson: string, taskDir: string): Promise<void> {
    let payload: TerminalPayload
    try {
      payload = JSON.parse(statusJson) as TerminalPayload
    } catch {
      await applyTaskFailure(t, 'STATUS_PARSE_ERROR', `status.json 解析失败: ${statusJson.slice(0, 200)}`)
      return
    }
    await this.finalizeTerminal(t, payload, taskDir)
  }

  private async finalizeTerminal(t: Task, payload: TerminalPayload, taskDir: string): Promise<void> {
    const { bus } = coreDeps()
    const repo = getDataSource().getRepository(Task)
    if (payload.status === 'completed') {
      t.status = 'completed'
      t.progress = 100
      if (payload.bytes) {
        t.downloadedBytes = payload.bytes
        t.totalBytes = t.totalBytes ?? payload.bytes
      }
      t.speedBps = 0
      t.etaSec = 0
      t.currentFile = null
      t.completedAt = new Date()
      await repo.save(t)
      bus.emitTaskStatus({ taskId: t.id, status: 'completed' })
      taskLogger(t.id).info({ bytes: payload.bytes }, '任务完成')
    } else if (payload.status === 'cancelled') {
      t.status = 'cancelled'
      t.speedBps = 0
      t.etaSec = null
      t.completedAt = new Date()
      await repo.save(t)
      bus.emitTaskStatus({ taskId: t.id, status: 'cancelled' })
    } else {
      await applyTaskFailure(t, payload.error_code ?? 'WORKER_FAILED', payload.error ?? 'worker 失败')
      if (payload.error_code === 'DRIVE_MOUNT_LOST') this.reauthInBackground()
    }
    await this.cleanupTaskDir(taskDir)
    this.lastSeq = 0
  }

  /** 恢复时的真相探测：status.json 存在？pid 活着？（§6.3） */
  private async probeTruth(taskDir: string): Promise<TruthProbe> {
    const { bridge } = coreDeps()
    const code = [
      'import os, json',
      `d = ${JSON.stringify(taskDir)}`,
      'sf = os.path.join(d, "status.json")',
      'pf = os.path.join(d, "worker.pid")',
      'st = open(sf).read().strip() if os.path.exists(sf) else ""',
      'alive = False',
      'try:',
      '    pid = int(open(pf).read().strip())',
      '    os.kill(pid, 0)',
      '    alive = open("/proc/%d/stat" % pid).read().split()[2] != "Z"',
      'except Exception:',
      '    pass',
      'print("@@STATUS@@" + st.replace("\\n", " ") if st else "@@NO_STATUS@@")',
      'print("@@ALIVE@@" + str(alive))',
    ].join('\n')
    try {
      const r = await bridge.exec(this.vm, code, 60)
      const st = r.stdout.match(/^@@STATUS@@(.+)$/m)?.[1] ?? null
      const alive = r.stdout.includes('@@ALIVE@@True')
      return { statusJson: st, alive }
    } catch {
      return { statusJson: null, alive: false }
    }
  }

  /** 清理 TASK_DIR（job.json 含凭据，任务结束即删，§12）；尽力而为 */
  private async cleanupTaskDir(taskDir: string): Promise<void> {
    try {
      await coreDeps().bridge.execTemplate(this.vm, 'cleanup_task', { TASK_DIR: taskDir }, 60)
    } catch (e) {
      taskLogger(this.currentTask?.id ?? 0).warn({ err: e }, 'cleanup_task 失败（忽略）')
    }
  }

  // ================================================================
  // 取消 / 停止 / 对账
  // ================================================================

  /** §6.5：restart-kernel 打断 tail → kill_worker → 写终态 → 清理 → VM 回 idle */
  async cancelCurrent(): Promise<void> {
    const t = this.currentTask
    if (!t) return
    if (this.vmStatus !== 'busy' && this.vmStatus !== 'reconnecting') return
    this.runId++ // 使 assign/tail 逻辑失效
    const { bridge, bus } = coreDeps()
    const log = taskLogger(t.id)
    const taskDir = `${TASK_DIR_BASE}/${t.id}`

    if (this.tail) {
      const h = this.tail
      this.tail = null
      await h.close().catch(() => {}) // 只杀本地进程
    }
    // C1/C30：kernel 被 tail 占着，restart-kernel 打断它；detached worker 不受影响，再单独杀
    await bridge.restartKernel(this.vm).catch((e) => log.warn({ err: e }, 'restart-kernel 失败（继续取消流程）'))
    await bridge.execTemplate(this.vm, 'kill_worker', { TASK_DIR: taskDir }, 60).catch((e) => log.warn({ err: e }, 'kill_worker 失败'))
    await this.cleanupTaskDir(taskDir)

    t.status = 'cancelled'
    t.speedBps = 0
    t.etaSec = null
    t.completedAt = new Date()
    t.cancelRequested = false
    await getDataSource().getRepository(Task).save(t)
    bus.emitTaskStatus({ taskId: t.id, status: 'cancelled' })
    log.info('任务已取消')
    await this.releaseSlot()
  }

  /** force 立即；否则 draining 等当前任务结束（§4） */
  async stop(force = false): Promise<void> {
    if (this.vmStatus === 'stopped' || this.vmStatus === 'stopping') return
    this.stopMode = force ? 'force' : 'drain'
    if (force && this.currentTask) {
      await this.cancelCurrent() // releaseSlot 里会走 doStop
      return
    }
    if (this.currentTask) {
      await this.patchVm({ status: 'draining' }, 'draining')
      return
    }
    await this.doStop()
  }

  /** Reconciler adopt 后的对账（§6.4）：downloading 任务走真相恢复 */
  async reconcile(): Promise<void> {
    const fresh = await getDataSource().getRepository(VM).findOneBy({ id: this.vmId })
    if (fresh) {
      this.vm = fresh
      this.vmStatus = fresh.status
    }
    if (this.vmStatus === 'stopped' || this.vmStatus === 'stopping') return
    if (!this.vm.bootstrapped) {
      await this.start()
      return
    }
    const taskId = this.vm.currentTaskId
    if (taskId) {
      const t = await getDataSource().getRepository(Task).findOneBy({ id: taskId })
      if (t && t.status === 'downloading') {
        const taskDir = `${TASK_DIR_BASE}/${t.id}`
        const truth = await this.probeTruth(taskDir)
        if (truth.statusJson) {
          this.currentTask = t
          await this.finalizeFromStatusJson(t, truth.statusJson, taskDir)
          await this.releaseSlot()
          return
        }
        if (truth.alive) {
          // 进程还活着：重置槽位并从 logOffset 续 tail（§6.4）
          this.currentTask = t
          this.lastSeq = 0
          const myRun = ++this.runId
          await this.patchVm({ status: 'busy' }, 'busy')
          void this.runTailLoop(t, taskDir, myRun).catch((e) => taskLogger(t.id).error({ err: e }, '续 tail 失败'))
          return
        }
        await applyTaskFailure(t, 'WORKER_VANISHED', '服务重启后 worker 进程已消失')
      }
    }
    if (this.vm.driveMounted) {
      await this.patchVm({ status: 'idle', currentTaskId: null }, 'idle')
    } else {
      // 未挂载：重新走授权流程（幂等）
      void this.start()
    }
  }

  // ================================================================
  // 内部工具
  // ================================================================

  private isStaleRun(myRun: number): boolean {
    return myRun !== this.runId
  }

  private isStopping(): boolean {
    return this.vmStatus === 'stopping' || this.vmStatus === 'stopped' || this.stopMode === 'force'
  }

  private async doStop(): Promise<void> {
    const { bridge } = coreDeps()
    await this.patchVm({ status: 'stopping', currentTaskId: null }, 'stopping')
    await coreDeps().driveAuth.cancel(this.vmId).catch(() => {})
    await bridge.stopSession(this.vm).catch((e) => vmLogger(this.vmId).warn({ err: e }, 'colab stop 失败'))
    await this.patchVm({ status: 'stopped', driveMounted: false }, 'stopped')
  }

  private async releaseSlot(): Promise<void> {
    this.currentTask = null
    this.tail = null
    this.noiseBuf = []
    if (this.stopMode !== 'none') {
      await this.doStop()
      return
    }
    // DRIVE_MOUNT_LOST 触发的后台重授权正在接管状态机，不能覆盖成 idle
    if (this.reauthPending) return
    await this.patchVm({ status: 'idle', currentTaskId: null }, 'idle')
  }

  private async buildJob(t: Task): Promise<Record<string, unknown>> {
    let token: string | null = null
    if (t.credentialId) {
      const cred = await getDataSource().getRepository(Credential).findOneBy({ id: t.credentialId })
      if (cred) token = decrypt(cred.valueEnc) // 只进 job.json（chmod 600），绝不进日志
    }
    return {
      tid: t.id,
      name: t.name,
      source_type: t.sourceType,
      source_url: t.sourceUrl,
      revision: t.revision,
      allow_patterns: t.allowPatterns ? (JSON.parse(t.allowPatterns) as unknown) : null,
      ignore_patterns: t.ignorePatterns ? (JSON.parse(t.ignorePatterns) as unknown) : null,
      drive_root: this.driveRoot(),
      dest_path: t.destPath,
      download_mode: t.downloadMode,
      resume_offset: t.resumeOffset,
      token,
      enable_torrent: await getSettingBool('enable_torrent', false),
    }
  }

  private async upsertTaskFile(t: Task, relPath: string, bytes: number, status: 'done' | 'failed'): Promise<void> {
    try {
      const repo = getDataSource().getRepository(TaskFile)
      let row = await repo.findOneBy({ taskId: t.id, relPath })
      if (!row) {
        row = repo.create({ taskId: t.id, relPath, bytes, status, completedAt: new Date() })
      } else {
        row.bytes = bytes
        row.status = status
        row.completedAt = new Date()
      }
      await repo.save(row)
    } catch (e) {
      taskLogger(t.id).warn({ err: e }, 'TaskFile 落库失败（忽略）')
    }
  }

  /** 进度落库节流：5s 或强制（§8.1 三级节流第 3 层） */
  private async flushTaskDb(t: Task, force: boolean): Promise<void> {
    const now = Date.now()
    if (!force && now - this.lastDbFlush < DB_FLUSH_MS) return
    this.lastDbFlush = now
    try {
      await getDataSource().getRepository(Task).save(t)
    } catch (e) {
      taskLogger(t.id).warn({ err: e }, '进度落库失败（忽略）')
    }
  }

  /** noise（tqdm/库输出）降级为 DownloadLog，限流 2s 一条（§7.2） */
  private pushNoise(t: Task, text: string): void {
    const trimmed = text.trim()
    if (!trimmed) return
    this.noiseBuf.push(trimmed.slice(0, 1000))
    if (Date.now() - this.lastNoiseFlush >= NOISE_FLUSH_MS) this.flushNoise(t)
  }

  private flushNoise(t: Task): void {
    if (this.noiseBuf.length === 0) return
    const message = this.noiseBuf.splice(0).join('\n').slice(0, 4000)
    this.lastNoiseFlush = Date.now()
    const repo = getDataSource().getRepository(DownloadLog)
    void repo
      .save({ taskId: t.id, level: 'info', source: 'vm', message })
      .then(() => coreDeps().bus.emitLog({ taskId: t.id, level: 'info', message, ts: Date.now() }))
      .catch(() => {})
  }

  /** VM 行更新：status 变化即落库 + SSE 广播；save 串行化防交错 */
  private async patchVm(patch: Partial<VM>, status?: VMStatus): Promise<void> {
    Object.assign(this.vm, patch)
    if (status) this.vmStatus = status
    this.vm.status = this.vmStatus
    await this.saveVm()
    coreDeps().bus.emitVMStatus({
      vmId: this.vmId,
      status: this.vmStatus,
      currentTaskId: this.vm.currentTaskId ?? null,
      sessionName: this.vm.sessionName,
      driveAuthState: this.vm.driveAuthState,
    })
  }

  private saveVm(): Promise<void> {
    this.vmSaveChain = this.vmSaveChain.then(async () => {
      try {
        await getDataSource().getRepository(VM).save(this.vm)
      } catch (e) {
        vmLogger(this.vmId).warn({ err: e }, 'VM 落库失败（忽略）')
      }
    })
    return this.vmSaveChain
  }
}

function tail(s: string, n: number): string {
  return s.length <= n ? s : s.slice(-n)
}

/** 解析 preflight 输出；解析失败按可重试的 PREFLIGHT_FAILED 处理 */
function parsePreflight(stdout: string): { ok: boolean; errorCode: string; error: string } {
  const m = stdout.match(/@@PREFLIGHT@@(\{.*\})/)
  if (!m) return { ok: false, errorCode: 'PREFLIGHT_FAILED', error: `预检无输出: ${tail(stdout, 200)}` }
  try {
    const r = JSON.parse(m[1]!) as { ok: boolean; error_code?: string | null; error?: string | null }
    return { ok: r.ok, errorCode: r.error_code ?? 'PREFLIGHT_FAILED', error: r.error ?? '预检失败' }
  } catch {
    return { ok: false, errorCode: 'PREFLIGHT_FAILED', error: `预检输出解析失败: ${tail(stdout, 200)}` }
  }
}
