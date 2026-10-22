import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VM } from '../../server/entities/VM'
import { MockColabBridge } from '../../server/colab/MockColabBridge'
import { parseTailLine } from '../../server/core/ProtocolParser'
import type { ParsedTail } from '../../server/core/ProtocolParser'

const vm = { id: 1, sessionName: 'mock-vm-1', configPath: '/tmp/mock.json', runtimeType: 'cpu' } as VM

async function launchAndTail(bridge: MockColabBridge, job: Record<string, unknown>, taskDir: string) {
  const p = bridge.execTemplate(vm, 'launch_worker', { TASK_DIR: taskDir, JOB: job })
  await vi.advanceTimersByTimeAsync(500)
  const r = await p
  expect(r.stdout).toContain('@@PID@@')
  const code = bridge.renderTemplate('tail_stream', { WD: taskDir, OFFSET: 0, IDLE: 300 })
  const stream = await bridge.execStream(vm, code, 86400)
  const lines: string[] = []
  stream.onLine((l) => lines.push(l))
  return { stream, lines }
}

function parsedOf(lines: string[]): ParsedTail[] {
  return lines.map((l) => parseTailLine(l)).filter((p): p is ParsedTail => p !== null)
}

describe('MockColabBridge', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('完整下载：hello → progress → TAILDONE completed，seq 单调', async () => {
    const bridge = new MockColabBridge()
    const pNew = bridge.newSession(vm)
    await vi.advanceTimersByTimeAsync(2500)
    await pNew
    expect(await bridge.sessionExists(vm)).toBe(true)

    const { stream, lines } = await launchAndTail(
      bridge,
      { tid: 42, name: 'smoke', source_type: 'http' },
      '/content/cdm/42',
    )
    await vi.advanceTimersByTimeAsync(60_000)
    await stream.done

    const msgs = parsedOf(lines).flatMap((p) => p.messages)
    expect(msgs[0]).toMatchObject({ type: 'hello', tid: 42, seq: 1 })
    expect(msgs.some((m) => m.type === 'progress')).toBe(true)
    // seq 单调递增（§7.1）
    for (let i = 1; i < msgs.length; i++) expect(msgs[i]!.seq).toBeGreaterThan(msgs[i - 1]!.seq)

    const done = parsedOf(lines).find((p) => p.control?.type === 'done')
    expect(done).toBeTruthy()
    expect(JSON.parse(done!.control!.statusJson!)).toMatchObject({ status: 'completed' })
  }, 20000)

  it('offset 续读：断开后重挂不丢行', async () => {
    const bridge = new MockColabBridge()
    const pNew = bridge.newSession(vm)
    await vi.advanceTimersByTimeAsync(2500)
    await pNew

    const { stream, lines } = await launchAndTail(
      bridge,
      { tid: 7, name: 'resume', source_type: 'http' },
      '/content/cdm/7',
    )
    await vi.advanceTimersByTimeAsync(3_500) // 跑几秒后本地断开
    await stream.close()
    const firstSeqs = parsedOf(lines).flatMap((p) => p.messages.map((m) => m.seq))
    const lastOffset = parsedOf(lines).at(-1)?.offset ?? 0
    expect(firstSeqs.length).toBeGreaterThan(2)

    // 带 offset 重挂（§6.3：一行不丢）
    const code = bridge.renderTemplate('tail_stream', { WD: '/content/cdm/7', OFFSET: lastOffset, IDLE: 300 })
    const stream2 = await bridge.execStream(vm, code, 86400)
    const lines2: string[] = []
    stream2.onLine((l) => lines2.push(l))
    await vi.advanceTimersByTimeAsync(60_000)
    await stream2.done
    const secondSeqs = parsedOf(lines2).flatMap((p) => p.messages.map((m) => m.seq))
    // 两段拼接后 seq 连续无空洞
    const all = [...firstSeqs, ...secondSeqs]
    for (let i = 1; i <= all.length; i++) expect(all[i - 1]).toBe(i)
  }, 20000)

  it('kill_worker → TAILDONE cancelled', async () => {
    const bridge = new MockColabBridge()
    const pNew = bridge.newSession(vm)
    await vi.advanceTimersByTimeAsync(2500)
    await pNew
    const { stream, lines } = await launchAndTail(
      bridge,
      { tid: 9, name: 'cancel-me', source_type: 'http' },
      '/content/cdm/9',
    )
    await vi.advanceTimersByTimeAsync(3_500)
    const kp = bridge.execTemplate(vm, 'kill_worker', { TASK_DIR: '/content/cdm/9' })
    await vi.advanceTimersByTimeAsync(500)
    await kp
    await vi.advanceTimersByTimeAsync(3_000)
    await stream.done
    const done = parsedOf(lines).find((p) => p.control?.type === 'done')
    expect(JSON.parse(done!.control!.statusJson!)).toMatchObject({ status: 'cancelled' })
  }, 20000)

  it('mockfail 注入：50% 时 status failed(SOURCE_NOT_FOUND)', async () => {
    const bridge = new MockColabBridge()
    const pNew = bridge.newSession(vm)
    await vi.advanceTimersByTimeAsync(2500)
    await pNew
    const { stream, lines } = await launchAndTail(
      bridge,
      { tid: 11, name: 'x-mockfail', source_type: 'http' },
      '/content/cdm/11',
    )
    await vi.advanceTimersByTimeAsync(60_000)
    await stream.done
    const done = parsedOf(lines).find((p) => p.control?.type === 'done')
    expect(JSON.parse(done!.control!.statusJson!)).toMatchObject({
      status: 'failed',
      error_code: 'SOURCE_NOT_FOUND',
    })
  }, 20000)

  it('startDriveMount：URI → write(\\n) → propagated → Mounted', async () => {
    const bridge = new MockColabBridge()
    const handle = bridge.startDriveMount(vm)
    let out = ''
    handle.onData((c) => (out += c))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(out).toContain('REQUIRED: Google Drive Authorization needed.')
    const uri = out.match(/(https:\/\/accounts\.google\.com\/o\/oauth2\/\S+)/)?.[1]
    expect(uri).toBeTruthy()
    expect(uri!.length).toBeGreaterThan(1200) // C26：实测 1415 字符

    handle.write('\n')
    await vi.advanceTimersByTimeAsync(1_500)
    expect(out).toContain('Credentials propagated')
    await vi.advanceTimersByTimeAsync(2_500)
    expect(out).toContain('Mounted at /content/drive')
    handle.kill()
  })
})
