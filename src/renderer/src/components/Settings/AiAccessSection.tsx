import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { useUiStore } from '../../state/uiStore'
import { Icon } from '../Icon'

interface MyStatus {
  plan_id: string
  plan_name: string
  credits_allowance: number
  credits_used: number
  credits_remaining: number
  requests_per_minute: number
  disabled: boolean
  period_end: string
  cancel_at_period_end: boolean
  is_admin: boolean
}

interface Plan {
  id: string
  name: string
  monthly_credits: number
}

/** Where "Upgrade" should send people once paid plans can actually be bought (a Stripe Checkout or
 *  pricing-page URL — see supabase/AI_PLANS.md). Null hides the button rather than shipping a dead one. */
const UPGRADE_URL: string | null = null

const credits = (n: number): string => Math.round(Number(n)).toLocaleString()
const day = (iso: string): string => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })

/** Settings > AI credits: every user sees their plan and how many credits they've used this period;
 *  admins (rows in ai_admins — see supabase/migrations/0014_ai_proxy.sql) also get a link to the
 *  admin dashboard. Credits, not dollars: what a credit costs us is tuned server-side (migration
 *  0018), so nothing here ever shows a price per request. All reads go through RPCs / RLS scoped to the
 *  signed-in user — nothing here is trusted just because the UI showed it. */
export function AiAccessSection(): JSX.Element {
  const [status, setStatus] = useState<MyStatus | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [error, setError] = useState<string | null>(null)
  const setView = useUiStore((s) => s.setView)

  const loadStatus = useCallback(async () => {
    const [statusRes, plansRes] = await Promise.all([
      supabase.rpc('ai_my_status'),
      supabase.from('ai_plans').select('id, name, monthly_credits').eq('is_public', true).order('sort_order')
    ])
    if (statusRes.error) setError(statusRes.error.message)
    else setStatus((statusRes.data as MyStatus[])[0] ?? null)
    if (plansRes.data) setPlans(plansRes.data as Plan[])
  }, [])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  const allowance = status ? Number(status.credits_allowance) : 0
  const used = status ? Number(status.credits_used) : 0
  const fraction = allowance > 0 ? Math.min(1, used / allowance) : 1
  const exhausted = !!status && allowance > 0 && Number(status.credits_remaining) <= 0

  return (
    <section style={sectionStyle}>
      <h2 style={sectionTitleStyle}>AI credits</h2>
      {error && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', margin: 0 }}>{error}</p>}
      {status && (
        <>
          <p style={{ ...hintStyle, color: 'var(--fg)' }}>
            <strong>{status.plan_name}</strong> plan
            {status.cancel_at_period_end && ` · ends ${day(status.period_end)}`}
          </p>
          {status.disabled ? (
            <p style={hintStyle}>Your AI access has been turned off. Ask the admin.</p>
          ) : allowance === 0 ? (
            <p style={hintStyle}>This plan doesn't include AI credits.</p>
          ) : (
            <>
              <p style={hintStyle}>
                {credits(used)} of {credits(allowance)} credits used — {credits(status.credits_remaining)} left. Resets{' '}
                {day(status.period_end)}.
              </p>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                <div style={{ width: `${fraction * 100}%`, height: '100%', background: fraction > 0.9 ? 'var(--danger)' : 'var(--accent)' }} />
              </div>
              {exhausted && (
                <p style={{ ...hintStyle, color: 'var(--danger)' }}>
                  You're out of credits until {day(status.period_end)}. Everything that doesn't use AI still works.
                </p>
              )}
            </>
          )}
          <p style={hintStyle}>
            Credits measure AI work — longer requests and more capable models use more. Reading, reviewing and on-device
            OCR and transcription never use any.
          </p>
          {plans.length > 1 && (
            <p style={hintStyle}>
              {plans.map((p, i) => (
                <span key={p.id} style={{ fontWeight: p.id === status.plan_id ? 600 : 400, color: p.id === status.plan_id ? 'var(--fg)' : undefined }}>
                  {i > 0 && ' · '}
                  {p.name} {credits(p.monthly_credits)}
                </span>
              ))}{' '}
              credits / month
            </p>
          )}
          {UPGRADE_URL && status.plan_id !== plans[plans.length - 1]?.id && (
            <button onClick={() => window.api.auth.openOAuthUrl(UPGRADE_URL)} style={linkButtonStyle}>
              Get more credits
              <Icon name="arrow-right" style={{ marginRight: 0, marginLeft: '0.45em' }} />
            </button>
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
