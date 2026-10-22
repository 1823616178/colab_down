<script setup lang="ts">
// 任务详情抽屉：右侧滑出。打开时 task-detail 拉快照，SSE 增量走全站单例连接（按 taskId 过滤）
import type { TaskDTO, TaskFileDTO } from '~/shared/types/task'

const props = defineProps<{
  taskId: number | null
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'action', payload: { action: 'cancel' | 'retry' | 'delete'; taskId: number }): void
}>()

const { request } = useApi()
const { subscribe } = useProgress()
const toast = useToast()
const fmt = useFormat()

const visible = computed(() => props.taskId != null)
const task = ref<TaskDTO | null>(null)
const files = ref<TaskFileDTO[]>([])
const loading = ref(false)
const acting = ref(false)
const logViewerRef = ref<{ reload: () => void } | null>(null)

let unsubscribe: (() => void) | null = null

async function loadDetail(id: number) {
  loading.value = true
  try {
    const res = await request<{ task: TaskDTO; files: TaskFileDTO[] }>('/api/task-detail', {
      taskId: id,
    })
    task.value = res.task
    files.value = res.files
  } catch (e: any) {
    toast.err(e?.message || '加载任务详情失败')
    emit('close')
  } finally {
    loading.value = false
  }
}

// 打开抽屉：拉快照 + 订阅 SSE（该任务的状态变化 → 刷新快照）
watch(
  () => props.taskId,
  (id) => {
    unsubscribe?.()
    unsubscribe = null
    task.value = null
    files.value = []
    if (id == null) return
    loadDetail(id)
    unsubscribe = subscribe((name, data) => {
      const d = data as { taskId?: number }
      if (d?.taskId !== id) return
      if (name === 'task-status') loadDetail(id) // 状态变化 → 快照刷新（进度走 TaskProgressBar 实时 Map）
    })
  },
)

onBeforeUnmount(() => unsubscribe?.())

async function doAction(action: 'cancel' | 'retry' | 'delete') {
  if (props.taskId == null || acting.value) return
  acting.value = true
  try {
    emit('action', { action, taskId: props.taskId })
  } finally {
    acting.value = false
  }
}

const fileStatusBadge: Record<string, string> = {
  pending: 'badge-muted',
  downloading: 'badge-primary',
  done: 'badge-ok',
  failed: 'badge-danger',
}
const fileStatusText: Record<string, string> = {
  pending: '等待',
  downloading: '下载中',
  done: '完成',
  failed: '失败',
}

