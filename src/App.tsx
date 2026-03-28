import { useState, useCallback, useEffect, useRef } from 'react'
import { FireCanvas } from './fire/FireCanvas'
import type { FireState, LogState } from './fire/FireEngine'
import { usePeer } from './p2p/usePeer'
import { getRoomIdFromUrl, buildInviteUrl } from './p2p/roomId'
import { InviteModal } from './components/InviteModal'
import './App.css'

const BROADCAST_INTERVAL = 100
const LOG_LIFETIME = 180
const GOLDEN_LIFETIME = 300  // golden logs burn longer
const COOLDOWN_MS = 60_000
const MAX_LOGS = 15
const LOG_SLOT_H = 0.024  // relY per slot

// 火力別の擬音（low: <0.25 / mid: 0.25〜0.6 / high: >0.6）
const FIRE_SOUNDS = {
  low:  ['ゆらゆら…', 'ほのか…', 'ぬくぬく…', 'しずか…', 'ちろちろ…'],
  mid:  ['チリチリ…', 'ポッ', 'パッ', 'しゅ…', 'ちりちり…'],
  high: ['パチパチ！', 'バチッ！', 'ボッ！', 'パッパッ！', 'バチバチ！'],
}
const EMOTES = ['🔥', '❤️', '✨', '👏', '😊', '🌸']

interface Bubble {
  id: string
  text: string
  x: number      // % from left within canvas-area
  startY: number // % from bottom within canvas-area
  type: 'sound' | 'emote'
}

function createLog(existingLogs: LogState[], golden = false): LogState {
  const activeLogs = existingLogs.filter(l => l.age < 0.85)
  const slot = Math.min(activeLogs.length, MAX_LOGS - 1)
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    relX: (Math.random() - 0.5) * 0.12,
    relY: 0.006 + slot * LOG_SLOT_H,
    angle: (Math.random() - 0.5) * 0.5,
    age: 0,
    lifetime: golden ? GOLDEN_LIFETIME : LOG_LIFETIME,
    golden,
  }
}

// Reassign log positions so upper logs fall down when lower ones burn away
function resettleLogs(logs: LogState[]): LogState[] {
  const sorted = [...logs].sort((a, b) => a.relY - b.relY)
  return sorted.map((log, i) => ({ ...log, relY: 0.006 + i * LOG_SLOT_H }))
}

