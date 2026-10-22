import type { VM } from '../entities/VM'
import { renderTemplate as renderTpl } from './assets'
import type {
  ColabBridge,
  ColabSessionInfo,
  DriveMountHandle,
  ExecResult,
  StreamHandle,
} from './ColabBridge'

/**
 * MockColabBridge —— 内存模拟（DESIGN.md §15.1）。
 * 走与 Real 完全相同的接口与行协议（@@OFF@@<offset>\t@@CDM@@{...}），
 * 故障注入：JOB.name 含 `mockfail` → 50% 时 status failed(SOURCE_NOT_FOUND)；
 *           含 `mockstall` → 30% 时 40s 无输出。
 */

interface MockJobLite {
  tid: number
  name?: string
  source_type?: string
}

interface MockLine {
  text: string
  endOffset: number
}

interface MockFile {
  name: string
  bytes: number
}

type DownloadState = 'running' | 'stalled' | 'completed' | 'failed' | 'cancelled' | 'dead'

class MockDownload {
  readonly taskDir: string
  readonly vmName: string
  readonly tid: number
  readonly files: MockFile[]
  readonly totalBytes: number
  private readonly baseSpeed: number
  private readonly failAt50: boolean
  private readonly stallOnce: boolean

  state: DownloadState = 'running'
  downloaded = 0
  seq = 0
  fileIdx = 0 // 当前文件下标（0-based）
  fileDone = 0
  lines: MockLine[] = []
  private offset = 0
  private tickCount = 0
  private stallUntil = 0
  private stallUsed = false
  private failUsed = false
  private timer: ReturnType<typeof setInterval> | null = null
  statusJson = ''

  constructor(taskDir: string, vmName: string, job: MockJobLite) {
    this.taskDir = taskDir
    this.vmName = vmName
    this.tid = job.tid
    this.files = buildFiles(job.source_type ?? 'http')
    this.totalBytes = this.files.reduce((s, f) => s + f.bytes, 0)
    this.baseSpeed = (80 + Math.random() * 40) * 1024 * 1024 // 80-120 MB/s
    const name = job.name ?? ''
    this.failAt50 = name.includes('mockfail')
    this.stallOnce = name.includes('mockstall')
  }

  start(): void {
    this.push({ type: 'hello', pid: 4000 + Math.floor(Math.random() * 1000), source_type: 'mock', files_planned: this.files.length })
    this.timer = setInterval(() => this.tick(), 1000)
    this.timer.unref?.()
  }

  private push(msg: Record<string, unknown>): void {
    this.seq += 1
    const rec = { v: 1, tid: this.tid, seq: this.seq, ts: Date.now() / 1000, ...msg }
    const text = `@@CDM@@${JSON.stringify(rec)}`
    this.offset += Buffer.byteLength(text) + 1
    this.lines.push({ text, endOffset: this.offset })
  }