const active = computed(() => (task.value ? fmt.isActiveTask(task.value.status) : false))
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="visible" class="container_taskDetailDrawer_mask" @click.self="emit('close')">
        <aside class="panel container_taskDetailDrawer_panel">
          <!-- 头部 -->
          <div class="panel-hd container_taskDetailDrawer_header">
            <span class="panel-hd-title">任务详情 <template v-if="task">#{{ task.id }}</template></span>
            <button class="btn btn-sm btn-ghost" @click="emit('close')">✕ 关闭</button>
          </div>

          <div class="container_taskDetailDrawer_body">
            <div v-if="loading && !task" class="flex justify-center p-8"><span class="spinner"></span></div>

            <template v-else-if="task">
              <!-- 基本信息 -->
              <div class="container_taskDetailDrawer_body_info">
                <div class="flex items-center gap-4 mb-4">
                  <span class="badge" :class="fmt.taskStatusBadgeClass(task.status)">
                    <span class="dot" :class="{ pulse: active }"></span>
                    {{ fmt.taskStatusText(task.status) }}
                  </span>
                  <span class="text-lg bold ellipsis" :title="task.name">{{ task.name }}</span>
                </div>
                <div class="grid container_taskDetailDrawer_body_info_grid text-xs">
                  <span class="c-mute">来源</span><span class="mono ellipsis" :title="task.sourceUrl">{{ task.sourceUrl }}</span>
                  <span class="c-mute">目标路径</span><span class="mono ellipsis" :title="task.destPath">{{ task.destPath }}</span>
                  <span class="c-mute">VM</span><span class="mono">{{ task.vmSessionName || '—' }}</span>
                  <span class="c-mute">优先级</span><span class="mono">{{ task.priority }}</span>
                  <span class="c-mute">重试</span><span class="mono">{{ task.retryCount }}/{{ task.maxRetries }}</span>
                  <span class="c-mute">创建时间</span><span class="mono">{{ fmt.formatTime(task.createdAt) }}</span>
                  <span class="c-mute">完成时间</span><span class="mono">{{ fmt.formatTime(task.completedAt) }}</span>
                  <template v-if="task.errorMsg">
                    <span class="c-mute">错误</span>
                    <span class="c-danger mono container_taskDetailDrawer_body_info_error">[{{ task.errorCode }}] {{ task.errorMsg }}</span>
                  </template>
                </div>
              </div>

              <!-- 进度 -->
              <div class="mt-6 container_taskDetailDrawer_body_progress">
                <TaskProgressBar :task-id="task.id" :task="task" />
              </div>

              <!-- 文件列表（多文件任务） -->
              <div v-if="files.length" class="mt-6 container_taskDetailDrawer_body_files">
                <div class="text-xs c-mute mb-2">文件列表（{{ files.length }}）</div>
                <div class="container_taskDetailDrawer_body_files_list">
                  <div v-for="f in files" :key="f.id" class="flex items-center gap-4 text-xs container_taskDetailDrawer_body_files_list_row">
                    <span class="mono ellipsis flex-1" :title="f.relPath">{{ f.relPath }}</span>
                    <span class="mono c-dim">{{ fmt.formatBytes(f.bytes) }}</span>
                    <span class="badge" :class="fileStatusBadge[f.status]">{{ fileStatusText[f.status] ?? f.status }}</span>
                  </div>
                </div>
              </div>

              <!-- 日志 -->
              <div class="mt-6 container_taskDetailDrawer_body_logs">
                <div class="flex items-center justify-between mb-2">
                  <span class="text-xs c-mute">运行日志</span>
                  <button class="btn btn-sm btn-ghost" @click="logViewerRef?.reload()">刷新</button>
                </div>
                <LogViewer ref="logViewerRef" :task-id="task.id" />
              </div>

              <!-- 操作 -->
              <div class="flex gap-4 mt-6 container_taskDetailDrawer_body_ops">
                <button v-if="active && !task.cancelRequested" class="btn btn-sm" :disabled="acting" @click="doAction('cancel')">取消任务</button>
                <button v-if="task.status === 'failed' || task.status === 'cancelled'" class="btn btn-sm btn-primary" :disabled="acting" @click="doAction('retry')">重试</button>
                <span class="flex-1"></span>
                <button class="btn btn-sm btn-danger" :disabled="acting" @click="doAction('delete')">删除任务</button>
              </div>
            </template>
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.container_taskDetailDrawer_mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(3, 5, 10, 0.6);
  backdrop-filter: blur(2px);
}
.container_taskDetailDrawer_panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(620px, 94vw);
  border-radius: 0;
  border-right: none;
  display: flex;
  flex-direction: column;
}
.container_taskDetailDrawer_body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}
.container_taskDetailDrawer_body_info_grid {
  grid-template-columns: 72px 1fr;
  gap: 6px 12px;
  align-items: center;
}
.container_taskDetailDrawer_body_info_error {
  word-break: break-all;
}
.container_taskDetailDrawer_body_files_list {
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
}
.container_taskDetailDrawer_body_files_list_row {
  padding: 4px 0;
  border-bottom: 1px dashed rgba(0, 229, 255, 0.06);
}
/* 抽屉滑入动画 */
.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.25s ease;
}
.drawer-enter-active .container_taskDetailDrawer_panel,
.drawer-leave-active .container_taskDetailDrawer_panel {
  transition: transform 0.25s ease;
}
.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}
.drawer-enter-from .container_taskDetailDrawer_panel,
.drawer-leave-to .container_taskDetailDrawer_panel {
  transform: translateX(40px);
}
</style>
