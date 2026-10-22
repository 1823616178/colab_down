/**
 * 统一响应包络（DESIGN.md §10.6）：
 *   成功 { code: 0, data }
 *   失败 { code: 4xxxx|5xxxx|6xxxx, message, detail? }
 */

export const ErrorCodes = {
  BAD_REQUEST: 40000,
  UNAUTHORIZED: 40100,
  LOGIN_FAILED: 40101,
  FORBIDDEN: 40300,
  NOT_FOUND: 40400,
  TASK_NOT_FOUND: 40401,
  VM_NOT_FOUND: 40402,
  CREDENTIAL_NOT_FOUND: 40403,
  CONFLICT: 40900,
  ILLEGAL_STATE: 40901,
  INTERNAL: 50000,
  DB_ERROR: 50001,
  COLAB_ERROR: 60000,
  COLAB_AUTH_FAILED: 60100,
  COLAB_QUOTA_EXCEEDED: 60200,
  COLAB_SESSION_LOST: 60400,
} as const

export class ApiError extends Error {
  constructor(
    public code: number,
    message: string,
    public detail?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function ok<T>(data: T) {
  return { code: 0, data }
}

export function fail(code: number, message: string, detail?: unknown) {
  return { code, message, ...(detail === undefined ? {} : { detail }) }
}

/** API handler 统一异常出口：ApiError → 对应包络；未知异常 → 50000 */
export function toErrorEnvelope(err: unknown) {
  if (err instanceof ApiError) return fail(err.code, err.message, err.detail)
  const msg = err instanceof Error ? err.message : String(err)
  return fail(ErrorCodes.INTERNAL, msg)
}
