import {
  assertValidDropChunkSessionId,
  blobToBase64DataUrl,
  type DropAppItem,
  type DropFileChunkCompletePayload,
  fileToDropAppItem,
  fillDropItemMimeAndKind,
  getDropReceiveItemStash,
  isMalianDropVirtualUrl,
  MALIAN_DROP_BASE64_BRIDGE_WARN_BYTES,
  MALIAN_DROP_CHUNK_BYTES,
  MALIAN_DROP_CHUNKS_PER_BRIDGE,
  MALIAN_DROP_CHUNKS_PER_BRIDGE_CAP,
  parseDropFileChunkCompletePayload
} from './app-drop-protocol'
import jsBridge from './js-bridge'

const CHUNK_COMPLETE_WAIT_MS = 120_000

type ChunkWaiter = {
  resolve: (p: DropFileChunkCompletePayload) => void
  reject: (e: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
}

const chunkCompleteWaiters = new Map<string, ChunkWaiter>()
let chunkGlobalHandlersInstalled = false

/** 等待原生 `dropFileChunk` 回调后再继续；单 `data` 与批量 `parts` 语义均为按序追加 */
function awaitMalianDropChunkAck(sessionId: string, body: { data: string } | { parts: string[] }): Promise<unknown> {
  return new Promise((resolve, reject) => {
    jsBridge.callHandler('dropFileChunk', { sessionId, ...body }, (res?: unknown) => {
      if (res && typeof res === 'object' && res !== null && 'error' in res) {
        const err = (res as { error?: unknown }).error
        reject(new Error(err != null ? String(err) : 'dropFileChunk 失败'))
        return
      }
      resolve(res)
    })
  })
}

function dispatchChunkComplete(raw: unknown): void {
  let payload: DropFileChunkCompletePayload
  try {
    payload = parseDropFileChunkCompletePayload(raw)
  } catch (e) {
    console.error('[AppDrop] dropFileChunkComplete 解析失败', e)
    return
  }
  const w = chunkCompleteWaiters.get(payload.sessionId)
  if (!w) {
    console.warn('[AppDrop] dropFileChunkComplete 无对应等待：', payload.sessionId)
    return
  }
  console.log('[AppDrop][分片] dropFileChunkComplete 匹配 session，resolve', payload)
  clearTimeout(w.timeoutId)
  chunkCompleteWaiters.delete(payload.sessionId)
  w.resolve(payload)
}

/** 挂载 `window.dropFileChunkComplete` / `__dropFileChunkComplete`（交付说明 §六；幂等） */
export function installDropFileChunkCompleteHandlers(): void {
  if (chunkGlobalHandlersInstalled) return
  chunkGlobalHandlersInstalled = true
  window.dropFileChunkComplete = dispatchChunkComplete
  window.__dropFileChunkComplete = dispatchChunkComplete
}

export function waitDropFileChunkComplete(sessionId: string): Promise<DropFileChunkCompletePayload> {
  assertValidDropChunkSessionId(sessionId)
  if (chunkCompleteWaiters.has(sessionId)) {
    return Promise.reject(new Error(`dropFileChunk: sessionId 已在等待中：${sessionId}`))
  }
  return new Promise<DropFileChunkCompletePayload>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      chunkCompleteWaiters.delete(sessionId)
      reject(new Error(`dropFileChunkComplete 超时（${CHUNK_COMPLETE_WAIT_MS}ms）：${sessionId}`))
    }, CHUNK_COMPLETE_WAIT_MS)
    chunkCompleteWaiters.set(sessionId, { resolve, reject, timeoutId })
  })
}

