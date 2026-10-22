import { getDataSource } from '../utils/db'
import { ApiError, ErrorCodes } from '../utils/response'
import { VM } from '../entities/VM'
import type { VMDTO, DriveAuthStatusDTO, DriveAuthState } from '../../shared/types/vm'
import { getRuntime } from '../core/runtime'
import type { CdmRuntime } from '../core/runtime'

export async function getVM(vmId: number): Promise<VM> {
  const vm = await getDataSource().getRepository(VM).findOneBy({ id: vmId })
  if (!vm) throw new ApiError(ErrorCodes.VM_NOT_FOUND, 'VM 不存在')
  return vm
}

export async function findVMBySessionName(sessionName: string): Promise<VM | null> {
  return getDataSource().getRepository(VM).findOneBy({ sessionName })
}

export async function listVMs(): Promise<VM[]> {
  return getDataSource().getRepository(VM).find({ order: { id: 'ASC' } })
}

/** 下一个会话名：cdm-vm-N（取库中最大 N + 1） */
export async function nextSessionName(): Promise<string> {
  const vms = await getDataSource().getRepository(VM).find({ select: { sessionName: true } })
  let max = 0
  for (const v of vms) {
    const m = /^cdm-vm-(\d+)$/.exec(v.sessionName)
    if (m) max = Math.max(max, Number.parseInt(m[1], 10))
  }
  return `cdm-vm-${max + 1}`
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null)

/** DriveAuthManager 返回的授权会话记录（server/core 契约） */
export interface DriveAuthRecord {
  vmId: number
  state: DriveAuthState
  authUri: string | null
  expiresAt: Date | null
  error: string | null
}

export function driveAuthToDTO(rec: DriveAuthRecord, sessionName?: string | null): DriveAuthStatusDTO {
  return {
    vmId: rec.vmId,
    sessionName: sessionName ?? '',
    state: rec.state,
    authUri: rec.authUri ?? null,
    expiresAt: iso(rec.expiresAt),
    error: rec.error ?? null,
  }
}

export function vmToDTO(vm: VM, currentTaskName?: string | null): VMDTO {
  return {
    id: vm.id,
    sessionName: vm.sessionName,
    runtimeType: vm.runtimeType,
    status: vm.status,
    currentTaskId: vm.currentTaskId,
    currentTaskName: currentTaskName ?? null,
    bootstrapped: vm.bootstrapped,
    driveBackend: vm.driveBackend,
    driveMounted: vm.driveMounted,
    driveRoot: vm.driveRoot,
    driveAuthState: vm.driveAuthState,
    driveAuthorizedAt: iso(vm.driveAuthorizedAt),
    autoStop: vm.autoStop,
    idleTimeout: vm.idleTimeout,
    errorMsg: vm.errorMsg,
    createdAt: vm.createdAt.toISOString(),
    bootstrappedAt: iso(vm.bootstrappedAt),
    lastActiveAt: vm.lastActiveAt.toISOString(),
    lastHeartbeatAt: iso(vm.lastHeartbeatAt),
    expiresAt: vm.expiresAt.toISOString(),
  }
}

/**
 * 运行时未就绪时返回 null（任务 CRUD 类接口不应被运行时阻塞）。
 * 仅在「有没有运行时都能继续」的场景使用。
 */
export function tryGetRuntime(): CdmRuntime | null {
  try {
    return getRuntime()
  } catch {
    return null
  }
}

/** 运行时必须就绪的场景（VM 操作/授权/对账），未就绪抛 ApiError(50000) */
export function requireRuntime(): CdmRuntime {
  const rt = tryGetRuntime()
  if (!rt) throw new ApiError(ErrorCodes.INTERNAL, '运行时未就绪')
  return rt
}
