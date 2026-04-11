import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { BottomInstructions } from './components/BottomInstructions'
import { RadarCanvas } from './components/RadarCanvas'
import { RadarView } from './components/RadarView'
import { ReceivedFilesModal } from './components/ReceivedFilesModal'
import { RoomJoin } from './components/RoomJoin'
import { SelectedFilesList } from './components/SelectedFilesList'
import { TransferRequestModal } from './components/TransferRequestModal'
import { useAppDropEmbed } from './hooks/useAppDropEmbed'
import { useRoom } from './hooks/useRoom'
import { type ReceivedFile, useWebRTC } from './hooks/useWebRTC'
import jsBridge from './utils/js-bridge'

function App() {
  const { roomId, inputRoomId, setInputRoomId, joinRoom, generateRoomId } = useRoom()
  const roomIdRef = useRef(roomId)
  roomIdRef.current = roomId

  const { peers, transfers, receivedFiles, sendFilesBatch, incomingRequests, respondToTransferRequest, downloadFile, myPeerId, myPeerName, myDeviceType } = useWebRTC(roomId)

  const readyPeers = useMemo(() => peers.filter((p) => p.status === 'connected'), [peers])

  const [selectedPeers, setSelectedPeers] = useState<string[]>([])

  const handleTogglePeer = useCallback((peerId: string) => {
    setSelectedPeers((prev) => (prev.includes(peerId) ? prev.filter((id) => id !== peerId) : [...prev, peerId]))
  }, [])

  useEffect(() => {
    // Remove selected peers that are no longer ready
    setSelectedPeers((prev) => {
      const filtered = prev.filter((id) => readyPeers.some((p) => p.id === id))
      // Only set state if the array actually changed to avoid infinite loops
      if (filtered.length !== prev.length) {
        return filtered
      }
      return prev
    })
  }, [readyPeers])

  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [isSending, setIsSending] = useState(false)

  const [showReceivedModal, setShowReceivedModal] = useState(false)
  const prevReceivingCountRef = useRef(0)
  const lastReceivedFilesRef = useRef<ReceivedFile[]>([])

  const [receiveAction, setReceiveAction] = useState<'album' | 'chat' | null>(null)
  const [pendingProcessFiles, setPendingProcessFiles] = useState<ReceivedFile[]>([])

  const onReceiveEmbedFiles = useCallback((files: File[]) => {
    if (!roomIdRef.current) {
      console.warn('[AppDrop] 请先加入房间后再接收来自 APP 的文件')
      return
    }
    setSelectedFiles((prev) => [...prev, ...files])
  }, [])

  const { notifySelectFile, notifyFileFlow, notifySaveToAlbum } = useAppDropEmbed({
    onReceiveFiles: onReceiveEmbedFiles
  })

  const handleDropZoneFilesChange = useCallback(
    (files: File[]) => {
      setSelectedFiles(files)
      if (files.length > 0) {
        notifySelectFile()
      }
    },
    [notifySelectFile]
  )

  const onReceivedFileInFlow = useCallback(
    (f: ReceivedFile) => {
      notifyFileFlow(f)
    },
    [notifyFileFlow]
  )

  useEffect(() => {
    const receivingTransfers = transfers.filter((t) => t.direction === 'receiving')
    const isReceiving = receivingTransfers.some((t) => t.status === 'transferring')
    const completedCount = receivingTransfers.filter((t) => t.status === 'completed').length

    if (!isReceiving && completedCount > 0 && completedCount > prevReceivingCountRef.current) {
      // Find the newly received files to show in the modal
      const newFiles = receivedFiles.slice(lastReceivedFilesRef.current.length)
      if (newFiles.length > 0) {
        setPendingProcessFiles(newFiles)
        setShowReceivedModal(true)
      }
      prevReceivingCountRef.current = completedCount
      lastReceivedFilesRef.current = receivedFiles
    }
  }, [transfers, receivedFiles, onReceivedFileInFlow])
  const handleSendFiles = async () => {
    if (selectedFiles.length === 0 || selectedPeers.length === 0) return

    setIsSending(true)
    try {
      // Send files to all selected peers
      for (const peerId of selectedPeers) {
        await sendFilesBatch(selectedFiles, peerId)
        for (const file of selectedFiles) {
          notifyFileFlow(file)
        }
      }
      // Keep files selected or clear them? Usually clear after send.
      // setSelectedFiles([])
      setSelectedPeers([])
    } catch (error) {
      // console.error('Error sending files:', error)
      // alert('Failed to send files. Please check peer connections or user rejected.')
    } finally {
      setIsSending(false)
    }
  }

  if (!roomId) {
    return <RoomJoin roomId={inputRoomId} onRoomIdChange={setInputRoomId} onJoin={joinRoom} onGenerate={generateRoomId} />
  }

  const roomLink = window.location.href

  return (
    <div className="flex min-h-screen flex-col bg-white font-sans relative overflow-hidden">
      <RadarCanvas animate={readyPeers.length === 0} />

      <div className="fixed left-1/2 top-[62%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-none z-0">
        <div className="w-14 h-14 rounded-full flex items-center justify-center mb-2">
          <svg className="w-[100px] h-[100px]" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="7311">
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
        <span className="text-[14px] font-medium text-[#333333] bg-[#F1F1F1] px-5 py-2 rounded-full">
          {myPeerName || myPeerId.slice(0, 4)}
        </span>
      </div>

      <div className="relative z-10 flex flex-col min-h-screen pointer-events-none">
        <div className="pointer-events-auto">
          <SelectedFilesList
            files={selectedFiles}
            onFilesChange={handleDropZoneFilesChange}
            onSelectMore={notifySelectFile}
            onSendFiles={handleSendFiles}
            canSend={selectedPeers.length > 0}
            isSending={isSending}
          />
        </div>

        <div className="flex-1 pointer-events-auto">
          <RadarView peers={readyPeers} selectedPeers={selectedPeers} onTogglePeer={handleTogglePeer} transfers={transfers} />
        </div>

        <div className="pointer-events-auto">
          <BottomInstructions roomLink={roomLink} />
        </div>

        {showReceivedModal && (
          <div className="pointer-events-auto">
            <ReceivedFilesModal
              files={pendingProcessFiles}
              onClose={() => setShowReceivedModal(false)}
              onDone={() => {
                setShowReceivedModal(false)
                if (receiveAction === 'album') {
                  if (jsBridge.isNativeEmbedHost()) {
                    pendingProcessFiles.forEach((f) => notifySaveToAlbum(f))
                  } else {
                    pendingProcessFiles.forEach((f) => downloadFile(f))
                  }
                } else if (receiveAction === 'chat') {
                  if (jsBridge.isNativeEmbedHost()) {
                    pendingProcessFiles.forEach((f) => onReceivedFileInFlow(f))
                  }
                }
                setPendingProcessFiles([])
                setReceiveAction(null)
              }}
            />
          </div>
        )}

        {incomingRequests.length > 0 && (
          <div className="pointer-events-auto">
            <TransferRequestModal
              peerName={incomingRequests[0].fromPeerId.slice(0, 6)}
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
