import { useState, type CSSProperties, type FormEvent } from 'react'
import { useGuestSessionStore } from '../../state/guestSessionStore'

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
    <div style={pageStyle}>
      <form onSubmit={handleSubmit} style={cardStyle}>
        <h1 style={{ fontSize: 'var(--font-xl)', margin: 0 }}>{title}</h1>
        <p style={{ fontSize: 'var(--font-sm)', color: 'var(--fg-muted)', margin: 0 }}>{subtitle}</p>

        <input
          type="text"
          required
          autoFocus
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value)}
          placeholder="Session code"
          style={{ ...inputStyle, textTransform: 'uppercase', letterSpacing: '0.05em' }}
        />
        <input
          type="text"
          required
          maxLength={40}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Your name"
          style={inputStyle}
        />

        {error && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', margin: 0 }}>{error}</p>}

        <button type="submit" disabled={status === 'joining'} style={primaryButtonStyle}>
          {status === 'joining' ? 'Joining…' : 'Join'}
        </button>

        {onBack && (
          <button type="button" onClick={onBack} style={quietTextButtonStyle}>
            ← Back to sign in
          </button>
        )}
      </form>
    </div>
  )
}

const pageStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  background: 'var(--bg)'
}

const cardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
  width: 320,
  padding: 'var(--space-6)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)'
}

const inputStyle: CSSProperties = {
  fontSize: 'var(--font-sm)',
  padding: '8px 10px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg)',
  color: 'inherit'
}

const primaryButtonStyle: CSSProperties = {
  border: '1px solid var(--accent)',
  background: 'var(--accent-soft)',
  color: 'var(--accent)',
  fontWeight: 600,
  borderRadius: 'var(--radius-sm)',
  padding: '8px 14px',
  cursor: 'pointer'
}

const quietTextButtonStyle: CSSProperties = {
  border: 'none',
  background: 'none',
  color: 'var(--fg-muted)',
  cursor: 'pointer',
  fontSize: 'var(--font-xs)'
}
