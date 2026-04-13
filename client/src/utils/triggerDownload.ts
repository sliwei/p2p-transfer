/**
 * 浏览器内保存 Blob：延后 revoke；仅在手机上尝试 Web Share；桌面只用 <a download>，避免 share 弹层或误开新窗口。
 */
function sanitizeFilename(name: string): string {
  const trimmed = name.trim().replace(/[/\\?%*:|"<>]/g, '_')
  return trimmed.slice(0, 200) || 'download'
}

/** 桌面端 Chrome/Edge 也有 navigator.share，会弹出分享 UI；只在典型移动环境使用 */
function shouldUseWebShare(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  if (/iP(ad|hone|od)/.test(ua)) return true
  if (/Android/i.test(ua) && /Mobile/i.test(ua)) return true
  return false
}

function openWithAnchor(url: string, safeName: string, revokeLater: () => void): void {
  const a = document.createElement('a')
  a.href = url
  a.download = safeName
  a.style.display = 'none'
  a.rel = 'noopener'
  document.body.appendChild(a)
  try {
    a.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, view: window })
    )
  } catch {
    a.click()
  }
  window.setTimeout(() => {
    document.body.removeChild(a)
  }, 100)
  revokeLater()
}

export function triggerBrowserDownload(blob: Blob, filename: string): void {
  const safeName = sanitizeFilename(filename)
  const url = URL.createObjectURL(blob)
  const revokeLater = () => {
    window.setTimeout(() => URL.revokeObjectURL(url), 3000)
  }

  const file = new File([blob], safeName, {
    type: blob.type || 'application/octet-stream',
  })

  if (shouldUseWebShare() && typeof navigator.share === 'function') {
    const canTry =
      typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] })
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
