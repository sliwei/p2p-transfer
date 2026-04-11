
import { ReceivedFile } from '../hooks/useWebRTC';

interface FileTransferProps {
  receivedFiles: ReceivedFile[];
  onDownload: (file: ReceivedFile) => void;
}

export const FileTransfer: React.FC<FileTransferProps> = ({ receivedFiles, onDownload }) => {
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatTime = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString();
  };

  const formatPeerId = (id: string): string => {
    return id.slice(0, 8) + '...';
  };

  if (receivedFiles.length === 0) {
    return (
      <div className="received-section">
        <h3 className="received-title">Received Files</h3>
        <div className="received-empty">
          <span>No files received yet</span>
        </div>
      </div>
    );
  }

  return (
    <div className="received-section">
      <h3 className="received-title">Received Files</h3>
      <div className="received-list">
        {receivedFiles.map((file) => (
          <div key={file.id} className="received-item">
            <div className="received-file-info">
              <div className="received-file-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
              </div>
              <div className="received-file-details">
                <span className="received-file-name" title={file.name}>
                  {file.name}
                </span>
                <div className="received-file-meta">
                  <span className="received-file-size">{formatFileSize(file.size)}</span>
                  <span className="received-file-from">From: {formatPeerId(file.fromPeerId)}</span>
                  <span className="received-file-time">{formatTime(file.timestamp)}</span>
                </div>
              </div>
            </div>
            <button 
              className="download-btn"
              onClick={() => onDownload(file)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              <span>Download</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
