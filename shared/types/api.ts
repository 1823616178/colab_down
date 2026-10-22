// 前后端共享：API 通用类型

export interface ApiOk<T> {
  code: 0
  data: T
}

export interface ApiFail {
  code: number
  message: string
  detail?: unknown
}

export type ApiEnvelope<T> = ApiOk<T> | ApiFail

export function isApiOk<T>(res: ApiEnvelope<T>): res is ApiOk<T> {
  return res.code === 0
}

export interface StatsOverview {
  totalTasks: number
  downloading: number
  pending: number
  queued: number
  completed: number
  failed: number
  cancelled: number
  retryWait: number
  todayCompleted: number
  todayBytes: number
  totalSpeedBps: number
  activeVms: number
  maxVms: number
  driveFreeBytes: number | null
  driveTotalBytes: number | null
}

export interface DriveEntry {
  name: string
  path: string
  isDir: boolean
  size?: number | null
}

export interface CredentialDTO {
  id: number
  name: string
  type: 'rclone_drive' | 'hf_token' | 'github_token' | 'other'
  hint: string
  createdAt: string
  updatedAt: string
}

export interface SettingDTO {
  configKey: string
  value: string | null
  valueType: 'string' | 'int' | 'bool' | 'json'
  description: string | null
  updatedAt: string
}

export interface ColabAuthStatus {
  ok: boolean
  mock: boolean
  cliFound: boolean
  version?: string
  sessions?: number
  message: string
  fixHint?: string
}
