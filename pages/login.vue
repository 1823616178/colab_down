<script setup lang="ts">
// 登录页 ⭐门面：全屏科技感 —— 发光卡片 / 动态网格 / 扫描线 / 粒子光点
definePageMeta({ layout: false })

const { login } = useAuth()
const toast = useToast()
const appName = useRuntimeConfig().public.appName

const username = ref('')
const password = ref('')
const loading = ref(false)
const errorMsg = ref('')

async function submit() {
  if (loading.value) return
  if (!username.value.trim() || !password.value) {
    errorMsg.value = '请输入用户名和密码'
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    await login(username.value.trim(), password.value)
    toast.ok('登录成功')
    navigateTo('/')
  } catch (e: any) {
    errorMsg.value = e?.message || '登录失败，请检查用户名和密码'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="container_login_root">
    <!-- 动态背景：网格 / 扫描线 / 粒子 -->
    <div class="container_login_bg_grid"></div>
    <div class="container_login_bg_scanline"></div>
    <div class="container_login_bg_particles">
      <span v-for="i in 12" :key="i" class="container_login_bg_particles_dot" :style="{ '--i': i }"></span>
    </div>

    <!-- 登录卡片 -->
    <div class="panel panel-glow container_login_card">
      <div class="container_login_card_logo">
        <div class="mono glow-text c-primary container_login_card_logo_main">COLAB</div>
        <div class="mono text-xs c-dim container_login_card_logo_sub">// DOWNLOAD MANAGER</div>
        <div class="text-xs c-mute mt-4 container_login_card_logo_desc">高速下载 · Google Drive 直连 · 任务调度中枢</div>
      </div>

      <form class="container_login_card_form" @submit.prevent="submit">
        <div class="mb-6">
          <label class="label">用户名</label>
          <input
            v-model="username"
            class="input"
            placeholder="admin"
            autocomplete="username"
            autofocus
            @keyup.enter="submit"
          />
        </div>
        <div class="mb-6">
          <label class="label">密码</label>
          <input
            v-model="password"
            type="password"
            class="input"
            placeholder="••••••••"
            autocomplete="current-password"
            @keyup.enter="submit"
          />
        </div>

        <div v-if="errorMsg" class="mono text-xs c-danger mb-6 container_login_card_form_error">{{ errorMsg }}</div>

        <button type="submit" class="btn btn-primary btn-lg btn-block container_login_card_form_submit" :disabled="loading">
          <span v-if="loading" class="spinner"></span>
          {{ loading ? '验证中…' : '进 入 系 统' }}
        </button>
      </form>
    </div>

    <!-- 底部版本信息 -->
    <div class="mono text-xs c-mute container_login_footer">{{ appName }} · v1.0 · SSR/NUXT3</div>
  </div>
</template>

<style scoped>
.container_login_root {
  position: relative;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: var(--bg-0);
}

/* ---------- 动态背景 ---------- */
/* 缓慢漂移的霓虹网格 */
.container_login_bg_grid {
  position: absolute;
  inset: -60px;
  background-image:
    linear-gradient(rgba(0, 229, 255, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 229, 255, 0.05) 1px, transparent 1px);
  background-size: 48px 48px;
  animation: grid-drift 24s linear infinite;
  mask-image: radial-gradient(ellipse 70% 60% at 50% 45%, black 25%, transparent 78%);
}
@keyframes grid-drift {
  from { transform: translate(0, 0); }
  to { transform: translate(48px, 48px); }
}
/* 周期下扫的扫描线 */
.container_login_bg_scanline {
  position: absolute;
  left: 0;
  right: 0;
  height: 120px;
  background: linear-gradient(180deg, transparent, rgba(0, 229, 255, 0.06), transparent);
  animation: scanline 7s linear infinite;
  pointer-events: none;
}
/* 漂浮粒子光点 */
.container_login_bg_particles_dot {
  position: absolute;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--primary);
  box-shadow: 0 0 8px var(--primary);
  left: calc((var(--i) * 83) % 100 * 1%);
  top: calc((var(--i) * 37) % 100 * 1%);
  opacity: 0.5;
  animation: particle-float calc(6s + var(--i) * 1s) ease-in-out infinite alternate;
  animation-delay: calc(var(--i) * -0.7s);
}
.container_login_bg_particles_dot:nth-child(3n) {
  background: var(--accent);
  box-shadow: 0 0 8px var(--accent);
}
@keyframes particle-float {
  from { transform: translateY(0); opacity: 0.15; }
  to { transform: translateY(-46px); opacity: 0.65; }
}

/* ---------- 登录卡片 ---------- */
.container_login_card {
  position: relative;
  z-index: 1;
  width: min(400px, 92vw);
  padding: 36px 32px 28px;
  animation: fade-up 0.5s ease both;
}
.container_login_card_logo {
  text-align: center;
  margin-bottom: 28px;
}
.container_login_card_logo_main {
  font-size: 42px;
  font-weight: 700;
  letter-spacing: 0.22em;
}
.container_login_card_logo_sub {
  letter-spacing: 0.28em;
  margin-top: 6px;
}
.container_login_card_form_error {
  background: rgba(255, 77, 109, 0.08);
  border: 1px solid rgba(255, 77, 109, 0.3);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
}
.container_login_card_form_submit {
  letter-spacing: 0.3em;
}
.container_login_footer {
  position: absolute;
  bottom: 18px;
  left: 0;
  right: 0;
  text-align: center;
  letter-spacing: 0.12em;
}
</style>
