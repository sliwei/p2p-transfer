import { summarizeForLog } from './log-sanitize'

/**
 * 与宿主 APP 约定的 drop 协议：解析 dropReceiveFile 入参 → File[]
 * - 《马良 Drop：流式传输与 H5 对接说明》：虚拟 `https://ml-drop-local/file/{id}`。
 * - 《马良 Drop：大文件接收方案》：`data` 与 `url` 二选一。
 * - 《马良 Drop 大文件接收 — H5 对接开发说明（交付版）》：P0 仅虚拟 URL；P1 `dropFileChunk*` + `dropFileChunkComplete`。
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

/**
 * 马良虚拟 URL 的 File 本体为 0 字节占位，真实体积在 stash.size；其余文件用 `file.size`。
 */
export function getEffectiveDropFileSize(file: File): number {
  const stash = dropReceiveItemStashByFile.get(file)
  if (stash && isMalianDropVirtualUrl(stash.url)) {
    const s = stash.size
    if (typeof s === 'number' && Number.isFinite(s) && s >= 0) return s
  }
  return file.size
}

/** 超过此体积仍走 Base64 回传时在控制台告警（依赖原生 IO/流式解码；见大文件方案 §5 P2） */
export const MALIAN_DROP_BASE64_BRIDGE_WARN_BYTES = 12 * 1024 * 1024

