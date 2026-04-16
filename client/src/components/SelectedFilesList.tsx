import { useCallback, useRef } from 'react'
import { toast } from 'sonner'

import { coverToImageSrc, getDropReceiveItemStash, getEffectiveDropFileSize, isMalianDropVirtualUrl } from '../utils/app-drop-protocol'
import jsBridge from '../utils/js-bridge'
import { isVideoFile, MAX_SELECTED_FILES, mergeFeedbackMessage, mergeIntoSelectedFiles, sumSelectedFilesBytes } from '../utils/selected-files-policy'

interface SelectedFilesListProps {
  files: File[]
  onFilesChange: (files: File[]) => void
  onSelectMore: () => void | Promise<void>
  onSendFiles: () => void
  canSend: boolean
  isSending: boolean
}

/** 人类可读大小，如 20 kb / 2 Mb / 1.5 Gb */
function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes === 0) return '0 kb'
  const kb = 1024
  const mb = kb * 1024
  const gb = mb * 1024
  const fmt = (n: number) => (n >= 10 || Number.isInteger(n) ? String(Math.round(n)) : n.toFixed(1))
  if (bytes < kb) return `${bytes} B`
  if (bytes < mb) return `${fmt(bytes / kb)} kb`
  if (bytes < gb) return `${fmt(bytes / mb)} Mb`
  return `${fmt(bytes / gb)} Gb`
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
      const picked = e.target.files ? Array.from(e.target.files) : []
      const r = mergeIntoSelectedFiles(files, picked, () => true)
      const msg = mergeFeedbackMessage(r)
      if (msg) queueMicrotask(() => toast.warning(msg))
      if (r.next !== files) onFilesChange(r.next)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    },
    [files, onFilesChange]
  )

  const handleSelectClick = () => {
    if (files.length >= MAX_SELECTED_FILES) {
      toast.warning(`已达上限（最多 ${MAX_SELECTED_FILES} 个文件），无法继续添加`)
      return
    }
    if (jsBridge.isNativeEmbedHost()) {
      void Promise.resolve(onSelectMore()).catch((e) => console.error('[AppDrop] onSelectMore', e))
    } else {
      fileInputRef.current?.click()
    }
  }

  const getFilePreview = (file: File): string | null => {
    const stash = getDropReceiveItemStash(file)
    const dropUrl = stash && typeof stash.url === 'string' ? stash.url : ''
    if (isMalianDropVirtualUrl(dropUrl) && file.type.startsWith('image/')) {
      return dropUrl
    }
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
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="min-w-0 flex-1 text-[17px] font-medium text-[#333333]">
          选择{files.length}/{MAX_SELECTED_FILES}个文件
          <span className="mt-0.5 block text-[14px] font-normal text-[#888888] sm:mt-0 sm:ml-1.5 sm:inline">（共 {formatFileSize(sumSelectedFilesBytes(files))}）</span>
        </h2>
        <div className="flex shrink-0 items-center gap-4">
          <button
            type="button"
            onClick={handleSelectClick}
            disabled={files.length >= MAX_SELECTED_FILES}
            className="flex items-center text-[15px] text-[#0066FF] disabled:cursor-not-allowed disabled:opacity-40"
          >
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
              <div key={`${file.name}-${index}`} className="flex w-[100px] flex-shrink-0 flex-col overflow-visible">
                <div className="relative h-[128px] w-full rounded-[10px] bg-[#E6E5F7] overflow-visible">
                  {previewUrl ? (
                    <div className="relative h-full w-full rounded-[10px] overflow-hidden">
                      <img src={previewUrl} alt={file.name} className="h-full w-full object-contain" />
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
                    <div className="flex h-full w-full flex-col items-center justify-center break-all p-2 text-center text-xs text-gray-400">
                      <span className="mb-1 text-sm font-medium text-[#333333]">{file.name.split('.').pop()?.toUpperCase()}</span>
                      <span className="line-clamp-2 text-[10px] opacity-70">{file.name}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => handleRemove(index)}
                    className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-[#FF3B30] text-xs text-white shadow-sm"
                    aria-label={`移除 ${file.name}`}
                  >
                    ×
                  </button>
                </div>
                <p className="mt-1 text-center text-[10px] leading-tight text-[#666666]">{formatFileSize(getEffectiveDropFileSize(file))}</p>
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
