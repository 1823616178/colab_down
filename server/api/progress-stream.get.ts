import { getRuntime } from '../core/runtime'

/**
 * SSE 实时进度推送（全项目唯一 GET）。
 * 查询参数：
 *   ?tasks=1,2     只收这些 task 的 progress/log/task-status
 *   ?scope=active  默认，收全部事件
 *   ?lastEventId=N 或 Last-Event-ID 头：用 bus.since(lastId) 补发
 * 鉴权：middleware 拦截 /api/*，EventSource 用 ?token= 携带（requireAuth 已支持）。
 * 写流方式：event.node.res 原生写；handler 不返回响应体（event._handled = true）。
 */

/** ProgressBus 事件形态（server/core 契约：onEvent 回调收到 {id,name,data}，since 返回同型数组） */
interface BusEvent {
  id: number
  name: string
  data: unknown
}

interface ProgressBusLike {
  onEvent(listener: (ev: BusEvent) => void): (() => void) | void
  since(lastId: number): BusEvent[]
}

/** tasks 过滤生效时，只放行这些任务级事件 */
const TASK_SCOPED_EVENTS = new Set(['progress', 'log', 'task-status'])

export default defineEventHandler((event) => {
  const query = getQuery(event)

  // ?tasks=1,2 过滤
  const taskFilter = new Set<number>()
  if (typeof query.tasks === 'string') {
    for (const part of query.tasks.split(',')) {
      const n = Number.parseInt(part.trim(), 10)
      if (Number.isFinite(n) && n > 0) taskFilter.add(n)
    }
  }
  const hasFilter = taskFilter.size > 0

  const matchFilter = (ev: BusEvent): boolean => {
    if (!hasFilter) return true
    if (!TASK_SCOPED_EVENTS.has(ev.name)) return false
    const tid = (ev.data as { taskId?: unknown } | null)?.taskId
    return typeof tid === 'number' && taskFilter.has(tid)
  }

  // Last-Event-ID（头优先，其次查询参数）
  const lastRaw = getHeader(event, 'last-event-id') ?? (typeof query.lastEventId === 'string' ? query.lastEventId : undefined)
  const lastId = lastRaw ? Number.parseInt(String(lastRaw), 10) : Number.NaN

  let bus: ProgressBusLike
  try {
    bus = getRuntime().bus as unknown as ProgressBusLike
  } catch {
    // 运行时未就绪：SSE 尚未建立，直接回错误包络
    setResponseStatus(event, 503)
    return fail(ErrorCodes.INTERNAL, '运行时未就绪')
  }

  const res = event.node.res
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  const writeEvent = (ev: BusEvent): void => {
    res.write(`id: ${ev.id}\nevent: ${ev.name}\ndata: ${JSON.stringify(ev.data)}\n\n`)
  }

  // 补发 lastEventId 之后的事件；否则发一条连接注释帧
  if (Number.isFinite(lastId) && lastId > 0 && typeof bus.since === 'function') {
    try {
      for (const ev of bus.since(lastId) ?? []) {
        if (matchFilter(ev)) writeEvent(ev)
      }
    } catch (err) {
      logger.warn({ err }, 'SSE 补发失败，继续实时推送')
    }
  } else {
    res.write(': connected\n\n')
  }

  const unsubscribe = bus.onEvent((ev: BusEvent) => {
    try {
      if (matchFilter(ev)) writeEvent(ev)
    } catch {
      // 写入失败交由 close 事件清理
    }
  })

  // 15s 心跳注释帧，防代理掐空闲连接
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n')
    } catch {
      // 忽略，close 时统一清理
    }
  }, 15000)

  event.node.req.on('close', () => {
    clearInterval(heartbeat)
    try {
      if (typeof unsubscribe === 'function') unsubscribe()
    } catch {
      // 忽略退订异常
    }
  })

  // 保持连接：标记已处理，不返回响应体
  event._handled = true
})
