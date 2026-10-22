import pino from 'pino'

/** 脱敏正则：token / authorization / password / hf_xxx / ghp_xxx / rclone obscure */
const REDACT_PATTERNS: Array<[RegExp, string]> = [
  [/hf_[A-Za-z0-9]{20,}/g, 'hf_***'],
  [/ghp_[A-Za-z0-9]{20,}/g, 'ghp_***'],
  [/github_pat_[A-Za-z0-9_]{20,}/g, 'github_pat_***'],
  [/("?(?:token|authorization|password|secret|value)"?\s*[:=]\s*"?)[^"'\s,}]{4,}/gi, '$1***'],
  [/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer ***'],
]

export function redact(input: string): string {
  let out = input
  for (const [re, rep] of REDACT_PATTERNS) out = out.replace(re, rep)
  return out
}

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { app: 'cdm' },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    log(obj) {
      // 对所有字符串字段做脱敏
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(obj)) {
        out[k] = typeof v === 'string' ? redact(v) : v
      }
      return out
    },
  },
})

export function taskLogger(taskId: number) {
  return logger.child({ taskId })
}

export function vmLogger(vmId: number) {
  return logger.child({ vmId })
}
