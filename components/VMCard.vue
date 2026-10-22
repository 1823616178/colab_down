<script setup lang="ts">
// VM 卡片（DESIGN.md §6.0.5③）：状态徽标 / 当前任务 / 运行时长 / 到期倒计时 / 操作
import type { VMDTO } from '~/shared/types/vm'

const props = withDefaults(
  defineProps<{
    vm: VMDTO
    /** 精简模式（仪表盘用）：隐藏操作按钮 */
    compact?: boolean
  }>(),
  { compact: false },
)

const emit = defineEmits<{
  (e: 'auth', vm: VMDTO): void
  (e: 'stop', vm: VMDTO): void
  (e: 'forceStop', vm: VMDTO): void
}>()

const fmt = useFormat()

const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  ticker = setInterval(() => (now.value = Date.now()), 1000)
})
onBeforeUnmount(() => {
  if (ticker) clearInterval(ticker)
})

/** 徽标配置：优先按业务规则（§6.0.5③）覆盖通用 VM 状态 */
const badge = computed(() => {
  const vm = props.vm
  if (vm.status === 'awaiting_drive_auth' || vm.driveAuthState === 'awaiting_user')
    return { cls: 'badge-warn', text: '需要授权', pulse: true }
  if (vm.driveAuthState === 'lost') return { cls: 'badge-danger', text: 'Drive 挂载失效', pulse: false }
  if (vm.status === 'bootstrapping' || vm.status === 'creating')
    return { cls: 'badge-info', text: '准备中…', pulse: true }
  if (vm.status === 'idle')
    return vm.driveMounted
      ? { cls: 'badge-ok', text: '空闲 · Drive 已挂载', pulse: false }
      : { cls: 'badge-muted', text: '空闲', pulse: false }
  if (vm.status === 'busy') return { cls: 'badge-primary', text: '下载中', pulse: true }
  if (vm.status === 'reconnecting') return { cls: 'badge-warn', text: '恢复连接中', pulse: true }
  if (vm.status === 'stopped') return { cls: 'badge-muted', text: '已停止', pulse: false }
  if (vm.status === 'error') return { cls: 'badge-danger', text: '异常', pulse: false }
  return { cls: fmt.vmStatusBadgeClass(vm.status), text: fmt.vmStatusText(vm.status), pulse: false }
})

/** 是否需要亮出 [授权] 主按钮 */
const needAuth = computed(
  () =>
    props.vm.status === 'awaiting_drive_auth' ||
    ['awaiting_user', 'lost', 'timeout', 'failed'].includes(props.vm.driveAuthState),
)

const canStop = computed(() => !['stopped', 'stopping'].includes(props.vm.status))

/** 运行时长（创建至今） */
const uptime = computed(() => {
  const t = new Date(props.vm.createdAt).getTime()
  if (Number.isNaN(t)) return '—'
  return fmt.formatDuration((now.value - t) / 1000)
})

/** 到期倒计时（expires_at，Colab 23h 硬上限） */
const expiresRemainSec = computed(() => {
  const t = new Date(props.vm.expiresAt).getTime()
  if (Number.isNaN(t)) return null
  return (t - now.value) / 1000
})
const expiresCls = computed(() => {
  const s = expiresRemainSec.value
  if (s == null) return 'c-dim'
  if (s <= 0) return 'c-danger'
  if (s < 3600) return 'c-warn' // 到期前 1h 预警
  return 'c-dim'
})
</script>

<template>
  <div class="panel container_vmCard_card" :class="`container_vmCard_card_${vm.status}`">
    <!-- 头部：session 名 + 状态徽标 -->
    <div class="flex items-center justify-between container_vmCard_card_header">
      <span class="mono bold c-primary ellipsis container_vmCard_card_header_name" :title="vm.sessionName">
        {{ vm.sessionName }}
      </span>
      <span class="badge container_vmCard_card_header_status" :class="[`${badge.cls}`, `container_vmCard_card_header_status_${vm.status}`]">
        <span class="dot" :class="{ pulse: badge.pulse }"></span>
        {{ badge.text }}
      </span>
    </div>

    <!-- 主体信息 -->
    <div class="grid text-xs mt-6 container_vmCard_card_body">
      <span class="c-mute">运行时</span>
      <span class="mono">{{ vm.runtimeType }}{{ vm.runtimeType === 'cpu' ? '（CPU）' : '' }}</span>
      <span class="c-mute">当前任务</span>
      <span class="mono ellipsis" :title="vm.currentTaskName ?? undefined">
        <template v-if="vm.currentTaskId">#{{ vm.currentTaskId }} {{ vm.currentTaskName || '' }}</template>
        <template v-else>—</template>
      </span>
      <span class="c-mute">运行时长</span>
      <span class="mono">{{ uptime }}</span>
      <span class="c-mute">到期倒计时</span>
      <span class="mono" :class="expiresCls">
        {{ expiresRemainSec != null && expiresRemainSec > 0 ? fmt.formatDuration(expiresRemainSec) : '已到期' }}
      </span>
      <template v-if="vm.errorMsg">
        <span class="c-mute">错误</span>
        <span class="c-danger mono container_vmCard_card_body_error" :title="vm.errorMsg">{{ vm.errorMsg }}</span>
      </template>
    </div>

    <!-- 操作 -->
    <div v-if="!compact" class="flex gap-4 mt-6 container_vmCard_card_ops">
      <button
        v-if="needAuth"
        class="btn btn-primary btn-sm container_vmCard_card_ops_auth"
        @click="emit('auth', vm)"
      >
        {{ vm.driveAuthState === 'awaiting_user' ? '授权' : '重新授权' }}
      </button>
      <span class="flex-1"></span>
      <button v-if="canStop" class="btn btn-sm btn-ghost" @click="emit('stop', vm)">停止</button>
      <button v-if="canStop" class="btn btn-sm btn-danger" @click="emit('forceStop', vm)">强制停止</button>
    </div>
  </div>
</template>

<style scoped>
.container_vmCard_card {
  padding: 14px 16px;
  min-width: 0;
}
.container_vmCard_card_awaiting_drive_auth {
  border-color: rgba(255, 176, 32, 0.4);
  box-shadow: 0 0 14px rgba(255, 176, 32, 0.12);
}
.container_vmCard_card_header_name {
  max-width: 60%;
}
.container_vmCard_card_body {
  grid-template-columns: 72px 1fr;
  gap: 6px 10px;
  align-items: center;
}
.container_vmCard_card_body_error {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* [授权] 主按钮呼吸高亮 —— 授权是阻塞点，必须第一眼看见 */
.container_vmCard_card_ops_auth {
  animation: auth-breathe 1.6s ease-in-out infinite;
}
@keyframes auth-breathe {
  0%,
  100% {
    box-shadow: 0 0 6px rgba(0, 229, 255, 0.3);
  }
  50% {
    box-shadow: 0 0 18px rgba(0, 229, 255, 0.75);
  }
}
</style>
