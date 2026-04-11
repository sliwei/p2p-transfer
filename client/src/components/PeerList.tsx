
import { Peer } from '../hooks/useWebRTC';

interface PeerListProps {
  peers: Peer[];
  myPeerId: string;
  /** 至少已与一对端建立可传文件的 DataChannel */
  p2pReady: boolean;
  selectedPeer: string | null;
  onSelectPeer: (peerId: string | null) => void;
}

export const PeerList: React.FC<PeerListProps> = ({ 
  peers, 
  myPeerId,
  p2pReady,
  selectedPeer, 
  onSelectPeer 
}) => {
  const getStatusColor = (status: Peer['status']) => {
    switch (status) {
      case 'connected': return '#00ff88';
      case 'connecting': return '#ffaa00';
      case 'disconnected': return '#ff4444';
      default: return '#666';
    }
  };

  const getStatusText = (status: Peer['status']) => {
    switch (status) {
      case 'connected': return 'Ready to transfer';
      case 'connecting': return 'Negotiating...';
      case 'disconnected': return 'Unavailable';
      default: return 'Unknown';
    }
  };

  const formatPeerId = (id: string) => {
    if (!id) return '—';
    return id.length <= 8 ? id : `${id.slice(0, 8)}…`;
  };

  return (
    <div className="peer-list">
      <h3 className="peer-list-title">Peers (direct link only)</h3>
      
      <div className="peer-item peer-item-local">
        <div className="peer-info">
          <div className="peer-avatar local">ME</div>
          <div className="peer-details">
            <span className="peer-name">You</span>
            <span className="peer-id">{formatPeerId(myPeerId)}</span>
          </div>
        </div>
        <div className="peer-status">
          <span
            className="status-dot"
            style={{ backgroundColor: p2pReady ? '#00ff88' : '#ffaa00' }}
          />
          <span className="status-text">{p2pReady ? 'Direct link ready' : 'In room only'}</span>
        </div>
      </div>

      {peers.length === 0 ? (
        <div className="peer-empty">
          <span className="peer-empty-icon">👤</span>
          <span>No peer shown until P2P works (same Wi‑Fi often required)</span>
        </div>
      ) : (
        peers.map(peer => (
          <div 
            key={peer.id}
            className={`peer-item ${selectedPeer === peer.id ? 'selected' : ''}`}
            onClick={() => onSelectPeer(selectedPeer === peer.id ? null : peer.id)}
          >
            <div className="peer-info">
              <div className="peer-avatar">P</div>
              <div className="peer-details">
                <span className="peer-name">Peer  <span
                  className={`peer-ice-path ${
                    peer.iceTransportPath === 'relay'
                      ? 'relay'
                      : peer.iceTransportPath === 'direct'
                        ? 'direct'
                        : ''
                  }`}
                  title={peer.iceTransportDetail ?? undefined}
                >
                  {peer.iceTransportPath === 'relay'
                    ? 'TURN 中继'
                    : peer.iceTransportPath === 'direct'
                      ? '直联'
                      : peer.iceTransportPath === 'unknown'
                        ? '路径未知'
                        : '检测 ICE 路径…'}
                </span></span>
                <span className="peer-id">{formatPeerId(peer.id)}</span>
              </div>
            </div>
            <div className="peer-status">
              <span 
                className={`status-dot ${peer.status === 'connecting' ? 'pulsing' : ''}`} 
                style={{ backgroundColor: getStatusColor(peer.status) }} 
              />
              <span className="status-text">{getStatusText(peer.status)}</span>
            </div>
          </div>
        ))
      )}

      {peers.length > 0 && (
        <div className="peer-hint">
          Click a peer to send files to specific recipient, or select "All Peers"
        </div>
      )}

      <div 
        className={`peer-item all-peers ${selectedPeer === null ? 'selected' : ''}`}
        onClick={() => onSelectPeer(null)}
      >
        <div className="peer-info">
          <div className="peer-avatar all">ALL</div>
          <div className="peer-details">
            <span className="peer-name">All Peers</span>
            <span className="peer-id">Broadcast to everyone</span>
          </div>
        </div>
      </div>
    </div>
  );
};
