import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { coverToImageSrc, getDropReceiveItemStash, getEffectiveDropFileSize, isMalianDropVirtualUrl } from '../utils/app-drop-protocol'
import jsBridge from '../utils/js-bridge'
import { createTextPayloadFile, getTextPayloadByteLength, isP2pTextFile, P2P_TEXT_MAX_BYTES } from '../utils/p2p-text'
import { isVideoFile, MAX_SELECTED_FILES, mergeFeedbackMessage, mergeIntoSelectedFiles, sumSelectedFilesBytes } from '../utils/selected-files-policy'

interface SelectedFilesListProps {
  files: File[]
  onFilesChange: (files: File[]) => void
  onSelectMore: () => void | Promise<void>
  onSendFiles: () => void
  canSend: boolean
  isSending: boolean
  isReceiving: boolean
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

function TextSendPreview({ file }: { file: File }) {
  const [snippet, setSnippet] = useState('')
  useEffect(() => {
    if (!isP2pTextFile(file)) return
    let cancelled = false
    void file
      .slice(0, 8000)
      .text()
      .then((t) => {
        if (!cancelled) setSnippet(t)
      })
      .catch(() => {
        if (!cancelled) setSnippet('')
      })
    return () => {
      cancelled = true
    }
  }, [file])
  return (
    <div className="flex h-full w-full flex-col items-stretch justify-center gap-1 p-2 text-left">
      <span className="inline-flex w-fit shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-[#2266FE] bg-[#2266FE]/10">文字</span>
      <p className="line-clamp-4 w-full flex-1 break-all text-[10px] leading-snug text-[#333333]">{snippet || '…'}</p>
    </div>
  )
}

export const SelectedFilesList: React.FC<SelectedFilesListProps> = ({ files, onFilesChange, onSelectMore, onSendFiles, canSend, isSending, isReceiving }) => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [textModalOpen, setTextModalOpen] = useState(false)
  const [textDraft, setTextDraft] = useState('')
  const transferLocked = isSending || isReceiving

  const handleRemove = (indexToRemove: number) => {
    if (transferLocked) return
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
    if (transferLocked) return
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

  const handleOpenTextModal = () => {
    if (transferLocked) return
    if (files.length >= MAX_SELECTED_FILES) {
      toast.warning(`已达上限（最多 ${MAX_SELECTED_FILES} 个文件），无法继续添加`)
      return
    }
    setTextDraft('')
    setTextModalOpen(true)
  }

  const handlePasteFromClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText()
      setTextDraft((prev) => (prev ? `${prev}${t}` : t))
    } catch {
      toast.error('无法读取剪贴板，请检查浏览器权限')
    }
  }

  const handleConfirmText = () => {
    const trimmed = textDraft.replace(/\r\n/g, '\n').trim()
    if (!trimmed) {
      toast.warning('请输入或粘贴文字内容')
      return
    }
    const bytes = getTextPayloadByteLength(trimmed)
    if (bytes > P2P_TEXT_MAX_BYTES) {
      toast.warning(`文字过长（最多约 ${Math.floor(P2P_TEXT_MAX_BYTES / 1024)} KB）`)
      return
    }
    const textFile = createTextPayloadFile(trimmed)
    const r = mergeIntoSelectedFiles(files, [textFile], () => true)
    const msg = mergeFeedbackMessage(r)
    if (msg) queueMicrotask(() => toast.warning(msg))
    if (r.next !== files) onFilesChange(r.next)
    setTextModalOpen(false)
    setTextDraft('')
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
          选择{files.length}/{MAX_SELECTED_FILES}项
          <span className="mt-0.5 block text-[14px] font-normal text-[#888888] sm:mt-0 sm:ml-1.5 sm:inline">（共 {formatFileSize(sumSelectedFilesBytes(files))}）</span>
        </h2>
        <div className="flex shrink-0 items-center gap-4">
          <button
            type="button"
            onClick={handleOpenTextModal}
            disabled={transferLocked || files.length >= MAX_SELECTED_FILES}
            className="bg-transparent border-none flex items-center text-[15px] text-[#0066FF] disabled:cursor-not-allowed disabled:opacity-40"
          >
            添加文字
          </button>
          <button
            type="button"
            onClick={handleSelectClick}
            disabled={transferLocked || files.length >= MAX_SELECTED_FILES}
            className="bg-transparent border-none flex items-center text-[15px] text-[#0066FF] disabled:cursor-not-allowed disabled:opacity-40"
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
          {(files.length > 0 || transferLocked) && (
            <button
              onClick={onSendFiles}
              disabled={transferLocked || !canSend}
              className="px-4 py-1.5 bg-[#0066FF] text-white text-[14px] font-medium rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-colors hover:bg-[#0052CC]"
            >
              {isSending ? '发送中...' : isReceiving ? '接收中...' : '发送'}
            </button>
          )}
        </div>
        <input type="file" ref={fileInputRef} multiple onChange={handleFileInput} className="hidden" />
      </div>

      {textModalOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center overscroll-none p-4 animate-in fade-in duration-200">
          <button type="button" className="absolute inset-0 bg-black/50" aria-label="关闭" onClick={() => setTextModalOpen(false)} />
          <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <h3 className="text-[17px] font-medium leading-tight text-[#333333]">添加文字</h3>
              <button
                type="button"
                onClick={() => setTextModalOpen(false)}
                className="-mr-1 -mt-1 shrink-0 rounded-full p-1 text-[#999999] transition-colors hover:bg-[#F5F5F5] hover:text-[#333333]"
                aria-label="关闭"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <textarea
              value={textDraft}
              onChange={(e) => setTextDraft(e.target.value)}
              rows={8}
              placeholder="输入或粘贴要传输的文字…"
              className="mb-3 w-full resize-y rounded-xl border border-[#E8E8E8] px-3 py-2.5 text-[15px] text-[#333333] placeholder:text-[#BBBBBB] focus:border-[#2266FE] focus:outline-none focus:ring-1 focus:ring-[#2266FE]"
            />
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={handlePasteFromClipboard} className="rounded-full border border-[#DDDDDD] px-4 py-2 text-[14px] text-[#333333] hover:bg-[#F8F9FA]">
                粘贴
              </button>
              <button type="button" onClick={handleConfirmText} className="ml-auto rounded-full bg-[#2266FE] px-5 py-2 text-[14px] font-medium text-white hover:bg-[#1b52cc]">
                确认
              </button>
            </div>
          </div>
        </div>
      )}

      {files.length > 0 ? (
        <div className="flex overflow-x-auto gap-3 pb-2 pt-2 scrollbar-hide">
          {files.map((file, index) => {
            const isText = isP2pTextFile(file)
            const previewUrl = isText ? null : getFilePreview(file)
            const showVideoBadgeOnCover = Boolean(!isText && getDropCover(file) && previewUrl && isVideoFile(file))
            return (
              <div key={`${file.name}-${index}`} className="flex w-[100px] flex-shrink-0 flex-col overflow-visible">
                <div className="relative h-[128px] w-full rounded-[10px] bg-[#E6E5F7] overflow-visible">
                  {isText ? (
                    <TextSendPreview file={file} />
                  ) : previewUrl ? (
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
                    disabled={transferLocked}
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
          <span className="font-normal text-[14px] text-[#999999] leading-[23px] text-left not-italic">您还没有添加文件或文字</span>
        </div>
      )}
    </div>
  )
}
