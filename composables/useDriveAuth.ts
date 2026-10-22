// Drive 授权主动提醒（DESIGN.md §6.0.5⑤）
// 任一 VM driveAuth.state === 'awaiting_user' 时：
//   ① 浏览器 Notification（先申请权限，点击聚焦窗口）
//   ② document.title 交替闪烁「⚠ 需要授权」
//   ③ WebAudio 蜂鸣提示音
// 三个开关分别读 setting：notify_browser / notify_sound / notify_title_flash（默认开）
import { computed, reactive, watch } from 'vue'
import type { SettingDTO } from '~/shared/types/api'
import { useProgress } from './useProgress'
import { useApi } from './useApi'

const { driveAuth } = useProgress()

/** 通知开关（从 setting-list 拉一次缓存） */
const switches = reactive({
  browser: true,
  sound: true,
  titleFlash: true,
})

const awaitingList = computed(() =>
  [...driveAuth.values()].filter((d) => d.state === 'awaiting_user'),
)
const awaitingCount = computed(() => awaitingList.value.length)

let started = false
let settingsLoaded = false
let originalTitle = ''
let flashTimer: ReturnType<typeof setInterval> | null = null
let audioCtx: AudioContext | null = null

function parseBool(v: string | null | undefined, def: boolean): boolean {
  if (v === null || v === undefined || v === '') return def
  return v === 'true' || v === '1'
}

/** 拉取通知开关配置（只拉一次） */
async function loadSettings() {
  if (settingsLoaded) return
  settingsLoaded = true
  try {
    const { request } = useApi()
    const list = await request<SettingDTO[]>('/api/setting-list', {})
    const get = (k: string) => list.find((s) => s.configKey === k)?.value
    switches.browser = parseBool(get('notify_browser'), true)
    switches.sound = parseBool(get('notify_sound'), true)
    switches.titleFlash = parseBool(get('notify_title_flash'), true)
  } catch {
    /* 拉取失败用默认值 */
  }
}

/** 页面设置变更后重新拉取开关 */
export async function refreshNotifySwitches() {
  settingsLoaded = false
  await loadSettings()
}

/** WebAudio 蜂鸣：三短声 */
function beep() {
  if (!switches.sound || !process.client) return
  try {
    audioCtx ??= new (window.AudioContext || (window as any).webkitAudioContext)()
    const ctx = audioCtx
    if (ctx.state === 'suspended') ctx.resume()
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.25)
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + i * 0.25 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.25 + 0.18)
      osc.connect(gain).connect(ctx.destination)
      osc.start(ctx.currentTime + i * 0.25)
      osc.stop(ctx.currentTime + i * 0.25 + 0.2)
    }
  } catch {
    /* 无音频环境时忽略 */
  }
}

/** 浏览器通知（含权限申请，点击聚焦） */
function notifyBrowser(count: number) {
  if (!switches.browser || !process.client || !('Notification' in window)) return
  const fire = () => {
    try {
      const n = new Notification('Colab Download Manager 需要授权', {
        body: `${count} 台 VM 正在等待 Google Drive 授权，点击返回处理`,
        tag: 'cdm-drive-auth', // 相同 tag 去重，避免刷屏
      })
      n.onclick = () => {
        window.focus()
        n.close()
      }
    } catch {
      /* 忽略 */
    }
  }
  if (Notification.permission === 'granted') fire()
  else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then((p) => {
      if (p === 'granted') fire()
    })
  }
}

/** 标题闪烁 */
function startFlash() {
  if (!switches.titleFlash || flashTimer || !process.client) return
  originalTitle = document.title
  let on = false
  flashTimer = setInterval(() => {
    on = !on
    document.title = on ? `⚠ 需要授权 (${awaitingCount.value}) - CDM` : originalTitle
  }, 1000)
}

function stopFlash() {
  if (flashTimer) {
    clearInterval(flashTimer)
    flashTimer = null
  }
  if (process.client && originalTitle) document.title = originalTitle
}

export function useDriveAuth() {
  /** 启动监听（幂等，layout 挂载时调一次） */
  function start() {
    if (started || !process.client) return
    started = true
    loadSettings()
    watch(awaitingCount, (n, old) => {
      // 仅在 0 → >0 跳变时触发一次提醒，避免每事件刷屏
      if (n > 0 && (old ?? 0) === 0) {
        beep()
        notifyBrowser(n)
        startFlash()
      }
      if (n === 0) stopFlash()
    })
  }

  return { awaitingList, awaitingCount, switches, start, refreshNotifySwitches }
}
