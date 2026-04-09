import { useEffect, useRef, useState, useCallback } from 'react'
import Peer from 'peerjs'
import type { DataConnection } from 'peerjs'
import type { FireState } from '../fire/FireEngine'

export type Role = 'host' | 'guest' | 'idle'

export type GuestMessage =
  | { type: 'addLog' }
  | { type: 'emote'; emoji: string }
  | { type: 'buyUpgrade'; upgradeId: string }

export type HostMessage =
  | { type: 'state'; payload: FireState }
  | { type: 'emote'; emoji: string }

interface UsePeerOptions {
  roomId: string | null
  onStateUpdate?: (state: FireState) => void
  onGuestAction?: (action: { type: 'addLog' } | { type: 'buyUpgrade'; upgradeId: string }, connId: string) => void
  onEmote?: (emoji: string) => void
}

export function usePeer({ roomId, onStateUpdate, onGuestAction, onEmote }: UsePeerOptions) {
  const [role, setRole] = useState<Role>('idle')
  const [peerId, setPeerId] = useState<string | null>(null)
  const [guestCount, setGuestCount] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const peerRef = useRef<Peer | null>(null)
  const connectionsRef = useRef<Map<string, DataConnection>>(new Map())
  const onStateUpdateRef = useRef(onStateUpdate)
  const onGuestActionRef = useRef(onGuestAction)
  const onEmoteRef = useRef(onEmote)

  useEffect(() => { onStateUpdateRef.current = onStateUpdate }, [onStateUpdate])
  useEffect(() => { onGuestActionRef.current = onGuestAction }, [onGuestAction])
  useEffect(() => { onEmoteRef.current = onEmote }, [onEmote])

  useEffect(() => {
    let peer: Peer

    const peerOptions = {
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
        ],
      },
    }

    if (roomId) {
      // ゲストモード
      peer = new Peer(peerOptions)
      peerRef.current = peer
      peer.on('open', (id) => {
        setPeerId(id)
        setRole('guest')
        const conn = peer.connect(roomId)
        connectionsRef.current.set(conn.peer, conn)
        conn.on('open', () => setGuestCount(1))
        conn.on('data', (data) => {
          const msg = data as HostMessage
          if (msg.type === 'state') onStateUpdateRef.current?.(msg.payload)
          else if (msg.type === 'emote') onEmoteRef.current?.(msg.emoji)
        })
        conn.on('close', () => { connectionsRef.current.delete(conn.peer); setGuestCount(0) })
        conn.on('error', (err) => setError(`接続エラー: ${err.message}`))
      })
    } else {
      // ホストモード
      peer = new Peer(peerOptions)
      peerRef.current = peer
      peer.on('open', (id) => { setPeerId(id); setRole('host') })
      peer.on('connection', (conn) => {
        connectionsRef.current.set(conn.peer, conn)
        setGuestCount(connectionsRef.current.size)
        conn.on('data', (data) => {
          const msg = data as GuestMessage
          if (msg.type === 'addLog') {
            onGuestActionRef.current?.({ type: 'addLog' }, conn.peer)
          } else if (msg.type === 'buyUpgrade') {
            onGuestActionRef.current?.({ type: 'buyUpgrade', upgradeId: msg.upgradeId }, conn.peer)
          } else if (msg.type === 'emote') {
            // ホスト画面にも表示
            onEmoteRef.current?.(msg.emoji)
            // 送信元以外の全ゲストへ中継
            for (const [id, c] of connectionsRef.current) {
              if (id !== conn.peer && c.open) c.send({ type: 'emote', emoji: msg.emoji } as HostMessage)
            }
          }
        })
        conn.on('close', () => { connectionsRef.current.delete(conn.peer); setGuestCount(connectionsRef.current.size) })
      })
    }

    peer.on('error', (err) => setError(`PeerJSエラー: ${err.message}`))

    return () => {
      peer.destroy()
      connectionsRef.current.clear()
    }
  }, [roomId])

  /** ホスト → 全ゲストへ状態配信 */
  const broadcastState = useCallback((state: FireState) => {
    const msg: HostMessage = { type: 'state', payload: state }
    for (const conn of connectionsRef.current.values()) {
      if (conn.open) conn.send(msg)
    }
  }, [])

  /** ホスト → 全ゲストへエモート配信 */
  const broadcastEmote = useCallback((emoji: string) => {
    const msg: HostMessage = { type: 'emote', emoji }
    for (const conn of connectionsRef.current.values()) {
      if (conn.open) conn.send(msg)
    }
  }, [])

  /** ゲスト → ホストへメッセージ送信 */
  const sendAction = useCallback((action: GuestMessage) => {
    for (const conn of connectionsRef.current.values()) {
      if (conn.open) conn.send(action)
    }
  }, [])

  return { role, peerId, guestCount, error, broadcastState, broadcastEmote, sendAction }
}
