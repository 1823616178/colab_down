import { Setting } from '../entities/Setting'
import { getDataSource } from '../utils/db'

/**
 * core 直接读 setting 表（不 import services，保持无环依赖）。
 * key 约定：max_vms(2) idle_timeout(3600) log_retention_days(14) orphan_policy('adopt')
 *          enable_torrent('false') drive_backend('colab_native')
 */

export async function getSettingString(key: string, def: string): Promise<string> {
  try {
    const row = await getDataSource().getRepository(Setting).findOne({ where: { configKey: key } })
    return row?.value ?? def
  } catch {
    return def
  }
}

export async function getSettingInt(key: string, def: number): Promise<number> {
  const raw = await getSettingString(key, String(def))
  const n = Number.parseInt(raw, 10)
  return Number.isNaN(n) ? def : n
}

export async function getSettingBool(key: string, def: boolean): Promise<boolean> {
  const raw = await getSettingString(key, def ? 'true' : 'false')
  return raw === 'true' || raw === '1'
}
