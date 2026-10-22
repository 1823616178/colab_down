import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/**
 * AES-256-GCM 凭据加密（DESIGN.md §12）。
 * 密钥来自 NUXT_CDM_SECRET_KEY（32 字节 base64，或任意字符串做 sha256 派生）。
 */
function getKey(): Buffer {
  const raw = useRuntimeConfig().cdmSecretKey
  if (!raw) throw new Error('NUXT_CDM_SECRET_KEY 未设置，拒绝加解密操作')
  // base64 解码后恰好 32 字节则直接用；否则 sha256 派生
  try {
    const b = Buffer.from(raw, 'base64')
    if (b.length === 32) return b
  } catch {
    /* fall through */
  }
  return createHash('sha256').update(raw).digest()
}

/** 加密 → base64(iv.tag.cipher) 单字符串入库 */
export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const data = buf.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', getKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

/** 末 4 位提示 */
export function hintOf(secret: string): string {
  const s = secret.trim()
  return s.length <= 4 ? s : s.slice(-4)
}
