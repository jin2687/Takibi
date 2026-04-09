import { useState, useCallback, useEffect, useRef } from 'react'
import { FireCanvas } from './fire/FireCanvas'
import type { FireState, LogState } from './fire/FireEngine'
import { usePeer } from './p2p/usePeer'
import { getRoomIdFromUrl, buildInviteUrl } from './p2p/roomId'
import { InviteModal } from './components/InviteModal'
import { Shop } from './components/Shop'
import {
  DEFAULT_UPGRADES, calcEmberRate, effectiveCooldown,
  effectiveMaxLogs, goldenChance, logLifetimeMult, calcEra,
  ERA_NAMES, ERA_COLORS,
} from './game/economy'
import type { UpgradeLevels } from './fire/FireEngine'
import { UPGRADES, upgradeCost } from './game/economy'
import './App.css'

const BROADCAST_INTERVAL = 100
const LOG_LIFETIME_BASE = 180
const COOLDOWN_MS_BASE = 60_000
const MAX_LOGS_BASE = 20
const LOG_SLOT_H = 0.024
const COOP_BONUS_DURATION = 120_000  // 2分
const COOP_WINDOW = 30_000           // 30秒以内に別の人もくべたら発動

const FIRE_SOUNDS = {
  low:  ['ゆらゆら…', 'ほのか…', 'ぬくぬく…', 'しずか…', 'ちろちろ…'],
  mid:  ['チリチリ…', 'ポッ', 'パッ', 'しゅ…', 'ちりちり…'],
  high: ['パチパチ！', 'バチッ！', 'ボッ！', 'パッパッ！', 'バチバチ！'],
}
const EMOTES = ['🔥', '❤️', '✨', '👏', '😊', '🌸']

const INITIAL_STATE: FireState = {
  intensity: 0.1, elapsed: 0, logs: [],
  embers: 0, totalEmbers: 0,
  upgrades: DEFAULT_UPGRADES,
  coopBonusMult: 1, coopBonusEnd: 0,
}

interface Bubble {
  id: string; text: string
  x: number; startY: number
  type: 'sound' | 'emote'
}

function createLog(existingLogs: LogState[], upgrades: UpgradeLevels, golden = false): LogState {
  const activeLogs = existingLogs.filter(l => l.age < 0.85)
  const maxLogs = effectiveMaxLogs(MAX_LOGS_BASE, upgrades)
  const slot = Math.min(activeLogs.length, maxLogs - 1)
  const lifetime = LOG_LIFETIME_BASE * logLifetimeMult(upgrades) * (golden ? 1.67 : 1)
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    relX: (Math.random() - 0.5) * 0.12,
    relY: 0.006 + slot * LOG_SLOT_H,
    angle: (Math.random() - 0.5) * 0.5,
    age: 0,
    lifetime,
    golden,
  }
}

function resettleLogs(logs: LogState[]): LogState[] {
  const sorted = [...logs].sort((a, b) => a.relY - b.relY)
  return sorted.map((log, i) => ({ ...log, relY: 0.006 + i * LOG_SLOT_H }))
}

