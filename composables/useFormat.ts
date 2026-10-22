// 展示格式化工具：字节/速度/时间/状态文案（格式化是前端的事，后端只给数值）
import type { TaskStatus, TaskSourceType } from '~/shared/types/task'
import type { VMStatus, DriveAuthState } from '~/shared/types/vm'

export function useFormat() {
  /** 字节数 → 人类可读（GiB/MiB 两位小数） */
  function formatBytes(n: number | null | undefined): string {
    if (n === null || n === undefined || Number.isNaN(n)) return '—'
    if (n < 1024) return `${n} B`
    if (n < 1024 ** 2) return `${(n / 1024).toFixed(2)} KiB`
    if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(2)} MiB`
    if (n < 1024 ** 4) return `${(n / 1024 ** 3).toFixed(2)} GiB`
    return `${(n / 1024 ** 4).toFixed(2)} TiB`
  }

  /** 速度 bps → xx MB/s */
  function formatSpeed(bps: number | null | undefined): string {
    if (bps === null || bps === undefined || bps <= 0) return '—'
    return `${formatBytes(bps)}/s`
  }

  /** 剩余秒数 → 短文案 */
  function formatEta(sec: number | null | undefined): string {
    if (sec === null || sec === undefined || sec < 0) return '—'
    if (sec < 60) return `${Math.round(sec)}s`
    if (sec < 3600) return `${Math.floor(sec / 60)}m${Math.round(sec % 60)}s`
    return `${Math.floor(sec / 3600)}h${Math.floor((sec % 3600) / 60)}m`
  }

  /** 时长秒数 → 中文时长 */
  function formatDuration(sec: number | null | undefined): string {
    if (sec === null || sec === undefined || sec < 0) return '—'
    const s = Math.floor(sec)
    if (s < 60) return `${s} 秒`
    if (s < 3600) return `${Math.floor(s / 60)} 分 ${s % 60} 秒`
    return `${Math.floor(s / 3600)} 时 ${Math.floor((s % 3600) / 60)} 分`
  }

  /** 倒计时秒数 → mm:ss */
  function formatCountdown(sec: number | null | undefined): string {
    if (sec === null || sec === undefined) return '--:--'
    const s = Math.max(0, Math.floor(sec))
    const m = Math.floor(s / 60)
    return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  }

  /** ISO 时间 → 本地 MM-DD HH:mm:ss */
  function formatTime(iso: string | null | undefined): string {
    if (!iso) return '—'
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '—'
    const p = (v: number) => String(v).padStart(2, '0')
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  }

  /** ISO 时间 → 相对时间 */
  function formatTimeAgo(iso: string | null | undefined): string {
    if (!iso) return '—'
    const t = new Date(iso).getTime()
    if (Number.isNaN(t)) return '—'
    const diff = Math.max(0, Date.now() - t)
    if (diff < 60_000) return '刚刚'
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`
    return `${Math.floor(diff / 86400_000)} 天前`
  }

  /** 任务状态 → 中文文案 */
  function taskStatusText(status: TaskStatus | string): string {
    const map: Record<string, string> = {
      pending: '等待调度',
      queued: '排队中',
      preparing: '准备中',
      downloading: '下载中',
      completed: '已完成',
      failed: '失败',
      cancelled: '已取消',
      retry_wait: '等待重试',
    }
    return map[status] ?? status
  }

  /** VM 状态 → 中文文案 */
  function vmStatusText(status: VMStatus | string): string {
    const map: Record<string, string> = {
      creating: '创建中',
      bootstrapping: '准备中',
      awaiting_drive_auth: '需要授权',
      idle: '空闲',
      busy: '下载中',
      reconnecting: '恢复连接中',
      draining: '排空停止中',
      stopping: '停止中',
      stopped: '已停止',
      error: '异常',
    }
    return map[status] ?? status
  }

  /** Drive 授权状态 → 中文文案 */
  function driveAuthStateText(state: DriveAuthState | string): string {
    const map: Record<string, string> = {
      none: '未发起',
      requesting: '获取授权链接中',
      awaiting_user: '等待用户授权',
      propagating: '推送凭据中',
      mounted: '已挂载',
      lost: '挂载失效',
      timeout: '授权超时',
      failed: '授权失败',
      cancelled: '已取消',
    }
    return map[state] ?? state
  }

  /** 任务状态 → badge 类名 */
  function taskStatusBadgeClass(status: TaskStatus | string): string {
    const map: Record<string, string> = {
      pending: 'badge-muted',
      queued: 'badge-accent',
      preparing: 'badge-info',
      downloading: 'badge-primary',
      completed: 'badge-ok',
      failed: 'badge-danger',
      cancelled: 'badge-muted',
      retry_wait: 'badge-warn',
    }
    return map[status] ?? 'badge-muted'
  }

  /** VM 状态 → badge 类名 */
  function vmStatusBadgeClass(status: VMStatus | string): string {
    const map: Record<string, string> = {
      creating: 'badge-info',
      bootstrapping: 'badge-info',
      awaiting_drive_auth: 'badge-warn',
      idle: 'badge-ok',
      busy: 'badge-primary',
      reconnecting: 'badge-warn',
      draining: 'badge-warn',
      stopping: 'badge-warn',
      stopped: 'badge-muted',
      error: 'badge-danger',
    }
    return map[status] ?? 'badge-muted'
  }

  /** Drive 授权状态 → badge 类名 */
  function driveAuthBadgeClass(state: DriveAuthState | string): string {
    const map: Record<string, string> = {
      none: 'badge-muted',
      requesting: 'badge-info',
      awaiting_user: 'badge-warn',
      propagating: 'badge-info',
      mounted: 'badge-ok',
      lost: 'badge-danger',
      timeout: 'badge-warn',
      failed: 'badge-danger',
      cancelled: 'badge-muted',
    }
    return map[state] ?? 'badge-muted'
  }

  /** 下载源类型 → 短文案 */
  function sourceTypeText(t: TaskSourceType | string): string {
    const map: Record<string, string> = {
      huggingface: 'HF',
      http: 'HTTP',
      github: 'GitHub',
      gdrive: 'GDrive',
      torrent: 'Torrent',
    }
    return map[t] ?? t
  }

  /** 状态是否为活跃任务（进度条需要轮播动画） */
  function isActiveTask(status: string): boolean {
    return ['pending', 'queued', 'preparing', 'downloading', 'retry_wait'].includes(status)
  }

  return {
    formatBytes,
    formatSpeed,
    formatEta,
    formatDuration,
    formatCountdown,
    formatTime,
    formatTimeAgo,
    taskStatusText,
    vmStatusText,
    driveAuthStateText,
    taskStatusBadgeClass,
    vmStatusBadgeClass,
    driveAuthBadgeClass,
    sourceTypeText,
    isActiveTask,
  }
}
