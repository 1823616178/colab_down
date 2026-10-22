<script setup lang="ts">
// 默认布局：左侧固定导航 + 顶部条（页标题 / 连接状态灯）+ 全局授权横幅 + 主内容区
// 挂载时启动：SSE 单例（useProgress）、授权提醒（useDriveAuth）、用户信息（fetchMe）
const route = useRoute()
const { user, fetchMe, logout } = useAuth()
const progress = useProgress()
const driveAuthNotify = useDriveAuth()

const NAV = [
  { path: '/', label: '仪表盘', icon: '◈' },
  { path: '/tasks', label: '任务', icon: '≣' },
  { path: '/task-create', label: '新建任务', icon: '＋' },
  { path: '/vms', label: 'VM 管理', icon: '⬡' },
  { path: '/settings', label: '设置', icon: '⚙' },
]

const TITLE_MAP: Record<string, string> = {
  '/': '仪表盘',
  '/tasks': '任务列表',
  '/task-create': '新建任务',
  '/vms': 'VM 管理',
  '/settings': '系统设置',
}
const pageTitle = computed(() => TITLE_MAP[route.path] ?? 'Colab Download Manager')

/** 授权面板（横幅点开） */
const authPanelVisible = ref(false)
const authPanelVmId = ref<number | null>(null)
function openAuthPanel(vmId: number) {
  authPanelVmId.value = vmId
  authPanelVisible.value = true
}

onMounted(() => {
  progress.start() // 全站单例 SSE（幂等）
  driveAuthNotify.start() // 授权主动提醒（幂等）
  fetchMe()
})
</script>

<template>
  <div class="container_layout_root">
    <!-- 左侧导航 -->
    <aside class="container_layout_sidebar">
      <div class="container_layout_sidebar_logo">
        <div class="mono glow-text c-primary bold container_layout_sidebar_logo_main">COLAB</div>
        <div class="mono text-xs c-mute container_layout_sidebar_logo_sub">// DOWNLOAD MANAGER</div>
      </div>

      <nav class="container_layout_sidebar_nav">
        <NuxtLink
          v-for="n in NAV"
          :key="n.path"
          :to="n.path"
          class="container_layout_sidebar_nav_item"
          :class="{ active: route.path === n.path }"
        >
          <span class="container_layout_sidebar_nav_item_icon">{{ n.icon }}</span>
          {{ n.label }}
        </NuxtLink>
      </nav>

      <!-- 底部用户区 -->
      <div class="container_layout_sidebar_user">
        <div class="text-xs c-dim ellipsis" :title="user?.username">
          <span class="c-primary">●</span> {{ user?.displayName || user?.username || '未登录' }}
        </div>
        <button class="btn btn-sm btn-ghost w-full mt-2" @click="logout">退出登录</button>
      </div>
    </aside>

    <!-- 右侧 -->
    <div class="container_layout_main">
      <!-- 顶部条 -->
      <header class="container_layout_topbar">
        <span class="text-lg bold container_layout_topbar_title">{{ pageTitle }}</span>
        <span class="flex-1"></span>
        <ConnectionBadge />
      </header>

      <!-- 全局授权横幅（任一 VM awaiting_user 时常驻） -->
      <DriveAuthBanner @open-panel="openAuthPanel" />

      <!-- 主内容 -->
      <main class="container_layout_content">
        <slot />
      </main>
    </div>

    <!-- 全局挂载 -->
    <Toast />
    <DriveAuthPanel :visible="authPanelVisible" :vm-id="authPanelVmId" @close="authPanelVisible = false" />
  </div>
</template>

<style scoped>
.container_layout_root {
  display: flex;
  min-height: 100vh;
}

/* 左侧固定导航 */
.container_layout_sidebar {
  width: 200px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--line);
  background: rgba(9, 13, 23, 0.85);
  position: sticky;
  top: 0;
  height: 100vh;
}
.container_layout_sidebar_logo {
  padding: 20px 16px 16px;
  border-bottom: 1px solid var(--line);
}
.container_layout_sidebar_logo_main {
  font-size: 22px;
  letter-spacing: 0.18em;
}
.container_layout_sidebar_logo_sub {
  letter-spacing: 0.12em;
  margin-top: 4px;
}
.container_layout_sidebar_nav {
  flex: 1;
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.container_layout_sidebar_nav_item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: var(--radius-sm);
  color: var(--text-1);
  font-size: 13px;
  border: 1px solid transparent;
  transition: all 0.15s ease;
}
.container_layout_sidebar_nav_item:hover {
  color: var(--primary);
  background: rgba(0, 229, 255, 0.05);
  text-shadow: none;
}
.container_layout_sidebar_nav_item.active {
  color: var(--primary);
  border-color: var(--line-strong);
  background: rgba(0, 229, 255, 0.07);
  box-shadow: inset 2px 0 0 var(--primary);
}
.container_layout_sidebar_nav_item_icon {
  width: 16px;
  text-align: center;
}
.container_layout_sidebar_user {
  padding: 12px 14px;
  border-top: 1px solid var(--line);
}

/* 右侧 */
.container_layout_main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.container_layout_topbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--line);
  background: rgba(9, 13, 23, 0.6);
  backdrop-filter: blur(6px);
  position: sticky;
  top: 0;
  z-index: 100;
}
.container_layout_content {
  flex: 1;
  padding: 20px;
}
</style>
