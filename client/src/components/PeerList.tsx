import { Peer } from '../hooks/useWebRTC'

interface PeerListProps {
  peers: Peer[]
  myPeerId: string
  /** 至少已与一对端建立可传文件的 DataChannel */
  p2pReady: boolean
  selectedPeer: string | null
  onSelectPeer: (peerId: string | null) => void
}

const statusDotClass = (status: Peer['status'], pulsing: boolean) => {
  const base = 'h-2 w-2 shrink-0 rounded-full'
  const pulse = pulsing ? ' animate-pulse-dot' : ''
  switch (status) {
    case 'connected':
      return `${base} bg-accent${pulse}`
    case 'connecting':
      return `${base} bg-accent-warn${pulse}`
    case 'disconnected':
      return `${base} bg-accent-danger${pulse}`
    default:
      return `${base} bg-content-muted${pulse}`
  }
}

const statusText = (status: Peer['status']) => {
  switch (status) {
    case 'connected':
      return 'Ready to transfer'
    case 'connecting':
      return 'Negotiating...'
    case 'disconnected':
      return 'Unavailable'
    default:
      return 'Unknown'
  }
}

const formatPeerId = (id: string) => {
  if (!id) return '—'
  return id.length <= 8 ? id : `${id.slice(0, 8)}…`
}

export const PeerList: React.FC<PeerListProps> = ({ peers, myPeerId, p2pReady, selectedPeer, onSelectPeer }) => {
  return (
    <div className="rounded-2xl border border-line bg-surface-raised p-5">
      <h3 className="mb-4 text-base font-semibold text-content">Peers (direct link only)</h3>

      <div className="mb-2 flex cursor-default items-center justify-between rounded-[10px] border border-transparent bg-surface-overlay p-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-accent bg-accent-soft font-mono text-xs font-semibold text-accent">ME</div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[0.9375rem] font-medium text-content">You</span>
            <span className="font-mono text-xs text-content-muted">{formatPeerId(myPeerId)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 shrink-0 rounded-full ${p2pReady ? 'bg-accent' : 'bg-accent-warn'}`} />
          <span className="text-xs text-content-secondary">{p2pReady ? 'Direct link ready' : 'In room only'}</span>
        </div>
      </div>

      {peers.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-sm text-content-muted">
          <span className="text-3xl opacity-50">👤</span>
          <span>No peer shown until P2P works (same Wi‑Fi often required)</span>
        </div>
      ) : (
        peers.map((peer) => (
          <div
            key={peer.id}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelectPeer(selectedPeer === peer.id ? null : peer.id)
              }
            }}
            className={`mb-2 flex cursor-pointer items-center justify-between rounded-[10px] border bg-surface-overlay p-3 transition-colors last:mb-0 ${
              selectedPeer === peer.id ? 'border-accent bg-accent-soft' : 'border-transparent hover:border-line-hover'
            }`}
            onClick={() => onSelectPeer(selectedPeer === peer.id ? null : peer.id)}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-surface-raised font-mono text-xs font-semibold text-content-secondary">P</div>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[0.9375rem] font-medium text-content">
                  Peer{' '}
                  <span
                    className={`text-[11px] font-medium ${peer.iceTransportPath === 'relay' ? 'text-accent-warn' : peer.iceTransportPath === 'direct' ? 'text-accent' : 'text-content-secondary'}`}
                    title={peer.iceTransportDetail ?? undefined}
                  >
                    {peer.iceTransportPath === 'relay' ? 'TURN 中继' : peer.iceTransportPath === 'direct' ? '直联' : peer.iceTransportPath === 'unknown' ? '路径未知' : '检测 ICE 路径…'}
                  </span>
                </span>
                <span className="font-mono text-xs text-content-muted">{formatPeerId(peer.id)}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={statusDotClass(peer.status, peer.status === 'connecting')} />
              <span className="text-xs text-content-secondary">{statusText(peer.status)}</span>
            </div>
          </div>
        ))
      )}

      {peers.length > 0 ? (
        <div className="mt-3 rounded-md bg-surface-raised px-3 py-2.5 text-xs leading-snug text-content-secondary">
          Click a peer to send files to specific recipient, or select &quot;All Peers&quot;
        </div>
      ) : null}

      <div
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSelectPeer(null)
          }
        }}
        className={`mt-4 flex cursor-pointer items-center rounded-[10px] border border-dashed bg-surface-overlay p-3 transition-colors hover:border-accent-blue ${
          selectedPeer === null ? 'border-solid border-accent-blue bg-accent-blue-soft' : 'border-transparent hover:border-accent-blue'
        }`}
        onClick={() => onSelectPeer(null)}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-accent-blue bg-accent-blue-soft font-mono text-xs font-semibold text-accent-blue">ALL</div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[0.9375rem] font-medium text-content">All Peers</span>
            <span className="font-mono text-xs text-content-muted">Broadcast to everyone</span>
          </div>
        </div>
      </div>
    </div>
  )
}
