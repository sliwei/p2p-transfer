
import { TransferProgress } from '../hooks/useWebRTC';

interface TransferProgressListProps {
  transfers: TransferProgress[];
}

export const TransferProgressList: React.FC<TransferProgressListProps> = ({ transfers }) => {
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatSpeed = (bytesPerSecond: number): string => {
    if (bytesPerSecond === 0) return '0 KB/s';
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s'];
    const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
    return parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const getStatusIcon = (status: TransferProgress['status']) => {
    switch (status) {
      case 'pending': return '⏳';
      case 'transferring': return '⬆️';
      case 'completed': return '✅';
      case 'error': return '❌';
      default: return '📄';
    }
  };

  const getDirectionIcon = (direction: TransferProgress['direction']) => {
    return direction === 'sending' ? '⬆️' : '⬇️';
  };

  if (transfers.length === 0) {
    return (
      <div className="transfer-section">
        <h3 className="transfer-title">Transfer Progress</h3>
        <div className="transfer-empty">
          <span>No active transfers</span>
        </div>
      </div>
    );
  }

  return (
    <div className="transfer-section">
      <h3 className="transfer-title">Transfer Progress</h3>
      <div className="transfer-list">
        {transfers.map((transfer) => {
          const progress = Math.min(100, (transfer.sentBytes / transfer.fileSize) * 100);
          
          return (
            <div key={transfer.fileId} className={`transfer-item ${transfer.status}`}>
              <div className="transfer-header">
                <div className="transfer-file-info">
                  <span className="transfer-icon">{getDirectionIcon(transfer.direction)}</span>
                  <span className="transfer-file-name" title={transfer.fileName}>
                    {transfer.fileName}
                  </span>
                </div>
                <div className="transfer-status">
                  <span className="status-badge">{getStatusIcon(transfer.status)}</span>
                </div>
              </div>
              
              <div className="transfer-progress-container">
                <div className="transfer-progress-bar">
                  <div 
                    className="transfer-progress-fill"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <span className="transfer-percentage">{progress.toFixed(0)}%</span>
              </div>
              
              <div className="transfer-stats">
                <span className="transfer-size">
                  {formatFileSize(transfer.sentBytes)} / {formatFileSize(transfer.fileSize)}
                </span>
                {transfer.status === 'transferring' && transfer.speed > 0 && (
                  <span className="transfer-speed">{formatSpeed(transfer.speed)}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
