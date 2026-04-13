import { useMemo, useState } from 'react'

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
        <svg className={cls} viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="8598" width="200" height="200">
          <path
            d="M810.666667 810.666667H170.666667V128h640m-320 853.333333a64 64 0 0 1-64-64 64 64 0 0 1 64-64 64 64 0 0 1 64 64 64 64 0 0 1-64 64m298.666666-981.333333h-597.333333A106.666667 106.666667 0 0 0 85.333333 106.666667v810.666666A106.666667 106.666667 0 0 0 192 1024h597.333333a106.666667 106.666667 0 0 0 106.666667-106.666667v-810.666666A106.666667 106.666667 0 0 0 789.333333 0z"
            fill="#ffffff"
            p-id="8599"
          ></path>
        </svg>
      )
    case 'ios':
      return (
        <svg className={cls} viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="54320" width="200" height="200">
          <path
            d="M808.449745 549.748364c-1.349818-128.162909 112.174545-189.579636 117.224728-192.674909-63.813818-86.993455-163.188364-98.862545-198.586182-100.282182-84.549818-7.936-165.003636 46.405818-207.941818 46.405818-42.821818 0-109.056-45.218909-179.2-43.985455-92.206545 1.233455-177.245091 49.896727-224.651637 126.836364C19.504291 540.904727 90.765382 770.280727 184.112291 895.860364c45.614545 61.509818 100.026182 130.513455 171.426909 128.069818 68.770909-2.583273 94.789818-41.495273 177.92-41.495273 83.153455 0 106.496 41.472 179.293091 40.215273 74.007273-1.303273 120.901818-62.650182 166.213818-124.322909 52.363636-71.284364 73.937455-140.334545 75.217455-143.895273-1.629091-0.698182-144.337455-51.595636-145.733819-204.683636zM700.3712 177.058909C741.517382 130.141091 769.281745 64.977455 761.718109 0c-59.298909 2.280727-131.165091 37.143273-173.661091 83.991273-38.213818 41.541818-71.586909 107.892364-62.626909 171.566545 66.187636 4.887273 133.701818-31.604364 174.941091-78.452363v-0.046546z"
            fill="#ffffff"
            p-id="54321"
          ></path>
        </svg>
      )
    case 'android':
      return (
        <svg className={cls} viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="7509" width="200" height="200">
          <path
            d="M615.878882 177.494507l42.303478-61.521169c1.811252-2.619664 1.146103-6.252401-1.473561-8.063653l-1.054005-0.726547c-2.619664-1.821485-6.231935-1.146103-8.043187 1.473561l-43.521213 63.291488c-28.427446-12.361539-60.139705-19.268856-93.601818-19.268856-31.753191 0-61.950957 6.221702-89.232301 17.426905l-41.587164-60.477396c-1.801019-2.619664-5.423523-3.284813-8.043187-1.473561l-1.054005 0.726547c-2.619664 1.811252-3.284813 5.443989-1.483794 8.073886l40.215934 58.461483c-63.23009 30.300097-108.664885 88.075964-117.915573 156.299789l438.20018 0C720.552873 265.017886 676.919097 208.296023 615.878882 177.494507zM418.217057 265.621637c-12.054547 0-21.837354-9.813506-21.837354-21.908986 0-12.095479 9.782807-21.898753 21.837354-21.898753 12.06478 0 21.837354 9.803273 21.837354 21.898753C440.054411 255.80813 430.281837 265.621637 418.217057 265.621637zM606.710059 265.621637c-12.054547 0-21.837354-9.813506-21.837354-21.908986 0-12.095479 9.782807-21.898753 21.837354-21.898753 12.06478 0 21.837354 9.803273 21.837354 21.898753C628.547413 255.80813 618.774839 265.621637 606.710059 265.621637z"
            p-id="7510"
            fill="#ffffff"
          ></path>
          <path
            d="M260.904195 419.506423l0 179.446975c0 30.760584-19.596314 55.933917-43.562145 55.933917l-9.680477 0c-23.955598 0-43.562145-25.173332-43.562145-55.933917l0-179.446975c0-30.760584 19.606547-55.923684 43.562145-55.923684l9.680477 0C241.307881 363.582739 260.904195 388.745838 260.904195 419.506423z"
            p-id="7511"
            fill="#ffffff"
          ></path>
          <path
            d="M859.896478 420.570661l0 179.446975c0 30.770817-19.596314 55.933917-43.562145 55.933917l-9.680477 0c-23.955598 0-43.562145-25.163099-43.562145-55.933917l0-179.446975c0-30.760584 19.606547-55.923684 43.562145-55.923684l9.680477 0C840.300164 364.646977 859.896478 389.810077 859.896478 420.570661z"
            p-id="7512"
            fill="#ffffff"
          ></path>
          <path
            d="M732.934878 360.830045l0 354.074178c0 24.579815-20.046568 44.687782-44.554752 44.687782l-36.746926 0 0 102.320387c0 30.760584-19.606547 55.923684-43.562145 55.923684l-9.680477 0c-23.955598 0-43.562145-25.163099-43.562145-55.923684l0-102.320387-81.864496 0 0 101.143585c0 30.760584-19.596314 55.933917-43.562145 55.933917l-9.680477 0c-23.955598 0-43.562145-25.173332-43.562145-55.933917l0-101.143585-40.062438 0c-24.508183 0-44.554752-20.107967-44.554752-44.687782l0-354.074178L732.934878 360.830045z"
            p-id="7513"
            fill="#ffffff"
          ></path>
        </svg>
      )
    default:
      return (
        <svg className={cls} viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="58971" width="200" height="200">
          <path
            d="M947.2 85.333333h-853.333333C57.6 85.333333 21.333333 113.066667 21.333333 149.333333v533.333334h981.333334V149.333333c0-36.266667-21.333333-64-55.466667-64zM21.333333 746.666667c0 36.266667 36.266667 64 72.533334 64H490.666667v85.333333h-204.8c-12.8 0-21.333333 8.533333-21.333334 21.333333s8.533333 21.333333 21.333334 21.333334h469.333333c12.8 0 21.333333-8.533333 21.333333-21.333334s-8.533333-21.333333-21.333333-21.333333H533.333333v-85.333333h413.866667c36.266667 0 55.466667-27.733333 55.466667-64v-21.333334H21.333333v21.333334z"
            fill="#ffffff"
            p-id="58972"
          ></path>
        </svg>
      )
  }
}

