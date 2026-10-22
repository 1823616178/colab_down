// ⭐ 核心：全站单例 SSE 连接（DESIGN.md §8.3）
// 职责：
//   1. 全站共用一条 EventSource（layout 挂载时 start() 一次，幂等）
//   2. 断线指数退避重连 1s→2s→4s→8s→30s 封顶，携带 Last-Event-ID
//   3. reconnecting 超 10s → 降级每 5s 轮询 task-list 兜底，进度不"冻住"
//   4. 页面 hidden 不断线（下载要持续）
//   5. 维护 reactive Map：任务进度 / VM 状态 / 授权状态 / 日志 / 统计
import { reactive, ref } from 'vue'
import type {
  SseConnectionState,
  SseEvents,
  TaskProgressState,
} from '~/shared/types/progress'
import type { DriveAuthState, DriveAuthStatusDTO } from '~/shared/types/vm'
import { ACTIVE_TASK_STATUS, type TaskDTO, type TaskListResult } from '~/shared/types/task'
import { useApi } from './useApi'

/** VM 实时状态（vm-status 事件增量） */
export interface VmLiveState {
  status: string
  currentTaskId: number | null
  sessionName: string
  driveAuthState?: string
  updatedAt: number
}

/** 任务日志行（log 事件增量，内存只留最近 200 条） */
export interface LogLine {
  level: string
  message: string
  ts: number
}

type SseName = keyof SseEvents
type Listener = (name: SseName, data: SseEvents[SseName]) => void

// ---------- 模块级单例状态 ----------
const tasks = reactive(new Map<number, TaskProgressState>())
const vms = reactive(new Map<number, VmLiveState>())
const driveAuth = reactive(new Map<number, DriveAuthStatusDTO>())
const logs = reactive(new Map<number, LogLine[]>())
const stats = ref<SseEvents['stats'] | null>(null)
const connectionState = ref<SseConnectionState>('closed')

const listeners = new Set<Listener>()

// ---------- 连接管理内部状态 ----------
const SSE_NAMES: SseName[] = ['progress', 'task-status', 'vm-status', 'drive-auth', 'log', 'stats']
const MAX_LOGS_PER_TASK = 200
const RETRY_CAP = 30_000
const POLL_INTERVAL = 5_000
const POLL_AFTER = 10_000

let es: EventSource | null = null
let running = false
let manualStop = false
let retryDelay = 1_000
let retryTimer: ReturnType<typeof setTimeout> | null = null
let lastEventId = ''
let reconnectSince = 0
let pollTimer: ReturnType<typeof setInterval> | null = null

function emit(name: SseName, data: SseEvents[SseName]) {
  listeners.forEach((fn) => {
    try {
      fn(name, data)
    } catch {
      /* 监听器异常不影响主链路 */
    }
  })
}

// ---------- 各类事件处理 ----------
function onProgress(d: SseEvents['progress']) {
  tasks.set(d.taskId, {
    downloaded: d.downloaded,
    total: d.total,
    speedBps: d.speedBps,
    etaSec: d.etaSec,
    file: d.file,
    fileIndex: d.fileIndex,
    fileTotal: d.fileTotal,
    progress: d.progress,
    recovering: false, // 有实时数据到达即视为已恢复
    updatedAt: Date.now(),
  })
}

function onTaskStatus(d: SseEvents['task-status']) {
  // 终态后进度定格为 100%（completed）或保持现状，交由页面快照刷新
  const st = tasks.get(d.taskId)
  if (st && d.status === 'completed') {
    st.progress = 100
    st.speedBps = 0
    st.recovering = false
    st.updatedAt = Date.now()
  }
  if (st && (d.status === 'failed' || d.status === 'cancelled')) {
    st.speedBps = 0
    st.recovering = false
    st.updatedAt = Date.now()
  }
}

function onVmStatus(d: SseEvents['vm-status']) {
  const prev = vms.get(d.vmId)
  vms.set(d.vmId, {
    status: d.status,
    currentTaskId: d.currentTaskId,
    sessionName: d.sessionName ?? prev?.sessionName ?? `VM#${d.vmId}`,
    driveAuthState: d.driveAuthState ?? prev?.driveAuthState,
    updatedAt: Date.now(),
  })
  // VM 断连恢复：其当前任务进度条进入"恢复中"形态（半透明、不清零）
  if (d.status === 'reconnecting' && d.currentTaskId != null) {
    const st = tasks.get(d.currentTaskId)
    if (st) st.recovering = true
  }
  // VM 回到 busy 且有进度事件后 recovering 会由 onProgress 清除
}

function onDriveAuth(d: SseEvents['drive-auth']) {
  const prev = driveAuth.get(d.vmId)
  driveAuth.set(d.vmId, {
    vmId: d.vmId,
    sessionName: d.sessionName ?? prev?.sessionName ?? `VM#${d.vmId}`,
    state: d.state as DriveAuthState,
    authUri: d.authUri ?? prev?.authUri ?? null,
    expiresAt: d.expiresAt ?? prev?.expiresAt ?? null,
    error: d.error ?? null,
  })
}

