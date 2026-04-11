import { ReceivedFile } from '../hooks/useWebRTC'

interface FileTransferProps {
  receivedFiles: ReceivedFile[]
  onDownload: (file: ReceivedFile) => void
}

export const FileTransfer: React.FC<FileTransferProps> = ({ receivedFiles, onDownload }) => {
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatTime = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString()
  }

  const formatPeerId = (id: string): string => {
    if (!id) return '—'
    return id.length <= 8 ? id : `${id.slice(0, 8)}…`
  }

  if (receivedFiles.length === 0) {
    return (
      <div className="mt-6 border-t border-line pt-6">
        <h3 className="mb-4 text-base font-semibold text-content">Received Files</h3>
        <div className="rounded-[10px] bg-surface-raised py-8 text-center text-sm text-content-muted">No files received yet</div>
      </div>
    )
  }

  return (
    <div className="mt-6 border-t border-line pt-6">
      <h3 className="mb-4 text-base font-semibold text-content">Received Files</h3>
      <div className="flex flex-col gap-3">
        {receivedFiles.map((file) => (
          <div
            key={file.id}
            className="flex flex-col items-stretch justify-between gap-4 rounded-[10px] border border-line bg-surface-raised p-4 sm:flex-row sm:items-center"
          >
            <div className="flex min-w-0 flex-1 items-center gap-3.5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-accent bg-accent-soft text-accent">
                <svg className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-[0.9375rem] font-medium text-content" title={file.name}>
                  {file.name}
                </span>
                <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-content-muted">
                  <span>{formatFileSize(file.size)}</span>
                  <span>From: {formatPeerId(file.fromPeerId)}</span>
                  <span>{formatTime(file.timestamp)}</span>
                </div>
              </div>
            </div>
            <button
              type="button"
              className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-[10px] border border-accent bg-accent-soft px-4 py-2.5 text-sm font-medium text-accent transition-all hover:bg-accent hover:text-surface hover:shadow-glow-green sm:w-auto"
              onClick={() => onDownload(file)}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>Download</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