export function generateDropChunkSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`
}

/** 分片完成后用虚拟 `url` 组一条 `dropFileFlow` / `dropSaveFile` 条目（仅 P0 字段） */
export function dropAppItemFromMalianChunkUrl(name: string, size: number, virtualUrl: string, mimeHint: string): DropAppItem {
  const item: DropAppItem = { name, size, url: virtualUrl }
  delete item.data
  delete item.base64
  fillDropItemMimeAndKind(item, mimeHint || 'application/octet-stream')
  return item
}

/** P1：按顺序分片上传 Blob，结束后通过原生回调取得虚拟 `url`（交付说明 §五）。 */
export async function uploadBlobViaMalianDropChunks(
  blob: Blob,
  options?: { sessionId?: string; mime?: string; chunkSize?: number; chunksPerBridge?: number }
): Promise<DropFileChunkCompletePayload> {
  if (!jsBridge.isNativeEmbedHost() || !jsBridge.isBridgeReady()) {
    throw new Error('分片上传仅在内嵌 WebView 且 Bridge 就绪时可用')
  }
  installDropFileChunkCompleteHandlers()
  const sessionId = options?.sessionId ?? generateDropChunkSessionId()
  assertValidDropChunkSessionId(sessionId)
  const mime = options?.mime && options.mime !== '' ? options.mime : blob.type || 'application/octet-stream'
  const chunkSize = options?.chunkSize ?? MALIAN_DROP_CHUNK_BYTES
  const chunksPerBridge = Math.max(
    1,
    Math.min(options?.chunksPerBridge ?? MALIAN_DROP_CHUNKS_PER_BRIDGE, MALIAN_DROP_CHUNKS_PER_BRIDGE_CAP)
  )

  const done = waitDropFileChunkComplete(sessionId)
  const totalChunks = Math.ceil(blob.size / chunkSize)
  console.log('[AppDrop][分片] uploadBlobViaMalianDropChunks 开始', {
    sessionId,
    mime,
    blobSize: blob.size,
    chunkSize,
    totalChunks,
    chunksPerBridge
  })

  jsBridge.malianDropChunkStart(sessionId, mime)
  let chunkIndex = 0
  const pending: string[] = []

  const flush = async (): Promise<void> => {
    if (pending.length === 0) return
    const batch = pending.splice(0, pending.length)
    const from = chunkIndex - batch.length + 1
    const to = chunkIndex
    if (batch.length === 1) {
      const data = batch[0]!
      console.log('[AppDrop][分片] dropFileChunk', { sessionId, index: from, totalChunks, base64Len: data.length })
      await awaitMalianDropChunkAck(sessionId, { data })
    } else {
      console.log('[AppDrop][分片] dropFileChunk batch', {
        sessionId,
        fromIndex: from,
        toIndex: to,
        totalChunks,
        partCount: batch.length,
        lens: batch.map((s) => s.length)
      })
      await awaitMalianDropChunkAck(sessionId, { parts: batch })
    }
  }

  for (let offset = 0; offset < blob.size; offset += chunkSize) {
    chunkIndex += 1
    const slice = blob.slice(offset, offset + chunkSize)
    const data = await blobToBase64DataUrl(slice)
    pending.push(data)
    if (pending.length >= chunksPerBridge) {
      await flush()
    }
  }
  await flush()

  console.log('[AppDrop][分片] dropFileChunkEnd', { sessionId, sentChunks: chunkIndex })
  jsBridge.malianDropChunkEnd(sessionId)

  return done
}

/**
 * 组装 drop 条目：虚拟 URL stash → 仍走 `fileToDropAppItem`；大文件且在内嵌宿主 → 先试 P1 分片拿 `url`，失败回退 Base64。
 */
export async function fileToDropAppItemPreferChunk(file: File): Promise<DropAppItem> {
  const stashed: Record<string, unknown> = { ...(getDropReceiveItemStash(file) ?? {}) }
  const blobMime = file.type || 'application/octet-stream'
  console.log('[AppDrop][协议] fileToDropAppItemPreferChunk', { name: file.name, size: file.size, blobMime, hasVirtual: isMalianDropVirtualUrl(stashed.url) })

  if (isMalianDropVirtualUrl(stashed.url)) {
    return fileToDropAppItem(file)
  }

  if (!jsBridge.isNativeEmbedHost() || !jsBridge.isBridgeReady() || file.size < MALIAN_DROP_BASE64_BRIDGE_WARN_BYTES) {
    console.log('[AppDrop][协议] fileToDropAppItemPreferChunk → 直接 fileToDropAppItem（宿主/体积）')
    return fileToDropAppItem(file)
  }

  try {
    const p = await uploadBlobViaMalianDropChunks(file, { mime: blobMime })
    const item: DropAppItem = { ...stashed, name: file.name, size: file.size, url: p.url }
    delete item.data
    delete item.base64
    fillDropItemMimeAndKind(item, blobMime)
    console.log('[AppDrop][协议] fileToDropAppItemPreferChunk → 分片完成', { name: item.name, url: p.url, fileId: p.fileId })
    return item
  } catch (e) {
    console.warn('[AppDrop] 分片落盘失败，回退整段 Base64', e)
    return fileToDropAppItem(file)
  }
}
