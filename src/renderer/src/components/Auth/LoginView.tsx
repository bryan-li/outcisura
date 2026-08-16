import { useState, type CSSProperties, type FormEvent } from 'react'
import { useAuthStore } from '../../state/authStore'
import { JoinSessionForm } from './JoinSessionForm'

type Mode = 'signIn' | 'signUp' | 'join'

export function LoginView(): JSX.Element {
  const signIn = useAuthStore((s) => s.signIn)
  const signUp = useAuthStore((s) => s.signUp)
  const error = useAuthStore((s) => s.error)

  const [mode, setMode] = useState<Mode>('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Separate from the store's own `error` — this catches a signUp's "check your email to confirm"
  // case, which isn't a failure and shouldn't render like one.
  const [notice, setNotice] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setSubmitting(true)
    setNotice(null)
    try {
      if (mode === 'signIn') {
        await signIn(email, password)
      } else if (mode === 'signUp') {
        await signUp(email, password, username)
        setNotice('Check your email to confirm your account, then sign in.')
        setMode('signIn')
      }
    } catch {
      // useAuthStore already captured the message in its own `error` state — nothing more to do
      // here, just stop showing the submitting state.
    } finally {
      setSubmitting(false)
    }
  }

  if (mode === 'join') {
    return (
      <JoinSessionForm
        title="Join a session"
        subtitle="Enter the code from your host — no account needed."
        onBack={() => setMode('signIn')}
      />
    )
  }

  return (
    <div style={pageStyle}>
      <form onSubmit={handleSubmit} style={cardStyle}>
        <h1 style={{ fontSize: 'var(--font-xl)', margin: 0 }}>Outcisura</h1>
        <p style={{ fontSize: 'var(--font-sm)', color: 'var(--fg-muted)', margin: 0 }}>
          {mode === 'signIn' ? 'Sign in to your account.' : 'Create an account.'}
        </p>

        <input
          type="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          style={inputStyle}
        />
        <input
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          style={inputStyle}
        />
        {/* Sign-in only needs email/password — the username is a one-time choice made at signup,
            not something a returning user re-enters. Uniqueness is enforced server-side (see
            0008_user_profiles.sql) regardless of what this pattern allows client-side; this is
            just fail-fast feedback before a round trip. */}
        {mode === 'signUp' && (
          <input
            type="text"
            required
            pattern="[a-zA-Z0-9_]{3,20}"
            title="3-20 characters: letters, numbers, and underscores only"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            style={inputStyle}
          />
        )}

        {error && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', margin: 0 }}>{error}</p>}
        {notice && <p style={{ color: 'var(--fg-muted)', fontSize: 'var(--font-sm)', margin: 0 }}>{notice}</p>}

        <button type="submit" disabled={submitting} style={primaryButtonStyle}>
          {mode === 'signIn' ? 'Sign in' : 'Sign up'}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'signIn' ? 'signUp' : 'signIn')
            setNotice(null)
          }}
          style={quietTextButtonStyle}
        >
          {mode === 'signIn' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
        </button>

        {/* A separate, visually distinct path from sign-in/sign-up — joining a live session never
            touches email/password, it's an anonymous identity scoped to one session (see
            guestSessionStore.ts). Only shown alongside the sign-in form, not sign-up's — hosting a
            session requires a real account, but joining one never should feel gated behind making
            one. */}
        {mode === 'signIn' && (
          <button type="button" onClick={() => setMode('join')} style={joinButtonStyle}>
            Join a session with a code →
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

const joinButtonStyle: CSSProperties = {
  border: '1px dashed var(--border)',
  background: 'none',
  color: 'var(--fg)',
  fontWeight: 600,
  borderRadius: 'var(--radius-sm)',
  padding: '8px 14px',
  cursor: 'pointer',
  marginTop: 'var(--space-2)'
}
