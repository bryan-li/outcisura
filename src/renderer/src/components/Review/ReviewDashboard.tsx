import { useEffect, useState, type CSSProperties } from 'react'
import type { CardRecord, FolderRecord } from '../../../../shared/types'
import { formatInterval } from '../../../../shared/srs'
import { useCardsStore } from '../../state/cardsStore'
import { useFoldersStore } from '../../state/foldersStore'
import { useReviewLogStore } from '../../state/reviewLogStore'
import { useReviewSessionsStore } from '../../state/reviewSessionsStore'
import { useUiStore, type ReviewScope } from '../../state/uiStore'
import { allCardsInScope, dueCards, upcomingCards } from '../../utils/srsQueue'
import { computeReviewStats } from '../../utils/reviewStats'
import { getChildren } from '../../utils/folderTree'
import { formatDuration } from '../../utils/formatDuration'
import {
  bigNumberStyle,
  countPillStyle,
  EmptyHint,
  eyebrowStyle,
  listStyle,
  panelStyle,
  panelTitleStyle,
  primaryPillStyle,
  rowLabelStyle,
  rowMetaStyle,
  rowStyle,
  secondaryPillStyle
} from '../dashboardKit'
import { ReviewHeatmap } from './ReviewHeatmap'
import { Icon } from '../Icon'

function formatDueIn(dueAt: string, now: Date): string {
  const diffDays = (new Date(dueAt).getTime() - now.getTime()) / 86400000
  return diffDays <= 0 ? 'now' : formatInterval(diffDays)
}

/** The Review tab: start a session (all cards, or just the folders you tick), see how you're doing
 *  (streak, today, average session, how your cards are maturing), and what's coming up. The session
 *  itself lives in ReviewSession — this page only chooses the scope and launches it. */
