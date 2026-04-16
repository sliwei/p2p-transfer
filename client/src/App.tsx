import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { BottomInstructions } from './components/BottomInstructions'
import { RadarCanvas } from './components/RadarCanvas'
import { RadarView } from './components/RadarView'
import { ReceivedFilesModal } from './components/ReceivedFilesModal'
import { RoomJoin } from './components/RoomJoin'
import { SelectedFilesList } from './components/SelectedFilesList'
import { TransferRequestModal } from './components/TransferRequestModal'
import { useAppDropEmbed } from './hooks/useAppDropEmbed'
import { useRoom } from './hooks/useRoom'
import { DISPLAY_NAME_MAX_LEN, type ReceivedFile, useWebRTC } from './hooks/useWebRTC'
import jsBridge from './utils/js-bridge'
import { buildRoomShareUrl } from './utils/roomLink'
import { isImageOrVideo, mergeFeedbackMessage, mergeIntoSelectedFiles } from './utils/selected-files-policy'
import { shouldStepwiseAlbumSaveInBrowser } from './utils/triggerDownload'

function App() {
  const { roomId, inputRoomId, setInputRoomId, joinRoom, generateRoomId } = useRoom()
  const roomIdRef = useRef(roomId)
  useEffect(() => {
    roomIdRef.current = roomId
  }, [roomId])

  const {
    peers,
    transfers,
    sendFilesBatch,
    incomingRequests,
    outgoingTransferHint,
    respondToTransferRequest,
    downloadFile,
    downloadReceivedFiles,
    myPeerId,
    myPeerName,
    setMyDisplayName,
    receivedModalPayload,
    acknowledgeReceivedModal,
    releaseReceivedFiles,
    transferBatchTotalBytesByPeer
  } = useWebRTC(roomId)

  const roomLink = useMemo(() => buildRoomShareUrl(roomId ?? ''), [roomId])

  const readyPeers = useMemo(() => peers.filter((p) => p.status === 'connected'), [peers])

  const readyPeerIds = useMemo(() => new Set(readyPeers.map((p) => p.id)), [readyPeers])

  const [selectedPeers, setSelectedPeers] = useState<string[]>([])

  /** 与就绪列表求交：对端掉线后 UI 与发送目标自动忽略已断连 id，无需 effect 回写 state */
  const selectedPeersEffective = useMemo(() => selectedPeers.filter((id) => readyPeerIds.has(id)), [selectedPeers, readyPeerIds])

  const handleTogglePeer = useCallback((peerId: string) => {
    setSelectedPeers((prev) => (prev.includes(peerId) ? prev.filter((id) => id !== peerId) : [...prev, peerId]))
  }, [])

  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [isSending, setIsSending] = useState(false)

  useEffect(() => {
    console.log('[UI][待传文件列表]', {
      count: selectedFiles.length,
      files: selectedFiles.map((f) => ({ name: f.name, size: f.size, type: f.type }))
    })
  }, [selectedFiles])

  /** 仅当对端从就绪列表消失时兜底结束「发送中」；用户手动清空勾选时不触发（见下方 selectedPeers.length 判断）。异步写入以避免 react-hooks/set-state-in-effect。 */
  useEffect(() => {
    if (!isSending) return
    if (selectedPeers.length === 0) return
    const anyStillReady = selectedPeers.some((id) => readyPeerIds.has(id))
    if (anyStillReady) return
    const id = requestAnimationFrame(() => setIsSending(false))
    return () => cancelAnimationFrame(id)
  }, [isSending, selectedPeers, readyPeerIds])

  const [showReceivedModal, setShowReceivedModal] = useState(false)

  const [nickEditing, setNickEditing] = useState(false)
  const nickEscapeRef = useRef(false)
  const beforeEditNickRef = useRef('')
  const nickElRef = useRef<HTMLSpanElement>(null)
  const displayNick = myPeerName || myPeerId.slice(0, 4)

  const startNickEdit = useCallback(() => {
    nickEscapeRef.current = false
    beforeEditNickRef.current = displayNick
    setNickEditing(true)
  }, [displayNick])

  useLayoutEffect(() => {
    if (!nickEditing) return
    const el = nickElRef.current
    if (!el) return
    el.textContent = beforeEditNickRef.current
    el.focus()
    const sel = window.getSelection()
    if (!sel) return
    const range = document.createRange()
    if (el.childNodes.length === 0) {
      range.setStart(el, 0)
    } else {
      range.selectNodeContents(el)
    }
    range.collapse(false)
    sel.removeAllRanges()
    sel.addRange(range)
  }, [nickEditing])

  const clampNickEditableLength = useCallback(() => {
    const el = nickElRef.current
    if (!el) return
    let t = el.innerText.replace(/\r?\n/g, '')
    if (t.length > DISPLAY_NAME_MAX_LEN) {
      t = t.slice(0, DISPLAY_NAME_MAX_LEN)
      el.textContent = t
      const range = document.createRange()
      range.setStart(el.firstChild ?? el, t.length)
      range.collapse(true)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
  }, [])

  const [receiveAction, setReceiveAction] = useState<'album' | 'chat' | null>(null)
  const [pendingProcessFiles, setPendingProcessFiles] = useState<ReceivedFile[]>([])
  const finishingReceivedRef = useRef(false)

  const albumStepwiseBrowserSave = useMemo(
    () => receiveAction === 'album' && shouldStepwiseAlbumSaveInBrowser(jsBridge.isNativeEmbedHost(), pendingProcessFiles.length),
    [receiveAction, pendingProcessFiles.length]
  )

  const onReceiveEmbedFiles = useCallback((files: File[]) => {
    if (!roomIdRef.current) {
      console.warn('[AppDrop] 请先加入房间后再接收来自 APP 的文件')
      return
    }
    setSelectedFiles((prev) => {
      const r = mergeIntoSelectedFiles(prev, files, isImageOrVideo)
      const msg = mergeFeedbackMessage(r)
      if (msg) queueMicrotask(() => toast.warning(msg))
      return r.next
    })
  }, [])

  const { notifySelectFile, notifyFileFlow, notifySaveToAlbumBatch } = useAppDropEmbed({
    onReceiveFiles: onReceiveEmbedFiles
  })

  const handleDropZoneFilesChange = useCallback((files: File[]) => {
    setSelectedFiles(files)
  }, [])

  useEffect(() => {
    if (!receivedModalPayload?.length) return
    setPendingProcessFiles(receivedModalPayload)
    setShowReceivedModal(true)
    acknowledgeReceivedModal()
  }, [receivedModalPayload, acknowledgeReceivedModal])
  const handleSendFiles = async () => {
    if (selectedFiles.length === 0 || selectedPeersEffective.length === 0 || isSending) return

    setIsSending(true)
    await Promise.allSettled(
      selectedPeersEffective.map(async (peerId) => {
        await sendFilesBatch(selectedFiles, peerId)
      })
    )
    setSelectedPeers([])
    setIsSending(false)
  }

  if (!roomId) {
    return <RoomJoin roomId={inputRoomId} onRoomIdChange={setInputRoomId} onJoin={joinRoom} onGenerate={generateRoomId} />
  }

  return (
    <div className="relative h-full min-h-[100dvh] w-full overflow-hidden overscroll-none bg-white font-sans">
      <RadarCanvas animate={readyPeers.length === 0} />

      {/* fixed 子项不参与可靠高度分配：用 absolute 铺满父级，flex-1 才有确定高度（Android WebView） */}
      <div className="absolute inset-0 z-50 flex min-h-0 flex-col pointer-events-none pt-[env(safe-area-inset-top,0px)]">
        <div className="pointer-events-auto shrink-0">
          <SelectedFilesList
            files={selectedFiles}
            onFilesChange={handleDropZoneFilesChange}
            onSelectMore={() => notifySelectFile(selectedFiles)}
            onSendFiles={handleSendFiles}
            canSend={selectedPeersEffective.length > 0}
            isSending={isSending}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pointer-events-auto">
          <RadarView
            peers={readyPeers}
            selectedPeers={selectedPeersEffective}
            onTogglePeer={handleTogglePeer}
            transfers={transfers}
            transferBatchTotalBytesByPeer={transferBatchTotalBytesByPeer}
            outgoingTransferHint={outgoingTransferHint}
            peerSelectionLocked={isSending}
          />
        </div>

        <div className="pointer-events-auto shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
          <BottomInstructions roomLink={roomLink} />
        </div>

        {/* 头像+昵称须在主栏之上（z-[60]）；整块 pointer-events-none，仅昵称可点，其余穿透到 Radar */}
        <div className="pointer-events-none absolute inset-0 z-[60]">
          <div className="absolute left-1/2 top-[62%] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
            <div className="pointer-events-none mb-2 flex h-14 w-14 items-center justify-center rounded-full">
              <svg className="h-[100px] w-[100px]" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="7311">
                <path d="M460.8 511.880533a51.080533 51.080533 0 1 0 102.161067 0 51.080533 51.080533 0 0 0-102.161067 0z" p-id="7312" fill="#2266FF"></path>
                <path
                  d="M565.4784 664.0128a27.4688 27.4688 0 0 1-11.170133-52.548267 100.164267 100.164267 0 1 0-83.601067-0.938666 27.4688 27.4688 0 0 1-23.517867 49.646933 155.136 155.136 0 1 1 129.5104 1.467733 27.306667 27.306667 0 0 1-11.221333 2.372267z"
                  p-id="7313"
                  fill="#2266FF"
                ></path>
                <path
                  d="M411.8272 768.324267a27.2896 27.2896 0 0 1-11.502933-2.474667A271.505067 271.505067 0 0 1 243.2 520.157867c0-149.162667 121.352533-270.5664 270.5664-270.5664 149.205333 0 270.557867 121.352533 270.557867 270.5664a269.397333 269.397333 0 0 1-148.5056 241.408 27.460267 27.460267 0 1 1-24.832-48.9984A214.715733 214.715733 0 0 0 729.326933 520.106667c0-118.869333-96.708267-215.594667-215.594666-215.594667S298.120533 401.237333 298.120533 520.106667A216.413867 216.413867 0 0 0 423.364267 715.946667a27.4688 27.4688 0 0 1-11.537067 52.394666v-0.0256z"
                  p-id="7314"
                  fill="#2266FF"
                ></path>
                <path
                  d="M347.434667 875.374933a27.306667 27.306667 0 0 1-12.680534-3.089066A383.3088 383.3088 0 0 1 128 531.4048C128 319.556267 300.356267 147.2 512.187733 147.2c211.84 0 384.2048 172.356267 384.2048 384.2048a384.221867 384.221867 0 0 1-201.0624 337.800533 27.4688 27.4688 0 0 1-26.2144-48.264533 329.301333 329.301333 0 0 0 172.356267-289.536c0-181.563733-147.694933-329.275733-329.284267-329.275733S182.954667 349.841067 182.954667 531.4048a328.533333 328.533333 0 0 0 177.237333 292.155733 27.4688 27.4688 0 0 1-12.731733 51.8144h-0.017067z"
                  p-id="7315"
                  fill="#2266FF"
                ></path>
              </svg>
            </div>
            <div className="pointer-events-auto">
              <span
                ref={nickElRef}
                role={nickEditing ? 'textbox' : 'button'}
                tabIndex={0}
                aria-label="我的昵称，点击编辑"
                title="点击编辑昵称"
                suppressContentEditableWarning
                contentEditable={nickEditing}
                className={
                  'inline-block min-w-[4ch] max-w-[min(72vw,240px)] text-center text-[14px] font-medium text-[#333333] bg-[#F1F1F1] px-5 py-1 rounded-full outline-none align-middle ' +
                  (nickEditing ? 'cursor-text ring-2 ring-[#2266FF]/40' : 'cursor-pointer truncate')
                }
                onClick={() => {
                  if (!nickEditing) startNickEdit()
                }}
                onInput={nickEditing ? clampNickEditableLength : undefined}
                onPaste={(e) => {
                  if (!nickEditing) return
                  e.preventDefault()
                  const plain = e.clipboardData.getData('text/plain').replace(/\r?\n/g, '')
                  document.execCommand('insertText', false, plain)
                  clampNickEditableLength()
                }}
                onBlur={() => {
                  if (!nickEditing) return
                  if (nickEscapeRef.current) {
                    nickEscapeRef.current = false
                    return
                  }
                  const raw = nickElRef.current?.innerText ?? ''
                  setMyDisplayName(raw.replace(/\r?\n/g, ''))
                  setNickEditing(false)
                }}
                onKeyDown={(e) => {
                  if (!nickEditing) {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      startNickEdit()
                    }
                    return
                  }
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    nickElRef.current?.blur()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    nickEscapeRef.current = true
                    const el = nickElRef.current
                    if (el) el.textContent = beforeEditNickRef.current
                    setNickEditing(false)
                  }
                }}
              >
                {nickEditing ? null : displayNick}
              </span>
            </div>
          </div>
        </div>

        {showReceivedModal && (
          <div className="pointer-events-auto">
            <ReceivedFilesModal
              key={pendingProcessFiles.map((f) => f.id).join(',')}
              files={pendingProcessFiles}
              stepwiseBrowserSave={albumStepwiseBrowserSave}
              onStepSave={albumStepwiseBrowserSave ? (f) => downloadFile(f) : undefined}
              onClose={() => setShowReceivedModal(false)}
              onDone={async () => {
                if (finishingReceivedRef.current || pendingProcessFiles.length === 0) return
                finishingReceivedRef.current = true
                const files = [...pendingProcessFiles]
                const action = receiveAction
                try {
                  if (action === 'album') {
                    if (jsBridge.isNativeEmbedHost()) {
                      await new Promise<void>((resolve) => {
                        void notifySaveToAlbumBatch(files, () => resolve())
                      })
                    } else if (!shouldStepwiseAlbumSaveInBrowser(jsBridge.isNativeEmbedHost(), files.length)) {
                      downloadReceivedFiles(files)
                    }
                  } else if (action === 'chat') {
                    await Promise.all(files.map((f) => notifyFileFlow(f)))
                  }
                } finally {
                  finishingReceivedRef.current = false
                  setShowReceivedModal(false)
                  const idsToRelease = files.map((f) => f.id)
                  setPendingProcessFiles([])
                  setReceiveAction(null)
                  releaseReceivedFiles(idsToRelease)
                }
              }}
            />
          </div>
        )}

        {incomingRequests.length > 0 && (
          <div className="pointer-events-auto">
            <TransferRequestModal
              name={incomingRequests[0].fromPeerName?.trim() || incomingRequests[0].fromPeerId.slice(0, 6)}
              fileCount={incomingRequests[0].filesInfo.length}
              onAcceptAlbum={() => {
                respondToTransferRequest(incomingRequests[0].requestId, true)
                setReceiveAction('album')
              }}
              onAcceptChat={() => {
                respondToTransferRequest(incomingRequests[0].requestId, true)
                setReceiveAction('chat')
              }}
              onReject={() => {
                respondToTransferRequest(incomingRequests[0].requestId, false)
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

export default App
