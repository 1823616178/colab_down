import type { SseEventName, SseEvents } from '~~/shared/types/progress'

/**
 * ProgressBus —— 单例事件总线（DESIGN.md §8）。
 * - 环形缓冲 200 条（带单调 id，SSE Last-Event-ID 补发用）
 * - progress 类事件按 taskId 500ms 合并只发最新（三级节流第 2 层）
 * - DB 落盘不在此做（VMWorker 负责）
 */

export interface BusEvent<K extends SseEventName = SseEventName> {
  id: number
  name: K
  data: SseEvents[K]
  ts: number
}

type Listener = (e: BusEvent) => void

const RING_SIZE = 200
const PROGRESS_MERGE_MS = 500

export class ProgressBus {
  private seq = 0
  private ring: BusEvent[] = []
  private listeners = new Set<Listener>()
  /** 每 task 的待合并 progress 与定时器 */
  private pendingProgress = new Map<number, SseEvents['progress']>()
  private progressTimers = new Map<number, ReturnType<typeof setTimeout>>()
  private lastProgressSent = new Map<number, number>()

  // ---- 订阅 ----

  onEvent(cb: Listener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /** Last-Event-ID 补发：返回 id > lastId 的全部缓冲事件 */
  since(lastId: number): BusEvent[] {
    return this.ring.filter((e) => e.id > lastId)
  }

  // ---- 发布 ----

  emit<K extends SseEventName>(name: K, data: SseEvents[K]): BusEvent<K> {
    const e: BusEvent<K> = { id: ++this.seq, name, data, ts: Date.now() }
    this.ring.push(e)
    if (this.ring.length > RING_SIZE) this.ring.shift()
    for (const cb of this.listeners) {
      try {
        cb(e as BusEvent)
      } catch {
        /* 监听器异常不影响总线 */
      }
    }
    return e
  }

  /** 同 task 500ms 合并：窗口内只发最新一条 */
  emitProgress(data: SseEvents['progress']): void {
    const now = Date.now()
    const last = this.lastProgressSent.get(data.taskId) ?? 0
    if (now - last >= PROGRESS_MERGE_MS) {
      this.lastProgressSent.set(data.taskId, now)
      this.emit('progress', data)
      return
    }
    this.pendingProgress.set(data.taskId, data)
    if (!this.progressTimers.has(data.taskId)) {
      const timer = setTimeout(() => {
        this.progressTimers.delete(data.taskId)
        const pending = this.pendingProgress.get(data.taskId)
        if (pending) {
          this.pendingProgress.delete(data.taskId)
          this.lastProgressSent.set(data.taskId, Date.now())
          this.emit('progress', pending)
        }
      }, PROGRESS_MERGE_MS - (now - last))
      timer.unref?.()
      this.progressTimers.set(data.taskId, timer)
    }
  }

  /** 状态变更前先把积压的 progress 冲掉，保证前端时序正确 */
  private flushProgress(taskId: number): void {
    const timer = this.progressTimers.get(taskId)
    if (timer) {
      clearTimeout(timer)
      this.progressTimers.delete(taskId)
    }
    const pending = this.pendingProgress.get(taskId)
    if (pending) {
      this.pendingProgress.delete(taskId)
      this.emit('progress', pending)
    }
  }

  emitTaskStatus(data: SseEvents['task-status']): void {
    this.flushProgress(data.taskId)
    this.emit('task-status', data)
  }

  emitVMStatus(data: SseEvents['vm-status']): void {
    this.emit('vm-status', data)
  }

  emitDriveAuth(data: SseEvents['drive-auth']): void {
    this.emit('drive-auth', data)
  }

  emitLog(data: SseEvents['log']): void {
    this.emit('log', data)
  }
}
