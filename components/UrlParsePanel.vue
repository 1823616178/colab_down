<script lang="ts">
// 批量行的对外类型（script setup 不允许命名导出，故放普通 script 块）
import type { ParsedUrl } from '~/shared/types/task'

export interface BatchRow extends ParsedUrl {
  selected: boolean
  editName: string
  editDestPath: string
}
</script>

<script setup lang="ts">
// 批量 URL 识别面板：粘贴 → task-parse-url → 结果表格（行可编辑 name/destPath）→ 勾选导出给父组件

const emit = defineEmits<{
  (e: 'change', rows: BatchRow[]): void
}>()

const { request } = useApi()
const toast = useToast()
const fmt = useFormat()

const rawText = ref('')
const parsing = ref(false)
const rows = ref<BatchRow[]>([])

const validCount = computed(() => rows.value.filter((r) => r.ok && r.selected).length)

async function parse() {
  const urls = rawText.value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!urls.length) {
    toast.warn('请先粘贴 URL（每行一个）')
    return
  }
  parsing.value = true
  try {
    const res = await request<ParsedUrl[]>('/api/task-parse-url', { urls })
    rows.value = res.map((r) => ({
      ...r,
      selected: r.ok,
      editName: r.name ?? '',
      editDestPath: r.suggestedDestPath ?? '',
    }))
    emitRows()
    const bad = res.filter((r) => !r.ok).length
    if (bad) toast.warn(`${res.length} 条中有 ${bad} 条无法识别`)
    else toast.ok(`成功识别 ${res.length} 条 URL`)
  } catch (e: any) {
    toast.err(e?.message || 'URL 识别失败')
  } finally {
    parsing.value = false
  }
}

function emitRows() {
  emit('change', rows.value)
}

function toggleRow(r: BatchRow) {
  if (!r.ok) return
  r.selected = !r.selected
  emitRows()
}

const allChecked = computed(() => rows.value.some((r) => r.ok) && rows.value.filter((r) => r.ok).every((r) => r.selected))

function toggleAll() {
  const target = !allChecked.value
  rows.value.forEach((r) => {
    if (r.ok) r.selected = target
  })
  emitRows()
}
</script>

<template>
  <div class="container_urlParsePanel_root">
    <!-- 粘贴区 -->
    <textarea
      v-model="rawText"
      class="textarea mono container_urlParsePanel_input"
      placeholder="每行一个 URL，支持 HuggingFace repo / HTTP 直链 / GitHub Release / GDrive 分享链接"
      rows="5"
    ></textarea>
    <div class="flex items-center gap-4 mt-4">
      <button class="btn btn-primary btn-sm" :disabled="parsing" @click="parse">
        <span v-if="parsing" class="spinner"></span>
        智能识别
      </button>
      <span v-if="rows.length" class="text-xs c-dim">已选 {{ validCount }} / {{ rows.length }} 条</span>
    </div>

    <!-- 识别结果 -->
    <div v-if="rows.length" class="mt-6 container_urlParsePanel_result">
      <table class="table">
        <thead>
          <tr>
            <th><input type="checkbox" :checked="allChecked" @change="toggleAll" /></th>
            <th>状态</th>
            <th>类型</th>
            <th>原始 URL</th>
            <th>任务名（可编辑）</th>
            <th>目标路径（可编辑）</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in rows" :key="i" :class="{ selected: r.selected }" class="container_urlParsePanel_result_row">
            <td><input type="checkbox" :checked="r.selected" :disabled="!r.ok" @change="toggleRow(r)" /></td>
            <td>
              <span v-if="r.ok" class="badge badge-ok"><span class="dot"></span>已识别</span>
              <span v-else class="badge badge-danger" :title="r.error"><span class="dot"></span>无法识别</span>
            </td>
            <td>
              <span v-if="r.sourceType" class="badge badge-accent">{{ fmt.sourceTypeText(r.sourceType) }}</span>
              <span v-else class="c-mute">—</span>
            </td>
            <td>
              <div class="mono text-xs ellipsis container_urlParsePanel_result_url" :title="r.url">{{ r.url }}</div>
              <div v-if="r.error" class="text-xs c-danger">{{ r.error }}</div>
            </td>
            <td><input v-model="r.editName" class="input container_urlParsePanel_result_name" :disabled="!r.ok" @input="emitRows" /></td>
            <td><input v-model="r.editDestPath" class="input mono container_urlParsePanel_result_dest" :disabled="!r.ok" @input="emitRows" /></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.container_urlParsePanel_result {
  overflow-x: auto;
}
.container_urlParsePanel_result_url {
  max-width: 240px;
}
.container_urlParsePanel_result_name {
  min-width: 160px;
  padding: 5px 8px;
}
.container_urlParsePanel_result_dest {
  min-width: 180px;
  padding: 5px 8px;
  font-size: 11px;
}
</style>
