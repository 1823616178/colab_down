import { describe, expect, it } from 'vitest'
import { parseTailLine, scanCdmMessages } from '../../server/core/ProtocolParser'

const MSG = (o: Record<string, unknown>) =>
  `@@CDM@@${JSON.stringify({ v: 1, tid: 42, ts: 1754700000.1, ...o })}`

describe('ProtocolParser', () => {
  it('解析干净的 @@OFF@@ 行', () => {
    const line = `@@OFF@@1234\t${MSG({ seq: 1, type: 'progress', downloaded: 100 })}`
    const r = parseTailLine(line)
    expect(r).not.toBeNull()
    expect(r!.offset).toBe(1234)
    expect(r!.messages).toHaveLength(1)
    expect(r!.messages[0]).toMatchObject({ type: 'progress', seq: 1, tid: 42 })
    expect(r!.control).toBeNull()
    expect(r!.noise).toBeNull()
  })

  it('@@CDM@@ 在行中间（tqdm \\r 噪声混入，spike-report §2）', () => {
    const line = `@@OFF@@2000\t[tqdm-noise] 70% |####      | 35/60 [00:05<00:00]${MSG({ seq: 37, type: 'progress' })}`
    const r = parseTailLine(line)!
    expect(r.messages).toHaveLength(1)
    expect(r.messages[0]).toMatchObject({ seq: 37 })
    // 噪声部分降级为日志文本
    expect(r.noise).toContain('tqdm-noise')
  })

  it('一行内多个 @@CDM@@', () => {
    const line = `@@OFF@@100\t${MSG({ seq: 1, type: 'log', level: 'info', message: 'a' })}${MSG({ seq: 2, type: 'progress', downloaded: 1 })}`
    const r = parseTailLine(line)!
    expect(r.messages).toHaveLength(2)
    expect(r.messages[0]).toMatchObject({ seq: 1, type: 'log' })
    expect(r.messages[1]).toMatchObject({ seq: 2, type: 'progress' })
  })

  it('非 @@OFF@@ 行返回 null', () => {
    expect(parseTailLine(`${MSG({ seq: 1, type: 'log', level: 'info', message: 'x' })}`)).toBeNull()
    expect(parseTailLine('random library chatter')).toBeNull()
    expect(parseTailLine('')).toBeNull()
  })

  it('控制行：TAILDONE 带 status.json 内容', () => {
    const st = JSON.stringify({ v: 1, type: 'status', status: 'completed', bytes: 100 })
    const r = parseTailLine(`@@OFF@@3000\t@@TAILDONE@@ ${st}`)!
    expect(r.offset).toBe(3000)
    expect(r.control).toEqual({ type: 'done', statusJson: st })
    expect(r.messages).toHaveLength(0)
  })

  it('控制行：TAILDEAD / TAILIDLE', () => {
    expect(parseTailLine('@@OFF@@10\t@@TAILDEAD@@ worker process vanished')!.control).toEqual({ type: 'dead' })
    expect(parseTailLine('@@OFF@@10\t@@TAILIDLE@@')!.control).toEqual({ type: 'idle' })
  })

  it('畸形行不崩：无 tab / 坏 offset / 坏 JSON', () => {
    const noTab = parseTailLine('@@OFF@@1234')
    expect(noTab).not.toBeNull()
    expect(noTab!.offset).toBeNull()
    expect(noTab!.noise).toBeTruthy()

    const badOff = parseTailLine(`@@OFF@@abc\t${MSG({ seq: 1, type: 'log', level: 'info', message: 'm' })}`)
    expect(badOff!.offset).toBeNull()
    expect(badOff!.messages).toHaveLength(1)

    const badJson = parseTailLine('@@OFF@@1\t@@CDM@@{broken json')
    expect(badJson).not.toBeNull()
    expect(badJson!.messages).toHaveLength(0)
  })

  it('纯噪声行（无 @@CDM@@）', () => {
    const r = parseTailLine('@@OFF@@50\trandom library chatter: downloading shard 3')!
    expect(r.offset).toBe(50)
    expect(r.messages).toHaveLength(0)
    expect(r.noise).toBe('random library chatter: downloading shard 3')
  })

  it('字段不全的 JSON 不认作 WorkerMessage', () => {
    const r = parseTailLine('@@OFF@@1\t@@CDM@@{"foo":1}')!
    expect(r.messages).toHaveLength(0)
  })

  it('scanCdmMessages 纯扫描（模拟 63 条全量校验场景）', () => {
    const parts: string[] = []
    for (let i = 1; i <= 63; i++) {
      parts.push(i % 7 === 0 ? `\r[tqdm] ${i}%${MSG({ seq: i, type: 'progress' })}` : MSG({ seq: i, type: 'progress' }))
    }
    const found = scanCdmMessages(parts.join('\n')) as Array<{ seq: number }>
    expect(found).toHaveLength(63)
    expect(found.map((m) => m.seq)).toEqual(Array.from({ length: 63 }, (_, i) => i + 1))
  })
})
