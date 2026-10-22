<script setup lang="ts">
// Drive 目录选择器：drive-list 浏览 + 面包屑 + 新建目录；无可用 VM 时降级为手填
import type { DriveEntry } from '~/shared/types/api'

const props = defineProps<{
  visible: boolean
  /** 当前值，打开时作为初始路径 */
  modelValue?: string
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'select', path: string): void
}>()

const { request } = useApi()

const path = ref('') // 当前浏览路径（相对 drive_root，'' 为根）
const entries = ref<DriveEntry[]>([])
const loading = ref(false)
/** null=正常；'no-vm' 等错误时降级手填 */
const loadError = ref<string | null>(null)
const manualPath = ref('')
const newDirName = ref('')

const breadcrumbs = computed(() => {
  const parts = path.value.split('/').filter(Boolean)
  const crumbs: { label: string; path: string }[] = [{ label: 'Drive 根目录', path: '' }]
  parts.forEach((p, i) => {
    crumbs.push({ label: p, path: parts.slice(0, i + 1).join('/') })
  })
  return crumbs
})

const dirs = computed(() => entries.value.filter((e) => e.isDir))

async function loadDir(p: string) {
  loading.value = true
  loadError.value = null
  try {
    entries.value = await request<DriveEntry[]>('/api/drive-list', { path: p })
    path.value = p
  } catch (e: any) {
    loadError.value = e?.message || '无法浏览 Drive 目录'
    manualPath.value = p
  } finally {
    loading.value = false
  }
}

function goUp() {
  const parts = path.value.split('/').filter(Boolean)
  parts.pop()
  loadDir(parts.join('/'))
}

function enterDir(e: DriveEntry) {
  loadDir(path.value ? `${path.value}/${e.name}` : e.name)
}

function createDir() {
  // 目录在提交任务时由后端/Worker 按需创建，这里只拼路径
  const name = newDirName.value.trim().replace(/^\/+|\/+$/g, '')
  if (!name) return
  loadDir(path.value ? `${path.value}/${name}` : name)
  newDirName.value = ''
}

function confirm() {
  if (loadError.value) {
    const p = manualPath.value.trim()
    if (!p) return
    emit('select', p)
  } else {
    emit('select', path.value || '/')
  }
  emit('close')
}

watch(
  () => props.visible,
  (v) => {
    if (!v) return
    newDirName.value = ''
    const init = (props.modelValue ?? '').replace(/^\/+|\/+$/g, '')
    loadDir(init === '/' ? '' : init)
  },
)
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="container_drivePathPicker_mask" @click.self="emit('close')">
      <div class="panel container_drivePathPicker_modal anim-fade-up">
        <div class="panel-hd">
          <span class="panel-hd-title">选择 Drive 目标目录</span>
          <button class="btn btn-sm btn-ghost" @click="emit('close')">✕</button>
        </div>
        <div class="panel-bd container_drivePathPicker_body">
          <!-- 降级：无可用 VM / 浏览失败 → 手填 -->
          <template v-if="loadError">
            <div class="badge badge-warn mb-6"><span class="dot"></span>暂无已挂载 Drive 的 VM，请手动填写路径</div>
            <div class="text-xs c-mute mb-2">{{ loadError }}</div>
            <input v-model="manualPath" class="input mono" placeholder="例如 downloads/models/xxx" @keyup.enter="confirm" />
          </template>

          <template v-else>
            <!-- 面包屑 -->
            <div class="flex items-center gap-2 wrap text-xs mb-6 container_drivePathPicker_body_crumbs">
              <template v-for="(c, i) in breadcrumbs" :key="c.path">
                <span v-if="i" class="c-mute">/</span>
                <a class="pointer" @click="loadDir(c.path)">{{ c.label }}</a>
              </template>
            </div>

            <!-- 目录列表 -->
            <div class="container_drivePathPicker_body_list">
              <div v-if="loading" class="flex justify-center p-8"><span class="spinner"></span></div>
              <template v-else>
                <div v-if="path" class="container_drivePathPicker_body_list_row pointer c-dim" @click="goUp">📁 ..</div>
                <div
                  v-for="e in dirs"
                  :key="e.path"
                  class="container_drivePathPicker_body_list_row pointer"
                  @dblclick="enterDir(e)"
                  @click="enterDir(e)"
                >
                  📁 {{ e.name }}
                </div>
                <div v-if="!dirs.length && !path" class="c-mute text-sm p-4">（空目录）</div>
                <div v-else-if="!dirs.length" class="c-mute text-sm p-4">（无子目录）</div>
              </template>
            </div>

            <!-- 新建目录 -->
            <div class="flex gap-4 mt-6">
              <input v-model="newDirName" class="input" placeholder="新建目录名（回车进入）" @keyup.enter="createDir" />
              <button class="btn btn-sm" @click="createDir">进入新目录</button>
            </div>
          </template>

          <!-- 操作行 -->
          <div class="flex items-center gap-4 mt-8">
            <span class="mono text-xs c-dim ellipsis flex-1 container_drivePathPicker_body_cur">
              当前：<span class="c-primary">{{ loadError ? manualPath || '—' : '/' + (path || '') }}</span>
            </span>
            <button class="btn btn-sm btn-ghost" @click="emit('close')">取消</button>
            <button class="btn btn-sm btn-primary" :disabled="loading || (!!loadError && !manualPath.trim())" @click="confirm">选此目录</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.container_drivePathPicker_mask {
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: rgba(3, 5, 10, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
}
.container_drivePathPicker_modal {
  width: min(560px, 92vw);
}
.container_drivePathPicker_body_list {
  height: 260px;
  overflow-y: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: rgba(5, 7, 13, 0.5);
}
.container_drivePathPicker_body_list_row {
  padding: 7px 12px;
  font-size: 13px;
  border-bottom: 1px dashed rgba(0, 229, 255, 0.05);
}
.container_drivePathPicker_body_list_row:hover {
  background: rgba(0, 229, 255, 0.05);
  color: var(--primary);
}
</style>
