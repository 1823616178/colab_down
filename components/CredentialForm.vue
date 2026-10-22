<script setup lang="ts">
// 凭据增改弹窗：name / type 下拉 / value 密码框（列表只显 hint，明文永不回显）
import type { CredentialDTO } from '~/shared/types/api'

const props = defineProps<{
  visible: boolean
  /** 编辑已有凭据时传入；新增为 null */
  editing?: CredentialDTO | null
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved'): void
}>()

const { request } = useApi()
const toast = useToast()

const TYPE_OPTIONS: { value: CredentialDTO['type']; label: string }[] = [
  { value: 'hf_token', label: 'HuggingFace Token' },
  { value: 'github_token', label: 'GitHub Token' },
  { value: 'rclone_drive', label: 'rclone Drive Token' },
  { value: 'other', label: '其他' },
]

const name = ref('')
const type = ref<CredentialDTO['type']>('hf_token')
const value = ref('')
const saving = ref(false)

const isEdit = computed(() => !!props.editing)

watch(
  () => props.visible,
  (v) => {
    if (!v) return
    name.value = props.editing?.name ?? ''
    type.value = props.editing?.type ?? 'hf_token'
    value.value = '' // 编辑时留空表示不修改
  },
)

async function save() {
  if (!name.value.trim()) {
    toast.warn('请填写凭据名称')
    return
  }
  if (!isEdit.value && !value.value.trim()) {
    toast.warn('请填写凭据内容')
    return
  }
  saving.value = true
  try {
    await request('/api/credential-upsert', {
      id: props.editing?.id,
      name: name.value.trim(),
      type: type.value,
      // 编辑时空值不传，避免覆盖已有凭据
      ...(value.value.trim() ? { value: value.value } : {}),
    })
    toast.ok(isEdit.value ? '凭据已更新' : '凭据已添加')
    emit('saved')
    emit('close')
  } catch (e: any) {
    toast.err(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="container_credentialForm_mask" @click.self="emit('close')">
      <div class="panel container_credentialForm_modal anim-fade-up">
        <div class="panel-hd">
          <span class="panel-hd-title">{{ isEdit ? '编辑凭据' : '新增凭据' }}</span>
          <button class="btn btn-sm btn-ghost" @click="emit('close')">✕</button>
        </div>
        <div class="panel-bd">
          <div class="mb-6">
            <label class="label">名称</label>
            <input v-model="name" class="input" placeholder="例如：主账号 HF Token" @keyup.enter="save" />
          </div>
          <div class="mb-6">
            <label class="label">类型</label>
            <select v-model="type" class="select">
              <option v-for="o in TYPE_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </div>
          <div class="mb-6">
            <label class="label">{{ isEdit ? '内容（留空则不修改）' : '内容' }}</label>
            <input
              v-model="value"
              type="password"
              class="input mono"
              :placeholder="isEdit ? `当前：${editing?.hint || '******'}` : 'hf_xxx / ghp_xxx / refresh_token'"
              autocomplete="new-password"
              @keyup.enter="save"
            />
            <div class="text-xs c-mute mt-2">凭据加密存储，保存后明文永不回显，列表仅显示末 4 位。</div>
          </div>
          <div class="flex justify-end gap-4">
            <button class="btn btn-sm btn-ghost" @click="emit('close')">取消</button>
            <button class="btn btn-sm btn-primary" :disabled="saving" @click="save">
              <span v-if="saving" class="spinner"></span>
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.container_credentialForm_mask {
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: rgba(3, 5, 10, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
}
.container_credentialForm_modal {
  width: min(440px, 92vw);
}
</style>
