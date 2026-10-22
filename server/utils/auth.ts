import { createHmac, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { ApiError, ErrorCodes } from './response'

/**
 * 登录 token：无状态 HMAC 签名 token，服务端重启不失效。
 * 格式：base64url(JSON payload).base64url(hmac_sha256)
 * payload: { uid, username, exp }
 */
const TOKEN_TTL_SEC = 7 * 24 * 3600

function secret(): string {
  const raw = useRuntimeConfig().cdmSecretKey
  if (!raw) throw new Error('NUXT_CDM_SECRET_KEY 未设置')
  return raw
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

function sign(data: string): string {
  return createHmac('sha256', secret()).update(data).digest('base64url')
}

export interface TokenPayload {
  uid: number
  username: string
  exp: number
}

export function issueToken(uid: number, username: string): string {
  const payload: TokenPayload = {
    uid,
    username,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC,
  }
  const body = b64url(JSON.stringify(payload))
  return `${body}.${sign(body)}`
}

export function verifyToken(token: string): TokenPayload | null {
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expect = sign(body)
  const a = Buffer.from(sig)
  const b = Buffer.from(expect)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload
    if (!payload.uid || !payload.exp) return null
    if (payload.exp < Date.now() / 1000) return null
    return payload
  } catch {
    return null
  }
}

/**
 * 从请求提取并校验登录用户。支持三种携带方式：
 *  Authorization: Bearer <token> / X-CDM-Token 头 / ?token=（SSE EventSource 无法设头）
 * 未登录抛 ApiError(40100)。
 */
export function requireAuth(event: H3Event): TokenPayload {
  const header = getHeader(event, 'authorization')
  const xToken = getHeader(event, 'x-cdm-token')
  const query = getQuery(event)
  const token =
    (header?.startsWith('Bearer ') ? header.slice(7) : undefined) ||
    xToken ||
    (typeof query.token === 'string' ? query.token : undefined)
  const payload = token ? verifyToken(token) : null
  if (!payload) throw new ApiError(ErrorCodes.UNAUTHORIZED, '未登录或登录已过期')
  return payload
}
