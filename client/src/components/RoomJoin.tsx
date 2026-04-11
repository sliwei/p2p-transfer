import { useState } from 'react';

interface RoomJoinProps {
  roomId: string;
  onRoomIdChange: (value: string) => void;
  onJoin: (roomId: string) => void;
  onGenerate: () => string;
}

export const RoomJoin: React.FC<RoomJoinProps> = ({ 
  roomId, 
  onRoomIdChange, 
  onJoin, 
  onGenerate 
}) => {
  const [copied, setCopied] = useState(false);

  const handleGenerate = () => {
    const newId = onGenerate();
    onRoomIdChange(newId);
  };

  const handleJoin = () => {
    if (roomId.trim()) {
      onJoin(roomId.trim());
    }
  };

  const handleCopyLink = () => {
    if (!roomId) return;
    const url = new URL(window.location.href);
    url.searchParams.set('roomid', roomId);
    navigator.clipboard.writeText(url.toString());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="room-join-container">
      <div className="room-join-card">
        <div className="room-join-header">
          <div className="logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 1v6m0 6v6m4.22-10.22l4.24-4.24M6.34 6.34L2.1 2.1m17.8 17.8l-4.24-4.24M6.34 17.66l-4.24 4.24M23 12h-6m-6 0H1m20.24 4.24l-4.24-4.24M6.34 6.34l-4.24-4.24"/>
            </svg>
          </div>
          <h1 className="room-join-title">P2P File Transfer</h1>
          <p className="room-join-subtitle">Direct peer-to-peer file sharing</p>
        </div>

        <div className="room-join-form">
          <div className="input-group">
            <label htmlFor="room-id">Room ID</label>
            <div className="input-wrapper">
              <input
                type="text"
                id="room-id"
                value={roomId}
                onChange={(e) => onRoomIdChange(e.target.value)}
                placeholder="Enter room ID or generate one"
                className="room-input"
              />
              {roomId && (
                <button 
                  className="copy-link-btn"
                  onClick={handleCopyLink}
                  title="Copy room link"
                >
                  {copied ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="#00ff88" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                  )}
                </button>
              )}
            </div>
          </div>

          <div className="button-group">
            <button 
              className="btn btn-secondary"
              onClick={handleGenerate}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
              Generate ID
            </button>
            <button 
              className="btn btn-primary"
              onClick={handleJoin}
              disabled={!roomId.trim()}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M13.8 12H3"/>
              </svg>
              Join Room
            </button>
          </div>
        </div>

        <div className="room-join-info">
          <div className="info-item">
            <span className="info-icon">🔒</span>
            <span className="info-text">End-to-end encrypted via WebRTC</span>
          </div>
          <div className="info-item">
            <span className="info-icon">⚡</span>
            <span className="info-text">Direct P2P connection, no server storage</span>
          </div>
          <div className="info-item">
            <span className="info-icon">🌐</span>
            <span className="info-text">Works on local network</span>
          </div>
        </div>
      </div>
    </div>
  );
};
