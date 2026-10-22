<script setup lang="ts">
// 任务筛选栏：状态多选 chip / 源类型下拉 / 关键字 / 时间范围 / 查询·重置
import type { TaskSourceType, TaskStatus, TaskListQuery } from '~/shared/types/task'

const emit = defineEmits<{
  (e: 'search', query: Partial<TaskListQuery>): void
}>()

const fmt = useFormat()

const STATUS_OPTIONS: TaskStatus[] = [
  'pending',
  'queued',
  'preparing',
  'downloading',
  'retry_wait',
  'completed',
  'failed',
  'cancelled',
]
const SOURCE_OPTIONS: { value: '' | TaskSourceType; label: string }[] = [
  { value: '', label: '全部来源' },
  { value: 'huggingface', label: 'HuggingFace' },
  { value: 'http', label: 'HTTP' },
  { value: 'github', label: 'GitHub' },
  { value: 'gdrive', label: 'GDrive' },
  { value: 'torrent', label: 'Torrent' },
]

const statusSel = ref<TaskStatus[]>([])
const sourceType = ref<'' | TaskSourceType>('')
const keyword = ref('')
const createdFrom = ref('')
const createdTo = ref('')

function toggleStatus(s: TaskStatus) {
  const i = statusSel.value.indexOf(s)
  if (i >= 0) statusSel.value.splice(i, 1)
  else statusSel.value.push(s)
  doSearch() // chip 即点即查
}

function doSearch() {
  emit('search', {
    status: statusSel.value.length ? [...statusSel.value] : undefined,
    sourceType: sourceType.value ? [sourceType.value] : undefined,
    keyword: keyword.value.trim() || undefined,
    createdFrom: createdFrom.value ? new Date(createdFrom.value).toISOString() : undefined,
    createdTo: createdTo.value ? new Date(createdTo.value).toISOString() : undefined,
  })
}

function reset() {
  statusSel.value = []
  sourceType.value = ''
  keyword.value = ''
  createdFrom.value = ''
  createdTo.value = ''
  doSearch()
}
</script>

<template>
  <div class="panel container_taskFilterBar_bar">
    <div class="panel-bd flex items-center gap-6 wrap container_taskFilterBar_body">
      <!-- 状态多选 chip -->
      <div class="flex items-center gap-2 wrap container_taskFilterBar_body_statusChips">
        <button
          v-for="s in STATUS_OPTIONS"
          :key="s"
          class="btn btn-sm container_taskFilterBar_body_statusChips_chip"
          :class="[statusSel.includes(s) ? 'btn-primary' : 'btn-ghost', `container_taskFilterBar_body_statusChips_chip_${s}`]"
          @click="toggleStatus(s)"
        >
          {{ fmt.taskStatusText(s) }}
        </button>
      </div>

      <span class="flex-1"></span>

      <!-- 源类型 / 关键字 / 时间范围 -->
      <select v-model="sourceType" class="select container_taskFilterBar_body_source" @change="doSearch">
        <option v-for="o in SOURCE_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
      </select>
      <input
        v-model="keyword"
        class="input container_taskFilterBar_body_keyword"
        placeholder="关键字：名称 / URL"
        @keyup.enter="doSearch"
      />
      <input v-model="createdFrom" type="datetime-local" class="input container_taskFilterBar_body_from" title="创建时间起" @change="doSearch" />
      <span class="c-mute text-xs">至</span>
      <input v-model="createdTo" type="datetime-local" class="input container_taskFilterBar_body_to" title="创建时间止" @change="doSearch" />
      <button class="btn btn-primary btn-sm" @click="doSearch">查询</button>
      <button class="btn btn-ghost btn-sm" @click="reset">重置</button>
    </div>
  </div>
</template>

<style scoped>
.container_taskFilterBar_body_source {
  width: 130px;
}
.container_taskFilterBar_body_keyword {
  width: 200px;
}
.container_taskFilterBar_body_from,
.container_taskFilterBar_body_to {
  width: 190px;
}
.container_taskFilterBar_body_statusChips_chip {
  padding: 3px 10px;
}
</style>
