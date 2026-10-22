import { getDataSource } from '../utils/db'
import { ApiError, ErrorCodes } from '../utils/response'
import { redact } from '../utils/logger'
import { DownloadLog } from '../entities/DownloadLog'
import type { LogLevel, LogSource } from '../entities/DownloadLog'
import { Task } from '../entities/Task'
import type { DownloadMode, TaskSourceType } from '../entities/Task'
import { TaskFile } from '../entities/TaskFile'
import type { TaskDTO, TaskFileDTO, TaskListQuery } from '../../shared/types/task'
import { TERMINAL_TASK_STATUS } from '../../shared/types/task'
import { getSetting, getSettingBool, getSettingInt } from './SettingService'
import { assertTransition } from './taskTransitions'

// 状态机守卫单独成纯模块（无 DB 依赖），此处再导出方便统一引用
export { assertTransition } from './taskTransitions'

const SOURCE_TYPES: readonly TaskSourceType[] = ['huggingface', 'http', 'github', 'gdrive', 'torrent']

export interface CreateTaskInput {
  name: string
  sourceType: TaskSourceType
  sourceUrl: string
  destPath: string
  revision?: string
  allowPatterns?: string[] | null
  ignorePatterns?: string[] | null
  priority?: number
  credentialId?: number
  downloadMode?: DownloadMode
  maxRetries?: number
}

/** dest_path 必须是 Drive 相对路径：拒绝绝对路径与 .. 穿越（DESIGN.md §12） */
function assertValidDestPath(destPath: string): void {
  const p = destPath.trim()
  if (!p) throw new ApiError(ErrorCodes.BAD_REQUEST, '目标路径不能为空')
  if (p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p)) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, '目标路径必须是相对路径（不含盘符/前导斜杠）')
  }
  if (p.split(/[\\/]+/).some((seg) => seg === '..')) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, '目标路径不能包含 ..')
  }
}

/** 归一化相对路径：统一分隔符、去重复斜杠、去首尾斜杠 */
function normalizeDestPath(destPath: string): string {
  return destPath
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/\/+$/, '')
}

/** 创建任务，初始 status=pending */
export async function createTask(input: CreateTaskInput): Promise<Task> {
  if (!SOURCE_TYPES.includes(input.sourceType)) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, `非法的下载源类型：${String(input.sourceType)}`)
  }
  assertValidDestPath(input.destPath)
  if (input.sourceType === 'torrent') {
    const enabled = await getSettingBool('enable_torrent', false)
    if (!enabled) {
      throw new ApiError(
        ErrorCodes.BAD_REQUEST,
        'torrent 源默认禁用（违反 Colab 服务条款，有封号风险），请在设置中手动开启',
      )
    }
  }

  const modeSetting = await getSetting('download_mode')
  const defaultMode: DownloadMode = modeSetting?.value === 'staged' ? 'staged' : 'direct'

  const repo = getDataSource().getRepository(Task)
  const task = repo.create({
    name: input.name,
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl,
    revision: input.revision ?? 'main',
    allowPatterns: input.allowPatterns?.length ? JSON.stringify(input.allowPatterns) : null,
    ignorePatterns: input.ignorePatterns?.length ? JSON.stringify(input.ignorePatterns) : null,
    destPath: normalizeDestPath(input.destPath),
    downloadMode: input.downloadMode ?? defaultMode,
    priority: input.priority ?? 100,
    credentialId: input.credentialId ?? null,
    maxRetries: input.maxRetries ?? (await getSettingInt('max_retries', 3)),
    status: 'pending',
  })
  return repo.save(task)
}

