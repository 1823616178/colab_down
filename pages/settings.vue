<script setup lang="ts">
// 系统设置页：Colab 认证 / Drive 授权总览+通知开关 / Drive 接入方式 / 凭据管理 / 默认值 / 访问控制 / 高级
import type { ColabAuthStatus, CredentialDTO, SettingDTO } from '~/shared/types/api'
import type { DriveAuthStatusDTO } from '~/shared/types/vm'

const { request } = useApi()
const toast = useToast()
const fmt = useFormat()
const { refreshNotifySwitches } = useDriveAuth()

// ---------- 通用 settings 存取 ----------
const settings = ref<SettingDTO[]>([])
function sVal(key: string, def = ''): string {
  return settings.value.find((s) => s.configKey === key)?.value ?? def
}
async function loadSettings() {
  try {
    settings.value = await request<SettingDTO[]>('/api/setting-list', {})
  } catch (e: any) {
    toast.err(e?.message || '加载设置失败')
  }
}
async function saveItems(items: { key: string; value: string }[], okMsg = '已保存') {
  try {
    await request('/api/setting-update', { items })
    toast.ok(okMsg)
    loadSettings()
  } catch (e: any) {
    toast.err(e?.message || '保存失败')
  }
}

// ---------- ① Colab 认证状态 ----------
const colabAuth = ref<ColabAuthStatus | null>(null)
const colabAuthLoading = ref(false)
async function checkColabAuth() {
  colabAuthLoading.value = true
  try {
    colabAuth.value = await request<ColabAuthStatus>('/api/colab-auth-status', {})
  } catch (e: any) {
    toast.err(e?.message || '探活失败')
  } finally {
    colabAuthLoading.value = false
  }
}

// ---------- ② Drive 授权总览 + 通知开关 ----------
const authList = ref<DriveAuthStatusDTO[]>([])
async function loadAuthOverview() {
  try {
    authList.value = await request<DriveAuthStatusDTO[]>('/api/vm-drive-auth-status', {})
  } catch {
    /* 静默 */
  }
}
const notify = reactive({ browser: true, sound: true, titleFlash: true })
function fillNotify() {
  notify.browser = sVal('notify_browser', 'true') === 'true'
  notify.sound = sVal('notify_sound', 'true') === 'true'
  notify.titleFlash = sVal('notify_title_flash', 'true') === 'true'
}
async function saveNotify() {
  await saveItems(
    [
      { key: 'notify_browser', value: String(notify.browser) },
      { key: 'notify_sound', value: String(notify.sound) },
      { key: 'notify_title_flash', value: String(notify.titleFlash) },
    ],
    '通知开关已保存',
  )
  refreshNotifySwitches() // 让提醒逻辑立刻用上新开关
}

// ---------- ③ Drive 接入方式 ----------
const rcloneToken = ref('')
const driveBackend = computed(() => sVal('drive_backend', 'colab_native'))
const driveSetupSaving = ref(false)
const driveTestResult = ref('')
async function submitRcloneToken() {
  if (!rcloneToken.value.trim()) {
    toast.warn('请粘贴 rclone refresh_token')
    return
  }
  if (
    !window.confirm(
      '切换 rclone 模式意味着长期 refresh_token 会被下发到每台 Colab VM。\n请确认你接受这一风险后再继续。',
    )
  )
    return
  driveSetupSaving.value = true
  try {
    await request('/api/drive-setup', { rcloneToken: rcloneToken.value.trim() })
    toast.ok('rclone token 已加密入库，后续新 VM 将使用 rclone 挂载')
    rcloneToken.value = ''
    loadSettings()
  } catch (e: any) {
    toast.err(e?.message || '提交失败')
  } finally {
    driveSetupSaving.value = false
  }
}
async function testDrive() {
  driveTestResult.value = '诊断中…'
  try {
    const res = await request<unknown>('/api/drive-test', {})
    driveTestResult.value = JSON.stringify(res, null, 2)
  } catch (e: any) {
    driveTestResult.value = `诊断失败：${e?.message}`
  }
}

