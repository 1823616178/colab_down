import { getDataSource } from '../utils/db'
import { Task } from '../entities/Task'
import { VM } from '../entities/VM'
import type { StatsOverview } from '../../shared/types/api'
import { getSettingInt } from './SettingService'
import { driveQuota } from './DriveService'

/** Dashboard 统计总览（TASK.md Phase 6.1） */
export async function statsOverview(): Promise<StatsOverview> {
  const ds = getDataSource()
  const taskRepo = ds.getRepository(Task)

  // 各状态计数
  const rows = await taskRepo
    .createQueryBuilder('t')
    .select('t.status', 'status')
    .addSelect('COUNT(*)', 'cnt')
    .groupBy('t.status')
    .getRawMany<{ status: string; cnt: string | number }>()
  const count: Record<string, number> = {}
  for (const r of rows) count[r.status] = Number(r.cnt)

  // 今日完成数与字节（completed_at >= 今日 0 点）
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayRow = await taskRepo
    .createQueryBuilder('t')
    .select('COUNT(*)', 'cnt')
    .addSelect('COALESCE(SUM(t.downloadedBytes), 0)', 'bytes')
    .where('t.status = :s', { s: 'completed' })
    .andWhere('t.completedAt >= :d', { d: todayStart })
    .getRawOne<{ cnt: string | number; bytes: string | number }>()

  // 当前总速度（downloading 的 speed_bps 求和）
  const speedRow = await taskRepo
    .createQueryBuilder('t')
    .select('COALESCE(SUM(t.speedBps), 0)', 'spd')
    .where('t.status = :s', { s: 'downloading' })
    .getRawOne<{ spd: string | number }>()

  // 活跃 VM（非 stopped/error）
  const activeVms = await ds
    .getRepository(VM)
    .createQueryBuilder('v')
    .where('v.status NOT IN (:...bad)', { bad: ['stopped', 'error'] })
    .getCount()

  const maxVms = await getSettingInt('max_vms', 2)
  // Drive 配额探测失败时为 null（DriveService 不抛错）
  const quota = await driveQuota()

  return {
    totalTasks: Object.values(count).reduce((a, b) => a + b, 0),
    downloading: count['downloading'] ?? 0,
    pending: count['pending'] ?? 0,
    queued: (count['queued'] ?? 0) + (count['preparing'] ?? 0),
    completed: count['completed'] ?? 0,
    failed: count['failed'] ?? 0,
    cancelled: count['cancelled'] ?? 0,
    retryWait: count['retry_wait'] ?? 0,
    todayCompleted: Number(todayRow?.cnt ?? 0),
    todayBytes: Number(todayRow?.bytes ?? 0),
    totalSpeedBps: Number(speedRow?.spd ?? 0),
    activeVms,
    maxVms,
    driveFreeBytes: quota.freeBytes,
    driveTotalBytes: quota.totalBytes,
  }
}