/** 列表查询：状态/源类型多选、关键字、时间范围、排序、分页 */
export async function listTasks(q: TaskListQuery): Promise<{ items: Task[]; total: number }> {
  const qb = getDataSource().getRepository(Task).createQueryBuilder('t')

  if (q.status?.length) qb.andWhere('t.status IN (:...status)', { status: q.status })
  if (q.sourceType?.length) qb.andWhere('t.sourceType IN (:...sourceType)', { sourceType: q.sourceType })
  if (q.keyword) {
    const kw = `%${q.keyword}%`
    qb.andWhere('(t.name LIKE :kw OR t.sourceUrl LIKE :kw)', { kw })
  }
  const from = q.createdFrom ? new Date(q.createdFrom) : null
  if (from && !Number.isNaN(from.getTime())) qb.andWhere('t.createdAt >= :from', { from })
  const to = q.createdTo ? new Date(q.createdTo) : null
  if (to && !Number.isNaN(to.getTime())) qb.andWhere('t.createdAt <= :to', { to })

  const sortMap: Record<string, string> = {
    id: 't.id',
    createdAt: 't.createdAt',
    priority: 't.priority',
    downloadedBytes: 't.downloadedBytes',
    speedBps: 't.speedBps',
    status: 't.status',
  }
  const sortCol = sortMap[q.sortBy ?? 'id'] ?? 't.id'
  qb.orderBy(sortCol, q.sortOrder === 'asc' ? 'ASC' : 'DESC')

  const page = Math.max(1, Math.floor(q.page) || 1)
  const pageSize = Math.min(200, Math.max(1, Math.floor(q.pageSize) || 20))
  qb.skip((page - 1) * pageSize).take(pageSize)

  const [items, total] = await qb.getManyAndCount()
  return { items, total }
}

export async function getTask(taskId: number): Promise<Task> {
  const task = await getDataSource().getRepository(Task).findOneBy({ id: taskId })
  if (!task) throw new ApiError(ErrorCodes.TASK_NOT_FOUND, '任务不存在')
  return task
}

export async function listTasksByIds(ids: number[]): Promise<Task[]> {
  if (!ids.length) return []
  return getDataSource().getRepository(Task).findByIds(ids)
}

/** 仅非终态可改 */
export async function updateTask(
  taskId: number,
  patch: { name?: string; destPath?: string; priority?: number; maxRetries?: number },
): Promise<Task> {
  const task = await getTask(taskId)
  if (TERMINAL_TASK_STATUS.includes(task.status)) {
    throw new ApiError(ErrorCodes.ILLEGAL_STATE, '终态任务不可修改')
  }
  if (patch.name !== undefined) task.name = patch.name
  if (patch.destPath !== undefined) {
    assertValidDestPath(patch.destPath)
    task.destPath = normalizeDestPath(patch.destPath)
  }
  if (patch.priority !== undefined) task.priority = patch.priority
  if (patch.maxRetries !== undefined) task.maxRetries = patch.maxRetries
  return getDataSource().getRepository(Task).save(task)
}

/** 终态或 pending 才能删；级联删 task_file / download_log */
export async function deleteTask(taskId: number): Promise<void> {
  const task = await getTask(taskId)
  if (!TERMINAL_TASK_STATUS.includes(task.status) && task.status !== 'pending') {
    throw new ApiError(ErrorCodes.ILLEGAL_STATE, '进行中的任务不能删除，请先取消')
  }
  await getDataSource().transaction(async (em) => {
    await em.delete(DownloadLog, { taskId })
    await em.delete(TaskFile, { taskId })
    await em.delete(Task, { id: taskId })
  })
}

/** 取消（DB 部分）：pending/retry_wait 直接置 cancelled；其余仅置 cancelRequested，由 runtime 推进 */
export async function requestCancel(taskId: number): Promise<{ task: Task; direct: boolean }> {
  const task = await getTask(taskId)
  if (TERMINAL_TASK_STATUS.includes(task.status)) {
    throw new ApiError(ErrorCodes.ILLEGAL_STATE, '任务已处于终态')
  }
  task.cancelRequested = true
  let direct = false
  if (task.status === 'pending' || task.status === 'retry_wait') {
    assertTransition(task.status, 'cancelled')
    task.status = 'cancelled'
    task.completedAt = new Date()
    direct = true
  }
  return { task: await getDataSource().getRepository(Task).save(task), direct }
}

