import { promises as fsp } from 'node:fs'
import nodePath from 'node:path'
import { getDataSource } from '../utils/db'
import { logger } from '../utils/logger'
import { VM } from '../entities/VM'
import type { DriveEntry } from '../../shared/types/api'
import { ensureRuntime } from '../core/runtime'

/**
 * Drive 目录浏览 / 配额探测。
 * 两种实现，按优先级：
 * 1. 配置了 NUXT_CDM_LOCAL_DRIVE_ROOT（本地挂载，如 rclone mount）→ 直接读本地文件系统，
 *    不依赖任何 VM，适合「还没登录/没有已挂载 VM」的场景；
 * 2. 否则找一台已挂载 Drive 的 VM，经 bridge.exec 跑内联 python，
 *    输出一行 `@@DRIVE@@{json}` 后解析。
 * 任何失败（挂载点不存在 / 无可用 VM / runtime 未就绪）都优雅降级：
 * driveList → []，driveQuota → {null,null}，绝不抛错（前端容错）。
 */

export interface DriveQuota {
  freeBytes: number | null
  totalBytes: number | null
}

/** 找一台可用于探测的 VM：driveMounted 且非 stopped/error，优先 idle/busy */
async function pickMountedVm(): Promise<VM | null> {
  const vms = await getDataSource()
    .getRepository(VM)
    .createQueryBuilder('v')
    .where('v.driveMounted = :m', { m: true })
    .andWhere('v.driveRoot IS NOT NULL')
    .andWhere('v.status NOT IN (:...bad)', { bad: ['stopped', 'error'] })
    .orderBy('v.id', 'ASC')
    .getMany()
  return vms.find((v) => v.status === 'idle' || v.status === 'busy') ?? vms[0] ?? null
}

/** 兼容多种 exec 返回形态，归一化为字符串输出 */
function normalizeExecOutput(out: unknown): string {
  if (typeof out === 'string') return out
  if (out && typeof out === 'object') {
    const o = out as Record<string, unknown>
    for (const k of ['stdout', 'output', 'text']) {
      if (typeof o[k] === 'string') return o[k]
    }
  }
  return ''
}

/** 在指定 VM 上执行内联 python，返回合并后的文本输出 */
async function execOnVm(vm: VM, code: string): Promise<string> {
  const { bridge } = await ensureRuntime()
  const result = await bridge.exec(vm, code, 120)
  return normalizeExecOutput(result)
}

/** 从输出中提取最后一行 @@DRIVE@@ 后的 JSON */
function extractDriveJson<T>(output: string): T | null {
  const MARK = '@@DRIVE@@'
  for (const line of output.split(/\r?\n/)) {
    const idx = line.lastIndexOf(MARK)
    if (idx < 0) continue
    try {
      return JSON.parse(line.slice(idx + MARK.length)) as T
    } catch {
      // 脏行，尝试下一行
    }
  }
  return null
}

/** 列目录（变量一律 JSON.stringify 内嵌，杜绝注入；VM 侧再做一次穿越防护） */
function buildListCode(driveRoot: string, path: string): string {
  return [
    'import os, json',
    `_root = ${JSON.stringify(driveRoot)}`,
    `_rel = ${JSON.stringify(path)}`,
    '_base = os.path.normpath(os.path.join(_root, _rel))',
    '_out = []',
    'if _base == _root or _base.startswith(_root.rstrip(os.sep) + os.sep):',
    '    try:',
    '        with os.scandir(_base) as _it:',
    '            for _e in _it:',
    '                try:',
    '                    _d = _e.is_dir(follow_symlinks=False)',
    '                    _sz = None if _d else _e.stat(follow_symlinks=False).st_size',
    '                    _out.append({"name": _e.name, "isDir": _d, "size": _sz})',
    '                except Exception:',
    '                    pass',
    '    except Exception:',
    '        pass',
    'print("@@DRIVE@@" + json.dumps(_out[:500]))',
  ].join('\n')
}

function buildQuotaCode(driveRoot: string): string {
  return [
    'import shutil, json',
    `_u = shutil.disk_usage(${JSON.stringify(driveRoot)})`,
    'print("@@DRIVE@@" + json.dumps({"freeBytes": _u.free, "totalBytes": _u.total}))',
  ].join('\n')
}

/** 本地挂载根（未配置返回 null） */
function localDriveRoot(): string | null {
  const root = String(useRuntimeConfig().cdmLocalDriveRoot || '').trim()
  return root || null
}

