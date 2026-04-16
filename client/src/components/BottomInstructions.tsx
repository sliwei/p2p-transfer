import { QRCodeSVG } from 'qrcode.react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { copyToClipboard } from '../utils/copyToClipboard'

interface BottomInstructionsProps {
  roomLink: string
}

type ShortUrlApiBody = {
  code?: number
  data?: { shortUrl?: string; qrcodeUrl?: string }
}

const MALIANG_SHORT_URL_API_ORIGIN = import.meta.env.MODE === 'live' ? 'https://api.maliang.miaobi.cn' : 'https://api-test.maliang.miaobi.cn'

function withoutHttpScheme(url: string): string {
  return url.replace(/^https?:\/\//i, '')
}

export const BottomInstructions: React.FC<BottomInstructionsProps> = ({ roomLink }) => {
  const [qrcodeUrl, setQrcodeUrl] = useState<string | null>(null)
  const [shortUrl, setShortUrl] = useState<string | null>(null)
  const [qrLoading, setQrLoading] = useState(false)

  useEffect(() => {
    if (!roomLink) {
      setQrcodeUrl(null)
      setShortUrl(null)
      return
    }
    const ac = new AbortController()
    setQrLoading(true)
    setQrcodeUrl(null)
    setShortUrl(null)
    ;(async () => {
      try {
        const r = await fetch(`${MALIANG_SHORT_URL_API_ORIGIN}/v1/magic-drop/anon/short-url`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ url: roomLink }).toString(),
          signal: ac.signal
        })
        let body: ShortUrlApiBody & { error?: string }
        try {
          body = (await r.json()) as ShortUrlApiBody & { error?: string }
        } catch {
          throw new Error(`HTTP ${r.status}`)
        }
        if (!r.ok) {
          throw new Error(body.error || `HTTP ${r.status}`)
        }
        if (body.code === 200 && body.data?.qrcodeUrl) {
          setQrcodeUrl(body.data.qrcodeUrl)
          if (body.data.shortUrl) setShortUrl(body.data.shortUrl)
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        console.warn('[BottomInstructions] short-url:', e)
      } finally {
        if (!ac.signal.aborted) setQrLoading(false)
      }
    })()
    return () => ac.abort()
  }, [roomLink])

  const linkToCopy = shortUrl || roomLink

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
          {qrcodeUrl ? <img src={qrcodeUrl} alt="" className="max-w-[88px] max-h-[88px] w-full h-full object-contain" /> : <QRCodeSVG value={roomLink} size={88} />}
        </div>
        {qrLoading ? (
          <span className="text-[12px] text-[#999999] mt-2">二维码加载中…</span>
        ) : (
          <span className="text-[12px] text-[#999999] mt-2 block max-w-[140px] truncate" title={withoutHttpScheme(shortUrl || roomLink)}>
            {withoutHttpScheme(shortUrl || roomLink)}
          </span>
        )}
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
