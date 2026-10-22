import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, createWriteStream, mkdirSync, readdirSync, type WriteStream } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { VM } from '../entities/VM'
import { redact } from '../utils/logger'
import { renderTemplate as renderTpl } from './assets'
import type {
  ColabBridge,
  ColabSessionInfo,
  DriveMountHandle,
  ExecResult,
  StreamHandle,
} from './ColabBridge'

/** GPU / TPU 枚举（C15，未识别的 --gpu 会被静默回退 A100，必须校验） */
const GPU_TYPES = new Set(['T4', 'L4', 'G4', 'H100', 'A100'])
const TPU_TYPES = new Set(['v5e1', 'v6e1'])

/** 短命令默认超时（C3/C4：显式大正数，绝不传 0） */
const DEFAULT_EXEC_TIMEOUT = 120

function cliLogDir(vmId: number): string {
  const dir = join(process.cwd(), 'logs', 'colab', String(vmId))
  mkdirSync(dir, { recursive: true })
  return dir
}

function logFilePath(vmId: number, cmd: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  return join(cliLogDir(vmId), `${ts}-${cmd}.log`)
}

/** CLI 原始输出留存（§14：排障唯一线索），内容脱敏 */
function appendCliLog(vmId: number, cmd: string, text: string): void {
  try {
    appendFileSync(logFilePath(vmId, cmd), redact(text))
  } catch {
    /* 日志失败不阻断主流程 */
  }
}

