import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import type { ColabBridge, DriveMountHandle } from '../colab/ColabBridge'
import { VM, type DriveAuthState } from '../entities/VM'
import { getDataSource } from '../utils/db'
import { redact, vmLogger } from '../utils/logger'
import type { ProgressBus } from './ProgressBus'

/**
 * DriveAuthManager —— PTY 授权会话注册表（DESIGN.md §6.0.5）。
 *
 * `colab drivemount` 未授权时阻塞在 /dev/tty（C7），必须持有 PTY 进程：
 * 捕获授权 URI → 用户浏览器授权 → confirm 写 "\n" → 凭据传播 → Mounted at。
 * 成功判定 = 输出出现 `Credentials propagated` 且 `Mounted at`
 * （挂载点写探针是第二重判定，由 VMWorker 做，此处只负责到 Mounted at）。
 */

export interface DriveAuthSession {
  vmId: number
  state: DriveAuthState
  authUri: string | null
  expiresAt: Date | null
  error: string | null
}

interface Waiter {
  resolve: (s: DriveAuthSession) => void
  reject: (e: Error) => void
}

interface Internal {
  vmId: number
  sessionName: string
  state: DriveAuthState
  authUri: string | null
  expiresAt: Date | null
  error: string | null
  handle: DriveMountHandle | null
  logStream: WriteStream | null
  propagatedSeen: boolean
  /** 滚动缓冲：授权 URI 有 1400+ 字符，可能横跨两个 data 事件，匹配必须在累积文本上做 */
  buf: string
  timers: Array<ReturnType<typeof setTimeout>>
  waiters: Waiter[]
}

const AUTH_URI_RE = /(https:\/\/accounts\.google\.com\/o\/oauth2\/\S+)/
const AUTH_TIMEOUT_MS = 600_000 // C25/§6.0.5：CLI 侧 600s 硬超时
const URI_WAIT_MS = 90_000 // requesting 状态等 URI 的兜底（实测 5.8s）
const PROPAGATE_WAIT_MS = 120_000 // 确认后等 Mounted at 的兜底（实测 11s）

/** 活跃状态：这些状态下重复 start 幂等返回现有会话 */
const ACTIVE_STATES: DriveAuthState[] = ['requesting', 'awaiting_user', 'propagating', 'mounted']

export class DriveAuthManager {
  private registry = new Map<number, Internal>()

  constructor(
    private bridge: ColabBridge,
    private bus: ProgressBus,
  ) {}

  get(vmId: number): DriveAuthSession | undefined {
    const s = this.registry.get(vmId)
    return s ? this.snapshot(s) : undefined
  }

  list(): DriveAuthSession[] {
    return [...this.registry.values()].map((s) => this.snapshot(s))
  }

  /** 服务重启后调用：PTY 随进程死亡，清空注册表（§6.0.5） */
  resetAll(): void {
    for (const s of this.registry.values()) this.teardown(s)
    this.registry.clear()
  }

  /** 幂等：已有活跃会话直接返回现有 authUri，不重复起 PTY */
  async start(vmId: number): Promise<DriveAuthSession> {
    const existing = this.registry.get(vmId)
    if (existing && ACTIVE_STATES.includes(existing.state)) return this.snapshot(existing)
    if (existing) this.teardown(existing)

    const vm = await getDataSource().getRepository(VM).findOneBy({ id: vmId })
    if (!vm) throw new Error(`VM ${vmId} 不存在`)
    const log = vmLogger(vmId)

    const s: Internal = {
      vmId,
      sessionName: vm.sessionName,
      state: 'requesting',
      authUri: null,
      expiresAt: null,
      error: null,
      handle: null,
      logStream: null,
      propagatedSeen: false,
      buf: '',
      timers: [],
      waiters: [], // 旧会话的 waiter 已在 teardown 中被拒绝
    }
    this.registry.set(vmId, s)

    // 全量 PTY 输出留档（排障唯一线索）
    try {
      const dir = join(process.cwd(), 'logs', 'colab', String(vmId))
      mkdirSync(dir, { recursive: true })
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      s.logStream = createWriteStream(join(dir, `drive-auth-${ts}.log`), { flags: 'a' })
    } catch {
      s.logStream = null
    }

    const handle = this.bridge.startDriveMount(vm)
    s.handle = handle
    handle.onData((chunk) => this.onChunk(s, chunk))
    this.setState(s, 'requesting')

    // 等 URI 的兜底定时器：90s 没抓到 URI 视为失败（CLI 报错/认证失效）
    s.timers.push(
      setTimeout(() => {
        if (s.state === 'requesting') this.fail(s, '90s 内未捕获到授权 URI（CLI 可能已报错，详见 drive-auth 日志）')
      }, URI_WAIT_MS),
    )
    log.info('drive 授权会话已启动')
    return this.snapshot(s)
  }

  /** 用户已在浏览器完成授权 → 向挂起的 PTY 写回车（对应 CLI 的 tty.readline()） */
  async confirm(vmId: number): Promise<DriveAuthSession> {
    const s = this.registry.get(vmId)
    if (!s) throw new Error(`VM ${vmId} 没有活跃的授权会话`)
    if (s.state !== 'awaiting_user') throw new Error(`当前状态 ${s.state} 不能确认（需要 awaiting_user）`)
    s.handle?.write('\n')
    this.setState(s, 'propagating')
    // C25：确认后约 11s 才 Mounted at；给 120s 兜底
    s.timers.push(
      setTimeout(() => {
        if (s.state === 'propagating') this.fail(s, '确认后 120s 未挂载成功（用户可能未完成授权）')
      }, PROPAGATE_WAIT_MS),
    )
    return this.snapshot(s)
  }

