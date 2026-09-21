import { useMemo, type CSSProperties } from 'react'
import type { CardRecord, ReviewLogEntry } from '../../../../shared/types'
import { useAuthStore } from '../../state/authStore'
import { useCardsStore } from '../../state/cardsStore'
import { useFoldersStore } from '../../state/foldersStore'
import { useDocumentsStore } from '../../state/documentsStore'
import { useReviewLogStore } from '../../state/reviewLogStore'
import { useUiStore } from '../../state/uiStore'
import { computeReviewStats } from '../../utils/reviewStats'
import { dueCards } from '../../utils/srsQueue'
import { formatDuration } from '../../utils/formatDuration'
import { DocTypeIcon, Icon } from '../Icon'
import {
  bigNumberStyle,
  countPillStyle,
  EmptyHint,
  eyebrowStyle,
  listStyle,
  panelStyle,
  panelTitleStyle,
  primaryPillStyle as primaryButtonStyle,
  rowLabelStyle,
  rowMetaStyle,
  rowStyle,
  secondaryPillStyle as secondaryButtonStyle
} from '../dashboardKit'

const DAY_MS = 86400000
const ACTIVITY_DAYS = 14

function greetingFor(now: Date): string {
  const h = now.getHours()
  return h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/** Review counts for each of the last `days` local calendar days, oldest first, ending today. */
function dailyReviewCounts(log: ReviewLogEntry[], now: Date, days: number): { date: Date; count: number }[] {
  const counts = new Map<string, number>()
  for (const entry of log) {
    const key = localDayKey(new Date(entry.reviewedAt))
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const out: { date: Date; count: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    out.push({ date, count: counts.get(localDayKey(date)) ?? 0 })
  }
  return out
}

/** When the soonest not-yet-due card comes up, in words — null if every card is already due. */
function nextDueLabel(cards: CardRecord[], now: Date): string | null {
  let soonest: number | null = null
  for (const c of cards) {
    const t = new Date(c.dueAt).getTime()
    if (t > now.getTime() && (soonest === null || t < soonest)) soonest = t
  }
  if (soonest === null) return null
  const mins = Math.round((soonest - now.getTime()) / 60000)
  if (mins < 60) return `in ${Math.max(mins, 1)} min`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `in ${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.round((soonest - now.getTime()) / DAY_MS)
  return days <= 1 ? 'tomorrow' : `in ${days} days`
}

/** The Home dashboard: what to do today (review), how you're doing (streak, activity), and quick ways
 *  back into your material (folders with cards due, recent documents and cards). Everything here is
 *  derived from data the app already holds — nothing is fetched. */
export function HomePage(): JSX.Element {
  const session = useAuthStore((s) => s.session)
  const cards = useCardsStore((s) => s.cards)
  const folders = useFoldersStore((s) => s.folders)
  const documents = useDocumentsStore((s) => s.documents)
  const openDocument = useDocumentsStore((s) => s.openDocument)
  const log = useReviewLogStore((s) => s.entries)
  const setView = useUiStore((s) => s.setView)

  const now = new Date()
  const stats = useMemo(() => computeReviewStats(cards, log, new Date()), [cards, log])
  const activity = useMemo(() => dailyReviewCounts(log, new Date(), ACTIVITY_DAYS), [log])
  const dueCount = dueCards(cards, { kind: 'all' }, now).length
  const nextDue = dueCount === 0 ? nextDueLabel(cards, now) : null

  const name = (session?.user.user_metadata?.username as string | undefined) ?? session?.user.email?.split('@')[0] ?? null
  const weekReviews = activity.slice(-7).reduce((sum, d) => sum + d.count, 0)
  const last7Active = activity.slice(-7).map((d) => d.count > 0)

  const dueByFolder = folders
    .map((folder) => ({ folder, due: dueCards(cards, { kind: 'folder', folderId: folder.id }, now).length }))
    .filter((f) => f.due > 0)
    .sort((a, b) => b.due - a.due)
    .slice(0, 5)

  const recentDocuments = [...documents].sort((a, b) => (a.importedAt < b.importedAt ? 1 : -1)).slice(0, 4)
  const recentCards = [...cards].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 5)

  const reviewedShare = stats.reviewedToday + dueCount > 0 ? stats.reviewedToday / (stats.reviewedToday + dueCount) : 0

  function startReview(): void {
    setView({ type: 'review-dashboard' })
  }

  return (
    <div style={pageStyle}>
      <header className="home-rise" style={{ animationDelay: '0ms' }}>
        <h1 style={{ fontSize: 'var(--font-xxl)', margin: 0, letterSpacing: '-0.02em' }}>
          {greetingFor(now)}
          {name ? `, ${name}` : ''}
        </h1>
        <p style={{ color: 'var(--fg-muted)', margin: 'var(--space-1) 0 0' }}>
          {dueCount > 0
            ? `${dueCount} card${dueCount === 1 ? ' is' : 's are'} waiting for you today.`
            : cards.length === 0
              ? 'Import a document and make your first flashcards.'
              : "You're all caught up."}
        </p>
      </header>

      <div className="home-rise" style={{ ...heroRowStyle, animationDelay: '60ms' }}>
        <section style={{ ...panelStyle, ...todayPanelStyle }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div style={eyebrowStyle}>Today</div>
            {dueCount > 0 ? (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
                  <span style={bigNumberStyle}>{dueCount}</span>
                  <span style={{ color: 'var(--fg-muted)' }}>card{dueCount === 1 ? '' : 's'} due</span>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <button onClick={startReview} style={primaryButtonStyle}>
                    <Icon name="play" size="0.85em" />Start review
                  </button>
                  <button
                    onClick={() => setView({ type: 'review-dashboard' })}
                    style={secondaryButtonStyle}
                    title="Choose which folders to review, or review everything regardless of schedule"
                  >
                    Choose what to review
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--font-lg)', fontWeight: 600 }}>
                  <span style={{ color: 'var(--accent)', display: 'inline-flex' }}>
                    <Icon name="check-circle" bare size="1.3em" />
                  </span>
                  Nothing due right now
                </div>
                <p style={{ color: 'var(--fg-muted)', margin: 0, fontSize: 'var(--font-sm)' }}>
                  {cards.length === 0
                    ? 'Cards you create will show up here when they need reviewing.'
                    : nextDue
                      ? `Your next card is due ${nextDue}.`
                      : 'Every card has been reviewed.'}
                </p>
                {cards.length > 0 && (
                  <div>
                    <button onClick={startReview} style={secondaryButtonStyle}>
                      <Icon name="flame" />Review anyway
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
          <ProgressRing share={reviewedShare} done={stats.reviewedToday} />
        </section>

        <section style={{ ...panelStyle, ...streakPanelStyle }}>
          <div style={eyebrowStyle}>Streak</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span style={{ color: stats.streakDays > 0 ? 'var(--accent)' : 'var(--fg-faint)', display: 'inline-flex' }}>
              <Icon name="flame" bare size={26} />
            </span>
            <span style={bigNumberStyle}>{stats.streakDays}</span>
            <span style={{ color: 'var(--fg-muted)' }}>day{stats.streakDays === 1 ? '' : 's'}</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }} title="Your last 7 days">
            {last7Active.map((active, i) => (
              <span
                key={i}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: active ? 'var(--accent)' : 'transparent',
                  border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`
                }}
              />
            ))}
          </div>
        </section>
      </div>

      <section className="home-rise" style={{ ...panelStyle, animationDelay: '120ms' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
          <h2 style={panelTitleStyle}>Activity</h2>
          <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--font-sm)' }}>
            {weekReviews} review{weekReviews === 1 ? '' : 's'} this week
          </span>
        </div>
        <ActivityBars days={activity} />
        <div style={statStripStyle}>
          <Stat label="Flashcards" value={cards.length} onClick={() => setView({ type: 'cards' })} />
          <Stat label="Mature" value={stats.matureCards} />
          <Stat label="New" value={stats.newCards} />
          <Stat label="Documents" value={documents.length} onClick={() => setView({ type: 'library-index' })} />
          <Stat label="Folders" value={folders.length} onClick={() => setView({ type: 'folders-index' })} />
        </div>
      </section>

      <div className="home-rise" style={{ ...columnsStyle, animationDelay: '180ms' }}>
        <section style={panelStyle}>
          <h2 style={panelTitleStyle}>Due by folder</h2>
          {dueByFolder.length === 0 ? (
            <EmptyHint text={folders.length === 0 ? 'Make a folder to group cards by topic.' : 'No folder has cards due.'} />
          ) : (
            <div style={listStyle}>
              {dueByFolder.map(({ folder, due }) => (
                <button
                  key={folder.id}
                  onClick={() => setView({ type: 'review', scope: { kind: 'folder', folderId: folder.id }, returnTo: { type: 'home' } })}
                  style={rowStyle}
                  title={`Review ${folder.name}`}
                >
                  <span style={rowLabelStyle}>
                    <Icon name="folder" />
                    {folder.name}
                  </span>
                  <span style={countPillStyle}>{due}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section style={panelStyle}>
          <h2 style={panelTitleStyle}>Recent documents</h2>
          {recentDocuments.length === 0 ? (
            <EmptyHint text="Nothing imported yet." />
          ) : (
            <div style={listStyle}>
              {recentDocuments.map((doc) => (
                <button
                  key={doc.id}
                  onClick={async () => {
                    setView({ type: 'library' })
                    await openDocument(doc.id)
                  }}
                  style={rowStyle}
                >
                  <span style={rowLabelStyle}>
                    <DocTypeIcon type={doc.type} />
                    <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{doc.filename}</span>
                  </span>
                  <span style={rowMetaStyle}>
                    {doc.type === 'video'
                      ? doc.lastPlaybackSeconds
                        ? `at ${formatDuration(doc.lastPlaybackSeconds)}`
                        : doc.durationSeconds !== null
                          ? formatDuration(doc.durationSeconds)
                          : ''
                      : doc.lastPageIndex !== null
                        ? `p. ${doc.lastPageIndex + 1}/${doc.pageCount}`
                        : `${doc.pageCount}p`}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section style={panelStyle}>
          <h2 style={panelTitleStyle}>Recent cards</h2>
          {recentCards.length === 0 ? (
            <EmptyHint text="Nothing created yet." />
          ) : (
            <div style={listStyle}>
              {recentCards.map((card) => {
                const folder = card.folderId ? folders.find((f) => f.id === card.folderId) : null
                return (
                  <button
                    key={card.id}
                    onClick={() => setView(card.folderId ? { type: 'folder', folderId: card.folderId } : { type: 'cards' })}
                    style={rowStyle}
                  >
                    <span style={{ ...rowLabelStyle, alignItems: 'flex-start' }}>
                      <span style={{ minWidth: 0, overflowWrap: 'anywhere', lineHeight: 1.35 }}>{card.front.trim() || '(no question yet)'}</span>
                    </span>
                    {folder && <span style={rowMetaStyle}>{folder.name}</span>}
                  </button>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

/** Circular progress for today: how much of the day's total (already reviewed + still due) is done. */
function ProgressRing({ share, done }: { share: number; done: number }): JSX.Element {
  const r = 34
  const c = 2 * Math.PI * r
  return (
    <div style={{ position: 'relative', width: 88, height: 88, flexShrink: 0 }} title={`${done} reviewed today`}>
      <svg viewBox="0 0 88 88" width="88" height="88" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="44" cy="44" r={r} fill="none" stroke="var(--border)" strokeWidth="7" />
        <circle
          cx="44"
          cy="44"
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - share)}
          style={{ transition: 'stroke-dashoffset 600ms cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 'var(--font-xl)', fontWeight: 700, lineHeight: 1 }}>{done}</span>
        <span style={{ fontSize: 10, color: 'var(--fg-muted)', marginTop: 2 }}>today</span>
      </div>
    </div>
  )
}

/** A bar per day for the last two weeks; today's bar is the accent colour, the rest are muted. */
function ActivityBars({ days }: { days: { date: Date; count: number }[] }): JSX.Element {
  const max = Math.max(1, ...days.map((d) => d.count))
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 64 }}>
        {days.map((d, i) => {
          const isToday = i === days.length - 1
          const h = d.count === 0 ? 3 : Math.max(6, (d.count / max) * 64)
          return (
            <div
              key={d.date.toISOString()}
              title={`${d.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}: ${d.count} review${d.count === 1 ? '' : 's'}`}
              style={{
                flex: 1,
                height: h,
                borderRadius: 4,
                background: isToday ? 'var(--accent)' : d.count === 0 ? 'var(--border)' : 'color-mix(in srgb, var(--accent) 38%, var(--border))',
                transition: 'height 500ms cubic-bezier(0.22, 1, 0.36, 1)'
              }}
            />
          )
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 10, color: 'var(--fg-faint)' }}>
        <span>{days[0].date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
        <span>Today</span>
      </div>
    </div>
  )
}

function Stat({ label, value, onClick }: { label: string; value: number; onClick?: () => void }): JSX.Element {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag onClick={onClick} style={{ ...statStyle, cursor: onClick ? 'pointer' : 'default' }}>
      <span style={{ fontSize: 'var(--font-lg)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      <span style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-muted)' }}>{label}</span>
    </Tag>
  )
}

const pageStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', maxWidth: 940 }

const heroRowStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(190px, 1fr)', gap: 'var(--space-4)' }

// alignItems: start — each panel keeps its natural height instead of stretching to match the tallest
// (Recent cards), which left the shorter lists half empty.
const columnsStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
  gap: 'var(--space-4)',
  alignItems: 'start'
}

const todayPanelStyle: CSSProperties = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 'var(--space-4)',
  padding: 'var(--space-5)',
  // A faint accent wash so the day's main action reads as the focal card, not just another panel.
  background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 9%, var(--bg)), var(--bg) 70%)'
}

const streakPanelStyle: CSSProperties = { justifyContent: 'center', gap: 'var(--space-3)', padding: 'var(--space-5)' }

const statStripStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--space-2)',
  paddingTop: 'var(--space-3)',
  borderTop: '1px solid var(--border)'
}

const statStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 2,
  flex: '1 1 90px',
  padding: '6px 10px',
  border: 'none',
  borderRadius: 'var(--radius-row)',
  textAlign: 'left',
  color: 'inherit'
}

