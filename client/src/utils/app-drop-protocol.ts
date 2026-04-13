/**
 * 与宿主 APP 约定的 drop 协议：解析 dropReceiveFile 入参 → File[]
 * 支持常见 JSON 形态（可按实际 APP 再扩展）
 */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([bytes], { type: mime || 'application/octet-stream' })
}

async function urlToBlob(url: string): Promise<Blob> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch url failed: ${res.status}`)
  return res.blob()
}

/** 单文件描述（APP 侧常用字段） */
export interface DropReceiveFileItem {
  name?: string
  fileName?: string
  size?: number
  type?: string
  mimeType?: string
  mime?: string
  kind?: string
  /** 纯 base64，不含 data: 前缀 */
  base64?: string
  /** 包含 data: 前缀的 base64 */
  data?: string
  /** 可下载地址 */
  url?: string
  path?: string
  messageId?: string
  /** 封面图：非空时列表预览优先用（data URL / http(s) / 纯 base64 均可） */
  cover?: string
}

/** 带可选 cover 的 File（dropReceiveFile 协议解析结果） */
export type DropReceiveFile = File & { cover?: string }

function attachCover(file: File, item: DropReceiveFileItem): DropReceiveFile {
  const raw = item.cover
  if (raw == null) return file as DropReceiveFile
  const cover = typeof raw === 'string' ? raw.trim() : ''
  if (!cover) return file as DropReceiveFile
  return Object.assign(file, { cover }) as DropReceiveFile
}

function itemToFile(item: DropReceiveFileItem): Promise<DropReceiveFile> {
  const name = item.name ?? item.fileName ?? 'file'
  const mime = item.mime ?? item.type ?? item.mimeType ?? 'application/octet-stream'

  if (item.data && typeof item.data === 'string') {
     
    const base64 = stripDataUrlToBase64(item.data)
    const blob = base64ToBlob(base64, mime)
    return Promise.resolve(attachCover(new File([blob], name, { type: mime }), item))
  }

  if (item.base64 && typeof item.base64 === 'string') {
    const blob = base64ToBlob(item.base64, mime)
    return Promise.resolve(attachCover(new File([blob], name, { type: mime }), item))
  }

  if (item.url && typeof item.url === 'string') {
    return urlToBlob(item.url).then((blob) =>
      attachCover(new File([blob], name, { type: item.type || blob.type || mime }), item)
    )
  }

  return Promise.reject(new Error(`dropReceiveFile: 无法解析文件项（需 data, base64 或 url）: ${name}`))
}

/**
 * 将 APP 通过 registerHandler('dropReceiveFile') 传入的 data 转为 File[]
 *
 * 支持形态示例：
 * - `{ items: [ { kind, mime, data, url, messageId, name }, ... ] }`
 * - `{ file: { name, base64, type? } }`
 * - `{ files: [ { ... }, ... ] }`
 * - `{ name, base64, type? }` 单文件
 */
export async function filesFromDropReceivePayload(data: unknown): Promise<DropReceiveFile[]> {
  if (data == null) return []

  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data) as unknown
      return filesFromDropReceivePayload(parsed)
    } catch {
      throw new Error('dropReceiveFile: 字符串不是合法 JSON')
    }
  }

  if (!isRecord(data)) {
    throw new Error('dropReceiveFile: 期望对象或 JSON 字符串')
  }

  if (Array.isArray(data.items)) {
    const items = data.items as DropReceiveFileItem[]
    return Promise.all(items.map((it) => itemToFile(it)))
  }

  if (Array.isArray(data.files)) {
    const items = data.files as DropReceiveFileItem[]
    return Promise.all(items.map((it) => itemToFile(it)))
  }

  if (isRecord(data.file)) {
    return [await itemToFile(data.file as DropReceiveFileItem)]
  }

  if (typeof data.data === 'string' || typeof data.base64 === 'string' || typeof data.url === 'string') {
    return [await itemToFile(data as DropReceiveFileItem)]
  }

  throw new Error('dropReceiveFile: 缺少 items / files / file / data / base64 / url')
}

export interface DropAppItem {
  name?: string
  kind?: string
  mime?: string
  data?: string
  url?: string
  messageId?: string
}

export interface DropAppPayload {
  items: DropAppItem[]
}

export function blobToBase64DataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

/** 从 data URL 拆出纯 base64 */
export function stripDataUrlToBase64(dataUrl: string): string {
  const i = dataUrl.indexOf(',')
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl
}

/** 日志用：长 data URL / base64 串省略为长度说明，其余字段原样 */
function omitLongPayloadForLog(value: string, field: string): string {
  const n = value.length
  if (value.startsWith('data:')) {
    return `[${field}: data URL omitted, length=${n}]`
  }
  if (n > 80 && /^[A-Za-z0-9+/=\s]+$/.test(value)) {
    return `[${field}: base64 omitted, length=${n}]`
  }
  if (n > 500) {
    return `[${field}: string truncated, length=${n}, head=${value.slice(0, 48)}…]`
  }
  return value
}

/**
 * 将 File（含 drop 协议挂的 cover 等自有字段）转为可 console 的对象，base64/长 payload 省略。
 */
export function describeFileForLog(file: File): Record<string, unknown> {
  const std = ['name', 'size', 'type', 'lastModified'] as const
  const out: Record<string, unknown> = {
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
  }
  const wrp = (file as File & { webkitRelativePath?: string }).webkitRelativePath
  if (wrp) out.webkitRelativePath = wrp

  const extra = file as File & Record<string, unknown>
  for (const key of Object.keys(extra)) {
    if (std.includes(key as (typeof std)[number]) || key === 'webkitRelativePath') continue
    const v = extra[key]
    if (typeof v === 'string') {
      out[key] = omitLongPayloadForLog(v, key)
    } else {
      out[key] = v
    }
  }
  return out
}

/** 协议中的 cover 转为可用于图片 src 的地址（data URL / 绝对 URL 原样返回；否则按 base64 + MIME 包装） */
export function coverToImageSrc(cover: string, file: File): string {
  const c = cover.trim()
  if (!c) return ''
  if (c.startsWith('data:') || c.startsWith('http://') || c.startsWith('https://') || c.startsWith('blob:')) {
    return c
  }
  const mime = file.type && file.type.startsWith('image/') ? file.type : 'image/jpeg'
  return `data:${mime};base64,${c}`
}
