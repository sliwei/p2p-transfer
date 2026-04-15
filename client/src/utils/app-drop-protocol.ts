/**
 * 与宿主 APP 约定的 drop 协议：解析 dropReceiveFile 入参 → File[]
 * 对齐《马良 Drop：流式传输与 H5 对接说明》：虚拟 host `ml-drop-local`、`dropFileFlow`/`dropSaveFile` 可无 `data` 仅回传虚拟 `url`。
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

/** 单文件描述（APP 侧常用字段；实际可含任意自定义键） */
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
  /** 虚拟 URL 或公网地址；流式模式下为 `https://ml-drop-local/file/{fileId}` */
  url?: string
  /** 原始业务地址（CDN 等），仅元数据；不参与解析 */
  sourceUrl?: string
  path?: string
  messageId?: string
  /** 封面图：非空时列表预览优先用（data URL / http(s) / 纯 base64 均可） */
  cover?: string
  [key: string]: unknown
}

/** 带可选 cover 的 File（dropReceiveFile 协议解析结果） */
export type DropReceiveFile = File & { cover?: string }

/** 与 File 配对保存 dropReceiveFile 原始条目（除体积字段外原样回传） */
const dropReceiveItemStashByFile = new WeakMap<File, Record<string, unknown>>()

/** 仅排除由 Blob 单独承载的字段，其余键（含宿主自定义）全部暂存 */
const STASH_OMIT_KEYS = new Set(['data', 'base64'])

function rememberDropReceiveItem(file: File, item: Record<string, unknown>): void {
  const stash: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(item)) {
    if (v === undefined) continue
    if (STASH_OMIT_KEYS.has(k)) continue
    stash[k] = v
  }
  dropReceiveItemStashByFile.set(file, stash)
}

/** 供 UI 等读取：来自 dropReceiveFile 的条目快照（未含 data/base64） */
export function getDropReceiveItemStash(file: File): Readonly<Record<string, unknown>> | undefined {
  return dropReceiveItemStashByFile.get(file)
}

/** 马良 Drop 虚拟文件 URL 前缀（与 MalianDropFileInterceptor 一致） */
export const MALIAN_DROP_VIRTUAL_URL_PREFIX = 'https://ml-drop-local/file/'

export function isMalianDropVirtualUrl(url: unknown): url is string {
  return typeof url === 'string' && url.startsWith(MALIAN_DROP_VIRTUAL_URL_PREFIX)
}

function itemToFile(item: DropReceiveFileItem): Promise<DropReceiveFile> {
  const name = item.name ?? item.fileName ?? 'file'
  const mime = item.mime ?? item.type ?? item.mimeType ?? 'application/octet-stream'

  const finish = (file: File): DropReceiveFile => {
    rememberDropReceiveItem(file, item as Record<string, unknown>)
    return file as DropReceiveFile
  }

  const dataRaw = item.data
  if (typeof dataRaw === 'string' && dataRaw.trim() !== '') {
    const base64 = stripDataUrlToBase64(dataRaw)
    const blob = base64ToBlob(base64, mime)
    return Promise.resolve(finish(new File([blob], name, { type: mime })))
  }

  const base64Raw = item.base64
  if (typeof base64Raw === 'string' && base64Raw.trim() !== '') {
    const blob = base64ToBlob(base64Raw, mime)
    return Promise.resolve(finish(new File([blob], name, { type: mime })))
  }

  if (item.url && typeof item.url === 'string') {
    return urlToBlob(item.url).then((blob) => {
      const fileType = blob.type && blob.type !== '' ? blob.type : mime
      return finish(new File([blob], name, { type: fileType }))
    })
  }

  return Promise.reject(new Error(`dropReceiveFile: 无法解析文件项（需 data, base64 或 url）: ${name}`))
}

/**
 * 将 APP 通过 registerHandler('dropReceiveFile') 传入的 data 转为 File[]
 *
 * 支持形态示例：
 * - `{ items: [ { kind, mime, url, sourceUrl?, size, messageId, name } ] }`（可无 `data`）
 * - `{ items: [ { kind, mime, data, ... } ] }`（旧 Base64）
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

/** H5 → APP 单条：结构同 dropReceiveFile 条目，键集不固定 */
export type DropAppItem = Record<string, unknown>

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

function fillDropItemMimeAndKind(item: DropAppItem, blobMime: string): void {
  if (item.mime == null || item.mime === '') item.mime = blobMime || 'application/octet-stream'
  if (item.kind == null || item.kind === '') {
    const m =
      (typeof item.mime === 'string' && item.mime !== '' ? item.mime : blobMime) || 'application/octet-stream'
    item.kind = m.startsWith('video') ? 'video' : m.startsWith('image') ? 'image' : 'file'
  }
}

/**
 * 将单个 File 转为发给 APP 的 drop 条目：若来自马良虚拟 URL stash 则只回传 url（无 data），否则走 Base64 data URL。
 */
export async function fileToDropAppItem(file: File): Promise<DropAppItem> {
  const stashed: Record<string, unknown> = { ...(dropReceiveItemStashByFile.get(file) ?? {}) }
  const blobMime = file.type || 'application/octet-stream'

  if (isMalianDropVirtualUrl(stashed.url)) {
    const item: DropAppItem = { ...stashed, name: file.name, size: file.size }
    delete item.data
    delete item.base64
    fillDropItemMimeAndKind(item, blobMime)
    return item
  }

  const dataUrl = await blobToBase64DataUrl(file)
  const item: DropAppItem = { ...stashed, name: file.name, size: file.size, data: dataUrl }
  fillDropItemMimeAndKind(item, blobMime)
  return item
}

/** 将 H5 已选 File[] 转为发给 APP 的 drop 载荷（dropReceiveFile 条目中除 data/base64 外原样带回；虚拟 URL 条目不编码 data） */
export async function filesToDropAppPayload(files: File[]): Promise<DropAppPayload> {
  const items = await Promise.all(files.map((file) => fileToDropAppItem(file)))
  return { items }
}

/** 从 data URL 拆出纯 base64 */
export function stripDataUrlToBase64(dataUrl: string): string {
  const i = dataUrl.indexOf(',')
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl
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
