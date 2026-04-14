import { useCallback, useRef } from 'react'

import { coverToImageSrc, getDropReceiveItemStash } from '../utils/app-drop-protocol'
import jsBridge from '../utils/js-bridge'

interface SelectedFilesListProps {
  files: File[]
  onFilesChange: (files: File[]) => void
  onSelectMore: () => void | Promise<void>
  onSendFiles: () => void
  canSend: boolean
  isSending: boolean
}

function isVideoFile(file: File): boolean {
  if (file.type.startsWith('video/')) return true
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return /^(mp4|mov|webm|mkv|avi|m4v|3gp|ogv)$/i.test(ext)
}

/** drop 协议在 File 上挂的 cover */
function getDropCover(file: File): string | undefined {
  const stash = getDropReceiveItemStash(file)
  const fromStash = stash?.cover
  if (typeof fromStash === 'string') {
    const t = fromStash.trim()
    if (t) return t
  }
  const c = (file as File & { cover?: string }).cover?.trim()
  return c || undefined
}

export const SelectedFilesList: React.FC<SelectedFilesListProps> = ({ files, onFilesChange, onSelectMore, onSendFiles, canSend, isSending }) => {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleRemove = (indexToRemove: number) => {
    onFilesChange(files.filter((_, index) => index !== indexToRemove))
  }

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.files ? Array.from(e.target.files) : []
      if (next.length > 0) {
        onFilesChange([...files, ...next])
      }
      // Reset input value so the same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    },
    [files, onFilesChange]
  )

  const handleSelectClick = () => {
    if (jsBridge.isNativeEmbedHost()) {
      void Promise.resolve(onSelectMore()).catch((e) => console.error('[AppDrop] onSelectMore', e))
    } else {
      if (fileInputRef.current) {
        fileInputRef.current.click()
      }
    }
  }

  const getFilePreview = (file: File): string | null => {
    const cover = getDropCover(file)
    if (cover) {
      return coverToImageSrc(cover, file)
    }
    if (file.type.startsWith('image/')) {
      return URL.createObjectURL(file)
    }
    return null
  }

  return (
    <div className="w-full px-4 py-3">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[17px] font-medium text-[#333333]">选择{files.length}个文件</h2>
        <div className="flex items-center gap-4">
          <button onClick={handleSelectClick} className="text-[15px] text-[#0066FF] flex items-center">
            {files.length > 0 ? '继续选择' : '添加文件'}
            <svg className="w-4 h-4 ml-1" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="8393">
              <path
                d="M704 514.368a52.864 52.864 0 0 1-15.808 37.888L415.872 819.2a55.296 55.296 0 0 1-73.984-2.752 52.608 52.608 0 0 1-2.816-72.512l233.6-228.928-233.6-228.992a52.736 52.736 0 0 1-17.536-53.056 53.952 53.952 0 0 1 40.192-39.424c19.904-4.672 40.832 1.92 54.144 17.216l272.32 266.88c9.92 9.792 15.616 23.04 15.808 36.8z"
                fill="#2266FE"
                fillOpacity=".88"
                p-id="8394"
              ></path>
            </svg>
          </button>
          {files.length > 0 && (
            <button
              onClick={onSendFiles}
              disabled={!canSend || isSending}
              className="px-4 py-1.5 bg-[#0066FF] text-white text-[14px] font-medium rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-colors hover:bg-[#0052CC]"
            >
              {isSending ? '发送中...' : '发送'}
            </button>
          )}
        </div>
        <input type="file" ref={fileInputRef} multiple onChange={handleFileInput} className="hidden" />
      </div>

      {files.length > 0 ? (
        <div className="flex overflow-x-auto gap-3 pb-2 pt-2 scrollbar-hide">
          {files.map((file, index) => {
            const previewUrl = getFilePreview(file)
            const showVideoBadgeOnCover = Boolean(getDropCover(file) && previewUrl && isVideoFile(file))
            return (
              <div key={`${file.name}-${index}`} className="relative flex-shrink-0 w-[100px] h-[128px] rounded-[10px] bg-[#E6E5F7] overflow-visible">
                {previewUrl ? (
                  <div className="relative w-full h-full rounded-[10px] overflow-hidden">
                    <img src={previewUrl} alt={file.name} className="w-full h-full object-contain" />
                    {showVideoBadgeOnCover && (
                      <div
                        className="absolute bottom-1.5 left-1/2 flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-full bg-black/50 text-white shadow-sm pointer-events-none"
                        aria-hidden
                      >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                          <path d="M8 5v14l11-7L8 5z" />
                        </svg>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-xs text-gray-400 break-all p-2 text-center">
                    <span className="font-medium text-sm text-[#333333] mb-1">{file.name.split('.').pop()?.toUpperCase()}</span>
                    <span className="text-[10px] opacity-70 line-clamp-2">{file.name}</span>
                  </div>
                )}
                <button
                  onClick={() => handleRemove(index)}
                  className="absolute -top-2 -right-2 w-6 h-6 bg-[#FF3B30] rounded-full flex items-center justify-center text-white text-xs border-2 border-white shadow-sm"
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="flex items-center justify-center h-[128px] pb-2 pt-2">
          <span className="font-normal text-[14px] text-[#999999] leading-[23px] text-left not-italic">您还没有添加文件</span>
        </div>
      )}
    </div>
  )
}
