import { QRCodeSVG } from 'qrcode.react'

interface BottomInstructionsProps {
  roomLink: string
}

export const BottomInstructions: React.FC<BottomInstructionsProps> = ({ roomLink }) => {
  return (
    <div className="w-full px-4 py-6 flex gap-4 items-start border-t border-[#F5F5F5]">
      <div className="flex flex-col items-center shrink-0">
        <div className="w-24 h-24 bg-white p-1 rounded-lg border border-[#E5E5E5] flex items-center justify-center">
          <QRCodeSVG value={roomLink} size={88} />
        </div>
        <span className="text-[12px] text-[#999999] mt-2">maliang.com</span>
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