  private finish(state: DownloadState, msg: Record<string, unknown>): void {
    if (this.state !== 'running' && this.state !== 'stalled') return
    this.state = state
    this.push({ type: 'status', status: state, ...msg })
    this.statusJson = this.lines[this.lines.length - 1]!.text.slice('@@CDM@@'.length)
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  cancel(): void {
    this.finish('cancelled', {})
  }

  markDead(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.state = 'dead'
  }

  private currentFileName(): string | null {
    return this.files[this.fileIdx]?.name ?? null
  }

  private tick(): void {
    if (this.state === 'stalled') {
      if (Date.now() < this.stallUntil) return
      this.state = 'running'
    }
    if (this.state !== 'running') return
    this.tickCount += 1

    // 速度带 ±30% 抖动
    const chunk = Math.floor(this.baseSpeed * (0.7 + Math.random() * 0.6))
    this.downloaded = Math.min(this.totalBytes, this.downloaded + chunk)

    // 跨文件边界 → file done 事件
    let cum = 0
    let idx = 0
    for (const f of this.files) {
      cum += f.bytes
      if (this.downloaded < cum) break
      idx += 1
    }
    while (this.fileIdx < Math.min(idx, this.files.length - 1)) {
      const f = this.files[this.fileIdx]!
      this.push({ type: 'file', file: f.name, bytes: f.bytes, status: 'done' })
      this.fileIdx += 1
      this.fileDone += 1
    }

    const total = this.totalBytes
    const speed = chunk
    const eta = speed > 0 ? Math.max(0, Math.round((total - this.downloaded) / speed)) : null
    this.push({
      type: 'progress',
      downloaded: this.downloaded,
      total,
      speed_bps: speed,
      eta_sec: eta,
      file: this.currentFileName(),
      file_index: this.fileIdx + 1,
      file_total: this.files.length,
    })

    if (this.tickCount % 30 === 0) {
      this.push({ type: 'heartbeat', downloaded: this.downloaded })
    }

    // 故障注入：50% 处失败
    if (this.failAt50 && !this.failUsed && this.downloaded >= total / 2 && this.downloaded < total) {
      this.failUsed = true
      this.finish('failed', { error_code: 'SOURCE_NOT_FOUND', error: 'mock: 注入的源不存在（mockfail）' })
      return
    }
    // 故障注入：30% 处 40s 无输出
    if (this.stallOnce && !this.stallUsed && this.downloaded >= total * 0.3) {
      this.stallUsed = true
      this.state = 'stalled'
      this.stallUntil = Date.now() + 40_000
      return
    }

    if (this.downloaded >= total) {
      const last = this.files[this.files.length - 1]!
      this.push({ type: 'file', file: last.name, bytes: last.bytes, status: 'done' })
      this.fileDone = this.files.length
      this.finish('completed', { bytes: total, duration_sec: this.tickCount, dest: `/content/drive/MyDrive/mock/${this.tid}` })
    }
  }
}

function buildFiles(sourceType: string): MockFile[] {
  const MB = 1024 * 1024
  if (sourceType === 'huggingface') {
    const n = 3 + Math.floor(Math.random() * 5) // 3-7 个文件
    const total = 2.5 * 1024 * MB // 2.5GB
    const files: MockFile[] = [{ name: 'config.json', bytes: 2 * MB }]
    const rest = total - 2 * MB
    for (let i = 1; i <= n; i++) {
      files.push({ name: `model-0000${i}-of-0000${n}.safetensors`, bytes: Math.floor(rest / n) })
    }
    return files
  }
  if (sourceType === 'http' || sourceType === 'github') {
    return [{ name: 'model.bin', bytes: Math.floor(1.2 * 1024 * MB) }]
  }
  return [{ name: 'download.bin', bytes: 800 * MB }]
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class MockColabBridge implements ColabBridge {
  readonly mock = true
  private sessions = new Map<string, ColabSessionInfo>()
  private downloads = new Map<string, MockDownload>() // key: TASK_DIR

  async newSession(vm: VM): Promise<ColabSessionInfo> {
    await delay(2000) // 模拟 colab new 的耗时（实测 15.9s，mock 加速）
    const info: ColabSessionInfo = {
      name: vm.sessionName,
      endpoint: `mock-${vm.sessionName}`,
      accelerator: vm.runtimeType !== 'cpu' ? vm.runtimeType : undefined,
    }
    this.sessions.set(vm.sessionName, info)
    return info
  }

  async stopSession(vm: VM): Promise<void> {
    await delay(200)
    this.sessions.delete(vm.sessionName)
    // VM 停了上面的进程全灭（tail 端会看到 TAILDEAD）
    for (const d of this.downloads.values()) {
      if (d.vmName === vm.sessionName) d.markDead()
    }
  }

  async restartKernel(_vm: VM): Promise<void> {
    // C30：restart-kernel 不杀 detached worker，mock 无操作
    await delay(200)
  }

  async listSessions(): Promise<ColabSessionInfo[]> {
    return [...this.sessions.values()]
  }

  async sessionExists(vm: VM): Promise<boolean> {
    return this.sessions.has(vm.sessionName)
  }

  async exec(_vm: VM, _code: string, _timeoutSec?: number): Promise<ExecResult> {
    await delay(200)
    return { code: 0, stdout: '', stderr: '' }
  }

  async execTemplate(
    vm: VM,
    templateName: string,
    vars: Record<string, unknown>,
    _timeoutSec?: number,
  ): Promise<ExecResult> {
    await delay(300)
    if (templateName === 'launch_worker') {
      const taskDir = String(vars.TASK_DIR)
      const job = (vars.JOB ?? {}) as MockJobLite
      const d = new MockDownload(taskDir, vm.sessionName, job)
      this.downloads.set(taskDir, d)
      d.start()
      return { code: 0, stdout: `@@PID@@${4000 + this.downloads.size}\n`, stderr: '' }
    }
    if (templateName === 'kill_worker') {
      const d = this.downloads.get(String(vars.TASK_DIR))
      d?.cancel()
      return { code: 0, stdout: '@@KILLED@@\n', stderr: '' }
    }
    if (templateName === 'preflight') {
      const out = { ok: true, drive_free: 200 * 1024 ** 3, drive_total: 250 * 1024 ** 3, vm_free: 100 * 1024 ** 3, error_code: null, error: null }
      return { code: 0, stdout: `@@PREFLIGHT@@${JSON.stringify(out)}\n`, stderr: '' }
    }
    if (templateName === 'probe_mount') {
      return { code: 0, stdout: 'OK\n', stderr: '' }
    }
    // deploy_lib / write_job / cleanup_task 等：直接成功
    return { code: 0, stdout: '', stderr: '' }
  }

  /**
   * 解析渲染后的 tail_stream 代码里的 WD/OFFSET/IDLE，
   * 从模拟下载的行日志按 offset 续读（与真实 tail 脚本同一协议）。
   */
  execStream(_vm: VM, code: string, _timeoutSec: number): Promise<StreamHandle> {
    const wd = JSON.parse(code.match(/WD\s*=\s*("(?:[^"\\]|\\.)*")/)?.[1] ?? '""') as string
    const offset = Number(code.match(/OFFSET\s*=\s*(\d+)/)?.[1] ?? '0')
    const idle = Number(code.match(/IDLE_TIMEOUT\s*=\s*(\d+)/)?.[1] ?? '300')

    const lineCbs: Array<(line: string) => void> = []
    const pending: string[] = []
    const emit = (line: string) => {
      if (lineCbs.length === 0) pending.push(line)
      else for (const cb of lineCbs) cb(line)
    }

    let resolveDone: (r: { code: number }) => void
    const done = new Promise<{ code: number }>((res) => (resolveDone = res))
    let closed = false
    const settle = (code: number) => {
      if (closed) return
      closed = true
      clearInterval(timer)
      resolveDone({ code })
    }

    const download = this.downloads.get(wd)
    if (!download) {
      // 任务目录不存在 = 进程从未启动过
      setTimeout(() => {
        emit('@@OFF@@0\t@@TAILDEAD@@ worker process vanished')
        settle(0)
      }, 50)
    }

    let cursor = 0
    let lastEmit = Date.now()
    const timer = setInterval(() => {
      if (!download) return
      if (cursor === 0) {
        // 定位续读起点：第一条 endOffset > OFFSET 的行
        cursor = download.lines.findIndex((l) => l.endOffset > offset)
        if (cursor === -1) cursor = download.lines.length
      }
      while (cursor < download.lines.length) {
        const l = download.lines[cursor]!
        emit(`@@OFF@@${l.endOffset}\t${l.text}`)
        lastEmit = Date.now()
        cursor += 1
      }
      const drained = cursor >= download.lines.length
      const finalOffset = download.lines[download.lines.length - 1]?.endOffset ?? offset
      if (drained && (download.state === 'completed' || download.state === 'failed' || download.state === 'cancelled')) {
        emit(`@@OFF@@${finalOffset}\t@@TAILDONE@@ ${download.statusJson}`)
        settle(0)
        return
      }
      if (drained && download.state === 'dead') {
        emit(`@@OFF@@${finalOffset}\t@@TAILDEAD@@ worker process vanished`)
        settle(0)
        return
      }
      if (Date.now() - lastEmit > idle * 1000) {
        emit(`@@OFF@@${finalOffset}\t@@TAILIDLE@@`)
        settle(0)
      }
    }, 100)
    timer.unref?.()

    const handle: StreamHandle = {
      onLine(cb) {
        lineCbs.push(cb)
        if (pending.length > 0) {
          const flush = pending.splice(0, pending.length)
          for (const line of flush) cb(line)
        }
      },
      async close() {
        settle(-1)
      },
      done,
    }
    return Promise.resolve(handle)
  }

  async install(_vm: VM, _packages: string[]): Promise<ExecResult> {
    await delay(300)
    return { code: 0, stdout: '', stderr: '' }
  }

  renderTemplate(templateName: string, vars: Record<string, unknown>): string {
    return renderTpl(templateName, vars)
  }

  /** 模拟真实授权链路的时间线（spike-report §6：捕获 URI ~5.8s，确认后 ~11s 挂载） */
  startDriveMount(vm: VM): DriveMountHandle {
    const cbs: Array<(chunk: string) => void> = []
    const emit = (s: string) => {
      for (const cb of cbs) cb(s)
    }
    const timers: ReturnType<typeof setTimeout>[] = []
    const later = (ms: number, fn: () => void) => {
      const t = setTimeout(fn, ms)
      t.unref?.()
      timers.push(t)
    }

    later(500, () => {
      emit(`\n[colab] REQUIRED: Google Drive Authorization needed.\nPlease visit:\n\n${fakeAuthUri(vm.sessionName)}\n`)
      emit('Press Enter after you have granted access... ')
    })

    return {
      onData(cb) {
        cbs.push(cb)
      },
      write(s: string) {
        if (!s.includes('\n')) return
        later(1000, () => emit('\n[colab] Credentials propagated. Resuming mount...\n'))
        later(3000, () => emit('Mounted at /content/drive\n'))
      },
      kill() {
        for (const t of timers) clearTimeout(t)
      },
    }
  }
}

/** 伪造一条 ~1400 字符的授权 URI（C26：实测 1415 字符，UI 要按这个长度设计） */
function fakeAuthUri(sessionName: string): string {
  const state = Buffer.from(
    JSON.stringify({ endpoint: `mock-${sessionName}`, auth_version: 1, t: Date.now() }),
  ).toString('base64url')
  const base =
    'https://accounts.google.com/o/oauth2/v2/auth?access_type=offline' +
    `&client_id=${'0'.repeat(12)}-${'a'.repeat(32)}.apps.googleusercontent.com` +
    '&enable_granular_consent=true&prompt=consent' +
    '&redirect_uri=https%3A%2F%2Fcolab.research.google.com%2Ftun%2Fm%2Fauthorize-for-drive-credentials-ephem' +
    '&response_type=none+gsession' +
    '&scope=email+https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive+https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.activity+https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.photos.readonly' +
    `&state=${encodeURIComponent(state)}`
  // 用填充参数凑到真实长度附近
  const padLen = Math.max(0, 1400 - base.length - 6)
  return `${base}&mockpad=${'x'.repeat(padLen)}`
}
