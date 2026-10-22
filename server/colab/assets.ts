import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

/**
 * 模板与 worker 包的文件定位 + 渲染。
 * 模板占位符风格 `__VAR__`，值一律 JSON.stringify 后内嵌（§6.2：杜绝注入）。
 */

/** 依次尝试的候选根目录（dev 下 import.meta.url 指向源码目录；构建后退化到 cwd） */
function resolveDir(rel: string): string {
  const candidates: string[] = []
  try {
    candidates.push(fileURLToPath(new URL(rel, import.meta.url)))
  } catch {
    /* 非 file: URL 时忽略 */
  }
  candidates.push(join(process.cwd(), 'server', 'colab', rel))
  candidates.push(join(process.cwd(), rel))
  for (const dir of candidates) {
    if (existsSync(dir)) return dir
  }
  // 兜底返回 cwd 相对路径，让 readFile 报出带路径的错误
  return candidates[candidates.length - 1]!
}

const templateCache = new Map<string, string>()

export function loadTemplate(templateName: string): string {
  let tpl = templateCache.get(templateName)
  if (!tpl) {
    const path = join(resolveDir('templates'), `${templateName}.py.tpl`)
    tpl = readFileSync(path, 'utf8')
    templateCache.set(templateName, tpl)
  }
  return tpl
}

/** 变量替换：`__KEY__` → JSON.stringify(value)。JSON 字符串字面量与 Python 兼容。 */
export function renderTemplate(templateName: string, vars: Record<string, unknown>): string {
  let out = loadTemplate(templateName)
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`__${key}__`).join(JSON.stringify(value))
  }
  return out
}

/** ustar 头（512 字节），仅支持普通文件，足够打包 .py */
function tarHeader(name: string, size: number): Buffer {
  const h = Buffer.alloc(512)
  h.write(name, 0, 100, 'utf8')
  h.write('0000644\0', 100, 8)
  h.write('0000000\0', 108, 8)
  h.write('0000000\0', 116, 8)
  h.write(size.toString(8).padStart(11, '0') + '\0', 124, 12)
  h.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136, 12)
  h.write('        ', 148, 8) // checksum 占位（8 个空格）
  h.write('0', 156, 1) // typeflag: 普通文件
  h.write('ustar\0', 257, 6)
  h.write('00', 263, 2)
  let sum = 0
  for (const b of h) sum += b
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8)
  return h
}

/**
 * 把 server/workers/*.py 打成 tar.gz 的 base64（spike-report §4 方案 B：
 * 单次 piped exec 送达，比 N 次 colab upload 快 5.7 倍且原子）。
 */
export function buildWorkersBundle(): string {
  const dir = resolveDir(join('..', 'workers'))
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.py'))
    .sort()
  const chunks: Buffer[] = []
  for (const f of files) {
    const data = readFileSync(join(dir, f))
    chunks.push(tarHeader(f, data.length))
    chunks.push(data)
    const pad = (512 - (data.length % 512)) % 512
    if (pad) chunks.push(Buffer.alloc(pad))
  }
  chunks.push(Buffer.alloc(1024)) // tar 结束：两个零块
  return gzipSync(Buffer.concat(chunks)).toString('base64')
}
