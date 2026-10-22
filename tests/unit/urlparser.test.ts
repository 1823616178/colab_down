import { describe, it, expect } from 'vitest'
import { parseUrls } from '../../server/services/UrlParser'

describe('UrlParser.parseUrls', () => {
  it('识别 huggingface 完整 URL', () => {
    const [r] = parseUrls(['https://huggingface.co/Comfy-Org/MiniMax-H3'])
    expect(r).toMatchObject({
      ok: true,
      sourceType: 'huggingface',
      normalizedUrl: 'Comfy-Org/MiniMax-H3',
      name: 'MiniMax-H3',
      suggestedDestPath: 'downloads/MiniMax-H3',
    })
    expect(r.revision).toBeUndefined()
  })

  it('识别 huggingface 带 revision 的 URL', () => {
    const [r] = parseUrls(['https://huggingface.co/org/repo/tree/v1.0'])
    expect(r).toMatchObject({
      ok: true,
      sourceType: 'huggingface',
      normalizedUrl: 'org/repo',
      revision: 'v1.0',
    })
  })

  it('识别 huggingface 裸写 org/repo', () => {
    const [r] = parseUrls(['org/repo'])
    expect(r).toMatchObject({ ok: true, sourceType: 'huggingface', name: 'repo' })
  })

  it('识别 github release URL（tag 形式）', () => {
    const [r] = parseUrls(['https://github.com/o/r/releases/tag/v2.0'])
    expect(r).toMatchObject({
      ok: true,
      sourceType: 'github',
      normalizedUrl: 'o/r@v2.0',
      suggestedDestPath: 'downloads/r',
    })
  })

  it('识别 github release URL（download 形式）与直写 o/r@tag', () => {
    const [a] = parseUrls(['https://github.com/o/r/releases/download/v2.0/model.bin'])
    expect(a.normalizedUrl).toBe('o/r@v2.0')
    const [b] = parseUrls(['o/r@v3.1'])
    expect(b).toMatchObject({ ok: true, sourceType: 'github', normalizedUrl: 'o/r@v3.1' })
  })

  it('识别 gdrive 链接（file/d 与 open?id 两种）', () => {
    const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz'
    const [a] = parseUrls([`https://drive.google.com/file/d/${id}/view?usp=sharing`])
    expect(a).toMatchObject({ ok: true, sourceType: 'gdrive', name: `gdrive-${id.slice(0, 8)}` })
    const [b] = parseUrls([`https://drive.google.com/open?id=${id}`])
    expect(b.ok).toBe(true)
    expect(b.sourceType).toBe('gdrive')
  })

  it('识别 magnet（ok=true 但带禁用提示）', () => {
    const [r] = parseUrls(['magnet:?xt=urn:btih:abcdef&dn=My%20File'])
    expect(r.ok).toBe(true)
    expect(r.sourceType).toBe('torrent')
    expect(r.name).toBe('My File')
    expect(r.error).toContain('禁用')
  })

  it('识别 http 直链并取末段文件名（去 query）', () => {
    const [r] = parseUrls(['https://example.com/models/model.safetensors?token=abc'])
    expect(r).toMatchObject({
      ok: true,
      sourceType: 'http',
      name: 'model.safetensors',
      suggestedDestPath: 'downloads/',
    })
  })

  it('无法识别与空行返回 ok=false', () => {
    const [a, b] = parseUrls(['not a url', '   '])
    expect(a.ok).toBe(false)
    expect(b.ok).toBe(false)
  })

  it('trim、去重且保持输入顺序', () => {
    const out = parseUrls(['  org/a ', 'org/b', 'org/a', 'org/b\n'])
    expect(out.map((r) => r.normalizedUrl)).toEqual(['org/a', 'org/b'])
  })
})
