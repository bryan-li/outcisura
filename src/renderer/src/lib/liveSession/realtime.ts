import { useCallback, useEffect, useRef } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../supabase'

/** First Realtime usage in this codebase — Broadcast, not Postgres Changes, exactly as decided in
 *  the original M0 plan. Every payload here is non-authoritative: it only ever means "something
 *  changed, go re-read Postgres" (which enforces RLS on the actual read) — nothing in a payload is
 *  worth a guest lying about, since correctness/scoring always comes from the RLS+trigger-guarded
 *  Postgres read/write, never from the broadcast itself. */
export type SessionEvent =
  | { type: 'question_advanced'; questionIndex: number; deadline: string }
  | { type: 'results_revealed'; questionIndex: number }
  | { type: 'session_ended' }
  | { type: 'participant_joined' }
  | { type: 'answer_submitted' }

const BROADCAST_EVENT = 'session-event'

/** One channel per session, reused for both listening and sending — never a fresh channel per
 *  message. Subscribes once per `sessionId` and cleans up on unmount/id change; `onEvent` is kept
 *  in a ref so identity churn on every render doesn't resubscribe. Returns a stable `send` function
 *  for broadcasting events on that same channel. */
export function useSessionChannel(sessionId: string | null, onEvent: (event: SessionEvent) => void): (event: SessionEvent) => void {
  const channelRef = useRef<RealtimeChannel | null>(null)
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  useEffect(() => {
    if (!sessionId) return
    const channel = supabase.channel(`live-session:${sessionId}`)
    channel.on('broadcast', { event: BROADCAST_EVENT }, ({ payload }) => {
      onEventRef.current(payload as SessionEvent)
    })
    channel.subscribe()
    channelRef.current = channel
    return () => {
      supabase.removeChannel(channel)
      channelRef.current = null
    }
  }, [sessionId])

  return useCallback((event: SessionEvent) => {
    void channelRef.current?.send({ type: 'broadcast', event: BROADCAST_EVENT, payload: event })
  }, [])
}
