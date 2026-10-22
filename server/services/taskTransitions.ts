import type { TaskStatus } from '../../shared/types/task'
import { ApiError, ErrorCodes } from '../utils/response'

/**
 * Task 状态机迁移守卫（DESIGN.md §5）。
 * 纯模块：不依赖 DB / Nuxt 运行时，可被 vitest 直接 import。
 */

/** 合法迁移表（终态 completed 无出边） */
export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  pending: ['queued', 'cancelled'],
  queued: ['preparing', 'pending', 'cancelled'],
  preparing: ['downloading', 'failed', 'cancelled'],
  downloading: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: ['retry_wait', 'pending'],
  cancelled: ['pending'],
  retry_wait: ['pending', 'cancelled'],
}

/** 校验 from → to 是否合法；非法抛 ApiError(40901)。同态写入视为合法 no-op。 */
export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (from === to) return
  if (!TASK_TRANSITIONS[from].includes(to)) {
    throw new ApiError(ErrorCodes.ILLEGAL_STATE, `非法任务状态迁移：${from} → ${to}`)
  }
}
