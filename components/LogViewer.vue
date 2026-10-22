<script setup lang="ts">
// 日志查看器：级别过滤 + 自动滚底 + 最近 500 条渲染 + 「加载更早」分页
// 数据源：task-log API 快照（分页）+ useProgress SSE log 增量
import type { LogLine } from '~/composables/useProgress'

interface ApiLogItem {
  id: number
  level: string
  source: string
  message: string
  createdAt: string
}

const props = defineProps<{ taskId: number }>()

const { request } = useApi()
const { logs } = useProgress()
const { formatTime } = useFormat()

const LEVELS = ['all', 'info', 'warn', 'error', 'debug'] as const
const levelText: Record<string, string> = {
  all: '全部',
  info: '信息',
  warn: '警告',
  error: '错误',
  debug: '调试',
}

const snapshot = ref<ApiLogItem[]>([]) // 已按时间正序
const page = ref(1)
const total = ref(0)
const loading = ref(false)
const loadingMore = ref(false)
const levelFilter = ref<(typeof LEVELS)[number]>('all')
const autoScroll = ref(true)
const limit = ref(500)
const scrollEl = ref<HTMLElement | null>(null)
/** 快照拉取时刻（ms），早于它的 SSE 行视为已在快照里，去重 */
let snapshotFetchedAt = 0

// 统一行结构：{key, level, message, timeMs, live}
interface Row {
  key: string
  level: string
  message: string
  timeMs: number
  live: boolean
}

const rows = computed<Row[]>(() => {
  const fromApi: Row[] = snapshot.value.map((l) => ({
    key: `a${l.id}`,
    level: l.level,
    message: l.message,
    timeMs: new Date(l.createdAt).getTime(),
    live: false,
  }))
  const live: Row[] = (logs.get(props.taskId) ?? [])
    .filter((l: LogLine) => l.ts * 1000 > snapshotFetchedAt)
    .map((l: LogLine, i: number) => ({
      key: `s${Math.round(l.ts * 1000)}_${i}`,
      level: l.level,
      message: l.message,
      timeMs: l.ts * 1000,
      live: true,
    }))
  const merged = [...fromApi, ...live].sort((a, b) => a.timeMs - b.timeMs)
  const filtered =
    levelFilter.value === 'all' ? merged : merged.filter((r) => r.level === levelFilter.value)
  return filtered.slice(-limit.value)
})

const hasMore = computed(() => snapshot.value.length < total.value)

async function fetchLogs(p: number, append: boolean) {
  const res = await request<{ items: ApiLogItem[]; total: number }>('/api/task-log', {
    taskId: props.taskId,
    page: p,
    pageSize: 200,
  })
  total.value = res.total
  if (append) snapshot.value = [...res.items, ...snapshot.value] // 更早的页前插
  else snapshot.value = res.items
}

async function reload() {
  loading.value = true
  try {
    page.value = 1
    snapshotFetchedAt = Date.now()
    await fetchLogs(1, false)
  } catch {
    /* 抽屉里已有 toast 之外的容错：空态即可 */
  } finally {
    loading.value = false
    scrollToBottom()
  }
}

async function loadMore() {
  if (loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  try {
    page.value += 1
    await fetchLogs(page.value, true)
  } finally {
    loadingMore.value = false
  }
}

function scrollToBottom() {
  nextTick(() => {
    const el = scrollEl.value
    if (el && autoScroll.value) el.scrollTop = el.scrollHeight
  })
}

// 新日志到达时自动滚底
watch(
  () => rows.value.length,
  () => scrollToBottom(),
)

function onScroll() {
  const el = scrollEl.value
  if (!el) return
  // 用户上翻超过 40px 则暂停自动滚底，回底则恢复
  autoScroll.value = el.scrollHeight - el.scrollTop - el.clientHeight < 40
}

function levelColor(level: string): string {
  const map: Record<string, string> = {
    info: 'c-dim',
    warn: 'c-warn',
    error: 'c-danger',
    debug: 'c-mute',
  }
  return map[level] ?? 'c-dim'
}

defineExpose({ reload })
onMounted(reload)
</script>

<template>
  <div class="container_logViewer_root">
    <!-- 工具行：级别过滤 + 自动滚底 -->
    <div class="flex items-center gap-4 mb-4 wrap container_logViewer_toolbar">
      <button
        v-for="lv in LEVELS"
        :key="lv"
        class="btn btn-sm btn-ghost container_logViewer_toolbar_chip"
        :class="{ 'chip-on': levelFilter === lv }"
        @click="levelFilter = lv"
      >
        {{ levelText[lv] }}
      </button>
      <span class="flex-1"></span>
      <label class="flex items-center gap-2 text-xs c-dim pointer container_logViewer_toolbar_autoscroll">
        <input type="checkbox" :checked="autoScroll" @change="autoScroll = ($event.target as HTMLInputElement).checked" />
        自动滚底
      </label>
    </div>

    <!-- 日志体 -->
    <div ref="scrollEl" class="mono container_logViewer_scroll" @scroll.passive="onScroll">
      <div v-if="loading" class="flex justify-center p-8"><span class="spinner"></span></div>
      <div v-else-if="!rows.length" class="text-center c-mute text-sm p-8">暂无日志</div>
      <template v-else>
        <div v-if="hasMore" class="text-center mb-2">
          <button class="btn btn-sm btn-ghost" :disabled="loadingMore" @click="loadMore">
            <span v-if="loadingMore" class="spinner"></span>
            加载更早（剩 {{ total - snapshot.length }} 条）
          </button>
        </div>
        <div v-for="r in rows" :key="r.key" class="container_logViewer_scroll_line" :class="{ live: r.live }">
          <span class="c-mute">{{ formatTime(new Date(r.timeMs).toISOString()) }}</span>
          <span class="container_logViewer_scroll_line_level" :class="levelColor(r.level)">[{{ r.level.toUpperCase() }}]</span>
          <span class="container_logViewer_scroll_line_msg">{{ r.message }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.container_logViewer_root {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.chip-on {
  color: var(--primary);
  border-color: var(--line-strong);
  background: rgba(0, 229, 255, 0.06);
}
.container_logViewer_scroll {
  height: 320px;
  overflow-y: auto;
  background: rgba(5, 7, 13, 0.6);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.7;
}
.container_logViewer_scroll_line {
  display: flex;
  gap: 8px;
  white-space: pre-wrap;
  word-break: break-all;
}
.container_logViewer_scroll_line.live {
  background: rgba(0, 229, 255, 0.03);
}
.container_logViewer_scroll_line_level {
  flex-shrink: 0;
  width: 58px;
}
.container_logViewer_scroll_line_msg {
  flex: 1;
  min-width: 0;
  color: var(--text-1);
}
</style>
