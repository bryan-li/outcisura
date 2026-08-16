import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { signInAsGuest } from '../lib/guestAuth'

interface JoinedSession {
  id: string
  status: string
  folderNameSnapshot: string | null
}

interface FindSessionRow {
  id: string
  status: string
  folder_name_snapshot: string | null
}

interface GuestSessionState {
  status: 'idle' | 'joining' | 'joined' | 'error'
  displayName: string | null
  joinedSession: JoinedSession | null
  error: string | null
  /** Called from LoginView's "Join a session" form. Signs in anonymously (if not already), looks
   *  the code up via the narrow `find_session_by_join_code` RPC (see 0006_live_sessions.sql — this
   *  is the one sanctioned way to look a session up before being a participant of it), and inserts
   *  the roster row. Anonymous auth succeeding flips App.tsx's top-level branch away from
   *  LoginView immediately (session.user.is_anonymous becomes true), so this store — not
   *  LoginView's own local state — is what GuestSessionView reads to keep going after that
   *  handoff, including surfacing an invalid-code error there rather than here. */
  join: (joinCode: string, displayName: string) => Promise<void>
  /** Retry with a different code using the same already-established anonymous identity — no need
   *  to sign in again. */
  reset: () => void
}

export const useGuestSessionStore = create<GuestSessionState>((set) => ({
  status: 'idle',
  displayName: null,
  joinedSession: null,
  error: null,

  join: async (joinCode, displayName) => {
    set({ status: 'joining', displayName, error: null })
    try {
      const session = await signInAsGuest()

      const code = joinCode.trim().toUpperCase()
      const { data: matches, error: lookupError } = await supabase.rpc('find_session_by_join_code', { p_code: code })
      if (lookupError) throw lookupError
      const match = (matches as FindSessionRow[] | null)?.[0]
      if (!match) {
        set({ status: 'error', error: `No session found for code "${code}" — check with the host and try again.` })
        return
      }

      const { error: joinError } = await supabase.from('live_session_participants').insert({
        session_id: match.id,
        user_id: session.user.id,
        display_name: displayName.trim(),
        is_guest: true
      })
      // A retry with the same code after already joining hits the (session_id, user_id) unique
      // constraint — not a real failure, just "you're already in," so treat it as success.
      if (joinError && joinError.code !== '23505') throw joinError

      set({
        status: 'joined',
        joinedSession: { id: match.id, status: match.status, folderNameSnapshot: match.folder_name_snapshot }
      })
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : 'Failed to join session' })
    }
  },

  reset: () => set({ status: 'idle', error: null, joinedSession: null })
}))
