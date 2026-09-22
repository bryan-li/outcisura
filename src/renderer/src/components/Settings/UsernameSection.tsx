import { useEffect, useState, type CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { supabaseErrorMessage } from '../../lib/supabaseError'
import { useAuthStore, USERNAME_PATTERN } from '../../state/authStore'
import { secondaryPillStyle } from '../dashboardKit'

const COOLDOWN_DAYS = 30

interface ProfileRow {
  username: string
  username_changed_at: string | null
}

function daysRemaining(changedAt: string): number {
  const unlocksAt = new Date(changedAt).getTime() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000
  return Math.max(0, Math.ceil((unlocksAt - Date.now()) / (24 * 60 * 60 * 1000)))
}

/** Settings > Account: shows the signed-in user's username and lets them change it — or, for an
 *  account with no `profiles` row at all yet (accounts predating 0008_user_profiles.sql, or ones
 *  whose signup never carried a username into user_metadata — see authStore.ts's ensureProfile,
 *  which silently skips creating one in that case), lets them choose one for the first time. Usernames
 *  are case-insensitively unique (idx_profiles_username_unique) and, once set, locked for 30 days
 *  (the profiles_username_cooldown trigger, 0023_username_change_rule.sql) — that trigger only fires
 *  on UPDATE, so the very first INSERT here is never cooldown-gated regardless. */
export function UsernameSection(): JSX.Element | null {
  const userId = useAuthStore((s) => s.session?.user.id)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  // Distinct from `profile === null`, which is also true before the fetch resolves — this is only
  // set once the fetch genuinely comes back with no row, so the component doesn't render the
  // "choose one" state for a split second on every load before the real state is known.
  const [loaded, setLoaded] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    supabase
      .from('profiles')
      .select('username, username_changed_at')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error: loadError }) => {
        if (cancelled) return
        if (loadError) setError(supabaseErrorMessage(loadError, 'Failed to load your username'))
        else if (data) {
          setProfile(data as ProfileRow)
          setDraft((data as ProfileRow).username)
        }
        setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  // Anonymous guest sessions never reach Settings at all (see App.tsx). Otherwise, wait for the
  // fetch to actually resolve before rendering anything — including the "choose one" state, which
  // is only correct once we know for sure there's no row yet, not just that none has loaded yet.
  if (!userId || !loaded) return null

  const locked = profile?.username_changed_at ? daysRemaining(profile.username_changed_at) : 0
  const trimmed = draft.trim()
  const formatValid = USERNAME_PATTERN.test(trimmed)
  const unchanged = profile !== null && trimmed === profile.username
  const canSave = formatValid && !unchanged && locked === 0 && !saving

  async function handleSave(): Promise<void> {
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      // No existing row: an insert (never touches the update-only cooldown trigger — a first choice
      // isn't a "change"). An existing row: a plain update, which the trigger gates.
      const { error: saveError } = profile
        ? await supabase.from('profiles').update({ username: trimmed }).eq('user_id', userId as string)
        : await supabase.from('profiles').insert({ user_id: userId, username: trimmed, username_changed_at: new Date().toISOString() })
      if (saveError) throw saveError
      setProfile({ username: trimmed, username_changed_at: new Date().toISOString() })
      setMessage(profile ? `Username changed to "${trimmed}".` : `Username set to "${trimmed}".`)
    } catch (err) {
      setError(supabaseErrorMessage(err, 'Failed to save your username'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section style={sectionStyle}>
      <h2 style={sectionTitleStyle}>{profile ? 'Username' : 'Choose a username'}</h2>
      <p style={hintStyle}>
        Shown to friends and on live-session rosters. Letters, numbers, and underscores, 3–20 characters. Case doesn't
        matter for uniqueness — "Alex" and "alex" count as the same name.{' '}
        {profile ? `Changing it locks it again for ${COOLDOWN_DAYS} days.` : `Once set, it's locked for ${COOLDOWN_DAYS} days.`}
      </p>
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSave) void handleSave()
          }}
          disabled={saving || locked > 0}
          maxLength={20}
          style={inputStyle}
          aria-label="Username"
        />
        <button disabled={!canSave} onClick={() => void handleSave()} style={secondaryPillStyle}>
          {saving ? 'Saving…' : profile ? 'Save' : 'Choose'}
        </button>
      </div>
      {locked > 0 && (
        <p style={hintStyle}>
          You can change it again in {locked} day{locked === 1 ? '' : 's'}.
        </p>
      )}
      {!formatValid && trimmed.length > 0 && (
        <p style={hintStyle}>3–20 characters: letters, numbers, and underscores only.</p>
      )}
      {message && <p style={{ ...hintStyle, color: 'var(--accent)' }}>{message}</p>}
      {error && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', margin: 0 }}>{error}</p>}
    </section>
  )
}

const sectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
  paddingBottom: 'var(--space-4)',
  borderBottom: '1px solid var(--border)'
}

const sectionTitleStyle: CSSProperties = { fontSize: 'var(--font-md)', fontWeight: 600, margin: 0 }

const hintStyle: CSSProperties = { fontSize: 'var(--font-sm)', color: 'var(--fg-muted)', margin: 0 }

const inputStyle: CSSProperties = {
  fontSize: 'var(--font-sm)',
  padding: '6px 10px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg)',
  color: 'inherit',
  width: 220
}
