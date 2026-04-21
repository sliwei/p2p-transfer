import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import type { ReceivedFile } from '../hooks/useWebRTC'
import jsBridge from '../utils/js-bridge'
import { isP2pTextReceived } from '../utils/p2p-text'

/** 人类可读大小（与 SelectedFilesList 思路一致，略短） */
function formatCompactSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes === 0) return '0 B'
  const kb = 1024
  const mb = kb * 1024
  if (bytes < kb) return `${bytes} B`
  if (bytes < mb) return `${(bytes / kb).toFixed(bytes < 10 * kb ? 1 : 0)} KB`
  return `${(bytes / mb).toFixed(2)} MB`
}

function ReceivedTextRow({ file }: { file: ReceivedFile }) {
  const [text, setText] = useState('')

  useEffect(() => {
    let cancelled = false
    void file.blob
      .text()
      .then((t) => {
        if (!cancelled) setText(t)
      })
      .catch(() => {
        if (!cancelled) setText('')
      })
    return () => {
      cancelled = true
    }
  }, [file.blob, file.id])

  const handleCopy = async () => {
    try {
      const t = text || (await file.blob.text())
      await navigator.clipboard.writeText(t)
      toast.success('已复制到剪贴板')
    } catch {
      toast.error('复制失败')
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-[#F8F9FA] p-3">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#E8EEFF] text-[13px] font-semibold text-[#2266FE]">文</div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-[#2266FE]/10 px-1.5 py-0.5 text-[11px] font-medium text-[#2266FE]">文字</span>
            <span className="text-[11px] text-[#999999]">类型：纯文本 · {formatCompactSize(file.size)}</span>
          </div>
          <p className="max-h-[9rem] overflow-y-auto whitespace-pre-wrap break-words text-[14px] leading-snug text-[#333333]">{text || '读取中…'}</p>
        </div>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="shrink-0 rounded-full border border-[#2266FE] px-3 py-1.5 text-[13px] font-medium text-[#2266FE] hover:bg-[#2266FE]/5"
        >
          复制
        </button>
      </div>
    </div>
  )
}

function runDoneInBackground(onClose: () => void, onDone: () => void | Promise<void>) {
  if (jsBridge.isNativeEmbedHost()) {
    onClose()
    void Promise.resolve(onDone()).catch((e) => console.error('[ReceivedFilesModal] onDone', e))
  } else {
    void Promise.resolve(onDone())
  }
}

interface ReceivedFilesModalProps {
  files: ReceivedFile[]
  onClose: () => void
  onDone: () => void | Promise<void>
  /** 为 true 时多文件不批量触发下载，改为每次点击按钮保存一个（Safari / iOS WebKit） */
  stepwiseBrowserSave?: boolean
  onStepSave?: (file: ReceivedFile) => void
}

export const ReceivedFilesModal: React.FC<ReceivedFilesModalProps> = ({ files, onClose, onDone, stepwiseBrowserSave = false, onStepSave }) => {
  const [stepIndex, setStepIndex] = useState(0)
  const stepwise = Boolean(stepwiseBrowserSave && files.length > 1 && onStepSave)

  if (files.length === 0) return null

  const handleStepClick = () => {
    if (!onStepSave) return
    onStepSave(files[stepIndex])
    if (stepIndex + 1 >= files.length) {
      runDoneInBackground(onClose, onDone)
      return
    }
    setStepIndex((s) => s + 1)
  }

  return (
    <div className="fixed top-0 inset-0 z-[100] flex items-center justify-center overscroll-none p-4 animate-in fade-in duration-200">
      <div className="absolute inset-0 bg-black/50" aria-hidden />
      <div className="relative z-10 bg-white rounded-2xl w-full max-w-sm overflow-hidden flex flex-col max-h-[80vh] shadow-xl">
        <div className="px-5 py-4 border-b border-[#F0F0F0] flex justify-between items-center">
          <h3 className="text-[17px] font-medium text-[#333333]">接收成功</h3>
          <button onClick={onClose} className="text-[#999999] hover:text-[#333333] transition-colors">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5 overflow-y-auto flex-1 flex flex-col gap-3">
          {files.map((file) =>
            isP2pTextReceived(file) ? (
              <ReceivedTextRow key={file.id} file={file} />
            ) : (
              <div key={file.id} className="flex items-center gap-3 bg-[#F8F9FA] p-3 rounded-xl">
                <div className="w-10 h-10 rounded-lg bg-[#E6E5F7] flex items-center justify-center text-[#333333] font-medium text-xs shrink-0">{file.name.split('.').pop()?.toUpperCase()}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] text-[#333333] truncate">{file.name}</div>
                  <div className="text-[12px] text-[#999999]">{(file.size / 1024 / 1024).toFixed(2)} MB</div>
                </div>
              </div>
            )
          )}
        </div>
        <div className="px-5 py-4 border-t border-[#F0F0F0]">
          {stepwise ? (
            <div className="flex flex-col gap-2">
              <p className="text-center text-[12px] leading-snug text-[#666666]">手机、平板等非电脑浏览器需逐个保存：每点一次按钮下载一个文件，保存完再点下一个。</p>
              <button type="button" onClick={handleStepClick} className="w-full py-2.5 bg-[#2266FE] text-white rounded-full font-medium hover:bg-[#1b52cc] transition-colors">
                保存第 {stepIndex + 1} / {files.length} 个
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => runDoneInBackground(onClose, onDone)} className="w-full py-2.5 bg-[#2266FE] text-white rounded-full font-medium hover:bg-[#1b52cc] transition-colors">
              完成
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
