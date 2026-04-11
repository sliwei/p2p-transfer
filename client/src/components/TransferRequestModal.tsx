import jsBridge from '../utils/js-bridge'

interface TransferRequestModalProps {
  peerName: string
  fileCount: number
  onAcceptAlbum: () => void
  onAcceptChat: () => void
  onReject: () => void
}

export function TransferRequestModal({
  peerName,
  fileCount,
  onAcceptAlbum,
  onAcceptChat,
  onReject
}: TransferRequestModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-3xl w-[320px] p-6 relative flex flex-col items-center">
        {/* Header */}
        <div className="w-full flex justify-between items-center mb-6">
          <div className="flex-1"></div>
          <h2 className="text-lg font-medium text-gray-900">马良Drop</h2>
          <div className="flex-1 flex justify-end">
            <button 
              onClick={onReject}
              className="text-[#2266FF] text-[15px]"
            >
              拒绝
            </button>
          </div>
        </div>

        {/* Content */}
        <p className="text-[16px] text-gray-800 mb-8 text-center">
          “{peerName}”想要共享{fileCount}个文件。
        </p>

        {/* Buttons */}
        <div className="flex w-full gap-3">
          <button
            onClick={onAcceptAlbum}
            className={`flex-1 py-3 rounded-full text-[15px] font-medium ${
              jsBridge.isNativeEmbedHost() 
                ? 'bg-gray-100 text-gray-800' 
                : 'bg-[#2266FF] text-white'
            }`}
          >
            保存至相册
          </button>
          {jsBridge.isNativeEmbedHost() && (
            <button
              onClick={onAcceptChat}
              className="flex-1 py-3 rounded-full bg-[#2266FF] text-white text-[15px] font-medium"
            >
              插入对话流
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
