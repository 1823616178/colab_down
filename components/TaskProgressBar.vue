<script setup lang="ts">
// 任务进度条（DESIGN.md §8.4 五形态）：
//   ① total 未知 → 不定态动画
//   ② 多文件 → 主条 + 副行 file (3/7)
//   ③ recovering → 半透明 + 「恢复连接中…」不清零
//   ④ 速度为 0 超 30s → stalled「停滞」
//   ⑤ retry_wait → 重试倒计时
// 数据优先级：手填 progress > useProgress 实时 Map > task 的 DB 快照字段
import type { TaskDTO } from '~/shared/types/task'
import type { TaskProgressState } from '~/shared/types/progress'

const props = defineProps<{
  taskId?: number
  task?: TaskDTO
  progress?: TaskProgressState | null
  compact?: boolean
}>()

const { tasks } = useProgress()
const fmt = useFormat()

/** 1s 节拍器：停滞检测与倒计时需要"现在"是响应式的 */
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  ticker = setInterval(() => (now.value = Date.now()), 1000)
})
onBeforeUnmount(() => {
  if (ticker) clearInterval(ticker)
})

/** 当前生效的进度状态 */
const state = computed<TaskProgressState>(() => {
  if (props.progress) return props.progress
  if (props.taskId != null) {
    const live = tasks.get(props.taskId)
    if (live) return live
  }
  const t = props.task
  return {
    downloaded: t?.downloadedBytes ?? 0,
    total: t?.totalBytes ?? null,
    speedBps: t?.speedBps ?? 0,
    etaSec: t?.etaSec ?? null,
    file: t?.currentFile ?? null,
    fileIndex: t?.fileDone ?? 0,
    fileTotal: t?.fileTotal ?? 0,
    progress: t?.progress ?? 0,
    updatedAt: t ? new Date(t.updatedAt).getTime() : 0,
  }
})

const status = computed(() => props.task?.status ?? 'downloading')

/** 停滞检测：最近一次有速度的时刻 */
const lastMovingAt = ref(0)
watch(
  () => state.value.speedBps,
  (v) => {
    if (v > 0) lastMovingAt.value = Date.now()
  },
  { immediate: true },
)
const stalled = computed(
  () =>
    status.value === 'downloading' &&
    !state.value.recovering &&
    state.value.speedBps <= 0 &&
    lastMovingAt.value > 0 &&
    now.value - lastMovingAt.value > 30_000,
)

const isRetryWait = computed(() => status.value === 'retry_wait')
const retryRemainSec = computed(() => {
  const at = props.task?.nextRetryAt
  if (!at) return null
  return Math.max(0, Math.ceil((new Date(at).getTime() - now.value) / 1000))
})

const percent = computed(() => {
  const s = state.value
  if (s.total && s.total > 0) return Math.min(100, (s.downloaded / s.total) * 100)
  return Math.min(100, s.progress || 0)
})

const unknownTotal = computed(() => !state.value.total || state.value.total <= 0)

/** 填充条形态类 */
const fillClass = computed(() => {
  if (status.value === 'failed') return 'failed'
  if (status.value === 'completed') return 'done'
  if (stalled.value) return 'stalled'
  if (unknownTotal.value && status.value === 'downloading') return 'indeterminate'
  return ''
})

/** 状态行文案 */
const statusLine = computed(() => {
  if (isRetryWait.value) {
    const cd = retryRemainSec.value
    const rc = props.task ? `（第 ${props.task.retryCount + 1}/${props.task.maxRetries} 次）` : ''
    return cd != null ? `将在 ${cd}s 后重试${rc}` : `等待重试${rc}`
  }
  if (state.value.recovering) return '恢复连接中…（进度保留，不清零）'
  if (stalled.value) return '⚠ 停滞：速度为 0 超过 30s（Drive 写入可能较慢，继续观察）'
  if (status.value === 'queued') return '排队中，等待空闲 VM（若长时间不动请检查 VM 授权）'
  return ''
})
</script>

<template>
  <div class="container_taskProgressBar_root" :class="{ compact }">
    <div
      class="progress-track container_taskProgressBar_track"
      :class="{ recovering: state.recovering }"
    >
      <div
        class="progress-fill container_taskProgressBar_track_fill"
        :class="fillClass"
        :style="{ width: unknownTotal && status === 'downloading' ? undefined : `${percent}%` }"
      ></div>
    </div>

    <div class="flex items-center gap-4 mt-2 text-xs container_taskProgressBar_info">
      <span class="mono c-primary bold">{{ unknownTotal && status === 'downloading' ? '—' : `${percent.toFixed(1)}%` }}</span>
      <span class="mono c-dim">{{ fmt.formatBytes(state.downloaded) }}<template v-if="!unknownTotal"> / {{ fmt.formatBytes(state.total) }}</template></span>
      <span v-if="!compact" class="mono c-dim">{{ fmt.formatSpeed(state.speedBps) }}</span>
      <span v-if="!compact" class="mono c-dim">ETA {{ fmt.formatEta(state.etaSec) }}</span>
      <span class="flex-1"></span>
      <span v-if="state.file && state.fileTotal > 1" class="mono c-accent ellipsis container_taskProgressBar_info_file">
        {{ state.file }} ({{ state.fileIndex }}/{{ state.fileTotal }})
      </span>
    </div>

    <div v-if="statusLine" class="text-xs mt-2 container_taskProgressBar_status" :class="stalled ? 'c-warn' : 'c-dim'">
      {{ statusLine }}
    </div>
  </div>
</template>

<style scoped>
.container_taskProgressBar_root {
  min-width: 140px;
}
.container_taskProgressBar_root.compact .container_taskProgressBar_info {
  margin-top: 4px;
}
.container_taskProgressBar_status {
  letter-spacing: 0.02em;
}
.container_taskProgressBar_info_file {
  max-width: 220px;
}
</style>
