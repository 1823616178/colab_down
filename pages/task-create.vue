<script setup lang="ts">
// 新建任务页：单任务表单（URL 失焦自动识别 + 高级项折叠）/ 批量模式 Tab（UrlParsePanel 一次提交）
import type { ParsedUrl, TaskDTO, DownloadMode } from '~/shared/types/task'
import type { CredentialDTO, SettingDTO } from '~/shared/types/api'
import type { BatchRow } from '~/components/UrlParsePanel.vue'

const { request } = useApi()
const toast = useToast()

const mode = ref<'single' | 'batch'>('single')

// ---------- 单任务表单 ----------
const url = ref('')
const parsing = ref(false)
const parsed = ref<ParsedUrl | null>(null)
const name = ref('')
const destPath = ref('')
const showAdvanced = ref(false)
const revision = ref('')
const allowPatterns = ref('')
const ignorePatterns = ref('')
const priority = ref(0)
const downloadMode = ref<DownloadMode>('direct')
const credentialId = ref<number | null>(null)
const maxRetries = ref(3)
const submitting = ref(false)
const pickerVisible = ref(false)

const credentials = ref<CredentialDTO[]>([])

/** URL 失焦自动识别 */
async function autoParse() {
  const u = url.value.trim()
  if (!u || parsing.value) return
  parsing.value = true
  try {
    const res = await request<ParsedUrl[]>('/api/task-parse-url', { urls: [u] })
    const r = res[0]
    parsed.value = r ?? null
    if (r?.ok) {
      if (!name.value) name.value = r.name ?? ''
      if (!destPath.value) destPath.value = r.suggestedDestPath ?? ''
      if (!revision.value && r.revision) revision.value = r.revision
    }
  } catch {
    /* 识别失败不打断输入，提交时后端还会校验 */
  } finally {
    parsing.value = false
  }
}

async function loadDefaults() {
  try {
    const [creds, settings] = await Promise.all([
      request<CredentialDTO[]>('/api/credential-list', {}),
      request<SettingDTO[]>('/api/setting-list', {}),
    ])
    credentials.value = creds
    // 默认值：default_dest_path / download_mode
    const dp = settings.find((s) => s.configKey === 'default_dest_path')?.value
    if (dp && !destPath.value) destPath.value = dp
    const dm = settings.find((s) => s.configKey === 'download_mode')?.value
    if (dm === 'direct' || dm === 'staged') downloadMode.value = dm
    const mr = settings.find((s) => s.configKey === 'max_retries')?.value
    if (mr) maxRetries.value = Number(mr) || 3
  } catch {
    /* 静默 */
  }
}

async function submitSingle() {
  if (!url.value.trim()) {
    toast.warn('请填写下载 URL')
    return
  }
  if (!destPath.value.trim()) {
    toast.warn('请填写目标路径')
    return
  }
  submitting.value = true
  try {
    const body: Record<string, unknown> = {
      name: name.value.trim() || parsed.value?.name || url.value.trim(),
      sourceType: parsed.value?.ok ? parsed.value.sourceType : undefined,
      sourceUrl: url.value.trim(),
      destPath: destPath.value.trim(),
      priority: priority.value,
      downloadMode: downloadMode.value,
      maxRetries: maxRetries.value,
    }
    if (revision.value.trim()) body.revision = revision.value.trim()
    if (allowPatterns.value.trim()) body.allowPatterns = allowPatterns.value.trim()
    if (ignorePatterns.value.trim()) body.ignorePatterns = ignorePatterns.value.trim()
    if (credentialId.value) body.credentialId = credentialId.value
    // sourceType 未识别时不传，交给后端兜底识别
    if (!body.sourceType) delete body.sourceType
    await request<TaskDTO>('/api/task-create', body)
    toast.ok('任务已创建，进入调度队列')
    navigateTo('/tasks')
  } catch (e: any) {
    toast.err(e?.message || '创建任务失败')
  } finally {
    submitting.value = false
  }
}

// ---------- 批量模式 ----------
const batchRows = ref<BatchRow[]>([])
const commonDestPath = ref('')
const batchSubmitting = ref(false)

const selectedRows = computed(() => batchRows.value.filter((r) => r.ok && r.selected))

async function submitBatch() {
  if (!selectedRows.value.length) {
    toast.warn('请先识别并勾选要提交的 URL')
    return
  }
  batchSubmitting.value = true
  try {
    const tasks = selectedRows.value.map((r) => ({
      name: r.editName.trim() || r.name || r.url,
      sourceType: r.sourceType,
      sourceUrl: r.normalizedUrl ?? r.url,
      destPath: r.editDestPath.trim() || r.suggestedDestPath || '',
      ...(r.revision ? { revision: r.revision } : {}),
    }))
    await request<TaskDTO[]>('/api/task-batch-create', {
      tasks,
      ...(commonDestPath.value.trim() ? { commonDestPath: commonDestPath.value.trim() } : {}),
    })
    toast.ok(`已批量创建 ${tasks.length} 个任务`)
    navigateTo('/tasks')
  } catch (e: any) {
    toast.err(e?.message || '批量创建失败')
  } finally {
    batchSubmitting.value = false
  }
}

onMounted(loadDefaults)
</script>

