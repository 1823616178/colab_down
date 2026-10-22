<script setup lang="ts">
// VM 管理页（DESIGN.md §5.2 页面4）：操作行 + VMCard 网格 + 策略配置面板
import type { RuntimeType, VMDTO, DriveAuthStatusDTO } from '~/shared/types/vm'
import type { SettingDTO } from '~/shared/types/api'

const { request } = useApi()
const { subscribe, driveAuth } = useProgress()
const toast = useToast()

const vms = ref<VMDTO[]>([])
const loading = ref(true)
const acting = ref(false)

// ---------- 操作行状态 ----------
const RUNTIME_OPTIONS: RuntimeType[] = ['cpu', 'T4', 'L4', 'G4', 'H100', 'A100']
const newRuntime = ref<RuntimeType>('cpu')
const warmupCount = ref(2)
const warmupRuntime = ref<RuntimeType>('cpu')

// ---------- 授权面板 ----------
const authPanelVisible = ref(false)
const authPanelVmId = ref<number | null>(null)

function openAuth(vm: VMDTO) {
  authPanelVmId.value = vm.id
  authPanelVisible.value = true
}

async function load() {
  loading.value = true
  try {
    const [vmList, authList] = await Promise.all([
      request<VMDTO[]>('/api/vm-list', {}),
      request<DriveAuthStatusDTO[]>('/api/vm-drive-auth-status', {}),
    ])
    vms.value = vmList
    for (const d of authList) driveAuth.set(d.vmId, d)
  } catch (e: any) {
    toast.err(e?.message || '加载 VM 列表失败')
  } finally {
    loading.value = false
  }
}

// ---------- VM 操作 ----------
async function createVm() {
  acting.value = true
  try {
    await request<VMDTO>('/api/vm-create', { runtimeType: newRuntime.value })
    toast.ok('VM 创建中（bootstrap 约 90-110s，随后需要一次 Drive 授权）')
    load()
  } catch (e: any) {
    toast.err(e?.message || '创建 VM 失败')
  } finally {
    acting.value = false
  }
}

async function warmup() {
  acting.value = true
  try {
    await request<VMDTO[]>('/api/vm-warmup', { count: warmupCount.value, runtimeType: warmupRuntime.value })
    toast.ok(`已发起预热 ${warmupCount.value} 台，请逐台完成 Drive 授权`)
    load()
  } catch (e: any) {
    toast.err(e?.message || '预热失败')
  } finally {
    acting.value = false
  }
}

async function stopVm(vm: VMDTO, force: boolean) {
  if (force && !window.confirm(`确认强制停止 ${vm.sessionName}？当前任务将被中断。`)) return
  acting.value = true
  try {
    await request('/api/vm-stop', { vmId: vm.id, force })
    toast.ok(force ? '已强制停止' : '停止指令已发送（默认等当前任务跑完）')
    load()
  } catch (e: any) {
    toast.err(e?.message || '停止失败')
  } finally {
    acting.value = false
  }
}

async function stopAll() {
  if (!window.confirm('确认停止全部 VM？进行中的任务将被中断并重新排队。')) return
  acting.value = true
  try {
    await request('/api/vm-stop-all', {})
    toast.ok('已全部停止')
    load()
  } catch (e: any) {
    toast.err(e?.message || '操作失败')
  } finally {
    acting.value = false
  }
}

async function syncVms() {
  acting.value = true
  try {
    const res = await request<{ adopted: number; stopped: number }>('/api/vm-sync', {})
    toast.ok(`对账完成：接管 ${res.adopted} 台，清理 ${res.stopped} 台`)
    load()
  } catch (e: any) {
    toast.err(e?.message || '对账失败')
  } finally {
    acting.value = false
  }
}

// ---------- 策略配置 ----------
const settings = ref<SettingDTO[]>([])
const policySaving = ref(false)
const policy = reactive({
  max_vms: 2,
  idle_timeout: 3600,
  orphan_policy: 'adopt',
  auto_rebuild_vm: false,
})

function settingVal(key: string): string | null {
  return settings.value.find((s) => s.configKey === key)?.value ?? null
}

async function loadSettings() {
  try {
    settings.value = await request<SettingDTO[]>('/api/setting-list', {})
    policy.max_vms = Number(settingVal('max_vms')) || 2
    policy.idle_timeout = Number(settingVal('idle_timeout')) || 3600
    policy.orphan_policy = settingVal('orphan_policy') || 'adopt'
    policy.auto_rebuild_vm = settingVal('auto_rebuild_vm') === 'true'
  } catch {
    /* 静默 */
  }
}

async function savePolicy() {
  policySaving.value = true
  try {
    await request('/api/setting-update', {
      items: [
        { key: 'max_vms', value: String(policy.max_vms) },
        { key: 'idle_timeout', value: String(policy.idle_timeout) },
        { key: 'orphan_policy', value: policy.orphan_policy },
        { key: 'auto_rebuild_vm', value: String(policy.auto_rebuild_vm) },
      ],
    })
    toast.ok('策略配置已保存')
  } catch (e: any) {
    toast.err(e?.message || '保存失败')
  } finally {
    policySaving.value = false
  }
}

