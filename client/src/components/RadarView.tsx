import { useMemo } from 'react'

import type { TransferProgress } from '../hooks/useWebRTC'

interface Peer {
  id: string
  name?: string
  deviceType?: string
  status: string
}

interface RadarViewProps {
  peers: Peer[]
  selectedPeers: string[]
  onTogglePeer: (id: string) => void
  transfers: TransferProgress[]
}

export const RadarView: React.FC<RadarViewProps> = ({ peers, selectedPeers, onTogglePeer, transfers }) => {
  const readyPeers = useMemo(() => peers.filter((p) => p.status === 'connected'), [peers])

  const getDeviceIcon = (_type?: string) => {
    // Placeholder for device icon
    return (
      <svg className="w-10 h-10 text-white" viewBox="0 0 24 24" fill="currentColor">
        <path d="M17 1H7c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-2-2-2zm0 18H7V5h10v14z" />
      </svg>
    )
  }

  const getProgress = (peerId: string) => {
    const peerTransfers = transfers.filter((t) => t.targetPeerId === peerId && t.status === 'transferring')
    if (peerTransfers.length === 0) return null
    const total = peerTransfers.reduce((acc, t) => acc + t.fileSize, 0)
    const transferred = peerTransfers.reduce((acc, t) => acc + t.sentBytes, 0)
    return total > 0 ? Math.round((transferred / total) * 100) : 0
  }

  return (
    <div className="w-full px-4 relative z-10 flex-1">
      <h3 className="text-[17px] font-medium text-[#333333] mb-4">已发现的设备</h3>

      {/* Devices Row */}
      <div className="flex overflow-x-auto gap-4 pb-4 scrollbar-hide relative z-10">
        {readyPeers.map((peer) => {
          const progress = getProgress(peer.id)
          const isSelected = selectedPeers.includes(peer.id)

          return (
            <div key={peer.id} className="flex flex-col items-center flex-shrink-0 cursor-pointer" onClick={() => onTogglePeer(peer.id)}>
              <div className="relative mb-2 flex items-center justify-center w-[72px] h-[72px]">
                {/* Circular Progress */}
                {progress !== null && (
                  <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none" viewBox="0 0 72 72">
                    <circle cx="36" cy="36" r="34" fill="none" stroke="#E5E5E5" strokeWidth="2" />
                    <circle
                      cx="36"
                      cy="36"
                      r="34"
                      fill="none"
                      stroke="#2266FE"
                      strokeWidth="2"
                      strokeDasharray={213.6}
                      strokeDashoffset={213.6 - (progress / 100) * 213.6}
                      strokeLinecap="round"
                      className="transition-all duration-300"
                    />
                  </svg>
                )}

                <div className={`w-16 h-16 rounded-full flex items-center justify-center relative transition-all`} style={{ background: 'linear-gradient(180deg, #A1B1C8 0%, #5B6A7F 100%)' }}>
                  {getDeviceIcon(peer.deviceType)}
                </div>

                {isSelected && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-white flex items-center justify-center shadow-sm">
                    <img src="/src/assets/images/check.png" alt="Selected" className="w-5 h-5" />
                  </div>
                )}
              </div>
              <span className="text-[14px] font-medium text-[#333333] truncate w-20 text-center">{peer.name || peer.id.slice(0, 4)}</span>
              <span className="text-[12px] text-[#999999] truncate w-20 text-center">{peer.deviceType || '未知设备'}</span>
              {progress !== null && <span className="text-[12px] text-[#0066FF] font-medium mt-1">{progress}%</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
