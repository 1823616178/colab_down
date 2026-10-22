<script setup lang="ts">
// 任务表格：勾选 / 名称 / 来源 / 目标路径 / 进度 / 速度 / ETA / 状态 / 创建时间 / 操作
// 排序由父组件驱动（服务端排序），多选经 v-model:selected 透出
import type { TaskDTO, TaskStatus, TaskListQuery } from '~/shared/types/task'

const props = withDefaults(
  defineProps<{
    tasks: TaskDTO[]
    loading?: boolean
    selected?: number[]
    sortBy?: TaskListQuery['sortBy']
    sortOrder?: 'asc' | 'desc'
  }>(),
  { loading: false, selected: () => [], sortBy: 'createdAt', sortOrder: 'desc' },
)

const emit = defineEmits<{
  (e: 'update:selected', ids: number[]): void
  (e: 'sort', sortBy: NonNullable<TaskListQuery['sortBy']>): void
  (e: 'action', payload: { action: 'cancel' | 'retry' | 'delete' | 'detail'; task: TaskDTO }): void
}>()

const fmt = useFormat()

/** 可排序列：表头点击切换 */
const sortableCols: { key: NonNullable<TaskListQuery['sortBy']>; label: string }[] = [
  { key: 'createdAt', label: '创建时间' },
  { key: 'speedBps', label: '速度' },
  { key: 'status', label: '状态' },
  { key: 'priority', label: '优先级' },
]

function onSort(key: NonNullable<TaskListQuery['sortBy']>) {
  emit('sort', key)
}

function sortMark(key: string): string {
  if (props.sortBy !== key) return ''
  return props.sortOrder === 'asc' ? ' ▲' : ' ▼'
}

// ---------- 多选 ----------
const allChecked = computed(
  () => props.tasks.length > 0 && props.tasks.every((t) => props.selected.includes(t.id)),
)

function toggleAll() {
  emit('update:selected', allChecked.value ? [] : props.tasks.map((t) => t.id))
}

function toggleOne(id: number) {
  const set = new Set(props.selected)
  if (set.has(id)) set.delete(id)
  else set.add(id)
  emit('update:selected', [...set])
}

// ---------- 行操作可用性 ----------
function canCancel(t: TaskDTO): boolean {
  return fmt.isActiveTask(t.status) && !t.cancelRequested
}
function canRetry(t: TaskDTO): boolean {
  return t.status === 'failed' || t.status === 'cancelled'
}

/** queued 且系统在等待授权时，提示原因（设计 §6.0.5⑤ 任务卡住原因直显） */
const { awaitingCount } = useDriveAuth()
function statusHint(t: TaskDTO): string {
  if (t.status === 'queued' && awaitingCount.value > 0) return '等待 VM 授权'
  if (t.cancelRequested) return '取消中…'
  return ''
}
</script>

<template>
  <div class="container_taskTable_wrap">
    <table class="table container_taskTable_table">
      <thead>
        <tr>
          <th class="container_taskTable_head_check"><input type="checkbox" :checked="allChecked" @change="toggleAll" /></th>
          <th>名称</th>
          <th>来源</th>
          <th>目标路径</th>
          <th class="container_taskTable_head_progress">进度</th>
          <th
            v-for="c in sortableCols"
            :key="c.key"
            class="sortable"
            :class="{ 'c-primary': sortBy === c.key }"
            @click="onSort(c.key)"
          >
            {{ c.label }}{{ sortMark(c.key) }}
          </th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td colspan="9" class="text-center p-8"><span class="spinner"></span></td>
        </tr>
        <tr v-else-if="!tasks.length">
          <td colspan="9" class="text-center p-8 c-mute">暂无任务，去 <NuxtLink to="/task-create">新建任务</NuxtLink> 吧</td>
        </tr>
        <template v-else>
        <tr
          v-for="t in tasks"
          :key="t.id"
          :class="{ selected: selected.includes(t.id) }"
          class="container_taskTable_body_row"
        >
          <td><input type="checkbox" :checked="selected.includes(t.id)" @change="toggleOne(t.id)" /></td>
          <td>
            <div class="ellipsis container_taskTable_body_name" :title="t.name">{{ t.name }}</div>
            <div class="text-xs c-mute mono ellipsis" :title="t.sourceUrl">#{{ t.id }} · {{ t.sourceUrl }}</div>
          </td>
          <td>
            <span class="badge badge-accent container_taskTable_body_source">{{ fmt.sourceTypeText(t.sourceType) }}</span>
          </td>
          <td>
            <span class="mono text-xs c-dim ellipsis container_taskTable_body_dest" :title="t.destPath">{{ t.destPath }}</span>
          </td>
          <td class="container_taskTable_body_progress">
            <TaskProgressBar :task-id="t.id" :task="t" compact />
          </td>
          <td class="mono text-xs">{{ fmt.formatSpeed(t.speedBps) }}</td>
          <td>
            <span class="badge container_taskTable_body_status" :class="[`${fmt.taskStatusBadgeClass(t.status)}`, `container_taskTable_body_status_${t.status}`]">
              <span v-if="fmt.isActiveTask(t.status)" class="dot pulse"></span>
              <span v-else class="dot"></span>
              {{ fmt.taskStatusText(t.status) }}
            </span>
            <div v-if="statusHint(t)" class="text-xs c-warn mt-2">{{ statusHint(t) }}</div>
          </td>
          <td class="mono text-xs c-dim">{{ fmt.formatTime(t.createdAt) }}</td>
          <td>
            <div class="flex gap-2 container_taskTable_body_ops">
              <button class="btn btn-sm btn-ghost" title="详情" @click="emit('action', { action: 'detail', task: t })">详情</button>
              <button v-if="canCancel(t)" class="btn btn-sm btn-ghost c-warn" @click="emit('action', { action: 'cancel', task: t })">取消</button>
              <button v-if="canRetry(t)" class="btn btn-sm btn-ghost c-primary" @click="emit('action', { action: 'retry', task: t })">重试</button>
              <button class="btn btn-sm btn-ghost c-danger" @click="emit('action', { action: 'delete', task: t })">删除</button>
            </div>
          </td>
        </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.container_taskTable_wrap {
  overflow-x: auto;
}
.container_taskTable_body_name {
  max-width: 240px;
}
.container_taskTable_body_dest {
  display: inline-block;
  max-width: 180px;
}
.container_taskTable_body_progress {
  min-width: 220px;
}
</style>