/** shell 单引号引用（script -qec 的内层命令拼接用，同 spike/pty-runner.mjs） */
function shellQuote(s: string): string {
  return /[\s"'$]/.test(s) ? `'${s.replace(/'/g, `'\\''`)}'` : s
}

export class RealColabBridge implements ColabBridge {
  readonly mock = false
  /** listSessions 的 --json 支持探测结果（unknown → 首次调用时探测） */
  private jsonSessions: boolean | null = null

  private bin(): string {
    return useRuntimeConfig().colabBin || 'colab'
  }

  private auth(): string {
    // C14/C21：必须显式传 --auth，不依赖默认值
    return useRuntimeConfig().colabAuth || 'oauth2'
  }

  /** C13：每台 VM 独立 --config 文件，隔离 sessions.json */
  private baseArgs(vm: VM): string[] {
    return ['--config', vm.configPath, '--auth', this.auth()]
  }

  /** 跑一条一次性命令：收集全部输出，写日志，带本地看门狗（CLI 认证可能卡死） */
  private run(
    vm: VM,
    args: string[],
    cmdTag: string,
    opts: { input?: string; watchdogMs?: number } = {},
  ): Promise<ExecResult> {
    const fullArgs = [...this.baseArgs(vm), ...args]
    return new Promise<ExecResult>((resolve) => {
      const child = spawn(this.bin(), fullArgs, { stdio: ['pipe', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      let finished = false
      const watchdog = setTimeout(
        () => {
          if (finished) return
          stderr += '\n[cdm] local watchdog timeout, process killed'
          child.kill('SIGKILL')
        },
        opts.watchdogMs ?? 300_000,
      )
      const done = (code: number | null) => {
        if (finished) return
        finished = true
        clearTimeout(watchdog)
        appendCliLog(vm.id, cmdTag, `$ colab ${fullArgs.join(' ')}\n${stdout}${stderr}`)
        resolve({ code: code ?? -1, stdout, stderr })
      }
      child.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf8')))
      child.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')))
      child.on('error', (e) => {
        stderr += `\n[cdm] spawn error: ${e.message}`
        done(-1)
      })
      child.on('close', (code) => done(code))
      if (opts.input !== undefined) {
        child.stdin.write(opts.input)
      }
      child.stdin.end()
    })
  }

  /** C4：timeout 一律显式大正数；0 / 负数会被 CLI 当成 30 秒，这里兜底 */
  private clampTimeout(timeoutSec: number | undefined, fallback = DEFAULT_EXEC_TIMEOUT): number {
    if (!timeoutSec || timeoutSec <= 0) return fallback
    return Math.floor(timeoutSec)
  }

  async newSession(vm: VM): Promise<ColabSessionInfo> {
    const args = ['new', '-s', vm.sessionName]
    if (GPU_TYPES.has(vm.runtimeType)) args.push('--gpu', vm.runtimeType)
    else if (TPU_TYPES.has(vm.runtimeType)) args.push('--tpu', vm.runtimeType)
    const r = await this.run(vm, args, 'new', { watchdogMs: 180_000 })
    if (r.code !== 0) {
      throw new Error(`colab new 失败(code=${r.code}): ${(r.stderr || r.stdout).slice(-500)}`)
    }
    // endpoint/accelerator 尽力解析（CLI 输出格式未文档化，宽容匹配）
    const ep = r.stdout.match(/endpoint[=:"'\s]+([a-z0-9-]{8,})/i) ?? r.stdout.match(/\b(m-s-[a-z0-9-]+)\b/i)
    return {
      name: vm.sessionName,
      endpoint: ep?.[1],
      accelerator: vm.runtimeType !== 'cpu' ? vm.runtimeType : undefined,
    }
  }

  async stopSession(vm: VM): Promise<void> {
    await this.run(vm, ['stop', '-s', vm.sessionName], 'stop')
  }

  async restartKernel(vm: VM): Promise<void> {
    await this.run(vm, ['restart-kernel', '-s', vm.sessionName], 'restart-kernel')
  }

  /**
   * 全局 session 列表（Reconciler 对账用）。
   * C13：每个 VM 的 session 只记录在各自的 --config 文件里，
   * 因此扫描 CDM 配置目录下全部 config 逐个查询后合并（C17：低频调用，可接受）。
   */
  async listSessions(): Promise<ColabSessionInfo[]> {
    const out = new Map<string, ColabSessionInfo>()
    for (const configPath of this.cdmConfigFiles()) {
      const probe = { id: 0, configPath, sessionName: '' } as VM
      try {
        for (const s of await this.listSessionsWith(probe)) {
          if (!out.has(s.name)) out.set(s.name, s)
        }
      } catch {
        /* 单个 config 损坏不阻断整体对账 */
      }
    }
    return [...out.values()]
  }

  private cdmConfigFiles(): string[] {
    const dir = join(homedir(), '.config', 'colab-cli-cdm')
    try {
      return readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => join(dir, f))
    } catch {
      return []
    }
  }

  /** 单个 config 下的 sessions 列表；--json 是否支持不确定：首次探测并缓存，解析宽容 */
  private async listSessionsWith(vm: VM): Promise<ColabSessionInfo[]> {
    if (this.jsonSessions !== false) {
      const r = await this.run(vm, ['sessions', '--json'], 'sessions')
      if (r.code === 0) {
        const parsed = this.tryParseSessionsJson(r.stdout)
        if (parsed) {
          this.jsonSessions = true
          return parsed
        }
      }
      this.jsonSessions = false
    }
    const r = await this.run(vm, ['sessions'], 'sessions')
    return this.parseSessionsText(r.stdout)
  }

  private tryParseSessionsJson(stdout: string): ColabSessionInfo[] | null {
    try {
      const raw: unknown = JSON.parse(stdout)
      const arr = Array.isArray(raw) ? raw : (raw as { sessions?: unknown[] }).sessions
      if (!Array.isArray(arr)) return null
      return arr.map((item) => {
        const o = item as Record<string, unknown>
        return {
          name: String(o.name ?? o.session ?? o.session_name ?? ''),
          endpoint: o.endpoint !== undefined ? String(o.endpoint) : undefined,
          accelerator: (o.accelerator ?? o.gpu) !== undefined ? String(o.accelerator ?? o.gpu) : undefined,
        }
      }).filter((s) => s.name.length > 0)
    } catch {
      return null
    }
  }

  private parseSessionsText(stdout: string): ColabSessionInfo[] {
    const out: ColabSessionInfo[] = []
    for (const line of stdout.split('\n')) {
      const t = line.trim()
      if (!t) continue
      // 跳过表头与分隔线
      if (/^name\b/i.test(t) || /^[-─\s|]+$/.test(t) || t.startsWith('[colab]')) continue
      const name = t.split(/\s+/)[0]
      if (name) out.push({ name })
    }
    return out
  }

  /** 用 VM 自己的 config 查（C13：它的 session 只记在那个文件里） */
  async sessionExists(vm: VM): Promise<boolean> {
    try {
      const sessions = await this.listSessionsWith(vm)
      return sessions.some((s) => s.name === vm.sessionName)
    } catch {
      return false
    }
  }

  /** C10：exec -f 不支持传参，code 一律经 stdin 管道喂给 colab exec */
  exec(vm: VM, code: string, timeoutSec?: number): Promise<ExecResult> {
    const t = this.clampTimeout(timeoutSec)
    return this.run(vm, ['exec', '-s', vm.sessionName, '--timeout', String(t)], 'exec', {
      input: code,
      watchdogMs: t * 1000 + 60_000,
    })
  }

  execTemplate(
    vm: VM,
    templateName: string,
    vars: Record<string, unknown>,
    timeoutSec?: number,
  ): Promise<ExecResult> {
    return this.exec(vm, this.renderTemplate(templateName, vars), timeoutSec)
  }

  /** C5：输出真流式，spawn 按行切分回调；C4：调用方必须给大正数 timeout */
  execStream(vm: VM, code: string, timeoutSec: number): Promise<StreamHandle> {
    const t = this.clampTimeout(timeoutSec, 86400)
    const args = [...this.baseArgs(vm), 'exec', '-s', vm.sessionName, '--timeout', String(t)]
    const child = spawn(this.bin(), args, { stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdin.write(code)
    child.stdin.end()

    let logStream: WriteStream | null = null
    try {
      logStream = createWriteStream(logFilePath(vm.id, 'exec-stream'), { flags: 'a' })
      logStream.write(`$ colab ${args.join(' ')}\n`)
    } catch {
      logStream = null
    }

    const lineCbs: Array<(line: string) => void> = []
    const pendingLines: string[] = [] // onLine 注册前的行先缓冲，避免竞态丢行
    let buf = ''

    const emitLine = (line: string) => {
      if (lineCbs.length === 0) {
        pendingLines.push(line)
        return
      }
      for (const cb of lineCbs) cb(line)
    }
    child.stdout.on('data', (c: Buffer) => {
      const text = c.toString('utf8')
      if (logStream) logStream.write(redact(text))
      buf += text
      let idx: number
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx)
        buf = buf.slice(idx + 1)
        emitLine(line)
      }
    })
    child.stderr.on('data', (c: Buffer) => {
      if (logStream) logStream.write(redact(c.toString('utf8')))
    })

    let resolveDone: (r: { code: number }) => void
    const done = new Promise<{ code: number }>((res) => (resolveDone = res))
    let settled = false
    const settle = (code: number) => {
      if (settled) return
      settled = true
      if (buf.length > 0) emitLine(buf) // 末尾无换行的残余
      if (logStream) logStream.end()
      resolveDone({ code })
    }
    child.on('error', () => settle(-1))
    child.on('close', (code) => settle(code ?? -1))

    const handle: StreamHandle = {
      onLine(cb) {
        lineCbs.push(cb)
        // 先注册回调再冲刷缓冲
        if (pendingLines.length > 0) {
          const flush = pendingLines.splice(0, pendingLines.length)
          for (const line of flush) cb(line)
        }
      },
      async close() {
        // 只杀本地进程；VM 上的 setsid 后台进程不受影响（§6.2）
        if (settled) return
        child.kill('SIGTERM')
        setTimeout(() => {
          if (!settled) child.kill('SIGKILL')
        }, 2000).unref()
        await done
      },
      done,
    }
    return Promise.resolve(handle)
  }

  /** C12：install 只走 pip；apt 包要在 exec 里用 subprocess 装 */
  install(vm: VM, packages: string[]): Promise<ExecResult> {
    return this.run(vm, ['install', '-s', vm.sessionName, ...packages], 'install', {
      watchdogMs: 600_000,
    })
  }

  renderTemplate(templateName: string, vars: Record<string, unknown>): string {
    return renderTpl(templateName, vars)
  }

  /**
   * C7/C24：drivemount 会 open('/dev/tty') 阻塞，必须用 PTY。
   * spike 已验证 script -qec 即可，无需 node-pty。
   * 输出日志由 DriveAuthManager 负责留档（drive-auth-<ts>.log），此处不重复写。
   */
  startDriveMount(vm: VM): DriveMountHandle {
    const inner = [this.bin(), ...this.baseArgs(vm), 'drivemount', '-s', vm.sessionName]
      .map(shellQuote)
      .join(' ')
    const child: ChildProcess = spawn('script', ['-qec', inner, '/dev/null'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const dataCbs: Array<(chunk: string) => void> = []
    const onChunk = (c: Buffer) => {
      const text = c.toString('utf8')
      for (const cb of dataCbs) cb(text)
    }
    child.stdout?.on('data', onChunk)
    child.stderr?.on('data', onChunk)

    return {
      onData(cb) {
        dataCbs.push(cb)
      },
      write(s: string) {
        child.stdin?.write(s)
      },
      kill() {
        child.kill('SIGTERM')
        setTimeout(() => child.kill('SIGKILL'), 2000).unref()
      },
    }
  }
}
