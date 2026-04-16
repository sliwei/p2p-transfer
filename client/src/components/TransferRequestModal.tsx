import jsBridge from '../utils/js-bridge'

interface TransferRequestModalProps {
  name: string
  fileCount: number
  onAcceptAlbum: () => void
  onAcceptChat: () => void
  onReject: () => void
}

export function TransferRequestModal({ name, fileCount, onAcceptAlbum, onAcceptChat, onReject }: TransferRequestModalProps) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overscroll-none">
      <div className="absolute inset-0 bg-black/40" aria-hidden />
      <div className="relative z-10 bg-white rounded-3xl w-[320px] p-6 flex flex-col items-center">
        {/* Header */}
        <div className="w-full flex justify-between items-center mb-6">
          <div className="flex-1"></div>
          <h2 className="text-lg font-medium text-gray-900">马良Drop</h2>
          <div className="flex-1 flex justify-end">
            <button onClick={onReject} className="text-[#2266FF] text-[15px]">
              拒绝
            </button>
          </div>
        </div>

        {/* Content */}
        <p className="text-[16px] text-gray-800 mb-8 text-center">
          “{name}”想要共享{fileCount}个文件。
        </p>

        {/* Buttons */}
        <div className="flex w-full gap-3">
          <button onClick={onAcceptAlbum} className={`flex-1 py-3 rounded-full text-[15px] font-medium ${jsBridge.isNativeEmbedHost() ? 'bg-gray-100 text-gray-800' : 'bg-[#2266FF] text-white'}`}>
            保存至相册
          </button>
          {jsBridge.isNativeEmbedHost() && (
            <button onClick={onAcceptChat} className="flex-1 py-3 rounded-full bg-[#2266FF] text-white text-[15px] font-medium">
              插入对话流
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
