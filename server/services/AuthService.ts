import bcrypt from 'bcryptjs'
import { getDataSource } from '../utils/db'
import { ApiError, ErrorCodes } from '../utils/response'
import { logger } from '../utils/logger'
import { issueToken } from '../utils/auth'
import { User } from '../entities/User'

export interface LoginResult {
  token: string
  user: { id: number; username: string; displayName: string }
}

/** 首次启动：无用户时创建默认管理员 admin/admin123 */
export async function ensureSeedUser(): Promise<void> {
  const repo = getDataSource().getRepository(User)
  if ((await repo.count()) > 0) return
  const passwordHash = await bcrypt.hash('admin123', 10)
  await repo.save(repo.create({ username: 'admin', passwordHash, displayName: '管理员' }))
  logger.warn('已创建默认管理员账号 admin / admin123，请尽快登录后修改密码')
}

export async function getUser(uid: number): Promise<User | null> {
  return getDataSource().getRepository(User).findOneBy({ id: uid })
}

/** 登录：校验密码，成功签发 token 并更新 lastLoginAt */
export async function login(username: string, password: string): Promise<LoginResult> {
  const repo = getDataSource().getRepository(User)
  const user = await repo.findOneBy({ username })
  const passOk = user ? await bcrypt.compare(password, user.passwordHash) : false
  if (!user || !passOk) {
    throw new ApiError(ErrorCodes.LOGIN_FAILED, '用户名或密码错误')
  }
  user.lastLoginAt = new Date()
  await repo.save(user)
  return {
    token: issueToken(user.id, user.username),
    user: { id: user.id, username: user.username, displayName: user.displayName },
  }
}

/** 修改密码：旧密码错误 40101；新密码长度 < 6 则 40000 */
export async function changePassword(uid: number, oldPwd: string, newPwd: string): Promise<void> {
  if (newPwd.length < 6) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, '新密码长度至少 6 位')
  }
  const repo = getDataSource().getRepository(User)
  const user = await repo.findOneBy({ id: uid })
  if (!user || !(await bcrypt.compare(oldPwd, user.passwordHash))) {
    throw new ApiError(ErrorCodes.LOGIN_FAILED, '原密码错误')
  }
  user.passwordHash = await bcrypt.hash(newPwd, 10)
  await repo.save(user)
}
