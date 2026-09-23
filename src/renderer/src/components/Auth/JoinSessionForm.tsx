import { useState, type CSSProperties, type FormEvent } from 'react'
import { useGuestSessionStore } from '../../state/guestSessionStore'
import { Icon } from '../Icon'
import { Eyebrow, inputPillStyle, pillPrimaryStyle, pillQuietStyle, sessionCardStyle, stageStyle } from '../LiveSession/liveKit'

/** The guest entry point — join code + display name, no email/password. Submitting signs the guest
 *  in anonymously (guestSessionStore.join), which immediately flips App.tsx's top-level branch to
 *  GuestSessionView (session.user.is_anonymous becomes true the moment sign-in succeeds) — so this
 *  form only ever collects input and kicks the join off; the actual "did the code resolve" outcome
 *  is handled over there, not here, since this component won't be mounted anymore by the time
 *  that's known. Shared by LoginView (first-time join) and GuestSessionView (a returning guest
 *  whose anonymous session is still valid but who hasn't entered a code yet this launch — see
 *  guestSessionStore's own note on why its in-memory state doesn't survive a relaunch even though
 *  the underlying Supabase session does). */
export function JoinSessionForm({ title, subtitle, onBack }: { title: string; subtitle: string; onBack?: () => void }): JSX.Element {
  const join = useGuestSessionStore((s) => s.join)
  const status = useGuestSessionStore((s) => s.status)
  const error = useGuestSessionStore((s) => s.error)
  const [joinCode, setJoinCode] = useState('')
  const [displayName, setDisplayName] = useState('')

  function handleSubmit(e: FormEvent): void {
    e.preventDefault()
    void join(joinCode, displayName)
  }

  return (
    <div style={{ ...stageStyle, background: 'var(--bg)' }}>
      <form onSubmit={handleSubmit} style={{ ...sessionCardStyle, width: 380 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', textAlign: 'center' }}>
          <Eyebrow tinted>
            <Icon name="broadcast" size="1em" />Live session
          </Eyebrow>
          <h1 style={{ fontSize: 'var(--font-xxl)', margin: '4px 0 0', letterSpacing: '-0.02em' }}>{title}</h1>
          <p style={{ fontSize: 'var(--font-sm)', color: 'var(--fg-muted)', margin: 0 }}>{subtitle}</p>
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
        <input
          type="text"
          required
          maxLength={40}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Your name"
          style={{ ...inputPillStyle, textAlign: 'center' }}
        />

        {error && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', margin: 0, textAlign: 'center' }}>{error}</p>}

        <button type="submit" disabled={status === 'joining'} style={pillPrimaryStyle}>
          {status === 'joining' ? 'Joining…' : 'Join'}
        </button>

        {onBack && (
          <button type="button" onClick={onBack} style={{ ...pillQuietStyle, alignSelf: 'center' }}>
            <Icon name="arrow-left" size="0.95em" bare />Back to sign in
          </button>
        )}
      </form>
    </div>
  )
}

/** Matches the host lobby's big spaced-out code, so the thing you're copying and the box you're
 *  typing it into look like the same object. */
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

