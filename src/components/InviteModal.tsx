import { useEffect, useRef } from 'react'
import QRCode from 'qrcode'

interface Props {
  url: string
  onClose: () => void
}

export function InviteModal({ url, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, url, { width: 220, margin: 2 })
    }
  }, [url])

  const copyUrl = () => {
    navigator.clipboard.writeText(url).catch(() => {})
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">友達を招待</h2>
        <canvas ref={canvasRef} className="modal-qr" />
        <p className="modal-url-label">またはURLをコピー</p>
        <div className="modal-url-row">
          <span className="modal-url-text">{url}</span>
          <button className="btn-copy" onClick={copyUrl}>コピー</button>
        </div>
        <button className="btn-close-modal" onClick={onClose}>閉じる</button>
      </div>
    </div>
  )
}