// ---------- ④ 凭据管理 ----------
const credentials = ref<CredentialDTO[]>([])
const credFormVisible = ref(false)
const credEditing = ref<CredentialDTO | null>(null)
async function loadCredentials() {
  try {
    credentials.value = await request<CredentialDTO[]>('/api/credential-list', {})
  } catch {
    /* 静默 */
  }
}
function openCredForm(c: CredentialDTO | null) {
  credEditing.value = c
  credFormVisible.value = true
}
async function deleteCredential(c: CredentialDTO) {
  if (!window.confirm(`确认删除凭据「${c.name}」？引用它的任务将失去凭据。`)) return
  try {
    await request('/api/credential-delete', { id: c.id })
    toast.ok('凭据已删除')
    loadCredentials()
  } catch (e: any) {
    toast.err(e?.message || '删除失败')
  }
}
const credTypeText: Record<string, string> = {
  hf_token: 'HF Token',
  github_token: 'GitHub Token',
  rclone_drive: 'rclone Drive',
  other: '其他',
}

// ---------- ⑤ 默认值 ----------
const defaults = reactive({
  default_dest_path: 'downloads',
  download_mode: 'direct',
  max_vms: 2,
  max_retries: 3,
  idle_timeout: 3600,
})
function fillDefaults() {
  defaults.default_dest_path = sVal('default_dest_path', 'downloads')
  defaults.download_mode = sVal('download_mode', 'direct')
  defaults.max_vms = Number(sVal('max_vms', '2')) || 2
  defaults.max_retries = Number(sVal('max_retries', '3')) || 3
  defaults.idle_timeout = Number(sVal('idle_timeout', '3600')) || 3600
}
const defaultsSaving = ref(false)
async function saveDefaults() {
  defaultsSaving.value = true
  try {
    await saveItems(
      [
        { key: 'default_dest_path', value: defaults.default_dest_path },
        { key: 'download_mode', value: defaults.download_mode },
        { key: 'max_vms', value: String(defaults.max_vms) },
        { key: 'max_retries', value: String(defaults.max_retries) },
        { key: 'idle_timeout', value: String(defaults.idle_timeout) },
      ],
      '默认值已保存',
    )
  } finally {
    defaultsSaving.value = false
  }
}

// ---------- ⑥ 访问控制 / 修改密码 ----------
const pwd = reactive({ oldPassword: '', newPassword: '', confirm: '' })
const pwdSaving = ref(false)
async function changePassword() {
  if (!pwd.oldPassword || !pwd.newPassword) {
    toast.warn('请填写旧密码与新密码')
    return
  }
  if (pwd.newPassword.length < 6) {
    toast.warn('新密码至少 6 位')
    return
  }
  if (pwd.newPassword !== pwd.confirm) {
    toast.warn('两次输入的新密码不一致')
    return
  }
  pwdSaving.value = true
  try {
    await request('/api/auth-change-password', {
      oldPassword: pwd.oldPassword,
      newPassword: pwd.newPassword,
    })
    toast.ok('密码已修改，下次登录生效')
    pwd.oldPassword = pwd.newPassword = pwd.confirm = ''
  } catch (e: any) {
    toast.err(e?.message || '修改失败')
  } finally {
    pwdSaving.value = false
  }
}

// ---------- ⑦ 高级 ----------
const advanced = reactive({ log_retention_days: 14, enable_torrent: false })
function fillAdvanced() {
  advanced.log_retention_days = Number(sVal('log_retention_days', '14')) || 14
  advanced.enable_torrent = sVal('enable_torrent', 'false') === 'true'
}
async function saveRetention() {
  await saveItems([{ key: 'log_retention_days', value: String(advanced.log_retention_days) }], '日志保留天数已保存')
}
function onTorrentToggle() {
  // 🔒 torrent 违反 Colab ToS，开启前必须风险确认
  if (advanced.enable_torrent) {
    const okRisk = window.confirm(
      '⚠ 风险确认\n\ntorrent / P2P 下载违反 Google Colab 服务条款，存在账号封禁风险。\n继续开启即表示你已知晓并风险自负。是否开启？',
    )
    if (!okRisk) {
      advanced.enable_torrent = false
      return
    }
  }
  saveItems([{ key: 'enable_torrent', value: String(advanced.enable_torrent) }], advanced.enable_torrent ? 'torrent 源已开启（风险自负）' : 'torrent 源已关闭')
}

