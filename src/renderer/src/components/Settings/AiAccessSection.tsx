import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'

interface MyStatus {
  monthly_budget_usd: number
  spent_month_usd: number
  requests_per_minute: number
  disabled: boolean
  is_admin: boolean
}

interface AdminRow {
  user_id: string
  email: string | null
  username: string | null
  monthly_budget_usd: number
  requests_per_minute: number
  disabled: boolean
  note: string | null
  spent_month_usd: number
  last_used_at: string | null
}

const usd = (n: number): string => `$${Number(n).toFixed(2)}`

/** Settings > AI access: every user sees their own monthly allowance; admins (rows in ai_admins — see
 *  supabase/migrations/0014_ai_proxy.sql) also get the table for granting budgets and switching
 *  accounts off. All reads/writes go through RPCs that check the admin flag server-side — nothing
 *  here is trusted just because the UI showed it. */
export function AiAccessSection(): JSX.Element {
  const [status, setStatus] = useState<MyStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

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
          {status.is_admin && <AdminTable onChanged={loadStatus} />}
        </>
      )}
    </section>
  )
}

function AdminTable({ onChanged }: { onChanged: () => void }): JSX.Element {
  const [rows, setRows] = useState<AdminRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('ai_admin_overview')
    if (err) setError(err.message)
    else setRows(data as AdminRow[])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h3 style={{ fontSize: 'var(--font-sm)', margin: 0, fontWeight: 600 }}>Accounts (admin)</h3>
        <button onClick={() => void load()} style={quietButtonStyle}>
          Refresh
        </button>
      </div>
      <p style={hintStyle}>
        Budgets are in USD per calendar month (UTC). Accounts start at $0 until you grant one. Only you can see this table.
      </p>
      {error && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', margin: 0 }}>{error}</p>}
      {rows?.map((row) => <AdminRowEditor key={row.user_id} row={row} onSaved={() => { void load(); onChanged() }} />)}
    </div>
  )
}

function AdminRowEditor({ row, onSaved }: { row: AdminRow; onSaved: () => void }): JSX.Element {
  const [budget, setBudget] = useState(String(row.monthly_budget_usd))
  const [rpm, setRpm] = useState(String(row.requests_per_minute))
  const [disabled, setDisabled] = useState(row.disabled)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const budgetNum = Number(budget)
  const rpmNum = Number(rpm)
  const valid = Number.isFinite(budgetNum) && budgetNum >= 0 && Number.isInteger(rpmNum) && rpmNum > 0
  const dirty = budgetNum !== Number(row.monthly_budget_usd) || rpmNum !== row.requests_per_minute || disabled !== row.disabled

  async function save(): Promise<void> {
    setSaving(true)
    setError(null)
    const { error: err } = await supabase.rpc('ai_admin_set_quota', {
      target: row.user_id,
      budget: budgetNum,
      rpm: rpmNum,
      is_disabled: disabled,
      quota_note: row.note
    })
    setSaving(false)
    if (err) setError(err.message)
    else onSaved()
  }

  return (
    <div style={rowStyle}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--font-sm)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {row.username ?? row.email ?? row.user_id}
        </div>
        <div style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-muted)' }}>
          {row.username && row.email ? `${row.email} · ` : ''}
          {usd(row.spent_month_usd)} spent
        </div>
        {error && <div style={{ fontSize: 'var(--font-xs)', color: 'var(--danger)' }}>{error}</div>}
      </div>
      <label style={fieldStyle} title="Monthly budget (USD)">
        $
        <input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" style={{ ...numberInputStyle, width: 60 }} />
      </label>
      <label style={fieldStyle} title="Max requests per minute">
        <input value={rpm} onChange={(e) => setRpm(e.target.value)} inputMode="numeric" style={{ ...numberInputStyle, width: 40 }} />
        /min
      </label>
      <label style={fieldStyle} title="Block this account from AI entirely">
        <input type="checkbox" checked={disabled} onChange={(e) => setDisabled(e.target.checked)} />
        off
      </label>
      <button disabled={!dirty || !valid || saving} onClick={() => void save()} style={saveButtonStyle}>
        {saving ? '…' : 'Save'}
      </button>
    </div>
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

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  padding: '6px 0',
  borderTop: '1px solid var(--border)'
}

const fieldStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  fontSize: 'var(--font-xs)',
  color: 'var(--fg-muted)'
}

const numberInputStyle: CSSProperties = {
  fontSize: 'var(--font-sm)',
  padding: '3px 5px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg)',
  color: 'inherit'
}

const saveButtonStyle: CSSProperties = {
  border: '1px solid var(--accent)',
  background: 'var(--accent-soft)',
  color: 'var(--accent)',
  fontWeight: 600,
  borderRadius: 'var(--radius-sm)',
  padding: '3px 10px',
  cursor: 'pointer',
  fontSize: 'var(--font-xs)'
}

const quietButtonStyle: CSSProperties = {
  border: 'none',
  background: 'none',
  color: 'var(--fg-muted)',
  cursor: 'pointer',
  fontSize: 'var(--font-xs)'
}
