<script setup lang="ts">
// 全局 Toast 渲染（右上角堆叠，类型色边，自动消失由 useToast 控制）
const { toasts, remove } = useToast()

const iconMap: Record<string, string> = {
  ok: '✓',
  err: '✕',
  warn: '⚠',
  info: 'ℹ',
}
</script>

<template>
  <div class="toast-wrap container_toast_wrap">
    <div
      v-for="t in toasts"
      :key="t.id"
      class="toast container_toast_item"
      :class="[`${t.type === 'info' ? '' : t.type}`, `container_toast_item_${t.type}`]"
      @click="remove(t.id)"
    >
      <span class="container_toast_item_icon mono mr-2" :class="`c-${t.type === 'err' ? 'danger' : t.type === 'ok' ? 'ok' : t.type === 'warn' ? 'warn' : 'primary'}`">{{ iconMap[t.type] }}</span>
      <span>{{ t.msg }}</span>
    </div>
  </div>
</template>

<style scoped>
.container_toast_item {
  cursor: pointer;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  word-break: break-all;
}
.mr-2 { margin-right: 2px; }
</style>
