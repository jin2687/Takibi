import { useState, useCallback, useEffect, useRef } from 'react'
import { FireCanvas } from './fire/FireCanvas'
import type { FireState } from './fire/FireEngine'
import { usePeer } from './p2p/usePeer'
import { generateRoomId, getRoomIdFromUrl, buildInviteUrl } from './p2p/roomId'
import { InviteModal } from './components/InviteModal'
import './App.css'

// ホスト側パラメータ
const BROADCAST_INTERVAL = 100  // ms
const DECAY_RATE = 0.04          // 毎秒火力が落ちる量
const LOG_BOOST = 0.25           // 薪1本あたりの火力増加量

function App() {
  const roomIdFromUrl = getRoomIdFromUrl()
  const isHost = roomIdFromUrl === null

  // ホストが持つルームID（ゲストは roomIdFromUrl を使う）
  const [hostRoomId] = useState(() => isHost ? generateRoomId() : null)
  const roomId = isHost ? hostRoomId : roomIdFromUrl

  // 焚き火状態（ホストのみ書き換える。ゲストはホストから受信）
  const [fireState, setFireState] = useState<FireState>({ intensity: 0.3, elapsed: 0 })
  const fireStateRef = useRef<FireState>(fireState)

  const [showInvite, setShowInvite] = useState(false)
  const [logAnimation, setLogAnimation] = useState(false)

  // ゲストがアクションを受け取ったときの処理
  const handleGuestAction = useCallback(() => {
    // 薪追加
    setFireState((prev) => {
      const next = { ...prev, intensity: Math.min(1, prev.intensity + LOG_BOOST) }
      fireStateRef.current = next
      return next
    })
    triggerLogAnimation()
  }, [])

  const { role, peerId, guestCount, error, broadcastState, sendAction } = usePeer({
    roomId: isHost ? null : roomId,
    onStateUpdate: isHost ? undefined : setFireState,
    onGuestAction: isHost ? handleGuestAction : undefined,
  })

  // ホスト: 時間経過で火力を減衰し、定期的にゲストへ配信
  useEffect(() => {
    if (!isHost) return

    let lastBroadcast = 0
    let animId: number
    let lastTime = performance.now()

    const loop = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05)
      lastTime = now

      setFireState((prev) => {
        const next: FireState = {
          intensity: Math.max(0.05, prev.intensity - DECAY_RATE * dt),
          elapsed: prev.elapsed + dt,
        }
        fireStateRef.current = next
        return next
      })

      if (now - lastBroadcast > BROADCAST_INTERVAL) {
        broadcastState(fireStateRef.current)
        lastBroadcast = now
      }

      animId = requestAnimationFrame(loop)
    }

    animId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(animId)
  }, [isHost, broadcastState])

  const triggerLogAnimation = () => {
    setLogAnimation(true)
    setTimeout(() => setLogAnimation(false), 600)
  }

  const handleAddLog = useCallback(() => {
    if (isHost) {
      setFireState((prev) => {
        const next = { ...prev, intensity: Math.min(1, prev.intensity + LOG_BOOST) }
        fireStateRef.current = next
        return next
      })
      triggerLogAnimation()
    } else {
      sendAction({ type: 'addLog' })
      triggerLogAnimation()
    }
  }, [isHost, sendAction])

  const inviteUrl = roomId ? buildInviteUrl(isHost ? hostRoomId! : roomId) : ''

  const statusLabel = () => {
    if (error) return `エラー: ${error}`
    if (!peerId) return '接続中…'
    if (role === 'host') {
      return guestCount > 0 ? `${guestCount}人が参加中` : '一人でたきび中'
    }
    return guestCount > 0 ? 'ホストと接続済み' : 'ホストを探しています…'
  }

  return (
    <div className="app">
      {/* 上部：焚き火Canvas領域 */}
      <div className="canvas-area">
        <FireCanvas fireState={fireState} className="fire-canvas" />
        <div className="room-status">
          <span className="room-badge">{statusLabel()}</span>
        </div>
        {/* 薪追加時のフラッシュ */}
        {logAnimation && <div className="log-flash" />}
      </div>

      {/* 下部：アクション領域 */}
      <div className="action-area">
        <div className="action-title">みんなでたきび</div>
        <button
          className={`btn-log${logAnimation ? ' btn-log--active' : ''}`}
          onClick={handleAddLog}
          disabled={!peerId}
        >
          薪をくべる 🪵
        </button>
        <div className="action-sub">
          {isHost && (
            <button
              className="btn-invite"
              onClick={() => setShowInvite(true)}
              disabled={!peerId}
            >
              招待URLを表示 📋
            </button>
          )}
        </div>
        <div className="intensity-bar-wrap">
          <div
            className="intensity-bar"
            style={{ width: `${fireState.intensity * 100}%` }}
          />
        </div>
      </div>

      {showInvite && inviteUrl && (
        <InviteModal url={inviteUrl} onClose={() => setShowInvite(false)} />
      )}
    </div>
  )
}

export default App
