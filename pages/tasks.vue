<script setup lang="ts">
// 任务列表页：筛选 + 表格 + 分页 + 批量操作 + 详情抽屉
// 首屏 task-list 快照；SSE 更新可见行（进度走 Map，状态变化合并到行）
import type { TaskDTO, TaskListQuery, TaskListResult } from '~/shared/types/task'

const { request } = useApi()
const { subscribe, seedTasks } = useProgress()
const toast = useToast()

const tasks = ref<TaskDTO[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)
const filters = ref<Partial<TaskListQuery>>({})
const sortBy = ref<NonNullable<TaskListQuery['sortBy']>>('createdAt')
const sortOrder = ref<'asc' | 'desc'>('desc')
const selected = ref<number[]>([])
const drawerTaskId = ref<number | null>(null)
const batching = ref(false)

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))

async function load() {
  loading.value = true
  try {
    const res = await request<TaskListResult>('/api/task-list', {
      page: page.value,
      pageSize,
      sortBy: sortBy.value,
      sortOrder: sortOrder.value,
      ...filters.value,
    })
    tasks.value = res.items
    total.value = res.total
    seedTasks(res.items) // 首屏一致性：快照灌进进度 Map
  } catch (e: any) {
    toast.err(e?.message || '加载任务列表失败')
  } finally {
    loading.value = false
  }
}

function onSearch(q: Partial<TaskListQuery>) {
  filters.value = q
  page.value = 1
  selected.value = []
  load()
}

function onSort(key: NonNullable<TaskListQuery['sortBy']>) {
  if (sortBy.value === key) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortBy.value = key
    sortOrder.value = 'desc'
  }
  load()
}

function goPage(p: number) {
  if (p < 1 || p > totalPages.value || p === page.value) return
  page.value = p
  load()
}

// ---------- 行操作 ----------
async function rowAction(payload: { action: string; task: TaskDTO }) {
  const { action, task } = payload
  if (action === 'detail') {
    drawerTaskId.value = task.id
    return
  }
  if (action === 'delete' && !window.confirm(`确认删除任务「${task.name}」？此操作不可恢复。`)) return
  try {
    await request(`/api/task-${action}`, { taskId: task.id })
    toast.ok(`任务已${action === 'cancel' ? '取消' : action === 'retry' ? '重新排队' : '删除'}`)
    if (action === 'delete' && drawerTaskId.value === task.id) drawerTaskId.value = null
    load()
  } catch (e: any) {
    toast.err(e?.message || '操作失败')
  }
}

// 抽屉里的操作复用同一套逻辑
async function drawerAction(payload: { action: string; taskId: number }) {
  const t = tasks.value.find((x) => x.id === payload.taskId)
  await rowAction({ action: payload.action, task: t ?? ({ id: payload.taskId, name: `#${payload.taskId}` } as TaskDTO) })
}

// ---------- 批量操作 ----------
async function batchAction(action: 'cancel' | 'retry' | 'delete') {
  if (!selected.value.length || batching.value) return
  const label = action === 'cancel' ? '取消' : action === 'retry' ? '重试' : '删除'
  if (action === 'delete' && !window.confirm(`确认删除选中的 ${selected.value.length} 个任务？此操作不可恢复。`)) return
  batching.value = true
  try {
    const res = await request<{ succeeded: number[]; failed: { id: number; message: string }[] }>(
      '/api/task-batch-action',
      { taskIds: selected.value, action },
    )
    if (res.failed.length) {
      toast.warn(`批量${label}：成功 ${res.succeeded.length} 个，失败 ${res.failed.length} 个（${res.failed[0].message}）`)
    } else {
      toast.ok(`批量${label}成功：${res.succeeded.length} 个任务`)
    }
    selected.value = []
    load()
  } catch (e: any) {
    toast.err(e?.message || `批量${label}失败`)
  } finally {
    batching.value = false
  }
}

let unsub: (() => void) | null = null
onMounted(() => {
  load()
  // SSE：可见行的状态变化就地合并（进度条组件自行走实时 Map）
  unsub = subscribe((name, data) => {
    if (name !== 'task-status') return
    const d = data as { taskId: number; status: string; errorCode?: string | null; error?: string | null }
    const t = tasks.value.find((x) => x.id === d.taskId)
    if (t) {
      t.status = d.status as TaskDTO['status']
      t.errorCode = d.errorCode ?? t.errorCode
      t.errorMsg = d.error ?? t.errorMsg
    }
  })
})
onBeforeUnmount(() => unsub?.())
</script>

<template>
  <div class="container_tasks_root">
    <TaskFilterBar @search="onSearch" />

    <!-- 批量操作栏 -->
    <div v-if="selected.length" class="panel mt-6 container_tasks_batchBar anim-fade-up">
      <div class="panel-bd flex items-center gap-6">
        <span class="text-sm">已选 <b class="c-primary mono">{{ selected.length }}</b> 项</span>
        <button class="btn btn-sm" :disabled="batching" @click="batchAction('cancel')">批量取消</button>
        <button class="btn btn-sm" :disabled="batching" @click="batchAction('retry')">批量重试</button>
        <button class="btn btn-sm btn-danger" :disabled="batching" @click="batchAction('delete')">批量删除</button>
        <span class="flex-1"></span>
        <button class="btn btn-sm btn-ghost" @click="selected = []">清除选择</button>
      </div>
    </div>

    <!-- 表格 -->
    <div class="panel mt-6 container_tasks_tablePanel">
      <TaskTable
        v-model:selected="selected"
        :tasks="tasks"
        :loading="loading"
        :sort-by="sortBy"
        :sort-order="sortOrder"
        @sort="onSort"
        @action="rowAction"
      />
    </div>

    <!-- 分页 -->
    <div class="flex items-center gap-4 mt-6 container_tasks_pager">
      <span class="text-xs c-mute">共 {{ total }} 条 · 第 {{ page }}/{{ totalPages }} 页</span>
      <span class="flex-1"></span>
      <button class="btn btn-sm" :disabled="page <= 1" @click="goPage(1)">«</button>
      <button class="btn btn-sm" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
      <button class="btn btn-sm" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</button>
      <button class="btn btn-sm" :disabled="page >= totalPages" @click="goPage(totalPages)">»</button>
    </div>

    <!-- 详情抽屉 -->
    <TaskDetailDrawer :task-id="drawerTaskId" @close="drawerTaskId = null" @action="drawerAction" />
  </div>
</template>
