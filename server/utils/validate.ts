import { z } from 'zod'
import type { H3Event } from 'h3'
import { ApiError, ErrorCodes } from './response'

/** 读取 body 并用 zod 校验；失败抛 ApiError(40000) */
export async function validateBody<T extends z.ZodTypeAny>(
  event: H3Event,
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown
  try {
    raw = await readBody(event)
  } catch {
    throw new ApiError(ErrorCodes.BAD_REQUEST, '请求体不是合法 JSON')
  }
  const parsed = schema.safeParse(raw ?? {})
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const where = first?.path?.join('.')
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      `参数校验失败${where ? `（${where}）` : ''}：${first?.message ?? 'invalid'}`,
      parsed.error.issues,
    )
  }
  return parsed.data
}

/** 常用字段 schema 片段 */
export const zId = z.number().int().positive()
export const zPatterns = z
  .array(z.string().max(256))
  .max(64)
  .optional()
