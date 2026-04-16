import { QRCodeSVG } from 'qrcode.react'
import { useCallback } from 'react'
import { toast } from 'sonner'

import { copyToClipboard } from '../utils/copyToClipboard'

interface BottomInstructionsProps {
  roomLink: string
}

function withoutHttpScheme(url: string): string {
  return url.replace(/^https?:\/\//i, '')
}

export const BottomInstructions: React.FC<BottomInstructionsProps> = ({ roomLink }) => {
  const linkToCopy = typeof window !== 'undefined' ? window.location.href : roomLink

  const handleCopyLink = useCallback(async () => {
    const ok = await copyToClipboard(linkToCopy)
    if (ok) {
      toast.success('复制成功')
    } else {
      toast.error('复制失败')
    }
  }, [linkToCopy])

  return (
    <div className="w-full px-2 py-2 flex gap-4 items-start">
      <div className="flex flex-col items-center shrink-0">
        <div className="w-24 h-24 bg-white rounded-lg border border-[#E5E5E5] flex items-center justify-center">
          <QRCodeSVG value={linkToCopy} size={88} />
        </div>
        <span className="text-[12px] text-[#999999] mt-2 block max-w-[140px] truncate" title={withoutHttpScheme(linkToCopy)}>
          {withoutHttpScheme(linkToCopy)}
        </span>
        <button
          type="button"
          onClick={handleCopyLink}
          className="mt-2 px-3 py-1 bg-[#0066FF] text-white text-[12px] font-medium rounded-full transition-colors hover:bg-[#0052CC] disabled:cursor-not-allowed disabled:opacity-50"
        >
          一键复制
        </button>
      </div>

      <div className="flex flex-col gap-4">
        <div>
          <div
            className="inline-flex items-center text-[#000000] text-[13px] font-medium px-3 py-1 rounded-full mb-2"
            style={{ background: 'linear-gradient(90deg, #DDE7FF 0%, rgba(255,255,255,0) 100%)' }}
          >
            1.建立设备连接
          </div>
          <p className="text-[13px] text-[#666666] leading-relaxed">在接收文件的设备上，扫描二维码或访问马良Drop链接，进入马良Drop页面设备连接</p>
        </div>

        <div>
          <div
            className="inline-flex items-center text-[#000000] text-[13px] font-medium px-3 py-1 rounded-full mb-2"
            style={{ background: 'linear-gradient(90deg, #DDE7FF 0%, rgba(255,255,255,0) 100%)' }}
          >
            2.发起文件传输
          </div>
          <p className="text-[13px] text-[#666666] leading-relaxed">选择文件后，在已发现的设备列表中，点击接收设备发起传输</p>
        </div>
      </div>
    </div>
  )
}
