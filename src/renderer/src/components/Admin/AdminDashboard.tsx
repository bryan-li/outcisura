import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { useAiAdminStore } from '../../state/aiAdminStore'
import { useAuthStore } from '../../state/authStore'

const ACCOUNTS_PER_PAGE = 10

interface Summary {
  month_credits: number
  month_cost_usd: number
  month_requests: number
  active_users: number
  by_plan: { name: string; accounts: number }[]
  by_feature: { name: string; requests: number; credits: number; cost_usd: number }[]
  by_model: { name: string; requests: number; credits: number; cost_usd: number }[]
  daily: { day: string; requests: number; credits: number; cost_usd: number }[]
}

interface Account {
  user_id: string
  email: string | null
  username: string | null
  plan_id: string
  /** 'free' | 'manual' (admin comp) | a billing provider name — only the first two can be changed here. */
  plan_source: string
  credits_override: number | null
  credits_allowance: number
  credits_used: number
  cost_period_usd: number
  rpm_override: number | null
  disabled: boolean
  note: string | null
  last_used_at: string | null
  is_admin: boolean
}

interface UsageRow {
  id: number
  created_at: string
  user_id: string
  email: string | null
  username: string | null
  feature: string
  model: string
  input_tokens: number
  output_tokens: number
  credits: number
  cost_usd: number
}

interface Price {
  model: string
  input_usd_per_mtok: number
  output_usd_per_mtok: number
  input_credits_per_mtok: number
  output_credits_per_mtok: number
  enabled: boolean
}

interface Plan {
  id: string
  name: string
  monthly_credits: number
  requests_per_minute: number
  models: string[] | null
  sort_order: number
}

interface FeatureWeight {
  feature: string
  multiplier: number
}

const money = (n: number): string => (n > 0 && n < 0.01 ? '<$0.01' : `$${Number(n).toFixed(2)}`)
const money4 = (n: number): string => `$${Number(n).toFixed(4)}`
const cr = (n: number): string => Math.round(Number(n)).toLocaleString()
const who = (a: { username: string | null; email: string | null; user_id: string }): string => a.username ?? a.email ?? a.user_id.slice(0, 8)

function relativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`
  return `${Math.round(mins / 1440)}d ago`
}

/** In-app admin dashboard for the shared Anthropic key and its plans (see supabase/migrations/0014-0018,
 *  supabase/AI_PLANS.md and the ai-proxy Edge Function). Users are limited in CREDITS; dollars appear
 *  here only as the real cost behind them, so margin is visible. Reachable only from the sidebar's Admin item, which itself only shows for
 *  admins — but that's cosmetic: every RPC below re-checks ai_admins server-side, so a non-admin who
 *  somehow renders this page just sees "not authorized" errors and no data. */
export function AdminDashboard(): JSX.Element {
  const isAdmin = useAiAdminStore((s) => s.isAdmin)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [usage, setUsage] = useState<UsageRow[]>([])
  const [prices, setPrices] = useState<Price[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [weights, setWeights] = useState<FeatureWeight[]>([])
  const [usageFilter, setUsageFilter] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const loadUsage = useCallback(async (userId: string | null) => {
    const { data, error: err } = await supabase.rpc('ai_admin_recent_usage', { p_limit: 100, p_user: userId })
    if (err) setError(err.message)
    else setUsage(data as UsageRow[])
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [s, a, p, pl, w] = await Promise.all([
      supabase.rpc('ai_admin_summary'),
      supabase.rpc('ai_admin_overview'),
      supabase.from('ai_model_prices').select('*').order('model'),
      supabase.from('ai_plans').select('*').order('sort_order'),
      supabase.from('ai_feature_weights').select('feature, multiplier').order('feature')
    ])
    const firstError = s.error ?? a.error ?? p.error ?? pl.error ?? w.error
    if (firstError) setError(firstError.message)
    else {
      setSummary(s.data as Summary)
      setAccounts(a.data as Account[])
      setPrices(p.data as Price[])
      setPlans(pl.data as Plan[])
      setWeights(w.data as FeatureWeight[])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (isAdmin) void loadAll()
  }, [isAdmin, loadAll])

  useEffect(() => {
    if (isAdmin) void loadUsage(usageFilter)
  }, [isAdmin, usageFilter, loadUsage])

  if (!isAdmin) return <p style={{ color: 'var(--fg-muted)' }}>This page is only available to admins.</p>

  const filteredAccount = usageFilter ? accounts.find((a) => a.user_id === usageFilter) : null

  return (
    <div style={pageStyle}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)' }}>
        <h1 style={{ fontSize: 'var(--font-xxl)', margin: 0, letterSpacing: '-0.02em' }}>AI admin</h1>
        <span style={{ fontSize: 'var(--font-sm)', color: 'var(--fg-muted)' }}>Shared Anthropic key · credits reset each billing period (calendar month on Free, UTC)</span>
        <button onClick={() => void loadAll()} disabled={loading} style={{ ...quietButtonStyle, marginLeft: 'auto' }}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>
      {error && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', margin: 0 }}>{error}</p>}

      {summary && (
        <>
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <Tile label="Credits used this month" value={cr(summary.month_credits)} />
            <Tile label="Anthropic spend" value={money(summary.month_cost_usd)} />
            <Tile
              label="Cost / 1,000 credits"
              value={Number(summary.month_credits) > 0 ? money4((Number(summary.month_cost_usd) / Number(summary.month_credits)) * 1000) : '—'}
            />
            <Tile label="Requests" value={String(summary.month_requests)} />
            <Tile label="Active accounts" value={String(summary.active_users)} />
            <Tile label="Credits allotted" value={cr(accounts.reduce((sum, a) => sum + Number(a.credits_allowance), 0))} />
          </div>

          <Card title="Credits used, last 30 days">
            <DailyChart daily={summary.daily} />
          </Card>

          <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
            <Card title="By feature" style={{ flex: 1, minWidth: 220 }}>
              <Breakdown rows={summary.by_feature} />
            </Card>
            <Card title="By model" style={{ flex: 1, minWidth: 220 }}>
              <Breakdown rows={summary.by_model} />
            </Card>
            <Card title="Accounts by plan" style={{ flex: 1, minWidth: 220 }}>
              {summary.by_plan.length === 0 ? (
                <p style={mutedStyle}>No accounts yet.</p>
              ) : (
                summary.by_plan.map((p) => (
                  <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-sm)' }}>
                    <span>{plans.find((x) => x.id === p.name)?.name ?? p.name}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--fg-muted)' }}>{p.accounts}</span>
                  </div>
                ))
              )}
            </Card>
          </div>
        </>
      )}

      <Card title={`Accounts (${accounts.length})`}>
        <AccountsTable
          accounts={accounts}
          plans={plans}
          onSaved={() => void loadAll()}
          onShowUsage={(id) => {
            setUsageFilter(id)
            document.getElementById('admin-usage-log')?.scrollIntoView({ behavior: 'smooth' })
          }}
        />
      </Card>

      <div id="admin-usage-log">
        <Card
          title={filteredAccount ? `Recent requests — ${who(filteredAccount)}` : 'Recent requests'}
          action={
            usageFilter && (
              <button onClick={() => setUsageFilter(null)} style={quietButtonStyle}>
                Show everyone
              </button>
            )
          }
        >
          <UsageTable rows={usage} />
        </Card>
      </div>

      <Card title="Plans">
        <PlansTable plans={plans} onSaved={() => void loadAll()} />
      </Card>

      <Card title="Models, prices & credit weights (per million tokens)">
        <PricesTable prices={prices} onSaved={() => void loadAll()} />
      </Card>

      <Card title="Feature multipliers">
        <FeatureWeightsTable weights={weights} features={summary?.by_feature.map((f) => f.name) ?? []} onSaved={() => void loadAll()} />
      </Card>
    </div>
  )
}

function Tile({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div style={tileStyle}>
      <div style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 'var(--font-xl)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  )
}

function Card({ title, action, children, style }: { title: string; action?: ReactNode; children: ReactNode; style?: CSSProperties }): JSX.Element {
  return (
    <section style={{ ...cardStyle, ...style }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
        <h2 style={{ fontSize: 'var(--font-md)', fontWeight: 600, margin: 0 }}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function DailyChart({ daily }: { daily: Summary['daily'] }): JSX.Element {
  const max = Math.max(...daily.map((d) => Number(d.credits)), 1)
  const barW = 100 / daily.length
  const total = daily.reduce((sum, d) => sum + Number(d.credits), 0)
  return (
    <div>
      <svg viewBox="0 0 100 32" preserveAspectRatio="none" style={{ width: '100%', height: 96, display: 'block' }} role="img" aria-label="Daily credits used, last 30 days">
        <line x1="0" y1="31.5" x2="100" y2="31.5" stroke="var(--border)" strokeWidth="0.3" />
        {daily.map((d, i) => {
          const h = (Number(d.credits) / max) * 30
          return (
            <rect key={d.day} x={i * barW + barW * 0.15} y={31 - h} width={barW * 0.7} height={Math.max(h, Number(d.credits) > 0 ? 0.4 : 0)} fill="var(--accent)" rx="0.2">
              <title>{`${d.day}: ${cr(Number(d.credits))} credits (${money4(Number(d.cost_usd))}) · ${d.requests} request${d.requests === 1 ? '' : 's'}`}</title>
            </rect>
          )
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-xs)', color: 'var(--fg-muted)', marginTop: 4 }}>
        <span>{daily[0]?.day}</span>
        <span>{total === 0 ? 'No usage yet' : `${cr(total)} credits over 30 days · peak ${cr(max)}/day`}</span>
        <span>{daily[daily.length - 1]?.day}</span>
      </div>
    </div>
  )
}

function Breakdown({ rows }: { rows: { name: string; requests: number; credits: number; cost_usd: number }[] }): JSX.Element {
  if (rows.length === 0) return <p style={mutedStyle}>Nothing yet this month.</p>
  const top = Number(rows[0].credits) || 1
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map((r) => (
        <div key={r.name} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-sm)' }}>
            <span>{r.name}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--fg-muted)' }} title={`Anthropic cost ${money4(Number(r.cost_usd))}`}>
              {cr(Number(r.credits))} cr · {r.requests}
            </span>
          </div>
          <div style={{ height: 4, borderRadius: 2, background: 'var(--border)' }}>
            <div style={{ height: '100%', borderRadius: 2, width: `${(Number(r.credits) / top) * 100}%`, background: 'var(--accent)' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function AccountsTable({ accounts, plans, onSaved, onShowUsage }: { accounts: Account[]; plans: Plan[]; onSaved: () => void; onShowUsage: (userId: string) => void }): JSX.Element {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'spend' | 'name' | 'recent'>('spend')
  const [page, setPage] = useState(0)
  const myId = useAuthStore((s) => s.session?.user.id)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = accounts.filter((a) => !q || `${a.email ?? ''} ${a.username ?? ''} ${a.note ?? ''}`.toLowerCase().includes(q))
    return [...filtered].sort((a, b) =>
      sort === 'spend'
        ? Number(b.credits_used) - Number(a.credits_used)
        : sort === 'recent'
          ? (b.last_used_at ?? '').localeCompare(a.last_used_at ?? '')
          : who(a).localeCompare(who(b))
    )
  }, [accounts, query, sort])

  // Paging is client-side over the full list: search and sort both need to span every account, not
  // just the current page, and the list is only ever one row per real (non-guest) sign-up.
  const pageCount = Math.max(1, Math.ceil(rows.length / ACCOUNTS_PER_PAGE))
  const safePage = Math.min(page, pageCount - 1)
  const start = safePage * ACCOUNTS_PER_PAGE
  const pageRows = rows.slice(start, start + ACCOUNTS_PER_PAGE)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setPage(0)
          }}
          placeholder="Search accounts…"
          style={{ ...inputStyle, flex: 1 }}
        />
        <select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value as typeof sort)
            setPage(0)
          }}
          style={inputStyle}
        >
          <option value="spend">Most used</option>
          <option value="recent">Recently active</option>
          <option value="name">Name</option>
        </select>
      </div>
      {pageRows.map((a) => (
        <AccountRow key={a.user_id} account={a} plans={plans} isSelf={a.user_id === myId} onSaved={onSaved} onShowUsage={() => onShowUsage(a.user_id)} />
      ))}
      {rows.length === 0 && <p style={mutedStyle}>No accounts match.</p>}
      {rows.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', justifyContent: 'space-between', paddingTop: 4 }}>
          <span style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {start + 1}–{start + pageRows.length} of {rows.length}
          </span>
          {pageCount > 1 && (
            <div style={{ display: 'flex', gap: 4 }}>
              <button disabled={safePage === 0} onClick={() => setPage(safePage - 1)} style={pagerButtonStyle}>
                ‹ Prev
              </button>
              {pageCount <= 8 &&
                Array.from({ length: pageCount }, (_, i) => (
                  <button key={i} onClick={() => setPage(i)} style={i === safePage ? pagerButtonActiveStyle : pagerButtonStyle}>
                    {i + 1}
                  </button>
                ))}
              <button disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)} style={pagerButtonStyle}>
                Next ›
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AccountRow({ account, plans, isSelf, onSaved, onShowUsage }: { account: Account; plans: Plan[]; isSelf: boolean; onSaved: () => void; onShowUsage: () => void }): JSX.Element {
  const reloadAdminFlag = useAiAdminStore((s) => s.load)
  const [override, setOverride] = useState(account.credits_override == null ? '' : String(account.credits_override))
  const [rpm, setRpm] = useState(account.rpm_override == null ? '' : String(account.rpm_override))
  const [disabled, setDisabled] = useState(account.disabled)
  const [note, setNote] = useState(account.note ?? '')
  const [grant, setGrant] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Blank = "follow the plan". Anything else must be a whole number.
  const overrideNum = override.trim() === '' ? null : Number(override)
  const rpmNum = rpm.trim() === '' ? null : Number(rpm)
  const valid =
    (overrideNum === null || (Number.isInteger(overrideNum) && overrideNum >= 0)) && (rpmNum === null || (Number.isInteger(rpmNum) && rpmNum > 0))
  const dirty =
    overrideNum !== account.credits_override || rpmNum !== account.rpm_override || disabled !== account.disabled || note !== (account.note ?? '')
  const used = Number(account.credits_used)
  const allowance = Number(account.credits_allowance)
  const fraction = allowance > 0 ? Math.min(1, used / allowance) : used > 0 ? 1 : 0
  // A plan owned by the billing provider can't be edited here — the next webhook would just undo it.
  const planLocked = account.plan_source !== 'free' && account.plan_source !== 'manual'

  async function save(): Promise<void> {
    setSaving(true)
    setError(null)
    const { error: err } = await supabase.rpc('ai_admin_set_quota', {
      p_target: account.user_id,
      p_credits_override: overrideNum,
      p_rpm_override: rpmNum,
      p_disabled: disabled,
      p_note: note.trim() || null
    })
    setSaving(false)
    if (err) setError(err.message)
    else onSaved()
  }

  async function changePlan(planId: string): Promise<void> {
    const name = who(account)
    const label = plans.find((p) => p.id === planId)?.name ?? planId
    const message =
      planId === 'free'
        ? `Move ${name} back to Free?`
        : `Give ${name} the ${label} plan for 30 days? This is a manual comp — it lapses back to Free on its own.`
    if (!window.confirm(message)) return
    setError(null)
    const { error: err } = await supabase.rpc('ai_admin_set_plan', { p_target: account.user_id, p_plan: planId, p_days: 30 })
    if (err) setError(err.message)
    else onSaved()
  }

  async function grantCredits(): Promise<void> {
    const amount = Number(grant)
    if (!Number.isInteger(amount) || amount <= 0) return
    setSaving(true)
    setError(null)
    const { error: err } = await supabase.rpc('ai_admin_grant_credits', {
      p_target: account.user_id,
      p_credits: amount,
      p_reason: 'admin grant'
    })
    setSaving(false)
    if (err) setError(err.message)
    else {
      setGrant('')
      onSaved()
    }
  }

  async function setAdmin(makeAdmin: boolean): Promise<void> {
    const name = who(account)
    const message = makeAdmin
      ? `Make ${name} an admin? They'll be able to see every account's usage, change budgets and prices, and add or remove other admins.`
      : isSelf
        ? 'Remove your own admin access? You will lose this page immediately.'
        : `Remove admin access from ${name}?`
    if (!window.confirm(message)) return
    setError(null)
    const { error: err } = await supabase.rpc('ai_admin_set_admin', { target: account.user_id, make_admin: makeAdmin })
    if (err) {
      setError(err.message)
      return
    }
    // Demoting yourself flips this page off; the store re-check handles that without a restart.
    if (isSelf) await reloadAdminFlag()
    onSaved()
  }

  return (
    <div style={{ ...accountRowStyle, opacity: disabled ? 0.6 : 1 }}>
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <div style={{ fontSize: 'var(--font-sm)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {who(account)}
          {account.is_admin && <span style={adminBadgeStyle}>admin</span>}
          {isSelf && <span style={{ fontWeight: 400, color: 'var(--fg-muted)' }}> (you)</span>}
        </div>
        <div style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {account.username && account.email ? `${account.email} · ` : ''}last used {relativeTime(account.last_used_at)}
        </div>
        <div style={{ height: 4, borderRadius: 2, background: 'var(--border)', marginTop: 4 }}>
          <div style={{ height: '100%', borderRadius: 2, width: `${fraction * 100}%`, background: fraction > 0.9 ? 'var(--danger)' : 'var(--accent)' }} />
        </div>
        <div style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-muted)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
          {cr(used)} of {cr(allowance)} credits · {money(Number(account.cost_period_usd))} cost
        </div>
        {error && <div style={{ fontSize: 'var(--font-xs)', color: 'var(--danger)' }}>{error}</div>}
      </div>
      <select
        value={account.plan_id}
        disabled={planLocked}
        onChange={(e) => void changePlan(e.target.value)}
        style={inputStyle}
        title={planLocked ? `Managed by ${account.plan_source} — change it there` : 'Comp this account onto a plan for 30 days'}
      >
        {plans.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <label style={fieldStyle} title="Credits per period for this account only — leave blank to follow the plan">
        <input value={override} onChange={(e) => setOverride(e.target.value)} placeholder="plan" inputMode="numeric" style={{ ...inputStyle, width: 60 }} /> cr
      </label>
      <label style={fieldStyle} title="Max requests per minute — leave blank to follow the plan">
        <input value={rpm} onChange={(e) => setRpm(e.target.value)} placeholder="plan" inputMode="numeric" style={{ ...inputStyle, width: 44 }} /> /min
      </label>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note" style={{ ...inputStyle, width: 110 }} />
      <label style={fieldStyle} title="Block this account from AI entirely">
        <input type="checkbox" checked={disabled} onChange={(e) => setDisabled(e.target.checked)} /> off
      </label>
      <button onClick={() => void setAdmin(!account.is_admin)} style={quietButtonStyle} title={account.is_admin ? 'Remove admin access' : 'Give this account admin access'}>
        {account.is_admin ? 'Remove admin' : 'Make admin'}
      </button>
      <label style={fieldStyle} title="One-off extra credits, valid until the end of their current period">
        +<input value={grant} onChange={(e) => setGrant(e.target.value)} inputMode="numeric" style={{ ...inputStyle, width: 52 }} />
        <button disabled={saving || !(Number(grant) > 0)} onClick={() => void grantCredits()} style={quietButtonStyle}>grant</button>
      </label>
      <button onClick={onShowUsage} style={quietButtonStyle} title="Show this account's recent requests">
        Requests
      </button>
      <button disabled={!dirty || !valid || saving} onClick={() => void save()} style={saveButtonStyle}>
        {saving ? '…' : 'Save'}
      </button>
    </div>
  )
}

function UsageTable({ rows }: { rows: UsageRow[] }): JSX.Element {
  if (rows.length === 0) return <p style={mutedStyle}>No requests yet.</p>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={tableStyle}>
        <thead>
          <tr>
            {['When', 'Account', 'Feature', 'Model', 'In', 'Out', 'Credits', 'Cost'].map((h) => (
              <th key={h} style={thStyle}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={tdStyle} title={new Date(r.created_at).toLocaleString()}>{relativeTime(r.created_at)}</td>
              <td style={tdStyle}>{who(r)}</td>
              <td style={tdStyle}>{r.feature}</td>
              <td style={tdStyle}>{r.model}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{r.input_tokens.toLocaleString()}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{r.output_tokens.toLocaleString()}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{Number(r.credits).toFixed(1)}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{money4(Number(r.cost_usd))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PricesTable({ prices, onSaved }: { prices: Price[]; onSaved: () => void }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <p style={{ ...mutedStyle, margin: 0 }}>
        A model with no row here — or switched off — is rejected by the proxy. USD is Anthropic's real price (margin tracking only);
        credits are what a user's allowance is charged in, and can be tuned independently. Changes only affect future requests.
      </p>
      {prices.map((p) => (
        <PriceRow key={p.model} price={p} onSaved={onSaved} />
      ))}
      <PriceRow key={`new-${prices.length}`} price={{ model: '', input_usd_per_mtok: 0, output_usd_per_mtok: 0, input_credits_per_mtok: 0, output_credits_per_mtok: 0, enabled: true }} isNew onSaved={onSaved} />
    </div>
  )
}

function PriceRow({ price, isNew, onSaved }: { price: Price; isNew?: boolean; onSaved: () => void }): JSX.Element {
  const [model, setModel] = useState(price.model)
  const [input, setInput] = useState(String(price.input_usd_per_mtok))
  const [output, setOutput] = useState(String(price.output_usd_per_mtok))
  const [inCredits, setInCredits] = useState(String(price.input_credits_per_mtok))
  const [outCredits, setOutCredits] = useState(String(price.output_credits_per_mtok))
  const [enabled, setEnabled] = useState(price.enabled)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const inNum = Number(input)
  const outNum = Number(output)
  const inCrNum = Number(inCredits)
  const outCrNum = Number(outCredits)
  const valid =
    model.trim() !== '' && [input, output, inCredits, outCredits].every((v) => v.trim() !== '') && inNum >= 0 && outNum >= 0 && inCrNum >= 0 && outCrNum >= 0
  const dirty =
    isNew ||
    inNum !== Number(price.input_usd_per_mtok) ||
    outNum !== Number(price.output_usd_per_mtok) ||
    inCrNum !== Number(price.input_credits_per_mtok) ||
    outCrNum !== Number(price.output_credits_per_mtok) ||
    enabled !== price.enabled

  async function save(): Promise<void> {
    setSaving(true)
    setError(null)
    const { error: err } = await supabase.rpc('ai_admin_set_price', {
      p_model: model.trim(),
      p_input_usd: inNum,
      p_output_usd: outNum,
      p_input_credits: inCrNum,
      p_output_credits: outCrNum,
      p_enabled: enabled
    })
    setSaving(false)
    if (err) setError(err.message)
    else onSaved()
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
      {isNew ? (
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="add model id, e.g. claude-opus-5" style={{ ...inputStyle, flex: '1 1 200px' }} />
      ) : (
        <span style={{ flex: '1 1 200px', fontSize: 'var(--font-sm)', fontFamily: 'ui-monospace, monospace' }}>{price.model}</span>
      )}
      <label style={fieldStyle}>in $ <input value={input} onChange={(e) => setInput(e.target.value)} inputMode="decimal" style={{ ...inputStyle, width: 56 }} /></label>
      <label style={fieldStyle}>out $ <input value={output} onChange={(e) => setOutput(e.target.value)} inputMode="decimal" style={{ ...inputStyle, width: 56 }} /></label>
      <label style={fieldStyle}>in cr <input value={inCredits} onChange={(e) => setInCredits(e.target.value)} inputMode="decimal" style={{ ...inputStyle, width: 64 }} /></label>
      <label style={fieldStyle}>out cr <input value={outCredits} onChange={(e) => setOutCredits(e.target.value)} inputMode="decimal" style={{ ...inputStyle, width: 64 }} /></label>
      <label style={fieldStyle}><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> allowed</label>
      <button disabled={!dirty || !valid || saving} onClick={() => void save()} style={saveButtonStyle}>{saving ? '…' : isNew ? 'Add' : 'Save'}</button>
      {error && <span style={{ fontSize: 'var(--font-xs)', color: 'var(--danger)' }}>{error}</span>}
    </div>
  )
}

function PlansTable({ plans, onSaved }: { plans: Plan[]; onSaved: () => void }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <p style={{ ...mutedStyle, margin: 0 }}>
        What each plan promises: credits per period, requests per minute, and which models it may use (blank = every enabled model).
        Editing a plan changes it for everyone on it, immediately.
      </p>
      {plans.map((p) => (
        <PlanRow key={p.id} plan={p} onSaved={onSaved} />
      ))}
      <PlanRow key={`new-${plans.length}`} plan={{ id: '', name: '', monthly_credits: 0, requests_per_minute: 20, models: null, sort_order: (plans.length + 1) * 10 }} isNew onSaved={onSaved} />
    </div>
  )
}

function PlanRow({ plan, isNew, onSaved }: { plan: Plan; isNew?: boolean; onSaved: () => void }): JSX.Element {
  const [id, setId] = useState(plan.id)
  const [name, setName] = useState(plan.name)
  const [creditsText, setCreditsText] = useState(String(plan.monthly_credits))
  const [rpmText, setRpmText] = useState(String(plan.requests_per_minute))
  const [modelsText, setModelsText] = useState((plan.models ?? []).join(', '))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const creditsNum = Number(creditsText)
  const rpmNum = Number(rpmText)
  const models = modelsText.split(',').map((m) => m.trim()).filter(Boolean)
  const valid =
    /^[a-z0-9_]+$/.test(id.trim()) && name.trim() !== '' && Number.isInteger(creditsNum) && creditsNum >= 0 && Number.isInteger(rpmNum) && rpmNum > 0
  const dirty =
    isNew ||
    name !== plan.name ||
    creditsNum !== plan.monthly_credits ||
    rpmNum !== plan.requests_per_minute ||
    models.join(',') !== (plan.models ?? []).join(',')

  async function save(): Promise<void> {
    setSaving(true)
    setError(null)
    const { error: err } = await supabase.rpc('ai_admin_upsert_plan', {
      p_id: id.trim(),
      p_name: name.trim(),
      p_credits: creditsNum,
      p_rpm: rpmNum,
      p_models: models.length > 0 ? models : null,
      p_sort: plan.sort_order
    })
    setSaving(false)
    if (err) setError(err.message)
    else onSaved()
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
      {isNew ? (
        <input value={id} onChange={(e) => setId(e.target.value)} placeholder="id, e.g. team" style={{ ...inputStyle, width: 90 }} />
      ) : (
        <span style={{ width: 90, fontSize: 'var(--font-sm)', fontFamily: 'ui-monospace, monospace' }}>{plan.id}</span>
      )}
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="name" style={{ ...inputStyle, width: 90 }} />
      <label style={fieldStyle}><input value={creditsText} onChange={(e) => setCreditsText(e.target.value)} inputMode="numeric" style={{ ...inputStyle, width: 70 }} /> credits</label>
      <label style={fieldStyle}><input value={rpmText} onChange={(e) => setRpmText(e.target.value)} inputMode="numeric" style={{ ...inputStyle, width: 44 }} /> /min</label>
      <input value={modelsText} onChange={(e) => setModelsText(e.target.value)} placeholder="all models" style={{ ...inputStyle, flex: '1 1 160px' }} title="Comma-separated model ids; blank = every enabled model" />
      <button disabled={!dirty || !valid || saving} onClick={() => void save()} style={saveButtonStyle}>{saving ? '…' : isNew ? 'Add' : 'Save'}</button>
      {error && <span style={{ fontSize: 'var(--font-xs)', color: 'var(--danger)' }}>{error}</span>}
    </div>
  )
}

function FeatureWeightsTable({ weights, features, onSaved }: { weights: FeatureWeight[]; features: string[]; onSaved: () => void }): JSX.Element {
  const known = new Set(weights.map((w) => w.feature))
  const rows: FeatureWeight[] = [...weights, ...features.filter((f) => !known.has(f)).map((feature) => ({ feature, multiplier: 1 }))]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <p style={{ ...mutedStyle, margin: 0 }}>
        Scales the credits a feature charges on top of the model weights — 1 is neutral, 0.5 makes it half as expensive for users, 0 makes it
        free. Features with no row charge 1x.
      </p>
      {rows.length === 0 && <p style={mutedStyle}>No AI features used yet.</p>}
      {rows.map((w) => (
        <FeatureWeightRow key={w.feature} weight={w} onSaved={onSaved} />
      ))}
    </div>
  )
}

function FeatureWeightRow({ weight, onSaved }: { weight: FeatureWeight; onSaved: () => void }): JSX.Element {
  const [text, setText] = useState(String(weight.multiplier))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const num = Number(text)
  const valid = text.trim() !== '' && Number.isFinite(num) && num >= 0

  async function save(): Promise<void> {
    setSaving(true)
    setError(null)
    const { error: err } = await supabase.rpc('ai_admin_set_feature_weight', { p_feature: weight.feature, p_multiplier: num })
    setSaving(false)
    if (err) setError(err.message)
    else onSaved()
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      <span style={{ flex: '1 1 160px', fontSize: 'var(--font-sm)', fontFamily: 'ui-monospace, monospace' }}>{weight.feature}</span>
      <label style={fieldStyle}>× <input value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" style={{ ...inputStyle, width: 56 }} /></label>
      <button disabled={!valid || num === Number(weight.multiplier) || saving} onClick={() => void save()} style={saveButtonStyle}>{saving ? '…' : 'Save'}</button>
      {error && <span style={{ fontSize: 'var(--font-xs)', color: 'var(--danger)' }}>{error}</span>}
    </div>
  )
}

const pageStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: 980 }
const cardStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', padding: 'var(--space-4)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }
const tileStyle: CSSProperties = { flex: '1 1 160px', display: 'flex', flexDirection: 'column', gap: 2, padding: 'var(--space-3) var(--space-4)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }
const mutedStyle: CSSProperties = { fontSize: 'var(--font-sm)', color: 'var(--fg-muted)' }
const accountRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', padding: '8px 0', borderTop: '1px solid var(--border)' }
const fieldStyle: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 'var(--font-xs)', color: 'var(--fg-muted)' }
const inputStyle: CSSProperties = { fontSize: 'var(--font-sm)', padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg)', color: 'inherit' }
const saveButtonStyle: CSSProperties = { border: '1px solid var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent)', fontWeight: 600, borderRadius: 'var(--radius-sm)', padding: '4px 12px', cursor: 'pointer', fontSize: 'var(--font-xs)' }
const quietButtonStyle: CSSProperties = { border: 'none', background: 'none', color: 'var(--fg-muted)', cursor: 'pointer', fontSize: 'var(--font-xs)' }
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-sm)', fontVariantNumeric: 'tabular-nums' }
const thStyle: CSSProperties = { textAlign: 'left', padding: '4px 8px', fontSize: 'var(--font-xs)', color: 'var(--fg-muted)', fontWeight: 600, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const tdStyle: CSSProperties = { padding: '4px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const adminBadgeStyle: CSSProperties = {
  marginLeft: 6,
  padding: '1px 7px',
  borderRadius: 999,
  fontSize: 'var(--font-xs)',
  fontWeight: 600,
  color: 'var(--accent)',
  background: 'var(--accent-soft)'
}
const pagerButtonStyle: CSSProperties = {
  border: '1px solid var(--border)',
  background: 'none',
  color: 'inherit',
  borderRadius: 'var(--radius-sm)',
  padding: '2px 9px',
  cursor: 'pointer',
  fontSize: 'var(--font-xs)'
}
const pagerButtonActiveStyle: CSSProperties = {
  ...pagerButtonStyle,
  border: '1px solid var(--accent)',
  background: 'var(--accent-soft)',
  color: 'var(--accent)',
  fontWeight: 600
}