let missingRootWarnedAt = 0

/**
 * 可用的本地挂载根：配置了但目录不存在（rclone 未挂载/挂载失效）时
 * 回退为 VM 探测并至多每 5 分钟 warn 一次（避免 stats 轮询刷错误栈）
 */
async function usableLocalRoot(): Promise<string | null> {
  const root = localDriveRoot()
  if (!root) return null
  try {
    if ((await fsp.stat(root)).isDirectory()) return root
  } catch {
    // 不存在或不可读，走下方回退
  }
  const now = Date.now()
  if (now - missingRootWarnedAt > 5 * 60 * 1000) {
    missingRootWarnedAt = now
    logger.warn({ root }, 'NUXT_CDM_LOCAL_DRIVE_ROOT 配置的挂载点不存在，回退为 VM 探测（rclone 未挂载？）')
  }
  return null
}

/** 本地挂载模式：安全拼接并校验路径不越出根目录，越界返回 null */
function resolveLocalPath(root: string, rel: string): string | null {
  const base = nodePath.resolve(root, rel || '.')
  const normRoot = nodePath.resolve(root)
  if (base !== normRoot && !base.startsWith(normRoot + nodePath.sep)) return null
  return base
}

/** 本地挂载模式：列目录（子目录不存在时安静返回空，例如选择器默认路径尚未创建） */
async function localList(root: string, rel: string): Promise<DriveEntry[]> {
  const base = resolveLocalPath(root, rel)
  if (!base) return []
  let dirents
  try {
    dirents = await fsp.readdir(base, { withFileTypes: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const prefix = (rel || '').replace(/\/+$/, '')
  const out: DriveEntry[] = []
  for (const d of dirents.slice(0, 500)) {
    const isDir = d.isDirectory()
    let size: number | null = null
    if (!isDir) {
      try {
        size = (await fsp.stat(nodePath.join(base, d.name))).size
      } catch {
        // 符号链接失效等，忽略大小
      }
    }
    out.push({ name: d.name, path: `${prefix}/${d.name}`.replace(/^\/+/, ''), isDir, size })
  }
  return out.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
}

/** 本地挂载模式：配额（rclone 挂载点反映的是底层盘，仅作参考） */
async function localQuota(root: string): Promise<DriveQuota> {
  const s = await fsp.statfs(root)
  return { freeBytes: Number(s.bavail) * Number(s.bsize), totalBytes: Number(s.blocks) * Number(s.bsize) }
}

/** 浏览 Drive 目录（path 为 Drive 相对路径）；失败返回 [] */
export async function driveList(path: string): Promise<DriveEntry[]> {
  try {
    if (/\.{2}/.test(path)) return []
    const root = await usableLocalRoot()
    if (root) return await localList(root, path)
    const vm = await pickMountedVm()
    if (!vm?.driveRoot) return []
    const out = await execOnVm(vm, buildListCode(vm.driveRoot, path || ''))
    const raw = extractDriveJson<Array<{ name: string; isDir: boolean; size: number | null }>>(out)
    if (!raw) return []
    const prefix = (path || '').replace(/\/+$/, '')
    return raw
      .map((e) => ({
        name: e.name,
        path: `${prefix}/${e.name}`.replace(/^\/+/, ''),
        isDir: Boolean(e.isDir),
        size: e.size ?? null,
      }))
      .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
  } catch (err) {
    logger.warn({ err }, 'driveList 探测失败，降级为空列表')
    return []
  }
}

/** Drive 配额；失败返回 {null,null} */
export async function driveQuota(): Promise<DriveQuota> {
  try {
    const root = await usableLocalRoot()
    if (root) return await localQuota(root)
    const vm = await pickMountedVm()
    if (!vm?.driveRoot) return { freeBytes: null, totalBytes: null }
    const out = await execOnVm(vm, buildQuotaCode(vm.driveRoot))
    const raw = extractDriveJson<{ freeBytes: number; totalBytes: number }>(out)
    if (!raw) return { freeBytes: null, totalBytes: null }
    return { freeBytes: Number(raw.freeBytes), totalBytes: Number(raw.totalBytes) }
  } catch (err) {
    logger.warn({ err }, 'driveQuota 探测失败，降级为 null')
    return { freeBytes: null, totalBytes: null }
  }
}
