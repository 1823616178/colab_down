import { getDataSource } from '../utils/db'
import { ApiError, ErrorCodes } from '../utils/response'
import { encrypt, decrypt, hintOf } from '../utils/crypto'
import { Credential } from '../entities/Credential'
import type { CredentialType } from '../entities/Credential'
import type { CredentialDTO } from '../../shared/types/api'

const CREDENTIAL_TYPES: readonly CredentialType[] = ['rclone_drive', 'hf_token', 'github_token', 'other']

export async function listCredentials(): Promise<Credential[]> {
  return getDataSource().getRepository(Credential).find({ order: { id: 'ASC' } })
}

export async function findCredentialByName(name: string): Promise<Credential | null> {
  return getDataSource().getRepository(Credential).findOneBy({ name })
}

/**
 * 新增/更新凭据：value 加密入库（AES-256-GCM），hint 存末 4 位。
 * 更新时 value 传空字符串表示保持原值不变。
 */
export async function upsertCredential(input: {
  id?: number
  name: string
  type: CredentialType
  value: string
}): Promise<Credential> {
  if (!CREDENTIAL_TYPES.includes(input.type)) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, `非法凭据类型：${String(input.type)}`)
  }
  const repo = getDataSource().getRepository(Credential)

  const dup = await repo.findOneBy({ name: input.name })
  if (dup && dup.id !== input.id) {
    throw new ApiError(ErrorCodes.CONFLICT, '凭据名称已存在')
  }

  let cred: Credential
  if (input.id !== undefined) {
    const found = await repo.findOneBy({ id: input.id })
    if (!found) throw new ApiError(ErrorCodes.CREDENTIAL_NOT_FOUND, '凭据不存在')
    cred = found
  } else {
    cred = repo.create()
  }

  cred.name = input.name
  cred.type = input.type
  if (input.value) {
    cred.valueEnc = encrypt(input.value)
    cred.hint = hintOf(input.value)
  } else if (!cred.valueEnc) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, '凭据内容不能为空')
  }
  return repo.save(cred)
}

export async function deleteCredential(id: number): Promise<void> {
  const repo = getDataSource().getRepository(Credential)
  const cred = await repo.findOneBy({ id })
  if (!cred) throw new ApiError(ErrorCodes.CREDENTIAL_NOT_FOUND, '凭据不存在')
  await repo.remove(cred)
}

/** 取明文（仅服务端内部使用，绝不经 API 返回） */
export async function getCredentialValue(id: number): Promise<string | null> {
  const cred = await getDataSource().getRepository(Credential).findOneBy({ id })
  if (!cred) return null
  return decrypt(cred.valueEnc)
}

/** DTO 只返 hint，绝不返明文/密文 */
export function credentialToDTO(c: Credential): CredentialDTO {
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    hint: c.hint,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }
}
