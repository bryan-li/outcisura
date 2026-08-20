import { useAuthStore } from '../../state/authStore'
import { useGuestSessionStore } from '../../state/guestSessionStore'
import { JoinSessionForm } from './JoinSessionForm'
import { LiveSessionPlayer } from '../LiveSession/LiveSessionPlayer'

/** Rendered by App.tsx in place of the normal AppShell whenever the current Supabase session is
 *  anonymous (session.user.is_anonymous) — a guest never sees the flashcard library, review
 *  dashboard, or Settings, only this. Covers two distinct paths into this same screen:
 *  - A guest who just submitted LoginView's "Join a session" form.
 *  - A *returning* guest whose anonymous Supabase session persisted across an app relaunch but
 *    whose in-memory guestSessionStore reset to 'idle' on this fresh load — they see the join form
 *    again rather than a broken blank screen.
 *  Once joined, hands off to LiveSessionPlayer (shared with the signed-in join path — see
 *  PlayLiveSessionView.tsx) for the actual answering/waiting/reveal loop. */
export function GuestSessionView(): JSX.Element {
  const status = useGuestSessionStore((s) => s.status)
  const displayName = useGuestSessionStore((s) => s.displayName)
  const joinedSession = useGuestSessionStore((s) => s.joinedSession)
  const reset = useGuestSessionStore((s) => s.reset)
  const signOut = useAuthStore((s) => s.signOut)
  const userId = useAuthStore((s) => s.session?.user.id)

  if (status !== 'joined' || !joinedSession || !userId) {
    return <JoinSessionForm title="Join a session" subtitle="Enter the code from your host — no account needed." />
  }

  return (
    <LiveSessionPlayer
      sessionId={joinedSession.id}
      userId={userId}
      displayName={displayName ?? 'Player'}
      folderNameSnapshot={joinedSession.folderNameSnapshot}
      onLeave={() => {
        // A guest's whole identity IS this one throwaway anonymous session — leaving means signing
        // out of it entirely, unlike a signed-in participant (PlayLiveSessionView), who just
        // navigates away and stays logged in.
        reset()
        void signOut()
      }}
    />
  )
}
