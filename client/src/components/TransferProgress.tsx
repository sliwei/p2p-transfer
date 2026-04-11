import { TransferProgress } from '../hooks/useWebRTC'

interface TransferProgressListProps {
  transfers: TransferProgress[]
}

const itemBorderClass = (status: TransferProgress['status']) => {
  switch (status) {
    case 'completed':
      return 'border-accent bg-accent-soft'
    case 'error':
      return 'border-accent-danger'
    default:
      return 'border-line bg-surface-raised'
  }
}

export const TransferProgressList: React.FC<TransferProgressListProps> = ({ transfers }) => {
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatSpeed = (bytesPerSecond: number): string => {
    if (bytesPerSecond === 0) return '0 KB/s'
    const k = 1024
    const sizes = ['B/s', 'KB/s', 'MB/s']
    const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k))
    return parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  const getStatusIcon = (status: TransferProgress['status']) => {
    switch (status) {
      case 'pending':
        return '⏳'
      case 'transferring':
        return '⬆️'
      case 'completed':
        return '✅'
      case 'error':
        return '❌'
      default:
        return '📄'
    }
  }

  const getDirectionIcon = (direction: TransferProgress['direction']) => {
    return direction === 'sending' ? '⬆️' : '⬇️'
  }

  if (transfers.length === 0) {
    return (
      <div className="mt-6 border-t border-line pt-6">
        <h3 className="mb-4 text-base font-semibold text-content">Transfer Progress</h3>
        <div className="rounded-[10px] bg-surface-raised py-8 text-center text-sm text-content-muted">No active transfers</div>
      </div>
    )
  }

  return (
    <div className="mt-6 border-t border-line pt-6">
      <h3 className="mb-4 text-base font-semibold text-content">Transfer Progress</h3>
      <div className="flex flex-col gap-3">
        {transfers.map((transfer) => {
          const progress = Math.min(100, (transfer.sentBytes / transfer.fileSize) * 100)

          return (
            <div key={transfer.fileId} className={`rounded-[10px] border p-4 ${itemBorderClass(transfer.status)}`}>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="text-base">{getDirectionIcon(transfer.direction)}</span>
                  <span className="truncate text-[0.9375rem] font-medium text-content" title={transfer.fileName}>
                    {transfer.fileName}
                  </span>
                </div>
                <div className="shrink-0">
                  <span className="text-base">{getStatusIcon(transfer.status)}</span>
                </div>
              </div>

              <div className="mb-2 flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-sm bg-surface-overlay">
                  <div
                    className="h-full rounded-sm bg-gradient-to-r from-accent to-accent-blue transition-[width] duration-300 ease-out"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <span className="min-w-[2.25rem] text-right font-mono text-xs font-semibold text-accent">{progress.toFixed(0)}%</span>
              </div>

              <div className="flex items-center justify-between font-mono text-xs text-content-secondary">
                <span>
                  {formatFileSize(transfer.sentBytes)} / {formatFileSize(transfer.fileSize)}
                </span>
                {transfer.status === 'transferring' && transfer.speed > 0 ? (
                  <span className="text-accent-blue">{formatSpeed(transfer.speed)}</span>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
