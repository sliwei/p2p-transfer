import { useEffect,useMemo, useState } from 'react'

import { FileDropZone } from './components/FileDropZone'
import { FileTransfer } from './components/FileTransfer'
import { PeerList } from './components/PeerList'
import { RoomJoin } from './components/RoomJoin'
import { TransferProgressList } from './components/TransferProgress'
import { useRoom } from './hooks/useRoom'
import { useWebRTC } from './hooks/useWebRTC'

function App() {
  const { roomId, inputRoomId, setInputRoomId, joinRoom, leaveRoom, generateRoomId, copyRoomLink } = useRoom()

  const {
    myPeerId,
    peers,
    transfers,
    receivedFiles,
    signalingInRoom,
    p2pFileTransferReady,
    sendFile,
    downloadFile
  } = useWebRTC(roomId)

  const readyPeers = useMemo(() => peers.filter((p) => p.status === 'connected'), [peers])

  const [selectedPeer, setSelectedPeer] = useState<string | null>(null)

  useEffect(() => {
    if (selectedPeer !== null && !readyPeers.some((p) => p.id === selectedPeer)) {
      setSelectedPeer(null)
    }
  }, [selectedPeer, readyPeers])

  const headerConnection = (() => {
    if (!signalingInRoom) {
      return {
        dotClass: 'bg-content-muted',
        textClass: 'text-content-secondary',
        text: 'Connecting to server...'
      }
    }
    if (p2pFileTransferReady) {
      return {
        dotClass: 'bg-accent shadow-dot',
        textClass: 'text-accent',
        text: 'P2P ready — you can transfer files'
      }
    }
    if (peers.length === 0) {
      return {
        dotClass: 'bg-accent-warn shadow-dot-warn animate-pulse-dot',
        textClass: 'text-accent-warn',
        text: 'In room — waiting for peer'
      }
    }
    const allFailed = peers.every((p) => p.status === 'disconnected')
    if (allFailed) {
      return {
        dotClass: 'bg-accent-warn shadow-dot-warn animate-pulse-dot',
        textClass: 'text-accent-warn',
        text: 'Direct link failed — use same Wi‑Fi or configure TURN'
      }
    }
    return {
      dotClass: 'bg-accent-warn shadow-dot-warn animate-pulse-dot',
      textClass: 'text-accent-warn',
      text: 'Trying direct P2P (not shown until it works)...'
    }
  })()

  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [isSending, setIsSending] = useState(false)

  const handleFilesSelected = (files: File[]) => {
    setSelectedFiles(files)
  }

  const handleSendFiles = async () => {
    if (selectedFiles.length === 0) return

    setIsSending(true)
    try {
      for (const file of selectedFiles) {
        await sendFile(file, selectedPeer || undefined)
      }
      setSelectedFiles([])
    } catch (error) {
      console.error('Error sending files:', error)
      alert('Failed to send files. Please check peer connections.')
    } finally {
      setIsSending(false)
    }
  }

  const handleCopyRoomId = () => {
    if (!roomId) return
    void navigator.clipboard.writeText(roomId).catch(() => {
      alert('无法复制：请确认页面为 HTTPS 或 localhost，或手动选择房间号复制。')
    })
  }

  if (!roomId) {
    return (
      <RoomJoin
        roomId={inputRoomId}
        onRoomIdChange={setInputRoomId}
        onJoin={joinRoom}
        onGenerate={generateRoomId}
      />
    )
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-[100] flex flex-col gap-3 border-b border-line bg-surface-raised px-4 py-4 md:flex-row md:items-center md:justify-between md:gap-0 md:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-accent bg-accent-soft text-accent">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v6m0 6v6m4.22-10.22l4.24-4.24M6.34 6.34L2.1 2.1m17.8 17.8l-4.24-4.24M6.34 17.66l-4.24 4.24M23 12h-6m-6 0H1m20.24 4.24l-4.24-4.24M6.34 6.34l-4.24-4.24" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-content">P2P Transfer</h1>
        </div>

        <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center md:gap-5">
          <div className="flex items-center gap-2 rounded-[10px] border border-line bg-surface-overlay px-4 py-2">
            <span className="text-sm text-content-secondary">Room:</span>
            <span
              className="cursor-pointer select-all font-mono text-[0.9375rem] font-semibold text-accent hover:drop-shadow-[0_0_10px_rgba(0,255,136,0.6)]"
              onClick={handleCopyRoomId}
              title="Click to copy"
            >
              {roomId}
            </span>
            <button
              type="button"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-content-secondary transition-colors hover:bg-line hover:text-content"
              onClick={copyRoomLink}
              title="Copy room link"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
          </div>
          <div className={`flex items-center gap-2 text-sm ${headerConnection.textClass}`}>
            <span className={`h-2 w-2 shrink-0 rounded-full ${headerConnection.dotClass}`} />
            <span>{headerConnection.text}</span>
          </div>
        </div>

        <div className="flex items-center md:justify-end">
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-[10px] border border-line bg-surface-overlay px-3.5 py-1.5 text-sm font-medium text-content transition-colors hover:border-line-hover hover:bg-line-hover disabled:cursor-not-allowed disabled:opacity-50"
            onClick={leaveRoom}
          >
            Leave Room
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-6 lg:grid-cols-[minmax(260px,320px)_1fr]">
          <aside className="h-fit lg:sticky lg:top-6">
            <PeerList
              peers={readyPeers}
              myPeerId={myPeerId}
              p2pReady={p2pFileTransferReady}
              selectedPeer={selectedPeer}
              onSelectPeer={setSelectedPeer}
            />
          </aside>

          <div className="min-w-0">
            <div className="rounded-2xl border border-line bg-surface-raised p-4 shadow-card md:p-6">
              <h2 className="mb-5 text-lg font-semibold text-content">
                {selectedPeer === null ? 'Send to All Peers' : `Send to ${selectedPeer.slice(0, 8)}...`}
              </h2>

              <FileDropZone onFilesSelected={handleFilesSelected} />

              {selectedFiles.length > 0 && (
                <div className="mb-6 flex flex-col items-center gap-3">
                  <button
                    type="button"
                    className="inline-flex items-center justify-center gap-2 rounded-[10px] border-0 bg-accent px-7 py-3.5 text-base font-medium text-surface transition-all hover:bg-[#00e67a] hover:shadow-glow-green disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={handleSendFiles}
                    disabled={isSending || readyPeers.length === 0}
                  >
                    {isSending ? (
                      <>
                        <span className="h-[18px] w-[18px] shrink-0 animate-spin rounded-full border-2 border-transparent border-t-current" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="22" y1="2" x2="11" y2="13" />
                          <polygon points="22 2 15 22 11 13 2 9" />
                        </svg>
                        Send {selectedFiles.length} file(s)
                      </>
                    )}
                  </button>
                  {readyPeers.length === 0 && (
                    <p className="text-sm text-accent-warn">No direct link yet — peer appears here only when transfer is possible</p>
                  )}
                </div>
              )}

              <TransferProgressList transfers={transfers} />
              <FileTransfer receivedFiles={receivedFiles} onDownload={downloadFile} />
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

export default App
