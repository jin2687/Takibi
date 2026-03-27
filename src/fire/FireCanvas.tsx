import { useEffect, useRef, useCallback } from 'react'
import { FireEngine } from './FireEngine'
import type { FireState } from './FireEngine'

interface Props {
  fireState: FireState
  onFrame?: (state: FireState) => void
  className?: string
}

export function FireCanvas({ fireState, onFrame, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<FireEngine | null>(null)
  const stateRef = useRef<FireState>(fireState)
  const rafRef = useRef<number>(0)

  // 外部から最新 state を注入（RAF ループ内で参照）
  useEffect(() => {
    stateRef.current = fireState
  }, [fireState])

  const startLoop = useCallback((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d')!
    if (!engineRef.current) {
      engineRef.current = new FireEngine()
    }
    const engine = engineRef.current

    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio
      canvas.height = canvas.offsetHeight * window.devicePixelRatio
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
    }
    resize()

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    let last = performance.now()

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now

      const logicalW = canvas.offsetWidth
      const logicalH = canvas.offsetHeight

      engine.update(dt, stateRef.current, logicalW, logicalH)
      engine.draw(ctx, logicalW, logicalH)

      onFrame?.(stateRef.current)
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
    }
  }, [onFrame])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    return startLoop(canvas)
  }, [startLoop])

  return <canvas ref={canvasRef} className={className} />
}
