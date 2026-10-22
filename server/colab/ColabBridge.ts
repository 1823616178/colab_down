import type { VM } from '../entities/VM'

/**
 * ColabBridge —— colab CLI 封装层接口（DESIGN.md §3.2）。
 * 其他模块只依赖本文件的接口与类型，不关心 Real/Mock 之分。
 */

export interface ColabSessionInfo {
  name: string
  endpoint?: string
  accelerator?: string
}

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

export interface StreamHandle {
  /** 每收到一行回调（自动按行切分，不含 \n） */
  onLine(cb: (line: string) => void): void
  /** 终止本地进程（不影响 VM 上的后台进程） */
  close(): Promise<void>
  /** 进程结束 */
  done: Promise<{ code: number }>
}

export interface DriveMountHandle {
  onData(cb: (chunk: string) => void): void
  /** 向 PTY 写入（确认授权时写 "\n"） */
  write(s: string): void
  kill(): void
}

export interface ColabBridge {
  readonly mock: boolean
  newSession(vm: VM): Promise<ColabSessionInfo>
  stopSession(vm: VM): Promise<void>
  restartKernel(vm: VM): Promise<void>
  listSessions(): Promise<ColabSessionInfo[]>
  sessionExists(vm: VM): Promise<boolean>
  exec(vm: VM, code: string, timeoutSec?: number): Promise<ExecResult>
  execTemplate(
    vm: VM,
    templateName: string,
    vars: Record<string, unknown>,
    timeoutSec?: number,
  ): Promise<ExecResult>
  execStream(vm: VM, code: string, timeoutSec: number): Promise<StreamHandle>
  install(vm: VM, packages: string[]): Promise<ExecResult>
  renderTemplate(templateName: string, vars: Record<string, unknown>): string
  startDriveMount(vm: VM): DriveMountHandle
}
