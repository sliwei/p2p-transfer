import { useMemo } from 'react'

import checkIcon from '../assets/images/check.png'
import type { OutgoingTransferHint, TransferProgress } from '../hooks/useWebRTC'

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
  /** 发送端：各对端上的等待 / 已拒绝 / 已完成（短时） */
  outgoingTransferHint?: Record<string, OutgoingTransferHint>
  /** 发送流程进行中时禁止改选，避免与等待确认状态不同步 */
  peerSelectionLocked?: boolean
}

/** 根据信令下发的 deviceName 字符串（UA 解析）推断图标类别，与 mb-pairdrop 的 mobile/tablet/desktop 思路一致 */
function inferDeviceIconKind(deviceSubtitle?: string): 'ios' | 'android' | 'ipad' | 'desktop' {
  const t = (deviceSubtitle || '').toLowerCase()
  if (t.includes('ipad') || t.includes('ipados')) return 'ipad'
  if (t.includes('android') || t.includes('harmonyos')) return 'android'
  if (t.includes('iphone') || t.includes('ipod')) return 'ios'
  if (t.includes('ios')) return 'ios'
  if (t.includes('windows') || t.includes('mac ') || t.includes('macos') || t.includes('linux') || t.includes('chrome os') || t.includes('ubuntu') || t.includes('fedora') || t.includes('debian'))
    return 'desktop'
  return 'desktop'
}

function DeviceKindIcon({ kind }: { kind: ReturnType<typeof inferDeviceIconKind> }) {
  const cls = 'w-10 h-10 text-white shrink-0'
  switch (kind) {
    case 'ipad':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M4 5h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7a2 2 0 012-2zm8 14.25a.75.75 0 100-1.5.75.75 0 000 1.5z" />
        </svg>
      )
    case 'ios':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M9 1h6a3 3 0 013 3v16a3 3 0 01-3 3H9a3 3 0 01-3-3V4a3 3 0 013-3zm3 20.5a1.25 1.25 0 100-2.5 1.25 1.25 0 000 2.5z" />
        </svg>
      )
    case 'android':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85a.62.62 0 00-.85.26l-1.83 3.17A9.9 9.9 0 0012 8c-1.18 0-2.38.27-3.5.73L6.67 5.56a.62.62 0 00-.85-.26.63.63 0 00-.26.85l1.84 3.18C5.31 9.83 4.07 11.42 4 13.25V18c0 .55.45 1 1 1h1v1.75c0 .69.56 1.25 1.25 1.25S8.5 20.44 8.5 19.75V19h7v.75c0 .69.56 1.25 1.25 1.25s1.25-.56 1.25-1.25V19h1c.55 0 1-.45 1-1v-4.75c0-1.83-1.31-3.42-3.4-3.77zM7 16.5c-.83 0-1.5-.67-1.5-1.5S6.17 13.5 7 13.5 8.5 14.17 8.5 15 7.83 16.5 7 16.5zm10 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM10 5h4v1h-4V5z" />
        </svg>
      )
    default:
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M2 4a2 2 0 012-2h16a2 2 0 012 2v11a2 2 0 01-2 2H4a2 2 0 01-2-2V4zm2 0v11h16V4H4zm2 16h12a1 1 0 011 1v1H5v-1a1 1 0 011-1z" />
        </svg>
      )
  }
}

export const RadarView: React.FC<RadarViewProps> = ({
  peers,
  selectedPeers,
  onTogglePeer,
  transfers,
  outgoingTransferHint,
  peerSelectionLocked = false,
}) => {
  const readyPeers = useMemo(() => peers.filter((p) => p.status === 'connected'), [peers])

  const getProgress = (peerId: string) => {
    const peerTransfers = transfers.filter((t) => t.targetPeerId === peerId && t.status === 'transferring')
    if (peerTransfers.length === 0) return null
    const total = peerTransfers.reduce((acc, t) => acc + t.fileSize, 0)
    const transferred = peerTransfers.reduce((acc, t) => acc + t.sentBytes, 0)
    return total > 0 ? Math.round((transferred / total) * 100) : 0
  }

  /** mb-pairdrop 卡片：`.name`=displayName（上一行），`.device-name`=deviceName（本行，UA 解析） */
  const peerDeviceSubtitle = (peer: Peer) => {
    const s = peer.deviceType?.trim()
    return s || '未知设备'
  }

  return (
    <div className="w-full px-4 relative z-10 flex-1">
      <h3 className="text-[17px] font-medium text-[#333333] mb-4">已发现的设备</h3>

      {/* Devices Row */}
      <div className="flex overflow-x-auto gap-4 pb-4 scrollbar-hide relative z-10">
        {readyPeers.map((peer) => {
          const hint = outgoingTransferHint?.[peer.id]
          const rawProgress = getProgress(peer.id)
          const isSelected = selectedPeers.includes(peer.id)

          return (
            <div
              key={peer.id}
              className={`flex flex-col items-center flex-shrink-0 ${peerSelectionLocked ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'}`}
              onClick={() => {
                if (!peerSelectionLocked) onTogglePeer(peer.id)
              }}
            >
              <div className="relative mb-2 flex items-center justify-center w-[72px] h-[72px]">
                {/* Circular Progress */}
                {rawProgress !== null && hint !== 'waiting' && hint !== 'rejected' && (
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
                      strokeDashoffset={213.6 - (rawProgress / 100) * 213.6}
                      strokeLinecap="round"
                      className="transition-all duration-300"
                    />
                  </svg>
                )}

                <div className={`w-16 h-16 rounded-full flex items-center justify-center relative transition-all`} style={{ background: 'linear-gradient(180deg, #A1B1C8 0%, #5B6A7F 100%)' }}>
                  <DeviceKindIcon kind={inferDeviceIconKind(peer.deviceType)} />
                </div>

                {isSelected && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-white flex items-center justify-center shadow-sm">
                    <img src={checkIcon} alt="Selected" className="w-5 h-5" />
                  </div>
                )}
              </div>
              <span className="text-[14px] font-medium text-[#333333] truncate w-20 text-center">{peer.name || peer.id.slice(0, 4)}</span>
              <span className="text-[10px] text-[#999999] truncate w-20 text-center">{peerDeviceSubtitle(peer)}</span>
              <div className="flex flex-col items-center mt-1 gap-0.5 min-h-[18px]">
                {hint === 'waiting' && (
                  <span className="text-[12px] font-medium" style={{ color: 'rgba(0,0,0,0.4)' }}>
                    等待中...
                  </span>
                )}
                {hint === 'rejected' && <span className="text-[12px] font-medium text-[#FF1818]">已拒绝</span>}
                {rawProgress !== null && hint !== 'waiting' && hint !== 'rejected' && (
                  <span className="text-[12px] text-[#0066FF] font-medium">{rawProgress}%</span>
                )}
                {hint === 'completed' && rawProgress === null && (
                  <span className="text-[12px] font-medium text-[#4DC43B]">已完成</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
