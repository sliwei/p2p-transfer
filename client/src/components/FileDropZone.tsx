import { useCallback,useState } from 'react'

interface FileDropZoneProps {
  onFilesSelected: (files: File[]) => void
}

export const FileDropZone: React.FC<FileDropZoneProps> = ({ onFilesSelected }) => {
  const [isDragging, setIsDragging] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)

      const files = Array.from(e.dataTransfer.files)
      if (files.length > 0) {
        setSelectedFiles(files)
        onFilesSelected(files)
      }
    },
    [onFilesSelected]
  )

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : []
      if (files.length > 0) {
        setSelectedFiles(files)
        onFilesSelected(files)
      }
    },
    [onFilesSelected]
  )

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const clearSelection = () => {
    setSelectedFiles([])
  }

  const zoneRing = isDragging
    ? 'border-accent bg-accent-soft shadow-glow-green'
    : selectedFiles.length > 0
      ? 'border-solid border-accent-blue'
      : 'border-dashed border-line'

  return (
    <div className="mb-6">
      <div
        className={`group relative rounded-2xl border-2 bg-surface-raised transition-all ${zoneRing}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input type="file" id="file-input" multiple onChange={handleFileInput} className="absolute h-0 w-0 opacity-0" />
        <label htmlFor="file-input" className={`block cursor-pointer ${selectedFiles.length === 0 ? 'px-8 py-12 text-center md:py-12' : 'p-6 text-left'}`}>
          {selectedFiles.length === 0 ? (
            <>
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-line bg-surface-overlay text-content-secondary transition-all group-hover:border-accent group-hover:text-accent group-hover:shadow-glow-green">
                <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <p className="mb-2 text-base text-content-secondary">
                <span className="font-medium text-accent">Drop files here</span> or click to browse
              </p>
              <p className="text-sm text-content-muted">Support for multiple files</p>
            </>
          ) : (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <span className="text-[0.9375rem] font-medium text-content">{selectedFiles.length} file(s) selected</span>
                <button
                  type="button"
                  className="rounded-md border border-line bg-transparent px-3 py-1.5 text-sm text-content-secondary transition-colors hover:border-accent-danger hover:text-accent-danger"
                  onClick={(e) => {
                    e.preventDefault()
                    clearSelection()
                  }}
                >
                  Clear
                </button>
              </div>
              <div className="flex flex-col gap-2">
                {selectedFiles.map((file, index) => (
                  <div key={index} className="flex items-center gap-3 rounded-[10px] border border-line bg-surface-overlay p-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-surface-raised text-accent-blue">
                      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                    </div>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-sm font-medium text-content">{file.name}</span>
                      <span className="font-mono text-xs text-content-muted">{formatFileSize(file.size)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </label>
      </div>
    </div>
  )
}
