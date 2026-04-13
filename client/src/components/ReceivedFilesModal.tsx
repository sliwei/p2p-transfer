import type { ReceivedFile } from '../hooks/useWebRTC'

interface ReceivedFilesModalProps {
  files: ReceivedFile[]
  onClose: () => void
  onDone: () => void
}

export const ReceivedFilesModal: React.FC<ReceivedFilesModalProps> = ({ files, onClose, onDone }) => {
  if (files.length === 0) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overscroll-none p-4 animate-in fade-in duration-200">
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
          {files.map((file) => (
            <div key={file.id} className="flex items-center gap-3 bg-[#F8F9FA] p-3 rounded-xl">
              <div className="w-10 h-10 rounded-lg bg-[#E6E5F7] flex items-center justify-center text-[#333333] font-medium text-xs shrink-0">
                {file.name.split('.').pop()?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] text-[#333333] truncate">{file.name}</div>
                <div className="text-[12px] text-[#999999]">{(file.size / 1024 / 1024).toFixed(2)} MB</div>
              </div>
            </div>
          ))}
        </div>
        <div className="px-5 py-4 border-t border-[#F0F0F0]">
          <button onClick={onDone} className="w-full py-2.5 bg-[#2266FE] text-white rounded-full font-medium hover:bg-[#1b52cc] transition-colors">
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