onMounted(async () => {
  await loadSettings()
  fillNotify()
  fillDefaults()
  fillAdvanced()
  checkColabAuth()
  loadAuthOverview()
  loadCredentials()
})
</script>

<template>
  <div class="container_settings_root">
    <!-- ① Colab 认证状态 -->
    <div class="panel container_settings_colabCard">
      <div class="panel-hd">
        <span class="panel-hd-title">Colab 认证状态</span>
        <button class="btn btn-sm btn-ghost" :disabled="colabAuthLoading" @click="checkColabAuth">
          <span v-if="colabAuthLoading" class="spinner"></span>重新探活
        </button>
      </div>
      <div class="panel-bd">
        <div v-if="!colabAuth" class="c-mute text-sm">探活中…</div>
        <template v-else>
          <div class="flex items-center gap-6 text-sm wrap">
            <span class="badge" :class="colabAuth.ok ? 'badge-ok' : 'badge-danger'">
              <span class="dot" :class="{ pulse: !colabAuth.ok }"></span>
              {{ colabAuth.ok ? '认证正常' : '认证异常' }}
            </span>
            <span v-if="colabAuth.mock" class="badge badge-accent">Mock 模式（CDM_MOCK=1）</span>
            <span class="c-dim text-xs">{{ colabAuth.message }}</span>
          </div>
          <div class="mono text-xs c-dim mt-4">
            CLI：<span :class="colabAuth.cliFound ? 'c-ok' : 'c-danger'">{{ colabAuth.cliFound ? '已找到' : '未找到' }}</span>
            <template v-if="colabAuth.version"> · 版本 {{ colabAuth.version }}</template>
            <template v-if="colabAuth.sessions != null"> · 活跃会话 {{ colabAuth.sessions }}</template>
          </div>
          <div v-if="!colabAuth.ok && colabAuth.fixHint" class="mono text-xs c-warn mt-6 container_settings_fixHint">
            {{ colabAuth.fixHint }}
          </div>
        </template>
      </div>
    </div>

    <!-- ② Drive 授权总览 + 通知开关 -->
    <div class="panel mt-8 container_settings_driveAuth">
      <div class="panel-hd">
        <span class="panel-hd-title">Drive 授权总览（colab_native 模式：每台 VM 授权一次）</span>
        <button class="btn btn-sm btn-ghost" @click="loadAuthOverview">刷新</button>
      </div>
      <div class="panel-bd">
        <table class="table container_settings_driveAuth_table">
          <thead>
            <tr><th>VM</th><th>授权状态</th><th>授权链接</th><th>链接到期</th><th>错误</th></tr>
          </thead>
          <tbody>
            <tr v-if="!authList.length"><td colspan="5" class="text-center c-mute p-6">暂无 VM</td></tr>
            <tr v-for="a in authList" :key="a.vmId">
              <td class="mono text-xs">{{ a.sessionName }}</td>
              <td>
                <span class="badge" :class="fmt.driveAuthBadgeClass(a.state)">
                  <span class="dot" :class="{ pulse: a.state === 'awaiting_user' }"></span>
                  {{ fmt.driveAuthStateText(a.state) }}
                </span>
              </td>
              <td class="text-xs">
                <span v-if="a.authUri" class="c-mute">已生成</span><span v-else class="c-mute">—</span>
              </td>
              <td class="mono text-xs c-dim">{{ fmt.formatTime(a.expiresAt) }}</td>
              <td class="text-xs c-danger ellipsis container_settings_driveAuth_table_err" :title="a.error ?? ''">{{ a.error || '—' }}</td>
            </tr>
          </tbody>
        </table>

        <!-- 通知开关 -->
        <div class="flex items-center gap-12 mt-8 wrap container_settings_notify">
          <span class="text-sm c-dim">授权提醒：</span>
          <label class="flex items-center gap-2 text-sm pointer">
            <input v-model="notify.browser" type="checkbox" @change="saveNotify" />浏览器通知
          </label>
          <label class="flex items-center gap-2 text-sm pointer">
            <input v-model="notify.sound" type="checkbox" @change="saveNotify" />提示音
          </label>
          <label class="flex items-center gap-2 text-sm pointer">
            <input v-model="notify.titleFlash" type="checkbox" @change="saveNotify" />标题闪烁
          </label>
        </div>
      </div>
    </div>

    <!-- ③ Drive 接入方式 -->
    <div class="panel mt-8 container_settings_driveBackend">
      <div class="panel-hd"><span class="panel-hd-title">Drive 接入方式（drive_backend）</span></div>
      <div class="panel-bd">
        <div class="flex items-center gap-6 text-sm">
          <span class="badge" :class="driveBackend === 'colab_native' ? 'badge-ok' : 'badge-accent'">
            <span class="dot"></span>{{ driveBackend }}
          </span>
          <span class="c-dim text-xs">
            {{ driveBackend === 'colab_native' ? '默认：每台 VM 交互授权一次，无长期凭据落 VM（推荐）' : 'rclone：全系统一次配置，长期 token 会下发到 VM' }}
          </span>
        </div>
        <!-- rclone 切换入口常驻展示（默认 colab_native 也可由此切换） -->
        <div class="mt-6">
          <label class="label">rclone refresh_token（切换 rclone 模式时提交）</label>
          <div class="flex gap-4">
            <input v-model="rcloneToken" type="password" class="input mono flex-1" placeholder="rclone config 中的 refresh_token" autocomplete="off" />
            <button class="btn btn-sm btn-primary" :disabled="driveSetupSaving" @click="submitRcloneToken">
              <span v-if="driveSetupSaving" class="spinner"></span>提交并切换
            </button>
            <button class="btn btn-sm" @click="testDrive">诊断挂载</button>
          </div>
          <div class="text-xs c-warn mt-2">⚠ rclone 模式会把长期 refresh_token 写入每台 Colab VM，安全性低于默认模式。</div>
          <pre v-if="driveTestResult" class="mono text-xs c-dim mt-4 container_settings_driveTest">{{ driveTestResult }}</pre>
        </div>
      </div>
    </div>

    <!-- ④ 凭据管理 -->
    <div class="panel mt-8 container_settings_credentials">
      <div class="panel-hd">
        <span class="panel-hd-title">凭据管理（HF / GitHub token，明文永不回显）</span>
        <button class="btn btn-sm btn-primary" @click="openCredForm(null)">＋ 新增凭据</button>
      </div>
      <table class="table container_settings_credentials_table">
        <thead>
          <tr><th>名称</th><th>类型</th><th>内容</th><th>更新时间</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-if="!credentials.length"><td colspan="5" class="text-center c-mute p-6">暂无凭据。下载 gated repo 前请先添加 HF Token。</td></tr>
          <tr v-for="c in credentials" :key="c.id">
            <td>{{ c.name }}</td>
            <td><span class="badge badge-accent">{{ credTypeText[c.type] ?? c.type }}</span></td>
            <td class="mono text-xs c-dim">{{ c.hint }}</td>
            <td class="mono text-xs c-dim">{{ fmt.formatTime(c.updatedAt) }}</td>
            <td>
              <div class="flex gap-2">
                <button class="btn btn-sm btn-ghost" @click="openCredForm(c)">编辑</button>
                <button class="btn btn-sm btn-ghost c-danger" @click="deleteCredential(c)">删除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ⑤ 默认值 -->
    <div class="panel mt-8 container_settings_defaults">
      <div class="panel-hd"><span class="panel-hd-title">任务默认值</span></div>
      <div class="panel-bd">
        <div class="grid gap-6 container_settings_defaults_grid">
          <div>
            <label class="label">默认目标路径（default_dest_path）</label>
            <input v-model="defaults.default_dest_path" class="input mono" />
          </div>
          <div>
            <label class="label">默认下载模式（download_mode）</label>
            <select v-model="defaults.download_mode" class="select">
              <option value="direct">direct（直写 Drive，可续传）</option>
              <option value="staged">staged（更快，不能续传）</option>
            </select>
          </div>
          <div>
            <label class="label">最大并行 VM（max_vms）</label>
            <input v-model.number="defaults.max_vms" type="number" min="1" max="5" class="input" />
          </div>
          <div>
            <label class="label">最大重试次数（max_retries）</label>
            <input v-model.number="defaults.max_retries" type="number" min="0" max="10" class="input" />
          </div>
          <div>
            <label class="label">VM 空闲超时秒（idle_timeout）</label>
            <input v-model.number="defaults.idle_timeout" type="number" min="300" class="input" />
          </div>
        </div>
        <div class="flex justify-end mt-6">
          <button class="btn btn-primary btn-sm" :disabled="defaultsSaving" @click="saveDefaults">
            <span v-if="defaultsSaving" class="spinner"></span>保存默认值
          </button>
        </div>
      </div>
    </div>

    <!-- ⑥ 访问控制 -->
    <div class="panel mt-8 container_settings_access">
      <div class="panel-hd"><span class="panel-hd-title">访问控制</span></div>
      <div class="panel-bd">
        <div class="text-xs c-dim mb-6">
          访问 token（access_token）：服务暴露到局域网/公网时必须设置，未带 token 的请求会被拒绝。当前通过登录态控制访问，修改密码如下。
        </div>
        <div class="grid gap-6 container_settings_access_grid">
          <div>
            <label class="label">旧密码</label>
            <input v-model="pwd.oldPassword" type="password" class="input" autocomplete="current-password" />
          </div>
          <div>
            <label class="label">新密码（≥ 6 位）</label>
            <input v-model="pwd.newPassword" type="password" class="input" autocomplete="new-password" />
          </div>
          <div>
            <label class="label">确认新密码</label>
            <input v-model="pwd.confirm" type="password" class="input" autocomplete="new-password" @keyup.enter="changePassword" />
          </div>
        </div>
        <div class="flex justify-end mt-6">
          <button class="btn btn-primary btn-sm" :disabled="pwdSaving" @click="changePassword">
            <span v-if="pwdSaving" class="spinner"></span>修改密码
          </button>
        </div>
      </div>
    </div>

    <!-- ⑦ 高级 -->
    <div class="panel mt-8 container_settings_advanced">
      <div class="panel-hd"><span class="panel-hd-title">高级</span></div>
      <div class="panel-bd">
        <div class="flex items-center gap-6 wrap">
          <div class="flex items-center gap-4">
            <label class="label container_settings_advanced_retentionLabel">日志保留天数（log_retention_days）</label>
            <input v-model.number="advanced.log_retention_days" type="number" min="1" max="90" class="input container_settings_advanced_retention" />
            <button class="btn btn-sm" @click="saveRetention">保存</button>
          </div>
          <span class="flex-1"></span>
          <label class="flex items-center gap-2 text-sm pointer" title="违反 Colab ToS，有封号风险">
            <input v-model="advanced.enable_torrent" type="checkbox" @change="onTorrentToggle" />
            <span class="c-warn">启用 torrent 源（🔒 高风险）</span>
          </label>
        </div>
        <div class="text-xs c-mute mt-4">日志超期由对账任务每日清理；单任务硬上限 5000 条，超出只保留 warn/error。</div>
      </div>
    </div>

    <CredentialForm :visible="credFormVisible" :editing="credEditing" @close="credFormVisible = false" @saved="loadCredentials" />
  </div>
</template>

<style scoped>
.container_settings_fixHint {
  background: rgba(255, 176, 32, 0.06);
  border: 1px solid rgba(255, 176, 32, 0.25);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  white-space: pre-wrap;
}
.container_settings_driveAuth_table_err {
  max-width: 220px;
}
.container_settings_driveTest {
  background: rgba(5, 7, 13, 0.6);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  max-height: 200px;
  overflow: auto;
  white-space: pre-wrap;
}
.container_settings_defaults_grid,
.container_settings_access_grid {
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
}
.container_settings_advanced_retention {
  width: 90px;
}
.container_settings_advanced_retentionLabel {
  margin-bottom: 0;
}
</style>
