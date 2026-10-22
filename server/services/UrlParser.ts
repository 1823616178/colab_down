import type { ParsedUrl } from '../../shared/types/task'

/**
 * URL 智能识别（TASK.md Phase 2.2 / §3.3）。
 * 纯模块：不依赖 DB / Nuxt 运行时，可被 vitest 直接 import。
 */

const HF_HOST = /^https?:\/\/huggingface\.co\/([^/?#]+)\/([^/?#]+)(?:\/tree\/([^/?#]+))?\/?(?:[?#].*)?$/i
const GH_RELEASE = /^https?:\/\/github\.com\/([^/?#]+)\/([^/?#]+)\/releases(?:\/(tag|download)\/([^/?#]+))?/i
const GDRIVE_FILE = /^https?:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/i
const GDRIVE_OPEN = /^https?:\/\/drive\.google\.com\/open\?(?:.*&)?id=([A-Za-z0-9_-]+)/i
const GH_SHORT = /^([^\s/@]+)\/([^\s/@]+)@([^\s@]+)$/
const HF_SHORT = /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/
const HTTP_URL = /^https?:\/\//i

/** 识别单个 URL，始终返回 ParsedUrl（不抛错） */
function parseOne(raw: string): ParsedUrl {
  const url = raw.trim()
  if (!url) return { url: raw, ok: false, error: '空行' }

  // torrent：magnet 开头（ok=true，但提示默认禁用，由前端展示）
  if (url.toLowerCase().startsWith('magnet:')) {
    const dn = /[?&]dn=([^&]+)/i.exec(url)
    return {
      url,
      ok: true,
      sourceType: 'torrent',
      normalizedUrl: url,
      name: dn ? decodeURIComponent(dn[1]) : 'torrent',
      suggestedDestPath: 'downloads/',
      error: 'torrent 源默认禁用（违反 Colab 服务条款），需在设置中手动开启',
    }
  }

  // huggingface 完整 URL：<org>/<repo>(/tree/<rev>)?
  let m = HF_HOST.exec(url)
  if (m) {
    const [, org, repo, rev] = m
    return {
      url,
      ok: true,
      sourceType: 'huggingface',
      normalizedUrl: `${org}/${repo}`,
      name: repo,
      revision: rev || undefined,
      suggestedDestPath: `downloads/${repo}`,
    }
  }

  // github release URL → o/r@tag
  m = GH_RELEASE.exec(url)
  if (m) {
    const [, owner, repo, , tag] = m
    const t = tag || 'latest'
    return {
      url,
      ok: true,
      sourceType: 'github',
      normalizedUrl: `${owner}/${repo}@${t}`,
      name: `${repo}@${t}`,
      suggestedDestPath: `downloads/${repo}`,
    }
  }

  // gdrive 分享链接
  m = GDRIVE_FILE.exec(url) ?? GDRIVE_OPEN.exec(url)
  if (m) {
    return {
      url,
      ok: true,
      sourceType: 'gdrive',
      normalizedUrl: url,
      name: `gdrive-${m[1].slice(0, 8)}`,
      suggestedDestPath: 'downloads/',
    }
  }

  // github 直写 o/r@tag
  m = GH_SHORT.exec(url)
  if (m) {
    return {
      url,
      ok: true,
      sourceType: 'github',
      normalizedUrl: url,
      name: `${m[2]}@${m[3]}`,
      suggestedDestPath: `downloads/${m[2]}`,
    }
  }

  // huggingface 裸写 org/repo
  if (HF_SHORT.test(url)) {
    const repo = url.split('/')[1]
    return {
      url,
      ok: true,
      sourceType: 'huggingface',
      normalizedUrl: url,
      name: repo,
      suggestedDestPath: `downloads/${repo}`,
    }
  }

  // 其余 http(s) 直链：取末段文件名
  if (HTTP_URL.test(url)) {
    try {
      const u = new URL(url)
      const segs = u.pathname.split('/').filter(Boolean)
      const last = segs[segs.length - 1]
      const name = last ? decodeURIComponent(last) : u.hostname
      return {
        url,
        ok: true,
        sourceType: 'http',
        normalizedUrl: url,
        name,
        suggestedDestPath: 'downloads/',
      }
    } catch {
      return { url, ok: false, error: 'URL 格式非法' }
    }
  }

  return { url, ok: false, error: '无法识别的 URL 格式' }
}

/** 批量识别：trim、去重（保持输入顺序） */
export function parseUrls(urls: string[]): ParsedUrl[] {
  const seen = new Set<string>()
  const out: ParsedUrl[] = []
  for (const raw of urls) {
    const key = raw.trim()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(parseOne(raw))
  }
  return out
}
