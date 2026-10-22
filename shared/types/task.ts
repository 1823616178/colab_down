// 前后端共享：任务相关类型（与 server/entities/Task.ts 对齐）

export type TaskSourceType = 'huggingface' | 'http' | 'github' | 'gdrive' | 'torrent'
export type TaskStatus =
  | 'pending'
  | 'queued'
  | 'preparing'
  | 'downloading'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'retry_wait'
export type DownloadMode = 'direct' | 'staged'

export const TERMINAL_TASK_STATUS: TaskStatus[] = ['completed', 'failed', 'cancelled']
export const ACTIVE_TASK_STATUS: TaskStatus[] = [
  'pending',
  'queued',
  'preparing',
  'downloading',
  'retry_wait',
]

export interface TaskDTO {
  id: number
  name: string
  sourceType: TaskSourceType
  sourceUrl: string
  revision: string
  allowPatterns: string | null
  ignorePatterns: string | null
  destPath: string
  downloadMode: DownloadMode
  priority: number
  status: TaskStatus
  cancelRequested: boolean
  progress: number
  totalBytes: number | null
  downloadedBytes: number
  resumeOffset: number
  speedBps: number
  etaSec: number | null
  currentFile: string | null
  fileTotal: number
  fileDone: number
  errorCode: string | null
  errorMsg: string | null
  retryCount: number
  maxRetries: number
  nextRetryAt: string | null
  vmId: number | null
  credentialId: number | null
  vmSessionName: string | null
  createdAt: string
  startedAt: string | null
  updatedAt: string
  completedAt: string | null
}

export interface TaskFileDTO {
  id: number
  taskId: number
  relPath: string
  bytes: number | null
  status: 'pending' | 'downloading' | 'done' | 'failed'
  checksum: string | null
  completedAt: string | null
}

export interface ParsedUrl {
  url: string
  ok: boolean
  sourceType?: TaskSourceType
  /** 归一化后的 source_url */
  normalizedUrl?: string
  name?: string
  revision?: string
  suggestedDestPath?: string
  error?: string
}

export interface TaskListQuery {
  page: number
  pageSize: number
  status?: TaskStatus[]
  sourceType?: TaskSourceType[]
  keyword?: string
  createdFrom?: string
  createdTo?: string
  sortBy?: 'id' | 'createdAt' | 'priority' | 'downloadedBytes' | 'speedBps' | 'status'
  sortOrder?: 'asc' | 'desc'
}

export interface TaskListResult {
  items: TaskDTO[]
  total: number
  page: number
  pageSize: number
}
