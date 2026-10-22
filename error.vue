<script setup lang="ts">
// 全局错误页：大字故障码 + 返回首页
const props = defineProps<{
  error: {
    statusCode?: number
    statusMessage?: string
    message?: string
  }
}>()

const code = computed(() => props.error?.statusCode ?? 500)
const desc = computed(() => {
  const map: Record<number, string> = {
    404: '页面不存在或已被移除',
    403: '没有访问权限',
    500: '服务器内部错误',
  }
  return map[code.value] ?? props.error?.statusMessage ?? '发生未知错误'
})

function goHome() {
  clearError({ redirect: '/' })
}
</script>

<template>
  <div class="container_errorPage_root">
    <div class="container_errorPage_code mono glow-text c-primary">{{ code }}</div>
    <div class="container_errorPage_msg">{{ desc }}</div>
    <div v-if="error?.message && error.message !== desc" class="mono text-xs c-mute mt-4 container_errorPage_detail">
      {{ error.message }}
    </div>
    <button class="btn btn-primary mt-12" @click="goHome">返回首页</button>
  </div>
</template>

<style scoped>
.container_errorPage_root {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--bg-1);
}
.container_errorPage_code {
  font-size: 120px;
  font-weight: 700;
  letter-spacing: 0.1em;
  line-height: 1;
  animation: glitch 2.4s ease-in-out infinite;
}
@keyframes glitch {
  0%,
  92%,
  100% {
    transform: none;
    opacity: 1;
  }
  94% {
    transform: translateX(3px);
    opacity: 0.75;
  }
  96% {
    transform: translateX(-3px);
    opacity: 0.9;
  }
}
.container_errorPage_msg {
  margin-top: 16px;
  color: var(--text-1);
  font-size: 15px;
}
.container_errorPage_detail {
  max-width: 520px;
  word-break: break-all;
  text-align: center;
}
</style>
