import { useState } from 'react';
import { useRoom } from './hooks/useRoom';
import { useWebRTC } from './hooks/useWebRTC';
import { RoomJoin } from './components/RoomJoin';
import { PeerList } from './components/PeerList';
import { FileDropZone } from './components/FileDropZone';
import { TransferProgressList } from './components/TransferProgress';
import { FileTransfer } from './components/FileTransfer';
import './styles/index.css';

function App() {
  const { 
    roomId, 
    inputRoomId, 
    setInputRoomId, 
    joinRoom, 
    leaveRoom, 
    generateRoomId,
    copyRoomLink 
  } = useRoom();
  
  const { 
    myPeerId, 
    peers, 
    transfers, 
    receivedFiles, 
    signalingInRoom,
    p2pFileTransferReady,
    sendFile, 
    downloadFile 
  } = useWebRTC(roomId);

  const headerConnection = (() => {
    if (!signalingInRoom) {
      return { className: 'disconnected', text: 'Connecting to server...' };
    }
    if (p2pFileTransferReady) {
      return { className: 'connected', text: 'P2P ready — you can transfer files' };
    }
    if (peers.length === 0) {
      return { className: 'pending-p2p', text: 'In room — waiting for peer' };
    }
    const allFailed = peers.every((p) => p.status === 'disconnected');
    if (allFailed) {
      return {
        className: 'disconnected',
        text: 'P2P unavailable — same LAN, TURN, or network setup required',
      };
    }
    return { className: 'pending-p2p', text: 'Establishing P2P link...' };
  })();

  const [selectedPeer, setSelectedPeer] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isSending, setIsSending] = useState(false);

  const handleFilesSelected = (files: File[]) => {
    setSelectedFiles(files);
  };

  const handleSendFiles = async () => {
    if (selectedFiles.length === 0) return;
    
    setIsSending(true);
    try {
      for (const file of selectedFiles) {
        await sendFile(file, selectedPeer || undefined);
      }
      setSelectedFiles([]);
    } catch (error) {
      console.error('Error sending files:', error);
      alert('Failed to send files. Please check peer connections.');
    } finally {
      setIsSending(false);
    }
  };

  const handleCopyRoomId = () => {
    if (roomId) {
      navigator.clipboard.writeText(roomId);
    }
  };

  // Show room join page if not in a room
  if (!roomId) {
    return (
      <RoomJoin
        roomId={inputRoomId}
        onRoomIdChange={setInputRoomId}
        onJoin={joinRoom}
        onGenerate={generateRoomId}
      />
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <div className="logo-small">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 1v6m0 6v6m4.22-10.22l4.24-4.24M6.34 6.34L2.1 2.1m17.8 17.8l-4.24-4.24M6.34 17.66l-4.24 4.24M23 12h-6m-6 0H1m20.24 4.24l-4.24-4.24M6.34 6.34l-4.24-4.24"/>
            </svg>
          </div>
          <h1 className="app-title">P2P Transfer</h1>
        </div>
        
        <div className="header-center">
          <div className="room-badge">
            <span className="room-label">Room:</span>
            <span className="room-id" onClick={handleCopyRoomId} title="Click to copy">
              {roomId}
            </span>
            <button className="copy-btn" onClick={copyRoomLink} title="Copy room link">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
          </div>
          <div className={`connection-status ${headerConnection.className}`}>
            <span className="status-dot" />
            <span className="status-text">{headerConnection.text}</span>
          </div>
        </div>

        <div className="header-right">
          <button className="btn btn-secondary btn-small" onClick={leaveRoom}>
            Leave Room
          </button>
        </div>
      </header>

      <main className="app-main">
        <div className="main-grid">
          <div className="sidebar">
            <PeerList
              peers={peers}
              myPeerId={myPeerId}
              selectedPeer={selectedPeer}
              onSelectPeer={setSelectedPeer}
            />
          </div>

          <div className="content">
            <div className="transfer-panel">
              <h2 className="panel-title">
                {selectedPeer === null 
                  ? 'Send to All Peers' 
                  : `Send to ${selectedPeer.slice(0, 8)}...`}
              </h2>
              
              <FileDropZone onFilesSelected={handleFilesSelected} />
              
              {selectedFiles.length > 0 && (
                <div className="send-actions">
                  <button 
                    className="btn btn-primary btn-large"
                    onClick={handleSendFiles}
                    disabled={isSending || peers.filter(p => p.status === 'connected').length === 0}
                  >
                    {isSending ? (
                      <>
                        <span className="spinner" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="22" y1="2" x2="11" y2="13"/>
                          <polygon points="22 2 15 22 11 13 2 9"/>
                        </svg>
                        Send {selectedFiles.length} file(s)
                      </>
                    )}
                  </button>
                  {peers.filter(p => p.status === 'connected').length === 0 && (
                    <p className="send-warning">Waiting for peers to connect...</p>
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
  );
}

export default App;
