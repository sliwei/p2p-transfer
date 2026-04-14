/**
 * 浏览器内保存 Blob：移动端优先 Web Share（便于 Safari「存储到照片」）；桌面用 <a download>。
 * 设备类型用 ua-parser-js，并对 iPad 桌面 UA 等保留触屏兜底。
 */

import { UAParser } from 'ua-parser-js'

export type DownloadItem = {
  blob: Blob
  filename: string
  /** 传输层带来的 MIME，常与 Blob.type 互补（分片拼 Blob 后 type 可能为空） */
  mimeHint?: string
}

function sanitizeFilename(name: string): string {
  const trimmed = name.trim().replace(/[/\\?%*:|"<>]/g, '_')
  return trimmed.slice(0, 200) || 'download'
}

function guessMimeFromFilename(name: string): string {
  const lower = name.toLowerCase()
  const dot = lower.lastIndexOf('.')
  const ext = dot >= 0 ? lower.slice(dot) : ''
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.avif': 'image/avif',
    '.bmp': 'image/bmp',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.m4v': 'video/x-m4v'
  }
  return map[ext] ?? ''
}

function effectiveMimeType(blob: Blob, filename: string, mimeHint?: string): string {
  if (blob.type && blob.type !== 'application/octet-stream') return blob.type
  const hint = mimeHint?.trim()
  if (hint && hint !== 'application/octet-stream') return hint
  const guessed = guessMimeFromFilename(filename)
  return guessed || 'application/octet-stream'
}

function buildShareableFile(item: DownloadItem): File {
  const type = effectiveMimeType(item.blob, item.filename, item.mimeHint)
  return new File([item.blob], item.filename, { type })
}

/** ua-parser 解析结果缓存（同页 UA 不变） */
let cachedUa = ''
let cachedUaResult: ReturnType<UAParser['getResult']> | null = null

/**
 * getResult() 只解析 UA 字符串，桌面/伪装 UA 下 device.type 常为 undefined。
 * withFeatureCheck() 会结合 navigator（userAgentData、iPad standalone +触点数等）补全设备类型。
 */
function getUaResult(): ReturnType<UAParser['getResult']> | null {
  if (typeof navigator === 'undefined') return null
  const ua = navigator.userAgent
  if (ua === cachedUa && cachedUaResult) return cachedUaResult
  cachedUa = ua
  const raw = new UAParser(ua).getResult() as ReturnType<UAParser['getResult']> & {
    withFeatureCheck?: () => ReturnType<UAParser['getResult']>
  }
  cachedUaResult = (typeof raw.withFeatureCheck === 'function' ? raw.withFeatureCheck() : raw) as ReturnType<UAParser['getResult']>
  return cachedUaResult
}

const NON_DESKTOP_DEVICE_TYPES = new Set(['mobile', 'tablet', 'console', 'smarttv', 'wearable', 'embedded', 'xr'])

/**
 * 小米 MIUI 自带浏览器（含手机/平板）常使用 `X11; Linux x86_64` + Chrome 式桌面 UA，
 * 不含 Android/Mobile，ua-parser 会误判为桌面 Linux。
 */
function isXiaomiMiuiBrowserUa(ua: string): boolean {
  return /MiuiBrowser/i.test(ua) || /\bXiaoMi\//i.test(ua)
}

/** 桌面端 Chrome/Edge 也有 navigator.share；手机 / 平板等走 share更合适 */
function shouldUseWebShare(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  if (isXiaomiMiuiBrowserUa(ua)) return true
  const r = getUaResult()
  const dtype = r?.device?.type
  if (dtype === 'mobile' || dtype === 'tablet') return true
  const osName = r?.os?.name ?? ''
  if (osName === 'iOS') return true
  if (osName === 'Android') return true
  if (/iP(ad|hone|od)/i.test(ua)) return true
  if (/Android/i.test(ua) && /Mobile/i.test(ua)) return true
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return true
  return false
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const osName = getUaResult()?.os?.name ?? ''
  if (osName === 'iOS') return true
  if (/iP(ad|hone|od)/i.test(ua)) return true
  if (/iPad/i.test(navigator.platform ?? '')) return true
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return true
  return false
}

/**
 * 传统电脑端浏览器（Windows / macOS / Linux 桌面场景）。
 * 手机、Android 平板、iPad、桌面模式 iPad 等均视为非桌面，批量程序化下载不可靠。
 */
function isDesktopPcBrowser(): boolean {
  if (typeof navigator === 'undefined') return true
  const ua = navigator.userAgent
  if (isXiaomiMiuiBrowserUa(ua)) return false
  const platform = navigator.platform ?? ''
  const r = getUaResult()
  const dtype = r?.device?.type
  /** 纯 UA 解析下 dtype 仍可能为 undefined，下面 os / 触屏 / Android 等会继续兜底 */
  if (dtype && NON_DESKTOP_DEVICE_TYPES.has(dtype)) return false

  const osName = r?.os?.name ?? ''
  if (osName === 'iOS') return false
  if (osName === 'Android') return false

  if (/iP(ad|hone|od)/i.test(ua)) return false
  if (/iPad/i.test(platform)) return false
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return false
  if (platform === 'MacIntel' && navigator.maxTouchPoints > 1) return false
  if (/Android/i.test(ua)) return false
  if (/webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return false
  return true
}

/**
 * 多文件时是否应改为「用户每点一次按钮只触发一次下载」。
 * 非桌面浏览器（含 Android 平板、iPad、手机 WebView）对连点 a[download] / 批量 share 常不稳定。
 */
export function browserNeedsStepwiseMultiDownload(): boolean {
  return !isDesktopPcBrowser()
}

/**
 * 浏览器内（非 App WebView）选「保存到相册」且多文件时，是否应逐步保存。
 * 与 ReceivedFilesModal 的 stepwise 按钮、onDone 中跳过批量 download 的判断保持一致。
 */
export function shouldStepwiseAlbumSaveInBrowser(isNativeEmbedHost: boolean, fileCount: number): boolean {
  return !isNativeEmbedHost && fileCount > 1 && browserNeedsStepwiseMultiDownload()
}

/**
 * Safari 连续 blob 下载易只落最后一个；且 confirm 若在 await/异步回调里再弹出，WebKit 常直接吞掉，后续无提示。
 * 必须在用户每次点「确定」后的同步栈里立刻触发 a[download]，故这里只用同步 for + 阻塞式 confirm。
 */
function runSequentialAnchorWithUserPrompt(items: DownloadItem[]): void {
  for (let i = 0; i < items.length; i++) {
    if (i > 0) {
      if (!window.confirm(`继续下载第 ${i + 1}/${items.length} 个文件？`)) return
    }
    downloadViaBlobAnchor(items[i].blob, items[i].filename, 120_000)
  }
}

function openWithAnchor(url: string, safeName: string, revokeLater: () => void): void {
  const a = document.createElement('a')
  a.href = url
  a.download = safeName
  a.style.display = 'none'
  a.rel = 'noopener'
  document.body.appendChild(a)
  try {
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
  } catch {
    a.click()
  }
  window.setTimeout(() => {
    document.body.removeChild(a)
  }, 100)
  revokeLater()
}

/** 同名文件依次加 (2)、(3)…，避免浏览器只保留一个下载 */
function withUniqueSafeFilenames(items: DownloadItem[]): DownloadItem[] {
  const countBy = new Map<string, number>()
  return items.map((item) => {
    const safe = sanitizeFilename(item.filename)
    const n = (countBy.get(safe) ?? 0) + 1
    countBy.set(safe, n)
    if (n === 1) return { ...item, filename: safe }
    const dot = safe.lastIndexOf('.')
    const nextName = dot <= 0 ? `${safe} (${n})` : `${safe.slice(0, dot)} (${n})${safe.slice(dot)}`
    return { ...item, filename: nextName }
  })
}

function downloadViaBlobAnchor(blob: Blob, safeName: string, revokeAfterMs: number): void {
  const url = URL.createObjectURL(blob)
  const revokeLater = () => {
    window.setTimeout(() => URL.revokeObjectURL(url), revokeAfterMs)
  }
  openWithAnchor(url, safeName, revokeLater)
}

/** 多文件：在用户手势内排期多次点击，减少被浏览器合并或拦截 */
function staggerAnchorDownloads(items: DownloadItem[]): void {
  const gapMs = 320
  const revokeAfterMs = 120_000
  items.forEach((item, index) => {
    window.setTimeout(() => {
      downloadViaBlobAnchor(item.blob, item.filename, revokeAfterMs)
    }, index * gapMs)
  })
}

export function triggerBrowserDownload(blob: Blob, filename: string, mimeHint?: string): void {
  const safeName = sanitizeFilename(filename)
  const url = URL.createObjectURL(blob)
  const revokeLater = () => {
    window.setTimeout(() => URL.revokeObjectURL(url), 3000)
  }

  const mime = effectiveMimeType(blob, safeName, mimeHint)
  const file = new File([blob], safeName, { type: mime })

  if (shouldUseWebShare() && typeof navigator.share === 'function') {
    const canTry = typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] })
    if (canTry) {
      void navigator
        .share({ files: [file] })
        .then(() => {
          revokeLater()
        })
        .catch((err: unknown) => {
          const name = err instanceof DOMException ? err.name : ''
          if (name === 'AbortError') {
            revokeLater()
            return
          }
          openWithAnchor(url, safeName, revokeLater)
        })
      return
    }
  }

  openWithAnchor(url, safeName, revokeLater)
}

