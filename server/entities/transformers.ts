import type { ValueTransformer } from 'typeorm'

/**
 * MySQL bigint → JS number（mysql2 默认返回 string）。仅用于字节/偏移类字段，数值不会超 2^53。
 * 注意：undefined 必须原样透传（让 TypeORM 省略该列、走 MySQL DEFAULT）——
 * 若转成 null 会被显式写进 INSERT，绕过列默认值导致 "cannot be null"。
 */
export const bigintTransformer: ValueTransformer = {
  to: (value?: number | null) => (value === undefined ? undefined : value),
  from: (value?: string | null) => (value === null || value === undefined ? null : Number(value)),
}
