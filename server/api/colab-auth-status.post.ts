import { execFile } from 'node:child_process'
import { ensureRuntime } from '../core/runtime'
import type { ColabAuthStatus } from '../../shared/types/api'

// 用 spawn --version 探测 CLI 是否存在（which 在 Nitro 环境下不可靠）
function probeCliVersion(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(bin, ['--version'], { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) return resolve(null)
      const first = (stdout || stderr || '').trim().split('\n')[0]?.trim()
      resolve(first || null)
    })
  })
}

// Colab 认证状态探活：mock 直接 ok；真实模式跑 listSessions()，失败给修复建议
export default defineEventHandler(async (event) => {
  try {
    const config = useRuntimeConfig()
    // destr 会把 NUXT_CDM_MOCK=1 解析成 number 1，String 归一再比较
    if (String(config.cdmMock) === '1') {
      const status: ColabAuthStatus = {
        ok: true,
        mock: true,
        cliFound: true,
        message: 'Mock 模式：跳过 Colab CLI 与认证检查',
      }
      return ok(status)
    }

    const version = await probeCliVersion(config.colabBin || 'colab')
    if (!version) {
      const status: ColabAuthStatus = {
        ok: false,
        mock: false,
        cliFound: false,
        message: '未找到 colab 可执行文件',
        fixHint: '确认 google-colab-cli 已安装（pip install google-colab-cli），或用 NUXT_COLAB_BIN 指定路径',
      }
      return ok(status)
    }

    try {
      const { bridge } = await ensureRuntime()
      const sessions = await bridge.listSessions()
      const status: ColabAuthStatus = {
        ok: true,
        mock: false,
        cliFound: true,
        version,
        sessions: sessions.length,
        message: 'Colab CLI 认证正常',
      }
      return ok(status)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const status: ColabAuthStatus = {
        ok: false,
        mock: false,
        cliFound: true,
        version,
        message: `colab 认证或会话查询失败：${msg}`,
        fixHint: 'colab login --auth oauth2',
      }
      return ok(status)
    }
  } catch (err) {
    return toErrorEnvelope(err)
  }
})
