import { useEffect, useRef, useState, useCallback } from 'react'
import Peer from 'peerjs'
import type { DataConnection } from 'peerjs'
import type { FireState } from '../fire/FireEngine'

export type Role = 'host' | 'guest' | 'idle'

export interface GuestAction {
  type: 'addLog'
}

export interface HostBroadcast {
  type: 'state'
  payload: FireState
}

type IncomingMessage = GuestAction | HostBroadcast

interface UsePeerOptions {
  roomId: string | null
  onStateUpdate?: (state: FireState) => void
  onGuestAction?: (action: GuestAction, connId: string) => void
}

export function usePeer({ roomId, onStateUpdate, onGuestAction }: UsePeerOptions) {
  const [role, setRole] = useState<Role>('idle')
  const [peerId, setPeerId] = useState<string | null>(null)
  const [guestCount, setGuestCount] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const peerRef = useRef<Peer | null>(null)
  const connectionsRef = useRef<Map<string, DataConnection>>(new Map())
  const onStateUpdateRef = useRef(onStateUpdate)
  const onGuestActionRef = useRef(onGuestAction)

  useEffect(() => { onStateUpdateRef.current = onStateUpdate }, [onStateUpdate])
  useEffect(() => { onGuestActionRef.current = onGuestAction }, [onGuestAction])

  useEffect(() => {
    let peer: Peer

    if (roomId) {
      // ゲストモード: roomId が URL に含まれていた場合
      peer = new Peer()
      peerRef.current = peer
      peer.on('open', (id) => {
        setPeerId(id)
        setRole('guest')
        const conn = peer.connect(roomId)
        connectionsRef.current.set(conn.peer, conn)
        conn.on('open', () => {
          setGuestCount(1)
        })
        conn.on('data', (data) => {
          const msg = data as IncomingMessage
          if (msg.type === 'state') {
            onStateUpdateRef.current?.(msg.payload)
          }
        })
        conn.on('close', () => {
          connectionsRef.current.delete(conn.peer)
          setGuestCount(0)
        })
        conn.on('error', (err) => {
          setError(`接続エラー: ${err.message}`)
        })
      })
    } else {
      // ホストモード: roomId が URL にない場合
      peer = new Peer()
      peerRef.current = peer
      peer.on('open', (id) => {
        setPeerId(id)
        setRole('host')
      })
      peer.on('connection', (conn) => {
        connectionsRef.current.set(conn.peer, conn)
        setGuestCount(connectionsRef.current.size)
        conn.on('data', (data) => {
          const msg = data as IncomingMessage
          if (msg.type === 'addLog') {
            onGuestActionRef.current?.(msg, conn.peer)
          }
        })
        conn.on('close', () => {
          connectionsRef.current.delete(conn.peer)
          setGuestCount(connectionsRef.current.size)
        })
      })
    }

    peer.on('error', (err) => {
      setError(`PeerJSエラー: ${err.message}`)
    })

    return () => {
      peer.destroy()
      connectionsRef.current.clear()
    }
  }, [roomId])

  /** ホスト → 全ゲストへ状態配信 */
  const broadcastState = useCallback((state: FireState) => {
    const msg: HostBroadcast = { type: 'state', payload: state }
    for (const conn of connectionsRef.current.values()) {
      if (conn.open) conn.send(msg)
    }
  }, [])

  /** ゲスト → ホストへアクション送信 */
  const sendAction = useCallback((action: GuestAction) => {
    for (const conn of connectionsRef.current.values()) {
      if (conn.open) conn.send(action)
    }
  }, [])

  return { role, peerId, guestCount, error, broadcastState, sendAction }
}