export type TriggerBatchOptions = {
  /** 接收方选「相册」：在 iOS 上优先分享进相册，失败则逐张分享而非依赖多次 a[download] */
  albumOriented?: boolean
}

/** 一次保存多份：非桌面环境多文件走同步 confirm 链；桌面可尝试批量 share 或错开 a[download] */
export function triggerBrowserDownloads(items: DownloadItem[], options?: TriggerBatchOptions): void {
  if (items.length === 0) return
  const unique = withUniqueSafeFilenames(items)
  if (unique.length === 1) {
    const one = unique[0]
    triggerBrowserDownload(one.blob, one.filename, one.mimeHint)
    return
  }

  const album = options?.albumOriented === true

  /** 手机 / 平板 / WebView：不批量 share、不短间隔 stagger */
  if (browserNeedsStepwiseMultiDownload()) {
    runSequentialAnchorWithUserPrompt(unique)
    return
  }

  const files = unique.map(buildShareableFile)

  if (shouldUseWebShare() && typeof navigator.share === 'function') {
    const canTry = typeof navigator.canShare !== 'function' || navigator.canShare({ files })
    if (canTry) {
      void navigator.share({ files }).catch((err: unknown) => {
        const name = err instanceof DOMException ? err.name : ''
        if (name === 'AbortError') return
        if (album && isIOS()) runSequentialAnchorWithUserPrompt(unique)
        else staggerAnchorDownloads(unique)
      })
      return
    }
  }

  if (album && isIOS()) {
    runSequentialAnchorWithUserPrompt(unique)
    return
  }

  staggerAnchorDownloads(unique)
}
