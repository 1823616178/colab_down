import { z } from 'zod'
import { tryGetRuntime, getVM, listVMs, driveAuthToDTO } from '../services/VMService'
import type { DriveAuthStatusDTO } from '../../shared/types/vm'

const schema = z.object({ vmId: zId.optional() })

// 授权状态快照：无 vmId 时返回全部；manager 中无记录时回退 DB 里的 driveAuthState
export default defineEventHandler(async (event) => {
  try {
    const { vmId } = await validateBody(event, schema)
    const rt = tryGetRuntime()

    if (vmId !== undefined) {
      const vm = await getVM(vmId) // 40402
      const rec = rt?.driveAuth.get(vmId)
      if (rec) return ok(driveAuthToDTO(rec, vm.sessionName))
      return ok(
        driveAuthToDTO(
          { vmId, state: vm.driveAuthState, authUri: null, expiresAt: null, error: vm.errorMsg },
          vm.sessionName,
        ),
      )
    }

    const vms = await listVMs()
    const nameById = new Map(vms.map((v) => [v.id, v.sessionName]))
    const items: DriveAuthStatusDTO[] = (rt?.driveAuth.list() ?? []).map((rec) =>
      driveAuthToDTO(rec, nameById.get(rec.vmId) ?? ''),
    )
    // 补齐 manager 中没有但 DB 存在授权状态的 VM
    const covered = new Set(items.map((i) => i.vmId))
    for (const vm of vms) {
      if (covered.has(vm.id) || vm.driveAuthState === 'none') continue
      items.push(
        driveAuthToDTO(
          { vmId: vm.id, state: vm.driveAuthState, authUri: null, expiresAt: null, error: vm.errorMsg },
          nameById.get(vm.id) ?? '',
        ),
      )
    }
    return ok(items)
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
