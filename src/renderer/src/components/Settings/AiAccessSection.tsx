import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { useUiStore } from '../../state/uiStore'
import { Icon } from '../Icon'

interface MyStatus {
  monthly_budget_usd: number
  spent_month_usd: number
  requests_per_minute: number
  disabled: boolean
  is_admin: boolean
}

const usd = (n: number): string => `$${Number(n).toFixed(2)}`

/** Settings > AI access: every user sees their own monthly allowance; admins (rows in ai_admins — see
 *  supabase/migrations/0014_ai_proxy.sql) also get the table for granting budgets and switching
 *  accounts off. All reads/writes go through RPCs that check the admin flag server-side — nothing
 *  here is trusted just because the UI showed it. */
export function AiAccessSection(): JSX.Element {
  const [status, setStatus] = useState<MyStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const setView = useUiStore((s) => s.setView)

  const loadStatus = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('ai_my_status')
    if (err) setError(err.message)
    else setStatus((data as MyStatus[])[0] ?? null)
  }, [])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  const remaining = status ? Math.max(0, status.monthly_budget_usd - status.spent_month_usd) : 0
  const fraction = status && status.monthly_budget_usd > 0 ? Math.min(1, status.spent_month_usd / status.monthly_budget_usd) : 0

  return (
    <section style={sectionStyle}>
      <h2 style={sectionTitleStyle}>AI access</h2>
      {error && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', margin: 0 }}>{error}</p>}
      {status && (
        <>
          {status.disabled ? (
            <p style={hintStyle}>Your AI access has been turned off. Ask the admin, or use your own key below.</p>
          ) : status.monthly_budget_usd === 0 ? (
            <p style={hintStyle}>You don't have an AI allowance yet. Ask the admin to enable it, or use your own key below.</p>
          ) : (
            <>
              <p style={hintStyle}>
                {usd(status.spent_month_usd)} of {usd(status.monthly_budget_usd)} used this month — {usd(remaining)} left. Resets on
                the 1st.
              </p>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${fraction * 100}%`,
                    height: '100%',
                    background: fraction > 0.9 ? 'var(--danger)' : 'var(--accent)'
                  }}
                />
              </div>
            </>
          )}
          {status.is_admin && (
            <button onClick={() => setView({ type: 'admin' })} style={linkButtonStyle}>
              Open the AI admin dashboard
              <Icon name="arrow-right" style={{ marginRight: 0, marginLeft: '0.45em' }} />
            </button>
          )}
        </>
      )}
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






const linkButtonStyle: CSSProperties = {
  alignSelf: 'flex-start',
  border: 'none',
  background: 'none',
  color: 'var(--accent)',
  cursor: 'pointer',
  fontSize: 'var(--font-sm)',
  fontWeight: 600,
  padding: 0
}
