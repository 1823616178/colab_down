<script setup lang="ts">
// Drive 授权面板（DESIGN.md §6.0.5②）：
// ① 打开授权页面 ② URI 折叠 + 复制 ③ 我已完成授权（写回车）+ 600s 倒计时 + 取消/重新发起
// 状态随 SSE drive-auth 实时变化；原始错误直接展示
import type { DriveAuthStatusDTO } from '~/shared/types/vm'

const props = defineProps<{
  visible: boolean
  vmId: number | null
}>()
const emit = defineEmits<{
  (e: 'close'): void
}>()

const { request } = useApi()
const { driveAuth } = useProgress()
const toast = useToast()
const fmt = useFormat()

/** 本地快照（auth-start/status API 返回），SSE 增量优先覆盖 */
const snap = ref<DriveAuthStatusDTO | null>(null)
const busy = ref(false)
const uriExpanded = ref(false)

const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null

/** 当前生效状态：SSE Map 优先，fallback 快照 */
const cur = computed<DriveAuthStatusDTO | null>(() => {
  if (props.vmId == null) return null
  return driveAuth.get(props.vmId) ?? snap.value
})

const state = computed(() => cur.value?.state ?? 'none')

/** 状态行（§6.0.5②：⏳ → 🔄 → ✅） */
const stateLine = computed(() => {
  const map: Record<string, { icon: string; text: string; cls: string }> = {
    none: { icon: '·', text: '尚未发起授权', cls: 'c-dim' },
    requesting: { icon: '⏳', text: '正在获取授权链接…', cls: 'c-dim' },
    awaiting_user: { icon: '⏳', text: '等待授权中…请在打开的页面完成 Google 授权', cls: 'c-warn' },
    propagating: { icon: '🔄', text: '正在推送凭据到 VM…', cls: 'c-primary' },
    mounted: { icon: '✅', text: '已挂载 Google Drive', cls: 'c-ok' },
    lost: { icon: '⚠', text: 'Drive 挂载失效，需要重新授权', cls: 'c-danger' },
    timeout: { icon: '⏱', text: '授权超时（600s），请重新发起', cls: 'c-warn' },
    failed: { icon: '✕', text: '授权失败', cls: 'c-danger' },
  }
  return map[state.value] ?? map.none
})

/** 倒计时（expiresAt，CLI 600s 硬超时） */
const remainSec = computed(() => {
  const at = cur.value?.expiresAt
  if (!at || state.value !== 'awaiting_user') return null
  return Math.max(0, (new Date(at).getTime() - now.value) / 1000)
})

const canStart = computed(() => ['none', 'lost', 'timeout', 'failed'].includes(state.value))
const canConfirm = computed(() => state.value === 'awaiting_user')
const canCancel = computed(() => ['requesting', 'awaiting_user', 'propagating'].includes(state.value))

async function refresh() {
  if (props.vmId == null) return
  try {
    const list = await request<DriveAuthStatusDTO[]>('/api/vm-drive-auth-status', { vmId: props.vmId })
    snap.value = list.find((d) => d.vmId === props.vmId) ?? list[0] ?? null
  } catch (e: any) {
    toast.err(e?.message || '获取授权状态失败')
  }
}

async function start() {
  if (props.vmId == null || busy.value) return
  busy.value = true
  try {
    snap.value = await request<DriveAuthStatusDTO>('/api/vm-drive-auth-start', { vmId: props.vmId })
  } catch (e: any) {
    toast.err(e?.message || '发起授权失败')
  } finally {
    busy.value = false
  }
}

async function confirm() {
  if (props.vmId == null || busy.value) return
  busy.value = true
  try {
    await request('/api/vm-drive-auth-confirm', { vmId: props.vmId })
    toast.ok('已确认，正在推送凭据到 VM…')
  } catch (e: any) {
    toast.err(e?.message || '确认失败')
  } finally {
    busy.value = false
  }
}

async function cancel() {
  if (props.vmId == null || busy.value) return
  busy.value = true
  try {
    await request('/api/vm-drive-auth-cancel', { vmId: props.vmId })
    toast.info('已取消授权')
  } catch (e: any) {
    toast.err(e?.message || '取消失败')
  } finally {
    busy.value = false
  }
}

function openAuthPage() {
  const uri = cur.value?.authUri
  if (uri && process.client) window.open(uri, '_blank', 'noopener')
}

async function copyUri() {
  const uri = cur.value?.authUri
  if (!uri || !process.client) return
  try {
    await navigator.clipboard.writeText(uri)
    toast.ok('授权链接已复制')
  } catch {
    toast.warn('复制失败，请手动展开链接复制')
    uriExpanded.value = true
  }
}