export function ReviewDashboard(): JSX.Element {
  const cards = useCardsStore((s) => s.cards)
  const folders = useFoldersStore((s) => s.folders)
  const logEntries = useReviewLogStore((s) => s.entries)
  const loadReviewLog = useReviewLogStore((s) => s.loadReviewLog)
  const reviewSessions = useReviewSessionsStore((s) => s.sessions)
  const loadReviewSessions = useReviewSessionsStore((s) => s.loadReviewSessions)
  const setView = useUiStore((s) => s.setView)
  const focusCard = useUiStore((s) => s.focusCard)

  // Re-fetch every time the dashboard is landed on, so its stats reflect anything graded/reviewed
  // since the app booted — neither log otherwise live-updates mid-session (see reviewLogStore).
  useEffect(() => {
    loadReviewLog()
    loadReviewSessions()
  }, [loadReviewLog, loadReviewSessions])

  const avgSessionSeconds =
    reviewSessions.length > 0 ? reviewSessions.reduce((sum, s) => sum + s.durationSeconds, 0) / reviewSessions.length : null

  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set())

  function toggleFolder(id: string): void {
    setSelectedFolderIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const now = new Date()
  const stats = computeReviewStats(cards, logEntries, now)

  const scope: ReviewScope =
    selectedFolderIds.size === 0
      ? { kind: 'all' }
      : selectedFolderIds.size === 1
        ? { kind: 'folder', folderId: [...selectedFolderIds][0] }
        : { kind: 'folders', folderIds: [...selectedFolderIds] }

  const upcoming = upcomingCards(cards, scope, 8)
  const dueInScope = dueCards(cards, scope, now).length
  const totalInScope = allCardsInScope(cards, scope).length
  const scopeLabel =
    selectedFolderIds.size === 0
      ? 'across all your cards'
      : `in ${selectedFolderIds.size} selected folder${selectedFolderIds.size === 1 ? '' : 's'}`

  // How the deck is maturing: new (never reviewed), mature (interval >= 21 days, Anki's own threshold —
  // see computeReviewStats) and everything in between.
  const youngCards = Math.max(0, stats.totalCards - stats.newCards - stats.matureCards)

  function startReview(): void {
    setView({ type: 'review', scope, returnTo: { type: 'review-dashboard' } })
  }

  function startCramSession(): void {
    setView({ type: 'review', scope, returnTo: { type: 'review-dashboard' }, force: true })
  }

  return (
    <div style={pageStyle}>
      <header className="home-rise" style={{ animationDelay: '0ms' }}>
        <h1 style={{ fontSize: 'var(--font-xxl)', margin: 0, letterSpacing: '-0.02em' }}>Review</h1>
        <p style={{ color: 'var(--fg-muted)', margin: 'var(--space-1) 0 0' }}>
          Start a session, or pick the folders you want to focus on.
        </p>
      </header>

      <div className="home-rise" style={{ ...heroRowStyle, animationDelay: '60ms' }}>
        <section style={{ ...panelStyle, ...sessionPanelStyle }}>
          <div style={eyebrowStyle}>Session</div>
          {totalInScope === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <div style={{ fontSize: 'var(--font-lg)', fontWeight: 600 }}>No cards here yet</div>
              <p style={{ color: 'var(--fg-muted)', margin: 0, fontSize: 'var(--font-sm)' }}>
                {selectedFolderIds.size > 0
                  ? 'The folders you picked are empty. Choose others, or clear the selection.'
                  : 'Create some flashcards from a document and they will show up here.'}
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <span style={bigNumberStyle}>{dueInScope}</span>
              <span style={{ color: 'var(--fg-muted)' }}>
                card{dueInScope === 1 ? '' : 's'} due {scopeLabel}
              </span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <button
              disabled={dueInScope === 0}
              title={dueInScope === 0 ? 'Nothing due in this selection' : undefined}
              onClick={startReview}
              style={{ ...primaryPillStyle, ...(dueInScope === 0 ? disabledStyle : {}) }}
            >
              <Icon name="play" size="0.85em" />
              Start review
            </button>
            <button
              disabled={totalInScope === 0}
              title={
                totalInScope === 0
                  ? 'No cards in this selection'
                  : `Review all ${totalInScope} card${totalInScope === 1 ? '' : 's'} in this selection, regardless of when they’re due`
              }
              onClick={startCramSession}
              style={{ ...secondaryPillStyle, ...(totalInScope === 0 ? disabledStyle : {}) }}
            >
              <Icon name="flame" />
              Review all{totalInScope > 0 ? ` (${totalInScope})` : ''}
            </button>
          </div>
        </section>

        <section style={{ ...panelStyle, ...statsPanelStyle }}>
          <MiniStat label="Reviewed today" value={stats.reviewedToday} />
          <MiniStat label="Day streak" value={stats.streakDays} icon="flame" accent={stats.streakDays > 0} />
          <MiniStat label="Due now" value={stats.dueNow} />
          <MiniStat label="Avg session" value={avgSessionSeconds !== null ? formatDuration(avgSessionSeconds) : '—'} icon="clock" />
        </section>
      </div>

      <div className="home-rise" style={{ ...columnsStyle, animationDelay: '120ms' }}>
        <section style={panelStyle}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
            <h2 style={panelTitleStyle}>Choose folders</h2>
            {folders.length > 0 && (
              <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                <button onClick={() => setSelectedFolderIds(new Set(folders.map((f) => f.id)))} style={textLinkStyle}>
                  Select all
                </button>
                <button onClick={() => setSelectedFolderIds(new Set())} disabled={selectedFolderIds.size === 0} style={textLinkStyle}>
                  Clear
                </button>
              </div>
            )}
          </div>
          {folders.length === 0 ? (
            <EmptyHint text="No folders yet — Start review covers everything that's due." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, margin: '0 -8px' }}>
              {getChildren(folders, null).map((folder) => (
                <FolderPickRow
                  key={folder.id}
                  folder={folder}
                  depth={0}
                  folders={folders}
                  cards={cards}
                  now={now}
                  selectedFolderIds={selectedFolderIds}
                  onToggle={toggleFolder}
                />
              ))}
            </div>
          )}
        </section>

        <section style={panelStyle}>
          <h2 style={panelTitleStyle}>Due next{selectedFolderIds.size > 0 ? ' · selected folders' : ''}</h2>
          {upcoming.length === 0 ? (
            <EmptyHint text="No cards in scope yet." />
          ) : (
            <div style={listStyle}>
              {upcoming.map((card) => (
                <button key={card.id} onClick={() => focusCard(card.id, card.folderId)} style={rowStyle}>
                  <span style={{ ...rowLabelStyle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                    {card.front.trim() || 'Untitled'}
                  </span>
                  <span style={rowMetaStyle}>{formatDueIn(card.dueAt, now)}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="home-rise" style={{ ...panelStyle, animationDelay: '180ms' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
          <h2 style={panelTitleStyle}>Your cards</h2>
          <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--font-sm)' }}>{stats.totalCards} total</span>
        </div>
        <MaturityBar newCards={stats.newCards} youngCards={youngCards} matureCards={stats.matureCards} />
      </section>

      <section className="home-rise" style={{ ...panelStyle, animationDelay: '240ms' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
          <h2 style={panelTitleStyle}>Review activity</h2>
          <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--font-sm)' }}>
            {logEntries.length} review{logEntries.length === 1 ? '' : 's'} all time
          </span>
        </div>
        {/* Scrolls sideways in a narrow window (the year grid is ~760px wide). The top padding/negative
            margin pair gives the per-cell tooltips, which sit above their cell, room inside the scroller
            so overflow-x doesn't clip them. */}
        <div style={{ overflowX: 'auto', paddingTop: 34, marginTop: -34 }}>
          <ReviewHeatmap log={logEntries} now={now} />
        </div>
      </section>
    </div>
  )
}

function MiniStat({
  label,
  value,
  icon,
  accent
}: {
  label: string
  value: number | string
  icon?: 'flame' | 'clock'
  accent?: boolean
}): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={eyebrowStyle}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-xl)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {icon && (
          <span style={{ display: 'inline-flex', color: accent ? 'var(--accent)' : 'var(--fg-faint)' }}>
            <Icon name={icon} bare size={18} />
          </span>
        )}
        {value}
      </span>
    </div>
  )
}

/** One stacked bar showing how the deck splits into new / young / mature, in three steps of the accent
 *  colour (lightest = new, solid = mature), with a legend carrying the counts. */
function MaturityBar({ newCards, youngCards, matureCards }: { newCards: number; youngCards: number; matureCards: number }): JSX.Element {
  const total = newCards + youngCards + matureCards
  if (total === 0) return <EmptyHint text="Cards you create will show up here as they mature." />
  const segments = [
    { label: 'New', hint: 'not reviewed yet', count: newCards, color: 'color-mix(in srgb, var(--accent) 28%, var(--border))' },
    { label: 'Young', hint: 'interval under 21 days', count: youngCards, color: 'color-mix(in srgb, var(--accent) 62%, var(--bg))' },
    { label: 'Mature', hint: 'interval 21 days or more', count: matureCards, color: 'var(--accent)' }
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', height: 12, borderRadius: 999, overflow: 'hidden', gap: 2 }} role="img" aria-label="How your cards are maturing">
        {segments
          .filter((s) => s.count > 0)
          .map((s) => (
            <div
              key={s.label}
              title={`${s.label}: ${s.count} (${s.hint})`}
              style={{ flex: s.count, background: s.color, transition: 'flex 500ms cubic-bezier(0.22, 1, 0.36, 1)' }}
            />
          ))}
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-5)', flexWrap: 'wrap' }}>
        {segments.map((s) => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }} title={s.hint}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
            <span style={{ fontSize: 'var(--font-sm)' }}>{s.label}</span>
            <span style={{ fontSize: 'var(--font-sm)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{s.count}</span>
            <span style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)' }}>{Math.round((s.count / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

interface FolderPickRowProps {
  folder: FolderRecord
  depth: number
  folders: FolderRecord[]
  cards: CardRecord[]
  now: Date
  selectedFolderIds: Set<string>
  onToggle: (id: string) => void
}

/** One folder in the picker (and, recursively, its subfolders): a checkbox-role button so it's keyboard
 *  operable, with the number of cards due in it on the right. */
function FolderPickRow({ folder, depth, folders, cards, now, selectedFolderIds, onToggle }: FolderPickRowProps): JSX.Element {
  const children = getChildren(folders, folder.id)
  const dueCount = dueCards(cards, { kind: 'folder', folderId: folder.id }, now).length
  const selected = selectedFolderIds.has(folder.id)

  return (
    <div>
      <button
        role="checkbox"
        aria-checked={selected}
        className="pick-row"
        onClick={() => onToggle(folder.id)}
        style={{ paddingLeft: 8 + depth * 18 }}
      >
        <span className="pick-box" aria-hidden="true">
          <Icon name="check" bare size={12} />
        </span>
        <span style={{ ...rowLabelStyle, overflowWrap: 'anywhere' }}>
          <Icon name="folder" />
          {folder.name}
        </span>
        {dueCount > 0 ? <span style={countPillStyle}>{dueCount}</span> : <span style={rowMetaStyle}>none due</span>}
      </button>
      {children.map((child) => (
        <FolderPickRow
          key={child.id}
          folder={child}
          depth={depth + 1}
          folders={folders}
          cards={cards}
          now={now}
          selectedFolderIds={selectedFolderIds}
          onToggle={onToggle}
        />
      ))}
    </div>
  )
}

const pageStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', maxWidth: 940 }

const heroRowStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(220px, 2fr)', gap: 'var(--space-4)' }

const columnsStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
  gap: 'var(--space-4)',
  alignItems: 'start'
}

const sessionPanelStyle: CSSProperties = {
  justifyContent: 'center',
  gap: 'var(--space-4)',
  padding: 'var(--space-5)',
  // A faint accent wash so the session card reads as the page's focal point (same as Home's Today card).
  background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 9%, var(--bg)), var(--bg) 70%)'
}

const statsPanelStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 'var(--space-4)',
  alignContent: 'center',
  padding: 'var(--space-5)'
}

const disabledStyle: CSSProperties = { opacity: 0.45, cursor: 'not-allowed' }

const textLinkStyle: CSSProperties = {
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  color: 'var(--accent)',
  fontSize: 'var(--font-xs)',
  padding: 0
}
