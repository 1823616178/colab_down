<script setup lang="ts">
// 全局待授权横幅（§6.0.5①）：任一 VM awaiting_user 即常驻所有页面顶部
// 数据：SSE drive-auth Map 实时 + 首屏 vm-drive-auth-status 快照兜底
import type { DriveAuthStatusDTO } from '~/shared/types/vm'

const emit = defineEmits<{
  (e: 'openPanel', vmId: number): void
}>()

const { request } = useApi()
const { driveAuth, subscribe } = useProgress()
const fmt = useFormat()

const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null

/** 所有等待授权的 VM（SSE Map 驱动；首屏快照也会 merge 进 Map） */
const awaiting = computed(() =>
  [...driveAuth.values()]
    .filter((d) => d.state === 'awaiting_user')
    .sort((a, b) => (a.expiresAt ?? '').localeCompare(b.expiresAt ?? '')),
)

/** 最紧迫的一台：剩余时间最少 */
const mostUrgent = computed(() => awaiting.value[0] ?? null)

const urgentRemainSec = computed(() => {
  const at = mostUrgent.value?.expiresAt
  if (!at) return null
  return Math.max(0, (new Date(at).getTime() - now.value) / 1000)
})

/** 首屏快照（SSE 尚未推事件时横幅也不能缺席） */
async function seed() {
  try {
    const list = await request<DriveAuthStatusDTO[]>('/api/vm-drive-auth-status', {})
    for (const d of list) driveAuth.set(d.vmId, d)
  } catch {
    /* 静默：SSE 增量会补上 */
  }
}

let unsub: (() => void) | null = null

onMounted(() => {
  seed()
  ticker = setInterval(() => (now.value = Date.now()), 1000)
  // SSE drive-auth 增量由 useProgress 写入 Map，此处仅保留快照兜底
  unsub = subscribe(() => {})
})

onBeforeUnmount(() => {
  unsub?.()
  if (ticker) clearInterval(ticker)
})
function openMostUrgent() {
  // v-if 已保证 awaiting 非空，这里仍做空值保护
  const target = mostUrgent.value
  if (target) emit('openPanel', target.vmId)
}
</script>

<template>
  <div v-if="awaiting.length" class="container_driveAuthBanner_bar" role="alert">
    <span class="container_driveAuthBanner_bar_icon">⚠</span>
    <span class="container_driveAuthBanner_bar_text">
      <b class="c-warn">{{ awaiting.length }}</b> 台 VM 正在等待 Google Drive 授权
      <span class="c-dim">（任务将阻塞在排队中）</span>
    </span>
    <span v-if="urgentRemainSec != null" class="mono text-xs c-warn container_driveAuthBanner_bar_countdown">
      剩余 {{ fmt.formatCountdown(urgentRemainSec) }}
    </span>
    <button class="btn btn-primary btn-sm" @click="openMostUrgent">去授权 →</button>
  </div>
</template>

<style scoped>
.container_driveAuthBanner_bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: linear-gradient(90deg, rgba(255, 176, 32, 0.12), rgba(255, 176, 32, 0.04));
  border-bottom: 1px solid rgba(255, 176, 32, 0.35);
  font-size: 13px;
}
.container_driveAuthBanner_bar_icon {
  animation: banner-blink 1.2s ease-in-out infinite;
}
@keyframes banner-blink {
  50% {
    opacity: 0.3;
  }
}
.container_driveAuthBanner_bar_text {
  flex: 1;
  min-width: 0;
}
</style>
