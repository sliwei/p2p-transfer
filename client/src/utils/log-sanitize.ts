/**
 * 控制台日志用：缩短 data URL / 大字符串 / 深层对象，避免拖慢主线程与刷屏二进制。
 */

export function summarizeForLog(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[…]'
  if (value === null || value === undefined) return value
  const t = typeof value
  if (t === 'number' || t === 'boolean' || t === 'bigint') return value
  if (t === 'string') {
    const s = value as string
    if (s.startsWith('data:')) return { kind: 'dataUrl', length: s.length }
    if (s.length > 240) return { kind: 'string', length: s.length, head: s.slice(0, 96) + '…' }
    return s
  }
  if (t === 'function') return '[Function]'
  if (Array.isArray(value)) {
    if (value.length > 64) {
      return {
        kind: 'array',
        length: value.length,
        head: value.slice(0, 5).map((v) => summarizeForLog(v, depth + 1))
      }
    }
    return value.map((v) => summarizeForLog(v, depth + 1))
  }
  if (t === 'object') {
    const o = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(o)) {
      if (k === 'parts' && Array.isArray(v)) {
        const strings = v.filter((x): x is string => typeof x === 'string')
        out[k] = { kind: 'parts', count: strings.length, lens: strings.map((s) => s.length) }
        continue
      }
      if (k === 'data' || k === 'base64') {
        if (typeof v === 'string') {
          out[k] =
            v.startsWith('data:') || k === 'base64'
              ? { length: v.length, head: v.slice(0, 48) + (v.length > 48 ? '…' : '') }
              : summarizeForLog(v, depth + 1)
          continue
        }
      }
      if (k === 'second' && typeof v === 'string') {
        try {
          const parsed = JSON.parse(v) as unknown
          out[k] = { rawLen: v.length, parsed: summarizeForLog(parsed, depth + 1) }
        } catch {
          out[k] = summarizeForLog(v, depth + 1)
        }
        continue
      }
      out[k] = summarizeForLog(v, depth + 1)
    }
    return out
  }
  return String(value)
}
