import { useCallback, useEffect, useRef } from 'react'

import { blobToBase64DataUrl, type DropAppPayload, filesFromDropReceivePayload, filesToDropAppPayload, MALIAN_DROP_BASE64_BRIDGE_WARN_BYTES } from '../utils/app-drop-protocol'
import jsBridge, { type JSBridgeHandler } from '../utils/js-bridge'
import { summarizeForLog } from '../utils/log-sanitize'
import { dropAppItemFromMalianChunkUrl, fileToDropAppItemPreferChunk, installDropFileChunkCompleteHandlers, uploadBlobViaMalianDropChunks } from '../utils/malian-drop-chunk'
import type { ReceivedFile } from './useWebRTC'

const DROP_RECEIVE = 'dropReceiveFile'

export interface UseAppDropEmbedOptions {
  /** APP 通过 dropReceiveFile 下发文件；由调用方决定是否要求已进房间 */
  onReceiveFiles: (files: File[]) => void
}

export function useAppDropEmbed(options: UseAppDropEmbedOptions) {
  const onReceiveFilesRef = useRef(options.onReceiveFiles)
  /** 防重复提交（大文件 Base64 解析易加重原生负担，见大文件接收方案 §5） */
  const heavyBridgeBusyRef = useRef(false)
  useEffect(() => {
    onReceiveFilesRef.current = options.onReceiveFiles
  }, [options.onReceiveFiles])

  const notifySelectFile = useCallback(async (files?: File[]) => {
    if (!jsBridge.isBridgeReady()) return
    try {
      const payload = files?.length ? await filesToDropAppPayload(files) : { items: [] as DropAppPayload['items'] }
      console.log('[AppDrop][协议] dropSelectFile 载荷', summarizeForLog(payload))
      jsBridge.dropSelectFile(payload)
    } catch (e) {
      console.error('[AppDrop] dropSelectFile stash payload error', e)
      jsBridge.dropSelectFile({ items: [] })
    }
  }, [])

  const notifyFileFlow = useCallback(async (file: File | ReceivedFile) => {
    if (!jsBridge.isBridgeReady()) return
    if (heavyBridgeBusyRef.current) {
      console.warn('[AppDrop] dropFileFlow 执行中，已忽略重复调用')
      return
    }
    heavyBridgeBusyRef.current = true
    try {
      if (file instanceof File) {
        const item = await fileToDropAppItemPreferChunk(file)
        console.log('[AppDrop][协议] dropFileFlow(File)', summarizeForLog({ items: [item] }))
        jsBridge.dropFileFlow({ items: [item] })
        return
      }
      const blob = file.blob
      const mime = file.type || blob.type || 'application/octet-stream'
      if (blob.size >= MALIAN_DROP_BASE64_BRIDGE_WARN_BYTES && jsBridge.isNativeEmbedHost()) {
        try {
          const p = await uploadBlobViaMalianDropChunks(blob, { mime })
          const item = dropAppItemFromMalianChunkUrl(file.name, blob.size, p.url, mime)
          console.log('[AppDrop][协议] dropFileFlow(ReceivedFile 分片)', summarizeForLog({ items: [item] }))
          jsBridge.dropFileFlow({ items: [item] })
          return
        } catch (e) {
          console.warn('[AppDrop] dropFileFlow 分片失败，回退 Base64', e)
        }
      }
      if (blob.size >= MALIAN_DROP_BASE64_BRIDGE_WARN_BYTES) {
        console.warn('[AppDrop] dropFileFlow 将以 Base64 回传较大文件（', blob.size, ' bytes）；优先压缩或与原生对齐分片方案。')
      }
      const dataUrl = await blobToBase64DataUrl(blob)
      const kind = mime.startsWith('video') ? 'video' : mime.startsWith('image') ? 'image' : 'file'
      const flowPayload = { items: [{ name: file.name, kind, mime, data: dataUrl }] }
      console.log('[AppDrop][协议] dropFileFlow(ReceivedFile Base64)', summarizeForLog(flowPayload))
      jsBridge.dropFileFlow(flowPayload)
    } catch (e) {
      console.error('[AppDrop] dropFileFlow error', e)
    } finally {
      heavyBridgeBusyRef.current = false
    }
  }, [])

  const notifySaveToAlbumBatch = useCallback(async (files: ReceivedFile[], callback: (result: { ok: boolean }) => void) => {
    if (!jsBridge.isBridgeReady()) {
      callback?.({ ok: false })
      return
    }
    if (files.length === 0) {
      callback?.({ ok: true })
      return
    }
    if (heavyBridgeBusyRef.current) {
      console.warn('[AppDrop] dropSaveFile 执行中，已忽略重复调用')
      callback?.({ ok: false })
      return
    }
    heavyBridgeBusyRef.current = true
    try {
      const items = await Promise.all(
        files.map(async (file) => {
          if (file.blob instanceof File) return fileToDropAppItemPreferChunk(file.blob)
          const b = file.blob
          const mime = file.type || b.type || 'application/octet-stream'
          if (b.size >= MALIAN_DROP_BASE64_BRIDGE_WARN_BYTES && jsBridge.isNativeEmbedHost()) {
            try {
              const p = await uploadBlobViaMalianDropChunks(b, { mime })
              return dropAppItemFromMalianChunkUrl(file.name, b.size, p.url, mime)
            } catch (e) {
              console.warn('[AppDrop] dropSaveFile 分片失败，回退 Base64', e)
            }
          }
          if (b.size >= MALIAN_DROP_BASE64_BRIDGE_WARN_BYTES) {
            console.warn('[AppDrop] dropSaveFile 将以 Base64 回传较大文件（', b.size, ' bytes）；优先压缩或与原生对齐分片方案。')
          }
          const dataUrl = await blobToBase64DataUrl(b)
          const kind = mime.startsWith('video') ? 'video' : mime.startsWith('image') ? 'image' : 'file'
          return { name: file.name, kind, mime, data: dataUrl }
        })
      )
      const payload: DropAppPayload = { items }
      console.log('[AppDrop][协议] dropSaveFile 载荷', summarizeForLog(payload))
      jsBridge.dropSaveFile(payload, () => callback({ ok: true }))
    } catch (e) {
      console.error('[AppDrop] dropSaveFile error', e)
      callback?.({ ok: false })
    } finally {
      heavyBridgeBusyRef.current = false
    }
  }, [])

  const notifySaveToAlbum = useCallback(
    async (file: ReceivedFile, callback: (result: { ok: boolean }) => void) => {
      return notifySaveToAlbumBatch([file], callback)
    },
    [notifySaveToAlbumBatch]
  )

  useEffect(() => {
    if (!jsBridge.isNativeEmbedHost()) return

    jsBridge.whenReady(() => {
      console.log('[AppDrop][协议] Bridge 就绪：installDropFileChunkCompleteHandlers + dropLoadComplete')
      installDropFileChunkCompleteHandlers()
      jsBridge.dropLoadComplete()
    })
  }, [])

  useEffect(() => {
    if (!jsBridge.isNativeEmbedHost()) return

    const handler: JSBridgeHandler = (data, callback) => {
      void (async () => {
        try {
          const files = await filesFromDropReceivePayload(data)
          if (files.length === 0) {
            console.log('[AppDrop][协议] dropReceiveFile 完成：0 个文件')
            callback?.({ ok: true, count: 0 })
            return
          }
          console.log('[AppDrop][协议] dropReceiveFile → onReceiveFiles', {
            count: files.length,
            names: files.map((f) => f.name),
            sizes: files.map((f) => f.size)
          })
          onReceiveFilesRef.current(files)
          callback?.({ ok: true, count: files.length })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          console.error('[AppDrop] dropReceiveFile', msg)
          callback?.({ ok: false, error: msg })
        }
      })()
    }

    jsBridge.registerHandler(DROP_RECEIVE, handler)
    return () => {
      jsBridge.unregisterHandler(DROP_RECEIVE, handler)
    }
  }, [])

  return { notifySelectFile, notifyFileFlow, notifySaveToAlbum, notifySaveToAlbumBatch }
}
