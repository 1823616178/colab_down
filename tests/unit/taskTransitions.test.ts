import { describe, it, expect } from 'vitest'
import { assertTransition, TASK_TRANSITIONS } from '../../server/services/taskTransitions'
import { ApiError } from '../../server/utils/response'
import type { TaskStatus } from '../../shared/types/task'

const ALL: TaskStatus[] = [
  'pending',
  'queued',
  'preparing',
  'downloading',
  'completed',
  'failed',
  'cancelled',
  'retry_wait',
]

describe('TaskService.assertTransition 状态机迁移守卫', () => {
  it('合法迁移全部放行', () => {
    const legal: Array<[TaskStatus, TaskStatus]> = [
      ['pending', 'queued'],
      ['pending', 'cancelled'],
      ['queued', 'preparing'],
      ['queued', 'pending'],
      ['queued', 'cancelled'],
      ['preparing', 'downloading'],
      ['preparing', 'failed'],
      ['preparing', 'cancelled'],
      ['downloading', 'completed'],
      ['downloading', 'failed'],
      ['downloading', 'cancelled'],
      ['failed', 'retry_wait'],
      ['failed', 'pending'],
      ['retry_wait', 'pending'],
      ['retry_wait', 'cancelled'],
      ['cancelled', 'pending'],
    ]
    for (const [from, to] of legal) {
      expect(() => assertTransition(from, to), `${from} → ${to}`).not.toThrow()
    }
  })

  it('非法迁移抛 ApiError(40901)', () => {
    const illegal: Array<[TaskStatus, TaskStatus]> = [
      ['pending', 'downloading'],
      ['pending', 'completed'],
      ['queued', 'downloading'],
      ['queued', 'completed'],
      ['preparing', 'completed'],
      ['downloading', 'pending'],
      ['completed', 'pending'],
      ['completed', 'failed'],
      ['completed', 'cancelled'],
      ['failed', 'downloading'],
      ['cancelled', 'downloading'],
      ['retry_wait', 'downloading'],
    ]
    for (const [from, to] of illegal) {
      try {
        assertTransition(from, to)
        expect.unreachable(`${from} → ${to} 应抛错`)
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError)
        expect((err as ApiError).code).toBe(40901)
      }
    }
  })

  it('同态写入视为合法 no-op', () => {
    for (const s of ALL) expect(() => assertTransition(s, s)).not.toThrow()
  })

  it('迁移表覆盖全部状态', () => {
    for (const s of ALL) expect(TASK_TRANSITIONS[s]).toBeDefined()
    expect(TASK_TRANSITIONS.completed).toHaveLength(0)
  })
})
