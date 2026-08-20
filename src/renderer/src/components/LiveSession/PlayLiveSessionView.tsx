import { useEffect, useState } from 'react'
import { useAuthStore } from '../../state/authStore'
import { useUiStore } from '../../state/uiStore'
import { supabase } from '../../lib/supabase'
import { LiveSessionPlayer } from './LiveSessionPlayer'

interface PlayLiveSessionViewProps {
  sessionId: string
}

/** Loads what LiveSessionPlayer needs but the `live-session-play` view (just a sessionId) doesn't
 *  carry itself — the signed-in user's own username (from `profiles`, readable by any authenticated
 *  user) and the session's folder name snapshot (readable now that JoinLiveSessionView has already
 *  inserted a live_session_participants row, satisfying `live_sessions_select`'s participant check)
 *  — rather than threading extra fields through view state the way `review`'s scope does. */
export function PlayLiveSessionView({ sessionId }: PlayLiveSessionViewProps): JSX.Element {
  const userId = useAuthStore((s) => s.session?.user.id)
  const setView = useUiStore((s) => s.setView)
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [folderNameSnapshot, setFolderNameSnapshot] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    Promise.all([
      supabase.from('profiles').select('username').eq('user_id', userId).maybeSingle(),
      supabase.from('live_sessions').select('folder_name_snapshot').eq('id', sessionId).maybeSingle()
    ])
      .then(([profileResult, sessionResult]) => {
        if (cancelled) return
        if (profileResult.error) throw profileResult.error
        if (sessionResult.error) throw sessionResult.error
        setDisplayName((profileResult.data as { username: string } | null)?.username ?? 'Player')
        setFolderNameSnapshot((sessionResult.data as { folder_name_snapshot: string | null } | null)?.folder_name_snapshot ?? null)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load session')
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, userId])

  if (!userId) return <p style={{ color: 'var(--fg-muted)' }}>Not signed in.</p>
  if (error) return <p style={{ color: 'var(--danger)' }}>{error}</p>
  if (displayName === null) return <p style={{ color: 'var(--fg-muted)' }}>Loading…</p>

  return (
    <LiveSessionPlayer
      sessionId={sessionId}
      userId={userId}
      displayName={displayName}
      folderNameSnapshot={folderNameSnapshot}
      onLeave={() => setView({ type: 'home' })}
    />
  )
}