  /** 放弃授权并杀 PTY */
  async cancel(vmId: number): Promise<void> {
    const s = this.registry.get(vmId)
    if (!s) return
    this.teardown(s)
    this.registry.delete(vmId)
    // 通知前端回到 none（DriveAuthState 无 cancelled 值，用 none 表示无会话）
    this.bus.emitDriveAuth({ vmId, sessionName: s.sessionName, state: 'none' })
    await this.syncVmAuthState(vmId, 'none')
  }

  /** VMWorker 等待挂载完成（到 Mounted at 为止；超时/失败抛错） */
  waitUntilMounted(vmId: number, timeoutMs = AUTH_TIMEOUT_MS + 60_000): Promise<DriveAuthSession> {
    const s = this.registry.get(vmId)
    if (!s) return Promise.reject(new Error(`VM ${vmId} 没有活跃的授权会话`))
    if (s.state === 'mounted') return Promise.resolve(this.snapshot(s))
    if (s.state === 'failed' || s.state === 'timeout') {
      return Promise.reject(new Error(s.error ?? `授权会话已 ${s.state}`))
    }
    return new Promise<DriveAuthSession>((resolve, reject) => {
      s.waiters.push({ resolve, reject })
      const timer = setTimeout(() => {
        reject(new Error('等待挂载完成超时'))
      }, timeoutMs)
      timer.unref?.()
      s.timers.push(timer)
    })
  }

  // ---- 内部 ----

  private onChunk(s: Internal, chunk: string): void {
    try {
      s.logStream?.write(redact(chunk))
    } catch {
      /* 日志失败不阻断 */
    }
    // 累积匹配（URI/标志行可能跨 chunk），缓冲封顶防膨胀
    s.buf += chunk
    if (s.buf.length > 256 * 1024) s.buf = s.buf.slice(-128 * 1024)

    if (!s.authUri) {
      const m = s.buf.match(AUTH_URI_RE)
      if (m) {
        s.authUri = m[1]!.trim()
        // CLI 侧 600s 硬超时：到期自动清理 → timeout（§6.0.5）
        s.expiresAt = new Date(Date.now() + AUTH_TIMEOUT_MS)
        this.setState(s, 'awaiting_user')
        s.timers.push(
          setTimeout(() => {
            if (s.state === 'awaiting_user') this.timeout(s)
          }, AUTH_TIMEOUT_MS),
        )
      }
    }
    if (/Credentials propagated/i.test(s.buf)) s.propagatedSeen = true
    // 成功判定：Credentials propagated 且 Mounted at（罕见直放行：已挂载提示也算）
    if (s.propagatedSeen && /Mounted at/i.test(s.buf)) this.mounted(s)
    else if (/Drive already mounted|drive is already mounted/i.test(s.buf)) this.mounted(s)
  }

  private mounted(s: Internal): void {
    if (s.state === 'mounted') return
    this.setState(s, 'mounted')
    this.clearTimers(s)
    const snap = this.snapshot(s)
    for (const w of s.waiters.splice(0)) w.resolve(snap)
  }

  private fail(s: Internal, error: string): void {
    this.setState(s, 'failed', error)
    this.killPty(s)
    this.clearTimers(s)
    for (const w of s.waiters.splice(0)) w.reject(new Error(error))
  }

  private timeout(s: Internal): void {
    this.setState(s, 'timeout', '授权超时（10 分钟未完成），请重新发起')
    this.killPty(s)
    this.clearTimers(s)
    for (const w of s.waiters.splice(0)) w.reject(new Error('授权超时'))
  }

  private setState(s: Internal, state: DriveAuthState, error: string | null = null): void {
    s.state = state
    if (error !== null) s.error = error
    this.bus.emitDriveAuth({
      vmId: s.vmId,
      sessionName: s.sessionName,
      state,
      authUri: s.authUri,
      expiresAt: s.expiresAt?.toISOString() ?? null,
      error: s.error,
    })
    void this.syncVmAuthState(s.vmId, state)
  }

  /** 同步 vm.drive_auth_state（尽力而为；VMWorker 仍拥有 status 字段） */
  private async syncVmAuthState(vmId: number, state: DriveAuthState): Promise<void> {
    try {
      await getDataSource().getRepository(VM).update({ id: vmId }, { driveAuthState: state })
    } catch {
      /* DB 未就绪时忽略 */
    }
  }

  private clearTimers(s: Internal): void {
    for (const t of s.timers) clearTimeout(t)
    s.timers = []
  }

  private killPty(s: Internal): void {
    try {
      s.handle?.kill()
    } catch {
      /* 已死 */
    }
    s.handle = null
  }

  private teardown(s: Internal): void {
    this.clearTimers(s)
    this.killPty(s)
    try {
      s.logStream?.end()
    } catch {
      /* ignore */
    }
    for (const w of s.waiters.splice(0)) w.reject(new Error('授权会话已取消'))
  }

  private snapshot(s: Internal): DriveAuthSession {
    return { vmId: s.vmId, state: s.state, authUri: s.authUri, expiresAt: s.expiresAt, error: s.error }
  }
}
