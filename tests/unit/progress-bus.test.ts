import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProgressBus, type BusEvent } from '../../server/core/ProgressBus'

const progress = (taskId: number, downloaded: number) => ({
  taskId,
  downloaded,
  total: 1000,
  speedBps: 100,
  etaSec: 5,
  file: null,
  fileIndex: 1,
  fileTotal: 1,
  progress: Math.floor(downloaded / 10),
})

describe('ProgressBus', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('emit/onEvent + since（Last-Event-ID 补发）', () => {
    const bus = new ProgressBus()
    const got: BusEvent[] = []
    bus.onEvent((e) => got.push(e))
    bus.emitTaskStatus({ taskId: 1, status: 'downloading' })
    bus.emitVMStatus({ vmId: 2, status: 'idle', currentTaskId: null, sessionName: 'vm-2' })
    expect(got).toHaveLength(2)
    expect(bus.since(0)).toHaveLength(2)
    expect(bus.since(got[0]!.id)).toHaveLength(1)
    expect(bus.since(got[1]!.id)).toHaveLength(0)
  })

  it('环形缓冲 200 条上限，id 单调', () => {
    const bus = new ProgressBus()
    for (let i = 0; i < 250; i++) bus.emitLog({ taskId: 1, level: 'info', message: `m${i}`, ts: i })
    const all = bus.since(0)
    expect(all).toHaveLength(200)
    expect(all[0]!.id).toBe(51) // 只留最近 200 条
    for (let i = 1; i < all.length; i++) expect(all[i]!.id).toBe(all[i - 1]!.id + 1)
  })

  it('progress 500ms 合并只发最新（§8.1 三级节流）', () => {
    const bus = new ProgressBus()
    const got: BusEvent[] = []
    bus.onEvent((e) => got.push(e))
    bus.emitProgress(progress(1, 100)) // 第一条立即发
    bus.emitProgress(progress(1, 200)) // 窗口内合并
    bus.emitProgress(progress(1, 300))
    expect(got.filter((e) => e.name === 'progress')).toHaveLength(1)
    vi.advanceTimersByTime(600)
    const progresses = got.filter((e) => e.name === 'progress')
    expect(progresses).toHaveLength(2)
    expect((progresses[1]!.data as { downloaded: number }).downloaded).toBe(300) // 只发最新
  })

  it('不同 task 的 progress 互不合并', () => {
    const bus = new ProgressBus()
    const got: BusEvent[] = []
    bus.onEvent((e) => got.push(e))
    bus.emitProgress(progress(1, 100))
    bus.emitProgress(progress(2, 100))
    expect(got.filter((e) => e.name === 'progress')).toHaveLength(2)
  })

  it('emitTaskStatus 先冲刷积压的 progress 再发状态（时序正确）', () => {
    const bus = new ProgressBus()
    const got: BusEvent[] = []
    bus.onEvent((e) => got.push(e))
    bus.emitProgress(progress(1, 100))
    bus.emitProgress(progress(1, 200)) // 积压
    bus.emitTaskStatus({ taskId: 1, status: 'completed' })
    expect(got.map((e) => e.name)).toEqual(['progress', 'progress', 'task-status'])
  })

  it('onEvent 返回 unsub', () => {
    const bus = new ProgressBus()
    const got: BusEvent[] = []
    const unsub = bus.onEvent((e) => got.push(e))
    bus.emitLog({ taskId: 1, level: 'info', message: 'a', ts: 1 })
    unsub()
    bus.emitLog({ taskId: 1, level: 'info', message: 'b', ts: 2 })
    expect(got).toHaveLength(1)
  })
})