function App() {
  const roomIdFromUrl = getRoomIdFromUrl()
  const isHost = roomIdFromUrl === null
  const roomId = roomIdFromUrl

  const [fireState, setFireState] = useState<FireState>(INITIAL_STATE)
  const fireStateRef = useRef<FireState>(INITIAL_STATE)

  const [showInvite, setShowInvite] = useState(false)
  const [showShop, setShowShop] = useState(false)
  const [logAnimation, setLogAnimation] = useState(false)
  const [cooldownEnd, setCooldownEnd] = useState(0)
  const [cooldownRemaining, setCooldownRemaining] = useState(0)
  const [bubbles, setBubbles] = useState<Bubble[]>([])

  // Track guest count in ref for host loop
  const guestCountRef = useRef(0)
  // Track last log add time for coop bonus
  const lastLogTimeRef = useRef(0)
  // Track previous era for era-up notification
  const prevEraRef = useRef(1)

  // Cooldown countdown
  useEffect(() => {
    const id = setInterval(() => {
      setCooldownRemaining(Math.max(0, Math.ceil((cooldownEnd - Date.now()) / 1000)))
    }, 100)
    return () => clearInterval(id)
  }, [cooldownEnd])

  const addBubble = useCallback((text: string, x: number, startY: number, type: Bubble['type']) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    setBubbles(prev => [...prev, { id, text, x, startY, type }])
    setTimeout(() => setBubbles(prev => prev.filter(b => b.id !== id)), 3200)
  }, [])

  // Fire sound bubbles
  useEffect(() => {
    let tid: ReturnType<typeof setTimeout>
    const schedule = () => {
      tid = setTimeout(() => {
        const intensity = fireStateRef.current.intensity
        if (intensity > 0.12) {
          const pool = intensity > 0.6 ? FIRE_SOUNDS.high
                     : intensity > 0.25 ? FIRE_SOUNDS.mid
                     : FIRE_SOUNDS.low
          addBubble(pool[Math.floor(Math.random() * pool.length)], 22 + Math.random() * 56, 12 + Math.random() * 10, 'sound')
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

  // Check and trigger coop bonus when a log is added
  const checkCoopBonus = useCallback(() => {
    if (guestCountRef.current <= 0) return
    const now = Date.now()
    if (lastLogTimeRef.current > 0 && now - lastLogTimeRef.current < COOP_WINDOW) {
      setFireState(prev => {
        const next = { ...prev, coopBonusMult: 2, coopBonusEnd: now + COOP_BONUS_DURATION }
        fireStateRef.current = next
        return next
      })
      addBubble('🤝 協力ボーナス！×2', 50, 25, 'emote')
    }
    lastLogTimeRef.current = now
  }, [addBubble])

  const handleBuyUpgrade = useCallback((upgradeId: keyof UpgradeLevels) => {
    if (!isHost) {
      sendActionRef.current({ type: 'buyUpgrade', upgradeId })
      return
    }
    setFireState(prev => {
      const def = UPGRADES.find(u => u.id === upgradeId)!
      const level = prev.upgrades[upgradeId]
      if (level >= def.maxLevel) return prev
      const cost = upgradeCost(def, level)
      if (prev.embers < cost) return prev
      const next = {
        ...prev,
        embers: prev.embers - cost,
        upgrades: { ...prev.upgrades, [upgradeId]: level + 1 },
      }
      fireStateRef.current = next
      return next
    })
  }, [isHost])

  const handleGuestAction = useCallback((
    action: { type: 'addLog' } | { type: 'buyUpgrade'; upgradeId: string },
  ) => {
    if (action.type === 'buyUpgrade') {
      handleBuyUpgrade(action.upgradeId as keyof UpgradeLevels)
      return
    }
    // addLog
    const { upgrades } = fireStateRef.current
    const maxLogs = effectiveMaxLogs(MAX_LOGS_BASE, upgrades)
    const activeLogs = fireStateRef.current.logs.filter(l => l.age < 0.85)
    if (activeLogs.length >= maxLogs) return
    const golden = Math.random() < goldenChance(upgrades)
    if (golden) addBubble('✨ ゴールデン薪！', 30 + Math.random() * 40, 22, 'emote')
    checkCoopBonus()
    setFireState(prev => {
      const newLog = createLog(prev.logs, prev.upgrades, golden)
      const next = { ...prev, logs: [...prev.logs, newLog] }
      fireStateRef.current = next
      return next
    })
    triggerLogAnimation()
  }, [addBubble, checkCoopBonus, handleBuyUpgrade])

  const handleIncomingEmote = useCallback((emoji: string) => {
    addBubble(emoji, 20 + Math.random() * 60, 14 + Math.random() * 12, 'emote')
  }, [addBubble])

  // sendAction ref so handleBuyUpgrade can access it without circular deps
  const sendActionRef = useRef<ReturnType<typeof usePeer>['sendAction']>(() => {})

  const { role, peerId, guestCount, error, broadcastState, broadcastEmote, sendAction } = usePeer({
    roomId: isHost ? null : roomId,
    onStateUpdate: isHost ? undefined : (state) =>
      setFireState({ ...INITIAL_STATE, ...state, logs: state.logs ?? [] }),
    onGuestAction: isHost ? handleGuestAction : undefined,
    onEmote: handleIncomingEmote,
  })

  useEffect(() => { sendActionRef.current = sendAction }, [sendAction])
  useEffect(() => { guestCountRef.current = guestCount }, [guestCount])

  // Host loop: fire physics + economy
  useEffect(() => {
    if (!isHost) return
    let lastBroadcast = 0
    let animId: number
    let lastTime = performance.now()

    const loop = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05)
      lastTime = now

      setFireState(prev => {
        // Tick logs
        const rawUpdated = prev.logs
          .map(log => ({ ...log, age: Math.min(1, log.age + dt / log.lifetime) }))
          .filter(log => log.age < 1)
        const updatedLogs = rawUpdated.length < prev.logs.length
          ? resettleLogs(rawUpdated) : rawUpdated

        // Fire intensity
        const target = 0.05 + updatedLogs.reduce((sum, log) =>
          sum + Math.max(0, 1 - log.age * 1.4) * (log.golden ? 0.50 : 0.32), 0)
        const newIntensity = prev.intensity + (Math.max(0.05, Math.min(1, target)) - prev.intensity) * 0.04

        // Economy: ember accumulation
        const rate = calcEmberRate({ ...prev, intensity: newIntensity }, guestCountRef.current)
        const newEmbers = prev.embers + rate * dt
        const newTotal = prev.totalEmbers + rate * dt

        // Coop bonus expiry
        const coopMult = prev.coopBonusEnd > 0 && Date.now() > prev.coopBonusEnd
          ? 1 : prev.coopBonusMult
        const coopEnd = coopMult === 1 ? 0 : prev.coopBonusEnd

        const next: FireState = {
          intensity: newIntensity,
          elapsed: prev.elapsed + dt,
          logs: updatedLogs,
          embers: newEmbers,
          totalEmbers: newTotal,
          upgrades: prev.upgrades,
          coopBonusMult: coopMult,
          coopBonusEnd: coopEnd,
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

  // Era-up notification
  useEffect(() => {
    const era = calcEra(fireState.totalEmbers)
    if (era > prevEraRef.current) {
      prevEraRef.current = era
      addBubble(`🔥 ${ERA_NAMES[era - 1]} に進化！`, 50, 30, 'emote')
    }
  }, [fireState.totalEmbers, addBubble])

  const handleAddLog = useCallback(() => {
    const { upgrades } = fireStateRef.current
    const cooldownMs = effectiveCooldown(COOLDOWN_MS_BASE, upgrades)
    if (Date.now() < cooldownEnd) return
    const maxLogs = effectiveMaxLogs(MAX_LOGS_BASE, upgrades)
    const activeLogs = fireStateRef.current.logs.filter(l => l.age < 0.85)
    if (activeLogs.length >= maxLogs) return
    setCooldownEnd(Date.now() + cooldownMs)
    const golden = Math.random() < goldenChance(upgrades)
    if (golden) addBubble('✨ ゴールデン薪！', 30 + Math.random() * 40, 22, 'emote')
    checkCoopBonus()
    if (isHost) {
      setFireState(prev => {
        const newLog = createLog(prev.logs, prev.upgrades, golden)
        const next = { ...prev, logs: [...prev.logs, newLog] }
        fireStateRef.current = next
        return next
      })
    } else {
      sendAction({ type: 'addLog' })
    }
    triggerLogAnimation()
  }, [isHost, sendAction, cooldownEnd, addBubble, checkCoopBonus])

  const handleEmote = useCallback((emoji: string) => {
    addBubble(emoji, 20 + Math.random() * 60, 14 + Math.random() * 12, 'emote')
    if (isHost) broadcastEmote(emoji)
    else sendAction({ type: 'emote', emoji })
  }, [isHost, broadcastEmote, sendAction, addBubble])

  const { upgrades } = fireState
  const inviteUrl = peerId && isHost ? buildInviteUrl(peerId) : ''
  const activeLogs = fireState.logs.filter(l => l.age < 0.9)
  const logCount = activeLogs.length
  const goldenCount = activeLogs.filter(l => l.golden).length
  const maxLogs = effectiveMaxLogs(MAX_LOGS_BASE, upgrades)
  const atMaxLogs = logCount >= maxLogs
  const cooldownMs = effectiveCooldown(COOLDOWN_MS_BASE, upgrades)
  const era = calcEra(fireState.totalEmbers)
  const emberRate = calcEmberRate(fireState, guestCount)

  const statusLabel = () => {
    if (error) return `エラー: ${error}`
    if (!peerId) return '接続中…'
    if (role === 'host') return guestCount > 0 ? `${guestCount}人が参加中` : '一人でたきび中'
    return guestCount > 0 ? 'ホストと接続済み' : 'ホストを探しています…'
  }

  function formatEmbers(n: number) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return Math.floor(n).toString()
  }

  return (
    <div className="app">
      <div className="canvas-area">
        <FireCanvas fireState={fireState} className="fire-canvas" />

        <div className="room-status">
          <span className="room-badge">{statusLabel()}</span>
        </div>

        {/* Era badge */}
        <div className="era-badge" style={{ '--era-color': ERA_COLORS[era - 1] } as React.CSSProperties}>
          {ERA_NAMES[era - 1]}
        </div>

        {/* Ember HUD */}
        <div className="ember-hud">
          <span className="ember-hud-count">🌟 {formatEmbers(fireState.embers)}</span>
          <span className="ember-hud-rate">+{emberRate.toFixed(1)}/秒</span>
          {fireState.coopBonusMult > 1 && (
            <span className="ember-hud-coop">🤝×{fireState.coopBonusMult}</span>
          )}
        </div>

        {logCount > 0 && (
          <div className="log-count-badge">
            🪵 ×{logCount}{goldenCount > 0 && <span className="golden-badge"> ✨×{goldenCount}</span>}
          </div>
        )}

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
            ? { '--cd-progress': `${((cooldownMs - cooldownRemaining * 1000) / cooldownMs * 100).toFixed(1)}%` } as React.CSSProperties
            : undefined}
          onClick={handleAddLog}
          disabled={!peerId || cooldownRemaining > 0 || atMaxLogs}
        >
          {atMaxLogs && cooldownRemaining <= 0
            ? `薪いっぱい！ 🪵×${maxLogs}`
            : cooldownRemaining > 0
            ? `くべる準備中… ${cooldownRemaining}秒`
            : '薪をくべる 🪵'}
        </button>

        <div className="emote-row">
          {EMOTES.map(emoji => (
            <button key={emoji} className="btn-emote" onClick={() => handleEmote(emoji)} disabled={!peerId} aria-label={emoji}>
              {emoji}
            </button>
          ))}
        </div>

        <div className="action-sub">
          <button className="btn-shop" onClick={() => setShowShop(true)} disabled={!peerId}>
            🛒 ショップ
          </button>
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

      {showShop && (
        <Shop
          embers={fireState.embers}
          emberRate={emberRate}
          totalEmbers={fireState.totalEmbers}
          upgrades={upgrades}
          coopBonusMult={fireState.coopBonusMult}
          guestCount={guestCount}
          onBuy={handleBuyUpgrade}
          onClose={() => setShowShop(false)}
        />
      )}

      {showInvite && inviteUrl && (
        <InviteModal url={inviteUrl} onClose={() => setShowInvite(false)} />
      )}
    </div>
  )
}

export default App
