<script setup lang="ts">
// 统计卡片：label + stat-num 大数字 + 可选副行/图标槽
withDefaults(
  defineProps<{
    label: string
    value: string | number
    sub?: string
    tone?: 'default' | 'primary' | 'ok' | 'warn' | 'danger' | 'accent'
  }>(),
  { sub: '', tone: 'default' },
)
</script>

<template>
  <div class="panel container_statsCard_card" :class="`container_statsCard_card_${tone}`">
    <div class="flex items-center justify-between">
      <span class="text-xs c-mute container_statsCard_card_label">{{ label }}</span>
      <slot name="icon"></slot>
    </div>
    <div class="stat-num mt-4 container_statsCard_card_value" :class="{ 'c-primary': tone === 'primary', 'c-ok': tone === 'ok', 'c-warn': tone === 'warn', 'c-danger': tone === 'danger', 'c-accent': tone === 'accent' }">
      {{ value }}
    </div>
    <div v-if="sub || $slots.default" class="text-xs c-dim mt-2 container_statsCard_card_sub">
      <slot>{{ sub }}</slot>
    </div>
  </div>
</template>

<style scoped>
.container_statsCard_card {
  padding: 14px 16px;
  min-width: 0;
}
.container_statsCard_card_value {
  font-size: 24px;
  line-height: 1.2;
  word-break: break-all;
}
.container_statsCard_card_primary { border-color: rgba(0, 229, 255, 0.28); }
.container_statsCard_card_danger { border-color: rgba(255, 77, 109, 0.3); }
</style>