export const RadarView: React.FC<RadarViewProps> = ({ peers, selectedPeers, onTogglePeer, transfers, outgoingTransferHint, peerSelectionLocked = false }) => {
  const readyPeers = useMemo(() => peers.filter((p) => p.status === 'connected'), [peers])
  /** 点击同一设备时递增 n，强制 remount 以重复播放果冻动画 */
  const [jellyPulse, setJellyPulse] = useState<{ id: string; n: number } | null>(null)

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
      <h3 className="text-[17px] font-medium text-[#333333] mb-4">已发现{readyPeers.length}个设备</h3>

      {/* Devices Row */}
      <div className="flex overflow-x-auto gap-4 scrollbar-hide relative z-10">
        {readyPeers.map((peer) => {
          const hint = outgoingTransferHint?.[peer.id]
          const rawProgress = getProgress(peer.id)
          const isSelected = selectedPeers.includes(peer.id)

          return (
            <div
              key={peer.id}
              className={`flex flex-col items-center flex-shrink-0 ${peerSelectionLocked ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'}`}
              onClick={() => {
                if (peerSelectionLocked) return
                setJellyPulse((p) => (p?.id === peer.id ? { id: peer.id, n: p.n + 1 } : { id: peer.id, n: 0 }))
                onTogglePeer(peer.id)
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

                <div
                  key={`peer-av-${peer.id}-${jellyPulse?.id === peer.id ? jellyPulse.n : 0}`}
                  className={`w-16 h-16 rounded-full flex items-center justify-center relative ${jellyPulse?.id === peer.id ? 'peer-jelly-pop' : ''}`}
                  style={{ background: 'linear-gradient(180deg, #A1B1C8 0%, #5B6A7F 100%)' }}
                >
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
                {rawProgress !== null && hint !== 'waiting' && hint !== 'rejected' && <span className="text-[12px] text-[#0066FF] font-medium">{rawProgress}%</span>}
                {hint === 'completed' && rawProgress === null && <span className="text-[12px] font-medium text-[#4DC43B]">已完成</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