/** 重试（DB 部分）：终态（failed/cancelled）→ 清 error/progress 置 pending */
export async function resetForRetry(taskId: number, resetRetryCount = false): Promise<Task> {
  const task = await getTask(taskId)
  if (task.status !== 'failed' && task.status !== 'cancelled') {
    throw new ApiError(ErrorCodes.ILLEGAL_STATE, '仅失败或已取消的任务可重试')
  }
  assertTransition(task.status, 'pending')
  task.status = 'pending'
  task.errorCode = null
  task.errorMsg = null
  task.progress = 0
  task.speedBps = 0
  task.etaSec = null
  task.currentFile = null
  task.cancelRequested = false
  task.nextRetryAt = null
  task.vmId = null
  task.vmSessionName = null
  task.startedAt = null
  task.completedAt = null
  if (resetRetryCount) task.retryCount = 0
  return getDataSource().getRepository(Task).save(task)
}

/** 任务日志（脱敏后落库） */
export async function appendTaskLog(
  taskId: number,
  level: LogLevel,
  source: LogSource,
  message: string,
): Promise<DownloadLog> {
  const repo = getDataSource().getRepository(DownloadLog)
  return repo.save(repo.create({ taskId, level, source, message: redact(message) }))
}

/** 日志倒序分页（LogViewer 依赖） */
export async function listTaskLogs(
  taskId: number,
  page: number,
  pageSize: number,
  level?: LogLevel,
): Promise<{ items: DownloadLog[]; total: number }> {
  const qb = getDataSource()
    .getRepository(DownloadLog)
    .createQueryBuilder('l')
    .where('l.taskId = :taskId', { taskId })
  if (level) qb.andWhere('l.level = :level', { level })
  qb.orderBy('l.id', 'DESC')
    .skip((Math.max(1, page) - 1) * pageSize)
    .take(Math.min(500, pageSize))
  const [items, total] = await qb.getManyAndCount()
  return { items, total }
}

export async function listTaskFiles(taskId: number): Promise<TaskFile[]> {
  return getDataSource().getRepository(TaskFile).find({ where: { taskId }, order: { id: 'ASC' } })
}

export async function listRecentTasksByVm(vmId: number, limit = 20): Promise<Task[]> {
  return getDataSource().getRepository(Task).find({
    where: { vmId },
    order: { id: 'DESC' },
    take: Math.min(100, limit),
  })
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null)

export function taskToDTO(t: Task): TaskDTO {
  return {
    id: t.id,
    name: t.name,
    sourceType: t.sourceType,
    sourceUrl: t.sourceUrl,
    revision: t.revision,
    allowPatterns: t.allowPatterns,
    ignorePatterns: t.ignorePatterns,
    destPath: t.destPath,
    downloadMode: t.downloadMode,
    priority: t.priority,
    status: t.status,
    cancelRequested: t.cancelRequested,
    progress: t.progress,
    totalBytes: t.totalBytes,
    downloadedBytes: t.downloadedBytes,
    resumeOffset: t.resumeOffset,
    speedBps: t.speedBps,
    etaSec: t.etaSec,
    currentFile: t.currentFile,
    fileTotal: t.fileTotal,
    fileDone: t.fileDone,
    errorCode: t.errorCode,
    errorMsg: t.errorMsg,
    retryCount: t.retryCount,
    maxRetries: t.maxRetries,
    nextRetryAt: iso(t.nextRetryAt),
    vmId: t.vmId,
    credentialId: t.credentialId,
    vmSessionName: t.vmSessionName,
    createdAt: t.createdAt.toISOString(),
    startedAt: iso(t.startedAt),
    updatedAt: t.updatedAt.toISOString(),
    completedAt: iso(t.completedAt),
  }
}

export function taskFileToDTO(f: TaskFile): TaskFileDTO {
  return {
    id: f.id,
    taskId: f.taskId,
    relPath: f.relPath,
    bytes: f.bytes,
    status: f.status,
    checksum: f.checksum,
    completedAt: iso(f.completedAt),
  }
}

export interface DownloadLogDTO {
  id: number
  taskId: number
  level: LogLevel
  source: LogSource
  message: string
  createdAt: string
}

export function downloadLogToDTO(l: DownloadLog): DownloadLogDTO {
  return {
    id: l.id,
    taskId: l.taskId,
    level: l.level,
    source: l.source,
    message: l.message,
    createdAt: l.createdAt.toISOString(),
  }
}
