import { useState } from 'react'

interface RoomJoinProps {
  roomId: string
  onRoomIdChange: (value: string) => void
  onJoin: (roomId: string) => void
  onGenerate: () => string
}

export const RoomJoin: React.FC<RoomJoinProps> = ({ roomId, onRoomIdChange, onJoin, onGenerate }) => {
  const [copied, setCopied] = useState(false)

  const handleGenerate = () => {
    const newId = onGenerate()
    onRoomIdChange(newId)
  }

  const handleJoin = () => {
    if (roomId.trim()) {
      onJoin(roomId.trim())
    }
  }

  const handleCopyLink = () => {
    if (!roomId) return
    const url = new URL(window.location.href)
    url.searchParams.set('roomid', roomId)
    navigator.clipboard.writeText(url.toString())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-surface-raised to-surface p-6">
      <div className="w-full max-w-[480px] rounded-2xl border border-line bg-surface-raised p-8 shadow-card md:p-12">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[10px] border-2 border-accent bg-accent-soft text-accent shadow-glow-green">
            <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v6m0 6v6m4.22-10.22l4.24-4.24M6.34 6.34L2.1 2.1m17.8 17.8l-4.24-4.24M6.34 17.66l-4.24 4.24M23 12h-6m-6 0H1m20.24 4.24l-4.24-4.24M6.34 6.34l-4.24-4.24" />
            </svg>
          </div>
          <h1 className="mb-2 text-3xl font-bold text-content">P2P File Transfer</h1>
          <p className="text-base text-content-secondary">Direct peer-to-peer file sharing</p>
        </div>

        <div className="mb-8">
          <div className="mb-5">
            <label htmlFor="room-id" className="mb-2 block text-sm font-medium text-content-secondary">
              Room ID
            </label>
            <div className="relative flex items-center">
              <input
                type="text"
                id="room-id"
                value={roomId}
                onChange={(e) => onRoomIdChange(e.target.value)}
                placeholder="Enter room ID or generate one"
                className="w-full rounded-[10px] border border-line bg-surface-overlay py-3.5 pl-4 pr-12 font-mono text-base text-content outline-none transition-all placeholder:font-sans placeholder:text-content-muted focus:border-accent focus:shadow-[0_0_0_3px_rgba(0,255,136,0.1)]"
              />
              {roomId ? (
                <button
                  type="button"
                  className="absolute right-3 flex h-8 w-8 items-center justify-center rounded-md border-0 bg-transparent text-content-secondary transition-colors hover:bg-line hover:text-content"
                  onClick={handleCopyLink}
                  title="Copy room link"
                >
                  {copied ? (
                    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="#00ff88" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  )}
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-[10px] border border-line bg-surface-overlay px-5 py-2.5 text-[0.9375rem] font-medium text-content transition-all hover:border-line-hover hover:bg-line-hover disabled:cursor-not-allowed disabled:opacity-50"
              onClick={handleGenerate}
            >
              <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              Generate ID
            </button>
            <button
              type="button"
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-[10px] border-0 bg-accent px-5 py-2.5 text-[0.9375rem] font-medium text-surface transition-all hover:bg-[#00e67a] hover:shadow-glow-green disabled:cursor-not-allowed disabled:opacity-50"
              onClick={handleJoin}
              disabled={!roomId.trim()}
            >
              <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M13.8 12H3" />
              </svg>
              Join Room
            </button>
          </div>
        </div>

        <div className="border-t border-line pt-6">
          <div className="flex items-center gap-3 py-2.5 text-sm text-content-secondary">
            <span className="text-lg">🔒</span>
            <span>End-to-end encrypted via WebRTC</span>
          </div>
          <div className="flex items-center gap-3 py-2.5 text-sm text-content-secondary">
            <span className="text-lg">⚡</span>
            <span>Direct P2P connection, no server storage</span>
          </div>
          <div className="flex items-center gap-3 py-2.5 text-sm text-content-secondary">
            <span className="text-lg">🌐</span>
            <span>Works on local network</span>
          </div>
        </div>
      </div>
    </div>
  )
}
