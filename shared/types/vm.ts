// 前后端共享：VM 相关类型（与 server/entities/VM.ts 对齐）

export type RuntimeType = 'cpu' | 'T4' | 'L4' | 'G4' | 'H100' | 'A100' | 'v5e1' | 'v6e1'
export type VMStatus =
  | 'creating'
  | 'bootstrapping'
  | 'awaiting_drive_auth'
  | 'idle'
  | 'busy'
  | 'reconnecting'
  | 'draining'
  | 'stopping'
  | 'stopped'
  | 'error'
export type DriveBackend = 'colab_native' | 'rclone'
export type DriveAuthState =
  | 'none'
  | 'requesting'
  | 'awaiting_user'
  | 'propagating'
  | 'mounted'
  | 'lost'
  | 'timeout'
  | 'failed'

export interface VMDTO {
  id: number
  sessionName: string
  runtimeType: RuntimeType
  status: VMStatus
  currentTaskId: number | null
  currentTaskName?: string | null
  bootstrapped: boolean
  driveBackend: DriveBackend
  driveMounted: boolean
  driveRoot: string | null
  driveAuthState: DriveAuthState
  driveAuthorizedAt: string | null
  autoStop: boolean
  idleTimeout: number
  errorMsg: string | null
  createdAt: string
  bootstrappedAt: string | null
  lastActiveAt: string
  lastHeartbeatAt: string | null
  expiresAt: string
}

export interface DriveAuthStatusDTO {
  vmId: number
  sessionName: string
  state: DriveAuthState
  authUri?: string | null
  expiresAt?: string | null
  error?: string | null
}
