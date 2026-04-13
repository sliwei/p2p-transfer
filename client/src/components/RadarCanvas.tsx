import { useEffect, useRef } from 'react'

export const RadarCanvas: React.FC<{ animate: boolean }> = ({ animate: shouldAnimate }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const requestRef = useRef<number>()
  const shouldAnimateRef = useRef(shouldAnimate)

  useEffect(() => {
    shouldAnimateRef.current = shouldAnimate
  }, [shouldAnimate])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let w = 0
    let h = 0
    let x0 = 0
    let y0 = 0
    let dw = 0

    const speed = 0.5
    const fps = 60
    const baseColor = '220, 220, 220' // #DCDCDC in rgb, slightly darker than F0F0F0 to be visible
    const baseOpacity = 1

    const resize = () => {
      w = window.innerWidth
      h = window.innerHeight

      // Handle high DPI displays
      const dpr = window.devicePixelRatio || 1
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.scale(dpr, dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`

      x0 = w / 2
      y0 = h * 0.6
      dw = Math.round(Math.min(Math.max(0.6 * w, h)) / 10)
    }

    resize()
    window.addEventListener('resize', resize)

    const drawCircle = (radius: number) => {
      ctx.lineWidth = 1

      let opacity = Math.max(0, baseOpacity * (1 - (1.2 * radius) / Math.max(w, h)))
      if (radius > dw * 7) {
        opacity *= (8 * dw - radius) / dw
      }

      ctx.strokeStyle = `rgba(${baseColor}, ${opacity})`
      ctx.beginPath()
      ctx.arc(x0, y0, radius, 0, 2 * Math.PI)
      ctx.stroke()
    }

    let startTime = Date.now()
    let currentFrame = 0

    const animate = () => {
      const now = Date.now()
      
      if (shouldAnimateRef.current) {
        const timeSinceStart = (now - startTime) % (1000 / speed)
        currentFrame = Math.trunc((fps * timeSinceStart) / 1000)
      } else {
        // When paused, keep startTime advancing so it doesn't jump when resumed
        startTime = now - (currentFrame * 1000) / fps
      }

      ctx.clearRect(0, 0, w, h)

      // Draw center background
      ctx.fillStyle = '#FFFFFF'
      ctx.beginPath()
      ctx.arc(x0, y0, dw * 0.5 + 33, 0, 2 * Math.PI)
      ctx.fill()

      for (let i = 7; i >= 0; i--) {
        drawCircle(dw * i + (speed * dw * currentFrame) / fps + 33)
      }

      requestRef.current = requestAnimationFrame(animate)
    }

    requestRef.current = requestAnimationFrame(animate)

    return () => {
      window.removeEventListener('resize', resize)
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current)
      }
    }
  }, [])

  // Safari 对视口边缘的 fixed 采样 background；canvas 上灰线会令顶/底栏发灰，故白底 fixed 壳 + absolute 画布。
  return (
    <div className="fixed inset-0 z-0 bg-white pointer-events-none">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
    </div>
  )
}
