<script setup lang="ts">
// SSE 连接状态灯（全局顶栏）
import type { SseConnectionState } from '~/shared/types/progress'

const { connectionState } = useProgress()

const conf: Record<SseConnectionState, { badge: string; text: string; pulse: boolean }> = {
  open: { badge: 'badge-ok', text: '实时已连接', pulse: false },
  connecting: { badge: 'badge-warn', text: '连接中…', pulse: true },
  reconnecting: { badge: 'badge-warn', text: '重连中…', pulse: true },
  closed: { badge: 'badge-danger', text: '已断开', pulse: false },
}

const cur = computed(() => conf[connectionState.value] ?? conf.closed)
</script>

<template>
  <span
    class="badge container_connectionBadge_status"
    :class="[cur.badge, `container_connectionBadge_status_${connectionState}`]"
    title="SSE 实时推送连接状态"
  >
    <span class="dot" :class="{ pulse: cur.pulse }"></span>
    {{ cur.text }}
  </span>
</template>