function itemToFile(item: DropReceiveFileItem): Promise<DropReceiveFile> {
  const name = item.name ?? item.fileName ?? 'file'
  const mime = item.mime ?? item.type ?? item.mimeType ?? 'application/octet-stream'

  const finish = (file: File): DropReceiveFile => {
    rememberDropReceiveItem(file, item as Record<string, unknown>)
    return file as DropReceiveFile
  }

  const dataRaw = item.data
  if (typeof dataRaw === 'string' && dataRaw.trim() !== '') {
    console.log('[AppDrop][协议] itemToFile', name, 'path=data', { mime, dataLen: dataRaw.length })
    const base64 = stripDataUrlToBase64(dataRaw)
    const blob = base64ToBlob(base64, mime)
    return Promise.resolve(finish(new File([blob], name, { type: mime })))
  }

  const base64Raw = item.base64
  if (typeof base64Raw === 'string' && base64Raw.trim() !== '') {
    console.log('[AppDrop][协议] itemToFile', name, 'path=base64', { mime, base64Len: base64Raw.length })
    const blob = base64ToBlob(base64Raw, mime)
    return Promise.resolve(finish(new File([blob], name, { type: mime })))
  }

  if (item.url && typeof item.url === 'string' && isMalianDropVirtualUrl(item.url)) {
    console.log('[AppDrop][协议] itemToFile', name, 'path=malian-virtual-url', { mime, url: item.url, size: item.size })
    if (typeof item.size !== 'number' || !Number.isFinite(item.size) || item.size < 0) {
      console.warn('[AppDrop] 马良虚拟 URL 缺少有效 size，列表配额与 WebRTC 元数据可能不准:', name)
    }
    const empty = new Blob([], { type: mime })
    return Promise.resolve(finish(new File([empty], name, { type: mime })))
  }

  if (item.url && typeof item.url === 'string') {
    console.log('[AppDrop][协议] itemToFile', name, 'path=fetch-url', { mime, url: item.url })
    return urlToBlob(item.url).then((blob) => {
      const fileType = blob.type && blob.type !== '' ? blob.type : mime
      console.log('[AppDrop][协议] itemToFile', name, 'fetch 完成', { blobSize: blob.size, blobType: fileType })
      return finish(new File([blob], name, { type: fileType }))
    })
  }

  console.error('[AppDrop][协议] itemToFile 无法解析', name, summarizeForLog(item))
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
  console.log('[AppDrop][协议] filesFromDropReceivePayload 入参', summarizeForLog(data))
  if (data == null) {
    console.log('[AppDrop][协议] filesFromDropReceivePayload 空入参 → []')
    return []
  }

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

  let files: DropReceiveFile[]
  if (Array.isArray(data.items)) {
    const items = data.items as DropReceiveFileItem[]
    console.log('[AppDrop][协议] 形态=items', { count: items.length })
    files = await Promise.all(items.map((it) => itemToFile(it)))
  } else if (Array.isArray(data.files)) {
    const items = data.files as DropReceiveFileItem[]
    console.log('[AppDrop][协议] 形态=files', { count: items.length })
    files = await Promise.all(items.map((it) => itemToFile(it)))
  } else if (isRecord(data.file)) {
    console.log('[AppDrop][协议] 形态=file 单对象')
    files = [await itemToFile(data.file as DropReceiveFileItem)]
  } else if (typeof data.data === 'string' || typeof data.base64 === 'string' || typeof data.url === 'string') {
    console.log('[AppDrop][协议] 形态=根级单文件字段')
    files = [await itemToFile(data as DropReceiveFileItem)]
  } else {
    throw new Error('dropReceiveFile: 缺少 items / files / file / data / base64 / url')
  }

  console.log(
    '[AppDrop][协议] filesFromDropReceivePayload 完成',
    files.map((f) => ({
      name: f.name,
      fileSize: f.size,
      effectiveSize: getEffectiveDropFileSize(f),
      type: f.type
    }))
  )
  return files
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

export function fillDropItemMimeAndKind(item: DropAppItem, blobMime: string): void {
  if (item.mime == null || item.mime === '') item.mime = blobMime || 'application/octet-stream'
  if (item.kind == null || item.kind === '') {
    const m = (typeof item.mime === 'string' && item.mime !== '' ? item.mime : blobMime) || 'application/octet-stream'
    item.kind = m.startsWith('video') ? 'video' : m.startsWith('image') ? 'image' : 'file'
  }
}

/**
 * 将单个 File 转为发给 APP 的 drop 条目：若 stash 为马良虚拟 URL 则 **仅 `url`**（不传 `data`）；否则 **仅 `data`**（不传 `url`，与解析器二选一契约一致）。
 */
export async function fileToDropAppItem(file: File): Promise<DropAppItem> {
  const stashed: Record<string, unknown> = { ...(dropReceiveItemStashByFile.get(file) ?? {}) }
  const blobMime = file.type || 'application/octet-stream'
  console.log('[AppDrop][协议] fileToDropAppItem 开始', {
    name: file.name,
    size: file.size,
    type: blobMime,
    stashKeys: Object.keys(stashed),
    virtualUrl: isMalianDropVirtualUrl(stashed.url) ? stashed.url : undefined
  })

  if (isMalianDropVirtualUrl(stashed.url)) {
    const st = stashed.size
    const logicalSize = typeof st === 'number' && Number.isFinite(st) && st >= 0 ? st : file.size
    const item: DropAppItem = { ...stashed, name: file.name, size: logicalSize }
    delete item.data
    delete item.base64
    fillDropItemMimeAndKind(item, blobMime)
    console.log('[AppDrop][协议] fileToDropAppItem 完成(虚拟URL)', summarizeForLog(item))
    return item
  }

  if (file.size >= MALIAN_DROP_BASE64_BRIDGE_WARN_BYTES) {
    console.warn('[AppDrop] 将通过 Base64 回传较大文件（', file.size, ' bytes）；若该文件来自马良 Drop，应只回传虚拟 url。大文件易导致卡顿，见大文件接收方案。')
  }

  const dataUrl = await blobToBase64DataUrl(file)
  const item: DropAppItem = { ...stashed, name: file.name, size: file.size, data: dataUrl }
  delete item.url
  delete item.base64
  fillDropItemMimeAndKind(item, blobMime)
  console.log('[AppDrop][协议] fileToDropAppItem 完成(Base64)', {
    name: item.name,
    size: item.size,
    hasData: typeof item.data === 'string',
    dataLen: typeof item.data === 'string' ? item.data.length : 0,
    mime: item.mime,
    kind: item.kind
  })
  return item
}

/** 将 H5 已选 File[] 转为发给 APP 的 drop 载荷（大文件优先分片见 `malian-drop-chunk`） */
export async function filesToDropAppPayload(files: File[]): Promise<DropAppPayload> {
  console.log('[AppDrop][协议] filesToDropAppPayload 开始', {
    count: files.length,
    names: files.map((f) => f.name),
    sizes: files.map((f) => f.size)
  })
  const { fileToDropAppItemPreferChunk } = await import('./malian-drop-chunk')
  const items = await Promise.all(files.map((file) => fileToDropAppItemPreferChunk(file)))
  console.log('[AppDrop][协议] filesToDropAppPayload 完成', summarizeForLog({ items }))
  return { items }
}

/** 从 data URL 拆出纯 base64 */
export function stripDataUrlToBase64(dataUrl: string): string {
  const i = dataUrl.indexOf(',')
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl
}

// —— 分片桥（P1）类型，与交付说明 §五、§六 对齐 ——

/** 分片相关 action（经 `invokeMethod` 的 `envelope.action` 下发） */
export type DropChunkAction = 'dropFileChunkStart' | 'dropFileChunk' | 'dropFileChunkEnd'

export interface DropFileChunkStartParams {
  sessionId: string
  /** 缺省由原生按 octet-stream 处理；建议填真实 MIME */
  mime?: string
}

/** 单片：`{ sessionId, data }`，与交付说明一致 */
export interface DropFileChunkBodyParams {
  sessionId: string
  /** 纯 Base64 或 `data:*;base64,*` */
  data: string
}

/**
 * 批量：同一桥调用内按数组顺序追加，语义等同连续多次单 `data`（无独立序号字段；顺序即序号）。
 * 宿主须在同一 handler 内解析 `parts` 并逐段拼接；仅支持单 `data` 的旧实现请将 H5 `chunksPerBridge` 保持为 1。
 */
export interface DropFileChunkBodyParamsBatch {
  sessionId: string
  parts: string[]
}

export interface DropFileChunkEndParams {
  sessionId: string
}

/** 原生 `evaluateJavascript` 回调 `dropFileChunkComplete` / `__dropFileChunkComplete` 的 payload */
export interface DropFileChunkCompletePayload {
  sessionId: string
  fileId: string
  url: string
}

/** 交付说明 §5.1：`^[a-zA-Z0-9_-]{1,64}$` */
export const DROP_CHUNK_SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/

export function assertValidDropChunkSessionId(sessionId: string): void {
  if (!DROP_CHUNK_SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error('dropFileChunk: sessionId 须为 1～64 位，仅 a-z A-Z 0-9 _ -')
  }
}

export function parseDropFileChunkCompletePayload(raw: unknown): DropFileChunkCompletePayload {
  let o: unknown
  if (typeof raw === 'string') {
    try {
      o = JSON.parse(raw) as unknown
    } catch {
      throw new Error('dropFileChunkComplete: payload 不是合法 JSON')
    }
  } else {
    o = raw
  }
  if (!isRecord(o)) throw new Error('dropFileChunkComplete: 期望对象')
  const sessionId = o.sessionId
  const fileId = o.fileId
  const url = o.url
  if (typeof sessionId !== 'string' || typeof fileId !== 'string' || typeof url !== 'string') {
    throw new Error('dropFileChunkComplete: 缺少 sessionId / fileId / url')
  }
  const out = { sessionId, fileId, url }
  console.log('[AppDrop][协议] parseDropFileChunkCompletePayload', out)
  return out
}

/**
 * 分片单段大小：经 Base64 + JSBridge 传对象时，过大单包会长时间占用主线程并放大序列化/日志成本（10MiB 在真机上常见数秒/片）。
 * 1MiB 在吞吐与单次延迟之间较均衡；可按宿主能力通过 `uploadBlobViaMalianDropChunks(..., { chunkSize })` 覆盖。
 */
export const MALIAN_DROP_CHUNK_BYTES = 1 * 1024 * 1024

/**
 * 单次 `dropFileChunk` 合并的片数：>1 时载荷为 `{ sessionId, parts }`，需宿主支持；默认 1 兼容仅实现单 `data` 的 App。
 */
export const MALIAN_DROP_CHUNKS_PER_BRIDGE = 1

/** 防止单次桥消息过大，合并片数上限（× {@link MALIAN_DROP_CHUNK_BYTES} 即粗上限） */
export const MALIAN_DROP_CHUNKS_PER_BRIDGE_CAP = 8

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
