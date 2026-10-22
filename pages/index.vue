<script setup lang="ts">
// 仪表盘：统计卡片 + 实时进度 + 活跃 VM + 最近完成 + 配额行
// 首屏：stats-overview + task-list + vm-list 快照；实时：SSE scope=active 增量
import type { StatsOverview } from '~/shared/types/api'
import type { TaskDTO, TaskListResult } from '~/shared/types/task'
import type { VMDTO } from '~/shared/types/vm'

const { request } = useApi()
const { stats: liveStats, tasks: liveTasks, subscribe, seedTasks } = useProgress()
const toast = useToast()
const fmt = useFormat()

const stats = ref<StatsOverview | null>(null)
const activeTasks = ref<TaskDTO[]>([])
const vms = ref<VMDTO[]>([])
const recentDone = ref<TaskDTO[]>([])
const loading = ref(true)

/** 活跃 VM（未停止） */
const activeVmList = computed(() =>
  vms.value.filter((v) => !['stopped'].includes(v.status)).slice(0, 6),
)

/** 实时下载任务：快照中活跃的任务（进度条走 SSE Map） */
const downloadingTasks = computed(() =>
  activeTasks.value.filter((t) => fmt.isActiveTask(t.status)).slice(0, 8),
)

/** 当前总带宽：优先 SSE stats 事件 */
const totalSpeedBps = computed(() => liveStats.value?.totalSpeedBps ?? stats.value?.totalSpeedBps ?? 0)
const todayBytes = computed(() => liveStats.value?.todayBytes ?? stats.value?.todayBytes ?? 0)

const driveFreePct = computed(() => {
  const s = stats.value
  if (!s?.driveTotalBytes || !s.driveFreeBytes) return null
  return (s.driveFreeBytes / s.driveTotalBytes) * 100
})

async function load() {
  loading.value = true
  try {
    const [st, act, done, vmList] = await Promise.all([
      request<StatsOverview>('/api/stats-overview', {}),
      request<TaskListResult>('/api/task-list', {
        page: 1,
        pageSize: 20,
        status: ['pending', 'queued', 'preparing', 'downloading', 'retry_wait'],
        sortBy: 'createdAt',
        sortOrder: 'desc',
      }),
      request<TaskListResult>('/api/task-list', {
        page: 1,
        pageSize: 10,
        status: ['completed'],
        sortBy: 'createdAt',
        sortOrder: 'desc',
      }),
      request<VMDTO[]>('/api/vm-list', {}),
    ])
    stats.value = st
    activeTasks.value = act.items
    recentDone.value = done.items
    vms.value = vmList
    // 首屏一致性：快照灌进进度 Map，SSE 增量再覆盖
    seedTasks(act.items)
  } catch (e: any) {
    toast.err(e?.message || '加载仪表盘数据失败')
  } finally {
    loading.value = false
  }
}

let unsub: (() => void) | null = null
let statsTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  load()
  // SSE：任务状态变化 → 同步本地快照行；VM 状态变化 → 更新 VM 卡片状态
  unsub = subscribe((name, data) => {
    if (name === 'task-status') {
      const d = data as { taskId: number; status: string; error?: string | null }
      const t = activeTasks.value.find((x) => x.id === d.taskId)
      if (t) {
        t.status = d.status as TaskDTO['status']
        if (d.error) t.errorMsg = d.error
      }
      // 状态变化可能让任务进出活跃列表，轻量刷新一次列表
      refreshActive()
    }
    if (name === 'vm-status') {
      const d = data as { vmId: number; status: string; currentTaskId: number | null }
      const v = vms.value.find((x) => x.id === d.vmId)
      if (v) {
        v.status = d.status as VMDTO['status']
        v.currentTaskId = d.currentTaskId
      } else {
        refreshVms()
      }
    }
  })
  // 30s 对一次统计快照（兜底）
  statsTimer = setInterval(async () => {
    try {
      stats.value = await request<StatsOverview>('/api/stats-overview', {})
    } catch {
      /* 静默 */
    }
  }, 30_000)
})

onBeforeUnmount(() => {
  unsub?.()
  if (statsTimer) clearInterval(statsTimer)
})

async function refreshActive() {
  try {
    const res = await request<TaskListResult>('/api/task-list', {
      page: 1,
      pageSize: 20,
      status: ['pending', 'queued', 'preparing', 'downloading', 'retry_wait'],
      sortBy: 'createdAt',
      sortOrder: 'desc',
    })
    activeTasks.value = res.items
    seedTasks(res.items)
  } catch {
    /* 静默 */
  }
}

async function refreshVms() {
  try {
    vms.value = await request<VMDTO[]>('/api/vm-list', {})
  } catch {
    /* 静默 */
  }
}
</script>

