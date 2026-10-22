import { getDataSource } from '../utils/db'
import { ApiError, ErrorCodes } from '../utils/response'
import { logger } from '../utils/logger'
import { Setting } from '../entities/Setting'
import type { SettingValueType } from '../entities/Setting'
import type { SettingDTO } from '../../shared/types/api'

export interface SettingDefault {
  value: string
  valueType: SettingValueType
  description: string
}

/** 系统配置默认值（TASK.md §3 / DESIGN.md §13；描述供设置页展示） */
export const SETTING_DEFAULTS: Readonly<Record<string, SettingDefault>> = {
  max_vms: { value: '2', valueType: 'int', description: '最大并行 VM 数量（受 Colab 订阅并发限制，免费档常见 1-2）' },
  idle_timeout: { value: '3600', valueType: 'int', description: 'VM 空闲回收超时（秒）；授权过的 VM 尽量留着复用' },
  max_retries: { value: '3', valueType: 'int', description: '任务失败后自动重试次数上限' },
  default_dest_path: { value: 'downloads', valueType: 'string', description: '新任务默认目标路径（Drive 相对路径）' },
  download_mode: { value: 'direct', valueType: 'string', description: '下载模式：direct 直写 Drive（可跨 VM 续传）/ staged 先落本地再拷贝（更快不可续传）' },
  log_retention_days: { value: '14', valueType: 'int', description: '下载日志保留天数，过期由对账任务清理' },
  enable_torrent: { value: 'false', valueType: 'bool', description: '启用 torrent 源（违反 Colab 服务条款，有封号风险，默认关闭）' },
  drive_backend: { value: 'colab_native', valueType: 'string', description: 'Drive 接入方式：colab_native（每台 VM 人工授权一次）/ rclone（无人值守，token 会落 VM）' },
  orphan_policy: { value: 'adopt', valueType: 'string', description: '孤儿 VM 处理策略：adopt 纳管 / stop 停止 / ignore 忽略' },
  auto_rebuild_vm: { value: 'false', valueType: 'bool', description: 'VM 出错后自动重建（重建出的 VM 仍需人工授权，默认关闭）' },
  notify_browser: { value: 'true', valueType: 'bool', description: '浏览器通知开关（VM 待授权时主动提醒）' },
  notify_sound: { value: 'true', valueType: 'bool', description: '提示音开关' },
  notify_title_flash: { value: 'true', valueType: 'bool', description: '页面标题闪烁开关' },
  access_token: { value: '', valueType: 'string', description: '访问控制 token（服务暴露到局域网时必开）' },
}

/** 启动时写入缺失的默认配置（已存在的不动） */
export async function ensureDefaultSettings(): Promise<void> {
  const repo = getDataSource().getRepository(Setting)
  const existing = await repo.find({ select: { configKey: true } })
  const keys = new Set(existing.map((s) => s.configKey))
  for (const [key, def] of Object.entries(SETTING_DEFAULTS)) {
    if (keys.has(key)) continue
    await repo.save(
      repo.create({ configKey: key, value: def.value, valueType: def.valueType, description: def.description }),
    )
  }
}

export async function getAllSettings(): Promise<Setting[]> {
  return getDataSource().getRepository(Setting).find({ order: { configKey: 'ASC' } })
}

export async function getSetting(key: string): Promise<Setting | null> {
  return getDataSource().getRepository(Setting).findOneBy({ configKey: key })
}

export async function getSettingInt(key: string, dft: number): Promise<number> {
  const s = await getSetting(key)
  if (!s?.value) return dft
  const n = Number.parseInt(s.value, 10)
  return Number.isNaN(n) ? dft : n
}

export async function getSettingBool(key: string, dft: boolean): Promise<boolean> {
  const s = await getSetting(key)
  if (!s?.value) return dft
  const v = s.value.trim().toLowerCase()
  if (v === 'true' || v === '1') return true
  if (v === 'false' || v === '0') return false
  return dft
}

/** 更新配置：key 必须在默认值表内；按 valueType 做格式校验 */
export async function setSetting(key: string, value: string): Promise<Setting> {
  const def = SETTING_DEFAULTS[key]
  if (!def) throw new ApiError(ErrorCodes.BAD_REQUEST, `未知配置项：${key}`)

  let v = value
  if (def.valueType === 'int') {
    if (!/^-?\d+$/.test(v.trim())) {
      throw new ApiError(ErrorCodes.BAD_REQUEST, `配置 ${key} 需要整数值`)
    }
    v = String(Number.parseInt(v.trim(), 10))
  } else if (def.valueType === 'bool') {
    const t = v.trim().toLowerCase()
    if (!['true', 'false', '1', '0'].includes(t)) {
      throw new ApiError(ErrorCodes.BAD_REQUEST, `配置 ${key} 需要布尔值（true/false）`)
    }
    v = t === 'true' || t === '1' ? 'true' : 'false'
  }

  // 风险确认由前端弹窗完成，后端仅记录 warn 日志
  if (key === 'enable_torrent' && v === 'true') {
    logger.warn('enable_torrent 已被开启：torrent 下载违反 Colab 服务条款，存在账号封禁风险')
  }

  const repo = getDataSource().getRepository(Setting)
  let s = await repo.findOneBy({ configKey: key })
  if (!s) {
    s = repo.create({ configKey: key, valueType: def.valueType, description: def.description })
  }
  s.value = v
  return repo.save(s)
}

export function settingToDTO(s: Setting): SettingDTO {
  return {
    configKey: s.configKey,
    value: s.value,
    valueType: s.valueType,
    description: s.description,
    updatedAt: s.updatedAt.toISOString(),
  }
}
