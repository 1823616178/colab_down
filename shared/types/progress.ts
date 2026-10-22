// 前后端共享：进度协议（DESIGN.md §7 v2）与 SSE 事件类型（§8.2）

/** VM worker 行协议（@@CDM@@ 前缀后的 JSON） */
export type WorkerMessage =
  | WorkerHello
  | WorkerProgress
  | WorkerFile
  | WorkerLog
  | WorkerHeartbeat
  | WorkerStatus

interface WorkerBase {
  v: number
  tid: number
  seq: number
  ts: number
}

export interface WorkerHello extends WorkerBase {
  type: 'hello'
  pid: number
  source_type: string
  files_planned: number
}

export interface WorkerProgress extends WorkerBase {
  type: 'progress'
  downloaded: number
  total: number | null
  speed_bps: number
  eta_sec: number | null
  file: string | null
  file_index: number
  file_total: number
}

export interface WorkerFile extends WorkerBase {
  type: 'file'
  file: string
  bytes: number
  status: 'done' | 'failed'
}

export interface WorkerLog extends WorkerBase {
  type: 'log'
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
}

export interface WorkerHeartbeat extends WorkerBase {
  type: 'heartbeat'
  downloaded: number
}

export interface WorkerStatus extends WorkerBase {
  type: 'status'
  status: 'completed' | 'failed' | 'cancelled'
  bytes?: number
  duration_sec?: number
  dest?: string
  error_code?: string
  error?: string
}

/** SSE 事件（event: 行 = 下表的 key） */
export interface SseEvents {
  progress: {
    taskId: number
    downloaded: number
    total: number | null
    speedBps: number
    etaSec: number | null
    file: string | null
    fileIndex: number
    fileTotal: number
    progress: number
  }
  'task-status': {
    taskId: number
    status: string
    errorCode?: string | null
    error?: string | null
  }
  'vm-status': {
    vmId: number
    status: string
    currentTaskId: number | null
    sessionName: string
    driveAuthState?: string
  }
  'drive-auth': {
    vmId: number
    sessionName?: string
    state: string
    authUri?: string | null
    expiresAt?: string | null
    error?: string | null
  }
  log: {
    taskId: number
    level: string
    message: string
    ts: number
  }
  stats: {
    pending: number
    downloading: number
    completed: number
    failed: number
    activeVms: number
    totalSpeedBps: number
    todayBytes: number
  }
}

export type SseEventName = keyof SseEvents

export type SseConnectionState = 'connecting' | 'open' | 'reconnecting' | 'closed'

/** 前端单例 EventSource 维护的任务进度状态 */
export interface TaskProgressState {
  downloaded: number
  total: number | null
  speedBps: number
  etaSec: number | null
  file: string | null
  fileIndex: number
  fileTotal: number
  progress: number
  /** VM 断连恢复中：进度条半透明且不清零 */
  recovering?: boolean
  updatedAt: number
}
