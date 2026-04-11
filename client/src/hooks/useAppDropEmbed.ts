import { useCallback, useEffect, useRef } from 'react'

import {
  blobToBase64DataUrl,
  type DropFileFlowPayload,
  type DropSaveFilePayload,
  filesFromDropReceivePayload,
  stripDataUrlToBase64
} from '../utils/app-drop-protocol'
import jsBridge, { type JSBridgeHandler } from '../utils/js-bridge'
import type { ReceivedFile } from './useWebRTC'

const DROP_RECEIVE = 'dropReceiveFile'

export interface UseAppDropEmbedOptions {
  /** APP 通过 dropReceiveFile 下发文件；由调用方决定是否要求已进房间 */
  onReceiveFiles: (files: File[]) => void
}

export function useAppDropEmbed(options: UseAppDropEmbedOptions) {
  const onReceiveFilesRef = useRef(options.onReceiveFiles)
  useEffect(() => {
    onReceiveFilesRef.current = options.onReceiveFiles
  }, [options.onReceiveFiles])

  const notifySelectFile = useCallback(() => {
    if (!jsBridge.isBridgeReady()) return
    jsBridge.dropSelectFile()
  }, [])

  const notifyFileFlow = useCallback((payload: DropFileFlowPayload) => {
    if (!jsBridge.isBridgeReady()) return
    jsBridge.dropFileFlow(payload)
  }, [])

  const notifySaveToAlbum = useCallback(async (file: ReceivedFile) => {
    if (!jsBridge.isBridgeReady()) return
    try {
      const dataUrl = await blobToBase64DataUrl(file.blob)
      const base64 = stripDataUrlToBase64(dataUrl)
      const payload: DropSaveFilePayload = {
        fileName: file.name,
        fileSize: file.size,
        base64,
        mimeType: file.type || file.blob.type || undefined
      }
      jsBridge.dropSaveFile(payload)
    } catch (e) {
      console.error('[AppDrop] dropSaveFile 读取 blob 失败', e)
    }
  }, [])

  useEffect(() => {
    if (!jsBridge.isNativeEmbedHost()) return

    jsBridge.whenReady(() => {
      jsBridge.dropLoadComplete({ page: 'p2p-transfer' })
    })
  }, [])

  useEffect(() => {
    if (!jsBridge.isNativeEmbedHost()) return

    const handler: JSBridgeHandler = (data, callback) => {
      void (async () => {
        try {
          const files = await filesFromDropReceivePayload(data)
          if (files.length === 0) {
            callback?.({ ok: true, count: 0 })
            return
          }
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

  return { notifySelectFile, notifyFileFlow, notifySaveToAlbum }
}
