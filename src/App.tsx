import { useState, useCallback, useEffect, useRef } from 'react'
import { FireCanvas } from './fire/FireCanvas'
import type { FireState, LogState } from './fire/FireEngine'
import { usePeer } from './p2p/usePeer'
import { generateRoomId, getRoomIdFromUrl, buildInviteUrl } from './p2p/roomId'
import { InviteModal } from './components/InviteModal'
import './App.css'

const BROADCAST_INTERVAL = 100  // ms
const LOG_LIFETIME = 180         // seconds per log
const COOLDOWN_MS = 60_000       // 1 minute cooldown

function createLog(existingLogs: LogState[]): LogState {
  const activeLogs = existingLogs.filter(l => l.age < 0.85)
  const pileLevel = activeLogs.length
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    relX: (Math.random() - 0.5) * 0.12,
    relY: 0.006 + pileLevel * 0.024,
    angle: (Math.random() - 0.5) * 0.5,
    age: 0,
    lifetime: LOG_LIFETIME,
  }
}

function App() {
  const roomIdFromUrl = getRoomIdFromUrl()
  const isHost = roomIdFromUrl === null
  const [hostRoomId] = useState(() => isHost ? generateRoomId() : null)
  const roomId = isHost ? hostRoomId : roomIdFromUrl

  const [fireState, setFireState] = useState<FireState>({
    intensity: 0.1,
    elapsed: 0,
    logs: [],
  })
  const fireStateRef = useRef<FireState>(fireState)

  const [showInvite, setShowInvite] = useState(false)
  const [logAnimation, setLogAnimation] = useState(false)
  const [cooldownEnd, setCooldownEnd] = useState(0)
  const [cooldownRemaining, setCooldownRemaining] = useState(0)

  // Update cooldown countdown every 100ms
  useEffect(() => {
    const id = setInterval(() => {
      setCooldownRemaining(Math.max(0, Math.ceil((cooldownEnd - Date.now()) / 1000)))
    }, 100)
    return () => clearInterval(id)
  }, [cooldownEnd])

  const triggerLogAnimation = () => {
    setLogAnimation(true)
    setTimeout(() => setLogAnimation(false), 600)
  }

  const handleGuestAction = useCallback(() => {
    setFireState((prev) => {
      const newLog = createLog(prev.logs)
      const next = { ...prev, logs: [...prev.logs, newLog] }
      fireStateRef.current = next
      return next
    })
    triggerLogAnimation()
  }, [])

  const { role, peerId, guestCount, error, broadcastState, sendAction } = usePeer({
    roomId: isHost ? null : roomId,
    onStateUpdate: isHost ? undefined : (state) =>
      setFireState({ ...state, logs: state.logs ?? [] }),
    onGuestAction: isHost ? handleGuestAction : undefined,
  })

  // Host loop: age logs + derive intensity + broadcast
  useEffect(() => {
    if (!isHost) return
    let lastBroadcast = 0
    let animId: number
    let lastTime = performance.now()

    const loop = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05)
      lastTime = now

      setFireState((prev) => {
        const updatedLogs = prev.logs
          .map(log => ({ ...log, age: Math.min(1, log.age + dt / log.lifetime) }))
          .filter(log => log.age < 1)

        const target = 0.05 + updatedLogs.reduce((sum, log) => {
          return sum + Math.max(0, 1 - log.age * 1.4) * 0.32
        }, 0)
        const newIntensity = prev.intensity + (Math.max(0.05, Math.min(1, target)) - prev.intensity) * 0.04

        const next: FireState = {
          intensity: newIntensity,
          elapsed: prev.elapsed + dt,
          logs: updatedLogs,
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

  const handleAddLog = useCallback(() => {
    if (Date.now() < cooldownEnd) return
    setCooldownEnd(Date.now() + COOLDOWN_MS)

    if (isHost) {
      setFireState((prev) => {
        const newLog = createLog(prev.logs)
        const next = { ...prev, logs: [...prev.logs, newLog] }
        fireStateRef.current = next
        return next
      })
    } else {
      sendAction({ type: 'addLog' })
    }
    triggerLogAnimation()
  }, [isHost, sendAction, cooldownEnd])

  const inviteUrl = roomId ? buildInviteUrl(isHost ? hostRoomId! : roomId) : ''

  const statusLabel = () => {
    if (error) return `エラー: ${error}`
    if (!peerId) return '接続中…'
    if (role === 'host') return guestCount > 0 ? `${guestCount}人が参加中` : '一人でたきび中'
    return guestCount > 0 ? 'ホストと接続済み' : 'ホストを探しています…'
  }

  const logCount = fireState.logs.filter(l => l.age < 0.9).length

  return (
    <div className="app">
      <div className="canvas-area">
        <FireCanvas fireState={fireState} className="fire-canvas" />
        <div className="room-status">
          <span className="room-badge">{statusLabel()}</span>
        </div>
        {logCount > 0 && (
          <div className="log-count-badge">🪵 ×{logCount}</div>
        )}
        {logAnimation && <div className="log-flash" />}
      </div>

      <div className="action-area">
        <div className="action-title">みんなでたきび</div>

        <button
          className={[
            'btn-log',
            logAnimation ? 'btn-log--active' : '',
            cooldownRemaining > 0 ? 'btn-log--cooldown' : '',
          ].filter(Boolean).join(' ')}
          style={cooldownRemaining > 0
            ? { '--cd-progress': `${((COOLDOWN_MS - cooldownRemaining * 1000) / COOLDOWN_MS * 100).toFixed(1)}%` } as React.CSSProperties
            : undefined}
          onClick={handleAddLog}
          disabled={!peerId || cooldownRemaining > 0}
        >
          {cooldownRemaining > 0
            ? `くべる準備中… ${cooldownRemaining}秒`
            : '薪をくべる 🪵'}
        </button>

        <div className="action-sub">
          {isHost && (
            <button className="btn-invite" onClick={() => setShowInvite(true)} disabled={!peerId}>
              招待URLを表示 📋
            </button>
          )}
        </div>

        <div className="intensity-bar-wrap">
          <div className="intensity-bar" style={{ width: `${fireState.intensity * 100}%` }} />
        </div>
      </div>

      {showInvite && inviteUrl && (
        <InviteModal url={inviteUrl} onClose={() => setShowInvite(false)} />
      )}
    </div>
  )
}

export default App