watch(
  () => [props.visible, props.vmId],
  ([v, id]) => {
    if (v && id != null) {
      uriExpanded.value = false
      refresh()
      if (ticker) clearInterval(ticker)
      ticker = setInterval(() => (now.value = Date.now()), 1000)
    } else if (ticker) {
      clearInterval(ticker)
      ticker = null
    }
  },
)

onBeforeUnmount(() => {
  if (ticker) clearInterval(ticker)
})

// 授权成功后自动关面板（延迟 1.5s 让用户看到 ✅）
watch(state, (s) => {
  if (s === 'mounted' && props.visible) {
    toast.ok('Drive 已挂载，VM 进入可用状态')
    setTimeout(() => emit('close'), 1500)
  }
})
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="container_driveAuthPanel_mask" @click.self="emit('close')">
      <div class="panel panel-glow container_driveAuthPanel_modal anim-fade-up">
        <div class="panel-hd">
          <span class="panel-hd-title">Google Drive 授权 — {{ cur?.sessionName || `VM#${vmId}` }}</span>
          <button class="btn btn-sm btn-ghost" @click="emit('close')">✕</button>
        </div>

        <div class="panel-bd container_driveAuthPanel_body">
          <!-- 状态行 + 倒计时 -->
          <div class="flex items-center gap-4 mb-8">
            <span class="container_driveAuthPanel_body_state" :class="stateLine.cls">{{ stateLine.icon }} {{ stateLine.text }}</span>
            <span class="flex-1"></span>
            <span v-if="remainSec != null" class="mono c-warn bold container_driveAuthPanel_body_countdown">
              剩余 {{ fmt.formatCountdown(remainSec) }}
            </span>
          </div>

          <!-- ① 打开授权页面 -->
          <div v-if="cur?.authUri" class="container_driveAuthPanel_body_step mb-6">
            <div class="text-xs c-mute mb-2">① 在新标签页打开授权页面，选择账号并同意 Drive 访问权限</div>
            <div class="flex gap-4">
              <button class="btn btn-primary container_driveAuthPanel_body_open" @click="openAuthPage">打开授权页面 ↗</button>
              <button class="btn" @click="copyUri">复制链接</button>
              <button class="btn btn-ghost btn-sm" @click="uriExpanded = !uriExpanded">
                {{ uriExpanded ? '收起链接' : '显示链接' }}
              </button>
            </div>
            <div v-if="uriExpanded" class="mono text-xs c-dim mt-4 container_driveAuthPanel_body_uri">{{ cur.authUri }}</div>
          </div>

          <!-- ③ 确认 -->
          <div v-if="canConfirm" class="container_driveAuthPanel_body_step mb-6">
            <div class="text-xs c-mute mb-2">② 完成后点击下方按钮（系统会向授权进程写入回车）</div>
            <button class="btn btn-primary btn-lg btn-block" :disabled="busy" @click="confirm">
              <span v-if="busy" class="spinner"></span>
              我已完成授权
            </button>
          </div>

          <!-- 未发起 / 失败后的入口 -->
          <div v-if="canStart" class="container_driveAuthPanel_body_step mb-6">
            <button class="btn btn-primary btn-block" :disabled="busy" @click="start">
              <span v-if="busy" class="spinner"></span>
              {{ state === 'none' ? '发起授权' : '重新发起授权' }}
            </button>
          </div>

          <!-- 原始错误直显（排障效率优先，不做二次包装） -->
          <div v-if="cur?.error" class="mono text-xs c-danger container_driveAuthPanel_body_error mt-6">
            {{ cur.error }}
          </div>

          <!-- 操作行 -->
          <div class="flex gap-4 mt-8">
            <button v-if="canCancel" class="btn btn-sm" :disabled="busy" @click="cancel">取消授权</button>
            <button v-if="!canStart && !canCancel && state !== 'mounted'" class="btn btn-sm btn-ghost" :disabled="busy" @click="start">重新发起</button>
            <span class="flex-1"></span>
            <button class="btn btn-sm btn-ghost" @click="emit('close')">关闭</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.container_driveAuthPanel_mask {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(3, 5, 10, 0.7);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
}
.container_driveAuthPanel_modal {
  width: min(540px, 94vw);
}
.container_driveAuthPanel_body_state {
  font-size: 14px;
}
.container_driveAuthPanel_body_countdown {
  font-size: 16px;
  text-shadow: 0 0 10px rgba(255, 176, 32, 0.4);
}
.container_driveAuthPanel_body_uri {
  word-break: break-all;
  background: rgba(5, 7, 13, 0.6);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  max-height: 120px;
  overflow-y: auto;
}
.container_driveAuthPanel_body_error {
  background: rgba(255, 77, 109, 0.06);
  border: 1px solid rgba(255, 77, 109, 0.25);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  word-break: break-all;
}
</style>