let unsub: (() => void) | null = null
onMounted(() => {
  load()
  loadSettings()
  // SSE：vm-status / drive-auth 增量就地合并
  unsub = subscribe((name, data) => {
    if (name === 'vm-status') {
      const d = data as { vmId: number; status: string; currentTaskId: number | null }
      const v = vms.value.find((x) => x.id === d.vmId)
      if (v) {
        v.status = d.status as VMDTO['status']
        v.currentTaskId = d.currentTaskId
      } else {
        load() // 新 VM 出现 → 全量刷新
      }
    }
    if (name === 'drive-auth') {
      const d = data as { vmId: number; state: string }
      const v = vms.value.find((x) => x.id === d.vmId)
      if (v) v.driveAuthState = d.state as VMDTO['driveAuthState']
    }
  })
})
onBeforeUnmount(() => unsub?.())
</script>

<template>
  <div class="container_vms_root">
    <!-- 操作行 -->
    <div class="panel container_vms_actionBar">
      <div class="panel-bd flex items-center gap-6 wrap">
        <div class="flex items-center gap-4">
          <select v-model="newRuntime" class="select container_vms_actionBar_runtime">
            <option v-for="r in RUNTIME_OPTIONS" :key="r" :value="r">{{ r === 'cpu' ? 'CPU（默认，下载够用）' : r }}</option>
          </select>
          <button class="btn btn-primary btn-sm" :disabled="acting" @click="createVm">＋ 新建 VM</button>
        </div>

        <div class="flex items-center gap-4">
          <input v-model.number="warmupCount" type="number" min="1" max="5" class="input container_vms_actionBar_warmupN" />
          <button class="btn btn-sm" :disabled="acting" @click="warmup">预热 N 台并逐台授权</button>
        </div>

        <span class="flex-1"></span>
        <button class="btn btn-sm" :disabled="acting" @click="syncVms">手动对账</button>
        <button class="btn btn-sm btn-danger" :disabled="acting" @click="stopAll">全部停止</button>
      </div>
    </div>

    <!-- VM 卡片网格 -->
    <div v-if="loading" class="flex justify-center p-8"><span class="spinner"></span></div>
    <div v-else-if="!vms.length" class="panel mt-8">
      <div class="panel-bd text-center c-mute p-8">
        暂无 VM。新建 VM 后需完成一次 Google Drive 授权（约 30 秒）才能接任务。
        <div class="mt-6"><button class="btn btn-primary btn-sm" @click="createVm">立即新建 →</button></div>
      </div>
    </div>
    <div v-else class="grid gap-8 mt-8 container_vms_grid">
      <VMCard
        v-for="v in vms"
        :key="v.id"
        :vm="v"
        @auth="openAuth"
        @stop="stopVm(v, false)"
        @force-stop="stopVm(v, true)"
      />
    </div>

    <!-- 策略配置面板 -->
    <div class="panel mt-8 container_vms_policy">
      <div class="panel-hd"><span class="panel-hd-title">调度策略</span></div>
      <div class="panel-bd">
        <div class="grid gap-6 container_vms_policy_grid">
          <div>
            <label class="label">最大并行 VM 数（max_vms）</label>
            <input v-model.number="policy.max_vms" type="number" min="1" max="5" class="input" />
          </div>
          <div>
            <label class="label">空闲超时（idle_timeout，秒）</label>
            <input v-model.number="policy.idle_timeout" type="number" min="300" class="input" />
          </div>
          <div>
            <label class="label">孤儿 VM 处理（orphan_policy）</label>
            <select v-model="policy.orphan_policy" class="select">
              <option value="adopt">adopt — 接管继续使用</option>
              <option value="stop">stop — 直接停止</option>
              <option value="ignore">ignore — 忽略（手动处理）</option>
            </select>
          </div>
          <div>
            <label class="label">自动重建 VM（auto_rebuild_vm）</label>
            <select v-model="policy.auto_rebuild_vm" class="select">
              <option :value="false">关闭（推荐：重建需人工授权）</option>
              <option :value="true">开启</option>
            </select>
          </div>
        </div>
        <div class="text-xs c-mute mt-6">
          说明：VM 创建成本是「人的注意力」——每台新 VM 都要一次 Drive 授权。建议「预热」后提交队列，避免中途打扰。
        </div>
        <div class="flex justify-end mt-6">
          <button class="btn btn-primary btn-sm" :disabled="policySaving" @click="savePolicy">
            <span v-if="policySaving" class="spinner"></span>
            保存策略
          </button>
        </div>
      </div>
    </div>

    <DriveAuthPanel :visible="authPanelVisible" :vm-id="authPanelVmId" @close="authPanelVisible = false" />
  </div>
</template>

<style scoped>
.container_vms_actionBar_runtime {
  width: 200px;
}
.container_vms_actionBar_warmupN {
  width: 64px;
}
.container_vms_grid {
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
}
.container_vms_policy_grid {
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
}
</style>