<template>
  <div class="container_dashboard_root">
    <div v-if="loading" class="flex justify-center p-8"><span class="spinner"></span></div>

    <template v-else>
      <!-- 统计卡片区 -->
      <div class="grid gap-8 container_dashboard_stats">
        <StatsCard label="总任务" :value="stats?.totalTasks ?? '—'" tone="default" />
        <StatsCard label="进行中" :value="liveStats?.downloading ?? stats?.downloading ?? '—'" tone="primary" />
        <StatsCard label="已完成" :value="stats?.completed ?? '—'" tone="ok" />
        <StatsCard label="失败" :value="stats?.failed ?? '—'" tone="danger" />
        <StatsCard label="今日下载" :value="fmt.formatBytes(todayBytes)" tone="accent" :sub="`今日完成 ${stats?.todayCompleted ?? 0} 个任务`" />
        <StatsCard label="当前总带宽" :value="fmt.formatSpeed(totalSpeedBps)" tone="primary" />
      </div>

      <!-- 配额行 -->
      <div class="panel mt-8 container_dashboard_quota">
        <div class="panel-bd flex items-center gap-12 wrap text-sm">
          <span class="c-dim">
            Drive 剩余：
            <b class="mono" :class="driveFreePct != null && driveFreePct < 10 ? 'c-danger' : 'c-primary'">
              {{ fmt.formatBytes(stats?.driveFreeBytes ?? null) }}
            </b>
            <span class="c-mute"> / {{ fmt.formatBytes(stats?.driveTotalBytes ?? null) }}</span>
          </span>
          <span class="c-dim">
            活跃 VM：<b class="mono c-primary">{{ liveStats?.activeVms ?? stats?.activeVms ?? 0 }}</b>
            <span class="c-mute"> / 上限 {{ stats?.maxVms ?? '—' }}</span>
          </span>
          <span class="flex-1"></span>
          <NuxtLink to="/task-create" class="btn btn-primary btn-sm">＋ 新建任务</NuxtLink>
        </div>
      </div>

      <div class="grid gap-8 mt-8 container_dashboard_main">
        <!-- 实时进度区 -->
        <div class="panel container_dashboard_livePanel">
          <div class="panel-hd">
            <span class="panel-hd-title">实时进度</span>
            <NuxtLink to="/tasks" class="text-xs">全部任务 →</NuxtLink>
          </div>
          <div class="panel-bd container_dashboard_livePanel_body">
            <div v-if="!downloadingTasks.length" class="text-center c-mute text-sm p-8">
              暂无进行中的任务
              <div class="mt-4"><NuxtLink to="/task-create" class="btn btn-sm btn-ghost">去创建 →</NuxtLink></div>
            </div>
            <div v-for="t in downloadingTasks" :key="t.id" class="container_dashboard_livePanel_body_item">
              <div class="flex items-center gap-4 mb-2">
                <span class="ellipsis text-sm" :title="t.name">{{ t.name }}</span>
                <span class="badge" :class="fmt.taskStatusBadgeClass(t.status)">
                  <span class="dot" :class="{ pulse: true }"></span>{{ fmt.taskStatusText(t.status) }}
                </span>
                <span class="flex-1"></span>
                <span class="mono text-xs c-mute">{{ fmt.formatSpeed(liveTasks.get(t.id)?.speedBps ?? t.speedBps) }}</span>
              </div>
              <TaskProgressBar :task-id="t.id" :task="t" compact />
            </div>
          </div>
        </div>

        <!-- 活跃 VM 区 -->
        <div class="panel container_dashboard_vmPanel">
          <div class="panel-hd">
            <span class="panel-hd-title">活跃 VM</span>
            <NuxtLink to="/vms" class="text-xs">VM 管理 →</NuxtLink>
          </div>
          <div class="panel-bd container_dashboard_vmPanel_body">
            <div v-if="!activeVmList.length" class="text-center c-mute text-sm p-8">
              暂无活跃 VM
              <div class="mt-4"><NuxtLink to="/vms" class="btn btn-sm btn-ghost">去创建 →</NuxtLink></div>
            </div>
            <div class="grid gap-6 container_dashboard_vmPanel_body_grid">
              <VMCard v-for="v in activeVmList" :key="v.id" :vm="v" compact />
            </div>
          </div>
        </div>
      </div>

      <!-- 最近完成 -->
      <div class="panel mt-8 container_dashboard_recent">
        <div class="panel-hd">
          <span class="panel-hd-title">最近完成</span>
        </div>
        <table class="table container_dashboard_recent_table">
          <thead>
            <tr><th>名称</th><th>大小</th><th>目标路径</th><th>完成时间</th></tr>
          </thead>
          <tbody>
            <tr v-if="!recentDone.length"><td colspan="4" class="text-center c-mute p-6">暂无完成任务</td></tr>
            <tr v-for="t in recentDone" :key="t.id">
              <td class="ellipsis container_dashboard_recent_table_name" :title="t.name">{{ t.name }}</td>
              <td class="mono text-xs">{{ fmt.formatBytes(t.downloadedBytes) }}</td>
              <td class="mono text-xs c-dim ellipsis container_dashboard_recent_table_dest" :title="t.destPath">{{ t.destPath }}</td>
              <td class="mono text-xs c-dim">{{ fmt.formatTime(t.completedAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.container_dashboard_stats {
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
}
.container_dashboard_main {
  grid-template-columns: 3fr 2fr;
}
@media (max-width: 1100px) {
  .container_dashboard_main {
    grid-template-columns: 1fr;
  }
}
.container_dashboard_livePanel_body_item {
  padding: 10px 0;
  border-bottom: 1px dashed rgba(0, 229, 255, 0.07);
}
.container_dashboard_livePanel_body_item:last-child {
  border-bottom: none;
}
.container_dashboard_vmPanel_body_grid {
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
}
.container_dashboard_recent_table_name {
  max-width: 280px;
}
.container_dashboard_recent_table_dest {
  max-width: 220px;
  display: inline-block;
}
</style>