function App() {
  const roomIdFromUrl = getRoomIdFromUrl()
  const isHost = roomIdFromUrl === null
  const roomId = roomIdFromUrl

  const [fireState, setFireState] = useState<FireState>({ intensity: 0.1, elapsed: 0, logs: [] })
  const fireStateRef = useRef<FireState>(fireState)

  const [showInvite, setShowInvite] = useState(false)
  const [logAnimation, setLogAnimation] = useState(false)
  const [cooldownEnd, setCooldownEnd] = useState(0)
  const [cooldownRemaining, setCooldownRemaining] = useState(0)
  const [bubbles, setBubbles] = useState<Bubble[]>([])

  // Cooldown countdown
  useEffect(() => {
    const id = setInterval(() => {
      setCooldownRemaining(Math.max(0, Math.ceil((cooldownEnd - Date.now()) / 1000)))
    }, 100)
    return () => clearInterval(id)
  }, [cooldownEnd])

  // Add a floating bubble
  const addBubble = useCallback((text: string, x: number, startY: number, type: Bubble['type']) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    setBubbles(prev => [...prev, { id, text, x, startY, type }])
    setTimeout(() => setBubbles(prev => prev.filter(b => b.id !== id)), 3200)
  }, [])

  // Fire sound bubbles（頻度低め：4〜9秒ごと、火力に応じてワード変化）
  useEffect(() => {
    let tid: ReturnType<typeof setTimeout>
    const schedule = () => {
      tid = setTimeout(() => {
        const intensity = fireStateRef.current.intensity
        if (intensity > 0.12) {
          const pool = intensity > 0.6 ? FIRE_SOUNDS.high
                     : intensity > 0.25 ? FIRE_SOUNDS.mid
                     : FIRE_SOUNDS.low
          addBubble(
            pool[Math.floor(Math.random() * pool.length)],
            22 + Math.random() * 56,
            12 + Math.random() * 10,
            'sound'
          )
        }
        schedule()
      }, 4000 + Math.random() * 5000)
    }
    schedule()
    return () => clearTimeout(tid)
  }, [addBubble])

  const triggerLogAnimation = () => {
    setLogAnimation(true)
    setTimeout(() => setLogAnimation(false), 600)
  }

  const handleGuestAction = useCallback(() => {
    const activeLogs = fireStateRef.current.logs.filter(l => l.age < 0.85)
    if (activeLogs.length >= MAX_LOGS) return
    const golden = Math.random() < 0.15
    if (golden) addBubble('✨ ゴールデン薪！', 30 + Math.random() * 40, 22, 'emote')
    setFireState((prev) => {
      const newLog = createLog(prev.logs, golden)
      const next = { ...prev, logs: [...prev.logs, newLog] }
      fireStateRef.current = next
      return next
    })
    triggerLogAnimation()
  }, [addBubble])

  const handleIncomingEmote = useCallback((emoji: string) => {
    addBubble(emoji, 20 + Math.random() * 60, 14 + Math.random() * 12, 'emote')
  }, [addBubble])

  const { role, peerId, guestCount, error, broadcastState, broadcastEmote, sendAction } = usePeer({
    roomId: isHost ? null : roomId,
    onStateUpdate: isHost ? undefined : (state) =>
      setFireState({ ...state, logs: state.logs ?? [] }),
    onGuestAction: isHost ? handleGuestAction : undefined,
    onEmote: handleIncomingEmote,
  })

  // Host loop
  useEffect(() => {
    if (!isHost) return
    let lastBroadcast = 0
    let animId: number
    let lastTime = performance.now()

    const loop = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05)
      lastTime = now

      setFireState((prev) => {
        const rawUpdated = prev.logs
          .map(log => ({ ...log, age: Math.min(1, log.age + dt / log.lifetime) }))
          .filter(log => log.age < 1)
        // Resettle upper logs when lower ones burn away
        const updatedLogs = rawUpdated.length < prev.logs.length
          ? resettleLogs(rawUpdated)
          : rawUpdated
        const target = 0.05 + updatedLogs.reduce((sum, log) =>
          sum + Math.max(0, 1 - log.age * 1.4) * (log.golden ? 0.50 : 0.32), 0)
        const newIntensity = prev.intensity + (Math.max(0.05, Math.min(1, target)) - prev.intensity) * 0.04
        const next: FireState = { intensity: newIntensity, elapsed: prev.elapsed + dt, logs: updatedLogs }
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
    const activeLogs = fireStateRef.current.logs.filter(l => l.age < 0.85)
    if (activeLogs.length >= MAX_LOGS) return
    setCooldownEnd(Date.now() + COOLDOWN_MS)
    const golden = Math.random() < 0.15
    if (golden) addBubble('✨ ゴールデン薪！', 30 + Math.random() * 40, 22, 'emote')
    if (isHost) {
      setFireState((prev) => {
        const newLog = createLog(prev.logs, golden)
        const next = { ...prev, logs: [...prev.logs, newLog] }
        fireStateRef.current = next
        return next
      })
    } else {
      sendAction({ type: 'addLog' })
    }
    triggerLogAnimation()
  }, [isHost, sendAction, cooldownEnd, addBubble])

  const handleEmote = useCallback((emoji: string) => {
    // 自分の画面にすぐ表示
    addBubble(emoji, 20 + Math.random() * 60, 14 + Math.random() * 12, 'emote')
    if (isHost) {
      broadcastEmote(emoji)
    } else {
      sendAction({ type: 'emote', emoji })
    }
  }, [isHost, broadcastEmote, sendAction, addBubble])

  const inviteUrl = peerId && isHost ? buildInviteUrl(peerId) : ''
  const activeLogs = fireState.logs.filter(l => l.age < 0.9)
  const logCount = activeLogs.length
  const goldenCount = activeLogs.filter(l => l.golden).length
  const atMaxLogs = logCount >= MAX_LOGS

  const statusLabel = () => {
    if (error) return `エラー: ${error}`
    if (!peerId) return '接続中…'
    if (role === 'host') return guestCount > 0 ? `${guestCount}人が参加中` : '一人でたきび中'
    return guestCount > 0 ? 'ホストと接続済み' : 'ホストを探しています…'
  }

  return (
    <div className="app">
      <div className="canvas-area">
        <FireCanvas fireState={fireState} className="fire-canvas" />

        <div className="room-status">
          <span className="room-badge">{statusLabel()}</span>
        </div>
        {logCount > 0 && (
          <div className="log-count-badge">
            🪵 ×{logCount}{goldenCount > 0 && <span className="golden-badge"> ✨×{goldenCount}</span>}
          </div>
        )}

        {/* 浮かび上がる吹き出し */}
        {bubbles.map(b => (
          <div
            key={b.id}
            className={`bubble bubble--${b.type}`}
            style={{ left: `${b.x}%`, bottom: `${b.startY}%` }}
          >
            {b.text}
          </div>
        ))}

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
          disabled={!peerId || cooldownRemaining > 0 || atMaxLogs}
        >
          {atMaxLogs && cooldownRemaining <= 0
            ? `薪いっぱい！ 🪵×${MAX_LOGS}`
            : cooldownRemaining > 0
            ? `くべる準備中… ${cooldownRemaining}秒`
            : '薪をくべる 🪵'}
        </button>

        {/* エモートボタン */}
        <div className="emote-row">
          {EMOTES.map(emoji => (
            <button
              key={emoji}
              className="btn-emote"
              onClick={() => handleEmote(emoji)}
              disabled={!peerId}
              aria-label={emoji}
            >
              {emoji}
            </button>
          ))}
        </div>

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