<template>
  <div class="container_taskCreate_root">
    <!-- 模式 Tab -->
    <div class="flex gap-4 mb-8 container_taskCreate_tabs">
      <button
        class="btn container_taskCreate_tabs_tab"
        :class="mode === 'single' ? 'btn-primary' : 'btn-ghost'"
        @click="mode = 'single'"
      >
        单任务
      </button>
      <button
        class="btn container_taskCreate_tabs_tab"
        :class="mode === 'batch' ? 'btn-primary' : 'btn-ghost'"
        @click="mode = 'batch'"
      >
        批量模式
      </button>
    </div>

    <!-- ============ 单任务 ============ -->
    <div v-if="mode === 'single'" class="panel container_taskCreate_singlePanel">
      <div class="panel-hd"><span class="panel-hd-title">创建下载任务</span></div>
      <div class="panel-bd">
        <div class="mb-6">
          <label class="label">下载 URL</label>
          <div class="relative">
            <input
              v-model="url"
              class="input mono"
              placeholder="Comfy-Org/MiniMax-H3 或 https://…（失焦自动识别）"
              @blur="autoParse"
            />
            <span v-if="parsing" class="spinner container_taskCreate_singlePanel_parseSpin"></span>
          </div>
          <div v-if="parsed" class="mt-2 text-xs">
            <span v-if="parsed.ok" class="badge badge-ok"><span class="dot"></span>已识别为 {{ parsed.sourceType }}</span>
            <span v-else class="badge badge-danger"><span class="dot"></span>{{ parsed.error || '无法识别，仍可手动提交' }}</span>
          </div>
        </div>

        <div class="grid gap-6 container_taskCreate_singlePanel_grid">
          <div>
            <label class="label">任务名</label>
            <input v-model="name" class="input" placeholder="留空用识别结果" />
          </div>
          <div>
            <label class="label">目标路径（Drive 相对路径）</label>
            <div class="flex gap-4">
              <input v-model="destPath" class="input mono flex-1" placeholder="downloads/models" />
              <button class="btn btn-sm" @click="pickerVisible = true">浏览 Drive…</button>
            </div>
          </div>
        </div>

        <!-- 高级项折叠 -->
        <div class="mt-6 container_taskCreate_singlePanel_advanced">
          <button class="btn btn-sm btn-ghost" @click="showAdvanced = !showAdvanced">
            {{ showAdvanced ? '▾ 收起高级选项' : '▸ 高级选项（revision / patterns / 优先级 / 凭据）' }}
          </button>
          <div v-if="showAdvanced" class="grid gap-6 mt-6 container_taskCreate_singlePanel_advanced_grid anim-fade-up">
            <div>
              <label class="label">Revision（HF 分支 / tag / commit）</label>
              <input v-model="revision" class="input mono" placeholder="main" />
            </div>
            <div>
              <label class="label">优先级（数字越大越先调度）</label>
              <input v-model.number="priority" type="number" class="input" />
            </div>
            <div>
              <label class="label">允许的文件模式（allowPatterns，逗号分隔）</label>
              <input v-model="allowPatterns" class="input mono" placeholder="*.safetensors, *.json" />
            </div>
            <div>
              <label class="label">忽略的文件模式（ignorePatterns，逗号分隔）</label>
              <input v-model="ignorePatterns" class="input mono" placeholder="*.bin, *.pt" />
            </div>
            <div>
              <label class="label">下载模式</label>
              <select v-model="downloadMode" class="select">
                <option value="direct">direct（直写 Drive，可跨 VM 续传）</option>
                <option value="staged">staged（先落 VM 再传，更快但不能续传）</option>
              </select>
            </div>
            <div>
              <label class="label">凭据（gated repo / 私有资源）</label>
              <select v-model="credentialId" class="select">
                <option :value="null">不使用凭据</option>
                <option v-for="c in credentials" :key="c.id" :value="c.id">{{ c.name }}（{{ c.hint }}）</option>
              </select>
            </div>
            <div>
              <label class="label">最大重试次数</label>
              <input v-model.number="maxRetries" type="number" min="0" max="10" class="input" />
            </div>
          </div>
        </div>

        <div class="flex justify-end gap-4 mt-8">
          <NuxtLink to="/tasks" class="btn btn-ghost">取消</NuxtLink>
          <button class="btn btn-primary" :disabled="submitting" @click="submitSingle">
            <span v-if="submitting" class="spinner"></span>
            创建任务
          </button>
        </div>
      </div>
    </div>

    <!-- ============ 批量模式 ============ -->
    <div v-else class="panel container_taskCreate_batchPanel">
      <div class="panel-hd"><span class="panel-hd-title">批量创建（逐行粘贴 → 识别 → 一次提交）</span></div>
      <div class="panel-bd">
        <UrlParsePanel @change="batchRows = $event" />
        <div class="flex items-center gap-4 mt-8">
          <input v-model="commonDestPath" class="input mono flex-1" placeholder="统一目标路径前缀（可选，覆盖各行路径）" />
          <button class="btn btn-primary" :disabled="batchSubmitting || !selectedRows.length" @click="submitBatch">
            <span v-if="batchSubmitting" class="spinner"></span>
            提交 {{ selectedRows.length }} 个任务
          </button>
        </div>
      </div>
    </div>

    <DrivePathPicker :visible="pickerVisible" :model-value="destPath" @close="pickerVisible = false" @select="destPath = $event" />
  </div>
</template>

<style scoped>
.container_taskCreate_singlePanel_grid {
  grid-template-columns: 1fr 1fr;
}
.container_taskCreate_singlePanel_advanced_grid {
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
}
.container_taskCreate_singlePanel_parseSpin {
  position: absolute;
  right: 10px;
  top: 10px;
}
@media (max-width: 900px) {
  .container_taskCreate_singlePanel_grid {
    grid-template-columns: 1fr;
  }
}
</style>
