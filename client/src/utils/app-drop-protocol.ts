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
}

function itemToFile(item: DropReceiveFileItem): Promise<File> {
  const name = item.name ?? item.fileName ?? 'file'
  const mime = item.mime ?? item.type ?? item.mimeType ?? 'application/octet-stream'

  if (item.data && typeof item.data === 'string') {
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    const base64 = stripDataUrlToBase64(item.data)
    const blob = base64ToBlob(base64, mime)
    return Promise.resolve(new File([blob], name, { type: mime }))
  }

  if (item.base64 && typeof item.base64 === 'string') {
    const blob = base64ToBlob(item.base64, mime)
    return Promise.resolve(new File([blob], name, { type: mime }))
  }

  if (item.url && typeof item.url === 'string') {
    return urlToBlob(item.url).then((blob) => new File([blob], name, { type: item.type || blob.type || mime }))
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
export async function filesFromDropReceivePayload(data: unknown): Promise<File[]> {
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
