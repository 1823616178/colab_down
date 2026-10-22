// 全局 Toast：模块级单例队列，由 Toast.vue 渲染
import { reactive } from 'vue'

export type ToastType = 'ok' | 'err' | 'warn' | 'info'

export interface ToastItem {
  id: number
  type: ToastType
  msg: string
}

const toasts = reactive<ToastItem[]>([])
let seq = 0
const DURATION = 4000

function push(type: ToastType, msg: string) {
  const id = ++seq
  toasts.push({ id, type, msg })
  // 自动消失
  setTimeout(() => remove(id), DURATION)
  // 防堆积：最多保留 5 条
  while (toasts.length > 5) toasts.shift()
}

function remove(id: number) {
  const i = toasts.findIndex((t) => t.id === id)
  if (i >= 0) toasts.splice(i, 1)
}

export function useToast() {
  return {
    toasts,
    remove,
    ok: (msg: string) => push('ok', msg),
    err: (msg: string) => push('err', msg),
    warn: (msg: string) => push('warn', msg),
    info: (msg: string) => push('info', msg),
  }
}