function onLog(d: SseEvents['log']) {
  let arr = logs.get(d.taskId)
  if (!arr) {
    arr = reactive<LogLine[]>([])
    logs.set(d.taskId, arr)
  }
  arr.push({ level: d.level, message: d.message, ts: d.ts })
  if (arr.length > MAX_LOGS_PER_TASK) arr.splice(0, arr.length - MAX_LOGS_PER_TASK)
}

function onStats(d: SseEvents['stats']) {
  stats.value = d
}

const handlers: { [K in SseName]: (d: SseEvents[K]) => void } = {
  progress: onProgress,
  'task-status': onTaskStatus,
  'vm-status': onVmStatus,
  'drive-auth': onDriveAuth,
  log: onLog,
  stats: onStats,
}

// ---------- 兜底轮询（SSE reconnecting 超 10s 启用） ----------
async function pollOnce() {
  try {
    const { request } = useApi()
    const res = await request<TaskListResult>('/api/task-list', {
      page: 1,
      pageSize: 100,
      status: [...ACTIVE_TASK_STATUS],
    })
    const now = Date.now()
    for (const t of res.items) {
      mergeTaskSnapshot(t, now)
      emit('task-status', { taskId: t.id, status: t.status, errorCode: t.errorCode, error: t.errorMsg })
    }
  } catch {
    /* 轮询失败静默，等下一轮 */
  }
}

/** 把 DB 快照字段合并进实时进度 Map（首屏 / 轮询共用） */
function mergeTaskSnapshot(t: TaskDTO, now = Date.now()) {
  const cur = tasks.get(t.id)
  // 实时数据比快照新（5s 落库延迟）时不回退进度
  if (cur && now - cur.updatedAt < 4_000) return
  tasks.set(t.id, {
    downloaded: t.downloadedBytes,
    total: t.totalBytes,
    speedBps: t.speedBps,
    etaSec: t.etaSec,
    file: t.currentFile,
    fileIndex: t.fileDone,
    fileTotal: t.fileTotal,
    progress: t.progress,
    recovering: cur?.recovering ?? false,
    updatedAt: cur?.updatedAt ?? now,
  })
}

function ensurePolling() {
  if (pollTimer || !process.client) return
  pollTimer = setInterval(() => {
    if (connectionState.value === 'open') return
    if (reconnectSince && Date.now() - reconnectSince >= POLL_AFTER) pollOnce()
  }, POLL_INTERVAL)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

// ---------- 连接生命周期 ----------
function cleanupSource() {
  if (es) {
    es.onopen = null
    es.onerror = null
    for (const n of SSE_NAMES) es.removeEventListener(n, dispatchEvent)
    es.close()
    es = null
  }
}

function dispatchEvent(e: MessageEvent) {
  if (e.lastEventId) lastEventId = e.lastEventId
  let data: unknown
  try {
    data = JSON.parse(e.data)
  } catch {
    return // 脏帧丢弃
  }
  const name = e.type as SseName
  const h = handlers[name]
  if (h) {
    ;(h as (d: unknown) => void)(data)
    emit(name, data as SseEvents[SseName])
  }
}

function connect() {
  if (!process.client || manualStop) return
  const token = localStorage.getItem('cdm_token')
  if (!token) {
    connectionState.value = 'closed'
    return
  }
  cleanupSource()
  connectionState.value = reconnectSince ? 'reconnecting' : 'connecting'

  // EventSource 自动重连不可靠（无法带自定义 token header/退避策略），
  // 这里全手动管理；Last-Event-ID 走 query 传递给服务端补发。
  const qs = new URLSearchParams({ scope: 'active', token })
  if (lastEventId) qs.set('lastEventId', lastEventId)
  es = new EventSource(`/api/progress-stream?${qs.toString()}`)

  es.onopen = () => {
    connectionState.value = 'open'
    retryDelay = 1_000
    reconnectSince = 0
    stopPolling()
  }
  es.onerror = () => {
    cleanupSource()
    if (manualStop) return
    connectionState.value = 'reconnecting'
    if (!reconnectSince) reconnectSince = Date.now()
    ensurePolling()
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = setTimeout(connect, retryDelay)
    retryDelay = Math.min(retryDelay * 2, RETRY_CAP)
  }
  for (const n of SSE_NAMES) es.addEventListener(n, dispatchEvent)
}

export function useProgress() {
  /** 启动单例连接（幂等，layout 挂载时调一次） */
  function start() {
    if (running) return
    running = true
    manualStop = false
    connect()
  }

  /** 停止连接（退出登录等场景） */
  function stop() {
    manualStop = true
    running = false
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    stopPolling()
    cleanupSource()
    connectionState.value = 'closed'
  }

  /** 订阅原始 SSE 事件（页面刷新本地快照用），返回取消函数 */
  function subscribe(fn: Listener) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }

  /** 手动把一批任务快照合并进进度 Map（首屏一致性用） */
  function seedTasks(list: TaskDTO[]) {
    for (const t of list) mergeTaskSnapshot(t)
  }

  return {
    tasks,
    vms,
    driveAuth,
    logs,
    stats,
    connectionState,
    start,
    stop,
    subscribe,
    seedTasks,
  }
}
