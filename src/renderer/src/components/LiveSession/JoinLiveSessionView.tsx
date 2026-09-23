import { useState, type CSSProperties, type FormEvent } from 'react'
import { useAuthStore } from '../../state/authStore'
import { useUiStore } from '../../state/uiStore'
import { supabase } from '../../lib/supabase'
import { Icon } from '../Icon'
import { Eyebrow, inputPillStyle, pillPrimaryStyle, sessionCardStyle, stageStyle } from './liveKit'

interface FindSessionRow {
  id: string
  status: string
  folder_name_snapshot: string | null
}

/** The signed-in counterpart to JoinSessionForm — a real account joining a live session as
 *  themselves (display name from their own username, no separate name prompt), rather than an
 *  anonymous guest. Uses the same `find_session_by_join_code` RPC guests use (the one sanctioned way
 *  to look a session up before being a participant of it — see 0006_live_sessions.sql) and the same
 *  `live_session_participants` insert path, just with `is_guest: false` and no anonymous sign-in
 *  step first, since a signed-in user already has a real `auth.uid()`. */
export function JoinLiveSessionView(): JSX.Element {
  const userId = useAuthStore((s) => s.session?.user.id)
  const setView = useUiStore((s) => s.setView)
  const [joinCode, setJoinCode] = useState('')
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!userId || joining) return
    setJoining(true)
    setError(null)
    try {
      const code = joinCode.trim().toUpperCase()
      const { data: matches, error: lookupError } = await supabase.rpc('find_session_by_join_code', { p_code: code })
      if (lookupError) throw lookupError
      const match = (matches as FindSessionRow[] | null)?.[0]
      if (!match) {
        setError(`No session found for code "${code}" — check with the host and try again.`)
        return
      }

      const { data: profile, error: profileError } = await supabase.from('profiles').select('username').eq('user_id', userId).maybeSingle()
      if (profileError) throw profileError
      const displayName = (profile as { username: string } | null)?.username ?? 'Player'

      const { error: joinError } = await supabase.from('live_session_participants').insert({
        session_id: match.id,
        user_id: userId,
        display_name: displayName,
        is_guest: false
      })
      // A retry with the same code after already joining hits the (session_id, user_id) unique
      // constraint — not a real failure, just "you're already in," same as the guest join flow.
      if (joinError && joinError.code !== '23505') throw joinError

      setView({ type: 'live-session-play', sessionId: match.id })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join session')
    } finally {
      setJoining(false)
    }
  }

  return (
    <div style={stageStyle}>
      <form onSubmit={handleSubmit} style={{ ...sessionCardStyle, width: 380 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', textAlign: 'center' }}>
          <Eyebrow tinted>
            <Icon name="join" size="1em" />Join a session
          </Eyebrow>
          <h1 style={{ fontSize: 'var(--font-xxl)', margin: '4px 0 0', letterSpacing: '-0.02em' }}>Enter the code</h1>
          <p style={{ fontSize: 'var(--font-sm)', color: 'var(--fg-muted)', margin: 0 }}>
            From your host — you&apos;ll join as yourself.
          </p>
        </div>

        <input
          type="text"
          required
          autoFocus
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value)}
          placeholder="Session code"
          style={codeInputStyle}
        />

        {error && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', margin: 0, textAlign: 'center' }}>{error}</p>}

        <button type="submit" disabled={joining} style={pillPrimaryStyle}>
          {joining ? 'Joining…' : 'Join'}
        </button>
      </form>
    </div>
  )
}

/** The code is the whole point of this screen, so it's typed big and spaced out — the same shape the
 *  host's lobby shows it in. */
const codeInputStyle: CSSProperties = {
  ...inputPillStyle,
  textAlign: 'center',
  textTransform: 'uppercase',
  fontSize: 26,
  fontWeight: 700,
  letterSpacing: '0.18em',
  textIndent: '0.18em',
  padding: 'var(--space-3)'
}

