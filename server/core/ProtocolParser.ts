import type { WorkerMessage } from '~~/shared/types/progress'

/**
 * ProtocolParser —— 解析 tail_stream 吐出的行（DESIGN.md §7 + spike-report §2）。
 *
 * 行格式：`@@OFF@@<offset>\t<content>`。
 * 🔴 不能假设 @@CDM@@ 在行首：tqdm 的 \r 输出会把它挤到行中间，
 *    必须扫描行内所有出现位置逐个 tryParse。
 */

export interface ParsedTail {
  offset: number | null
  messages: WorkerMessage[]
  control: { type: 'done' | 'dead' | 'idle'; statusJson?: string } | null
  noise: string | null
}

const OFF_PREFIX = '@@OFF@@'
// §7.2 的规定正则 + m 标志：让 scanCdmMessages 对多行整块文本也成立
//（parseTailLine 逐行调用时与原文档正则行为完全一致）
const CDM_RE = /@@CDM@@(\{.*?\})(?=\s*$|@@CDM@@)/gm

/** 纯扫描文本里的全部 @@CDM@@ JSON（测试与解析共用）；坏 JSON 跳过不抛 */
export function scanCdmMessages(text: string): unknown[] {
  const out: unknown[] = []
  for (const m of text.matchAll(CDM_RE)) {
    try {
      out.push(JSON.parse(m[1]!))
    } catch {
      /* 半行 / 坏 JSON：跳过（§7.2 解析器永不崩） */
    }
  }
  return out
}

/** 最小形状校验：v/tid/seq/ts/type 齐全才认作 WorkerMessage */
function asWorkerMessage(raw: unknown): WorkerMessage | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  if (typeof o.v !== 'number' || typeof o.tid !== 'number' || typeof o.seq !== 'number') return null
  if (typeof o.type !== 'string') return null
  return raw as WorkerMessage
}

/** 非 @@OFF@@ 行返回 null（调用方按普通日志处理） */
export function parseTailLine(line: string): ParsedTail | null {
  if (!line.startsWith(OFF_PREFIX)) return null
  const rest = line.slice(OFF_PREFIX.length)
  const tab = rest.indexOf('\t')
  if (tab === -1) {
    // 畸形行：不崩，整体作为 noise
    return { offset: null, messages: [], control: null, noise: line }
  }
  const offNum = Number.parseInt(rest.slice(0, tab), 10)
  const offset = Number.isNaN(offNum) ? null : offNum
  const content = rest.slice(tab + 1)

  // 控制行（tail 脚本的终态/死亡/空闲信号）
  if (content.startsWith('@@TAILDONE@@')) {
    return {
      offset,
      messages: [],
      control: { type: 'done', statusJson: content.slice('@@TAILDONE@@'.length).trim() },
      noise: null,
    }
  }
  if (content.startsWith('@@TAILDEAD@@')) {
    return { offset, messages: [], control: { type: 'dead' }, noise: null }
  }
  if (content.startsWith('@@TAILIDLE@@')) {
    return { offset, messages: [], control: { type: 'idle' }, noise: null }
  }

  // 扫描所有 @@CDM@@ 出现位置（可能 0 个或多个）
  const messages: WorkerMessage[] = []
  for (const raw of scanCdmMessages(content)) {
    const msg = asWorkerMessage(raw)
    if (msg) messages.push(msg)
  }

  // 去掉协议片段后的残余是 noise（tqdm/库输出，降级为日志）
  const noise = content.replace(CDM_RE, '').trim()
  return { offset, messages, control: null, noise: noise.length > 0 ? noise : null }
}
