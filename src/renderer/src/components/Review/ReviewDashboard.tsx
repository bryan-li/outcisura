import { useEffect, useState, type CSSProperties } from 'react'
import type { FolderRecord } from '../../../../shared/types'
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
import { StatTile } from '../Home/HomePage'
import { ReviewHeatmap } from './ReviewHeatmap'

function formatDueIn(dueAt: string, now: Date): string {
  const diffDays = (new Date(dueAt).getTime() - now.getTime()) / 86400000
  return diffDays <= 0 ? 'now' : formatInterval(diffDays)
}

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

  function startReview(): void {
    setView({ type: 'review', scope, returnTo: { type: 'review-dashboard' } })
  }

  function startCramSession(): void {
    setView({ type: 'review', scope, returnTo: { type: 'review-dashboard' }, force: true })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', maxWidth: 960 }}>
      <div>
        <h1 style={{ fontSize: 'var(--font-xxl)', margin: 0 }}>Review</h1>
        <p style={{ color: 'var(--fg-muted)', marginTop: 'var(--space-1)' }}>Stats, what's coming up, and custom sessions.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 'var(--space-3)' }}>
        <StatTile label="Due now" value={stats.dueNow} />
        <StatTile label="New" value={stats.newCards} />
        <StatTile label="Mature" value={stats.matureCards} />
        <StatTile label="Total cards" value={stats.totalCards} />
        <StatTile label="Reviewed today" value={stats.reviewedToday} />
        <StatTile label="🔥 Day streak" value={stats.streakDays} />
        <StatTile label="⏱ Avg session" value={avgSessionSeconds !== null ? formatDuration(avgSessionSeconds) : '—'} />
      </div>

      <div>
        <h2 style={sectionHeaderStyle}>Review activity</h2>
        <ReviewHeatmap log={logEntries} now={now} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'var(--space-5)' }}>
        <div>
          <h2 style={sectionHeaderStyle}>Due next{selectedFolderIds.size > 0 ? ' (selected folders)' : ''}</h2>
          {upcoming.length === 0 ? (
            <p style={{ color: 'var(--fg-faint)', fontSize: 'var(--font-sm)' }}>No cards in scope yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {upcoming.map((card) => (
                <button key={card.id} onClick={() => focusCard(card.id, card.folderId)} style={dueRowStyle}>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {card.front.trim() || 'Untitled'}
                  </span>
                  <span style={{ color: 'var(--fg-faint)', fontSize: 'var(--font-xs)', flexShrink: 0 }}>
                    {formatDueIn(card.dueAt, now)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <h2 style={sectionHeaderStyle}>Custom session</h2>
            {folders.length > 0 && (
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button onClick={() => setSelectedFolderIds(new Set(folders.map((f) => f.id)))} style={smallTextButton}>
                  Select all
                </button>
                <button onClick={() => setSelectedFolderIds(new Set())} style={smallTextButton}>
                  Clear
                </button>
              </div>
            )}
          </div>

          {folders.length === 0 ? (
            <p style={{ color: 'var(--fg-faint)', fontSize: 'var(--font-sm)' }}>
              No folders yet — Start Review below reviews everything due.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginBottom: 'var(--space-3)' }}>
              {getChildren(folders, null).map((folder) => (
                <FolderCheckboxRow
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

          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              disabled={dueInScope === 0}
              title={dueInScope === 0 ? 'Nothing due in this selection' : undefined}
              onClick={startReview}
              style={{ ...primaryButtonStyle, flex: 1 }}
            >
              ✨ Start Review{dueInScope > 0 ? ` (${dueInScope})` : ''}
            </button>
            <button
              disabled={totalInScope === 0}
              title={
                totalInScope === 0
                  ? 'No cards in this selection'
                  : 'Review every card in this selection, regardless of when it’s due'
              }
              onClick={startCramSession}
              style={{ flex: 1 }}
            >
              🔥 Review All{totalInScope > 0 ? ` (${totalInScope})` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

interface FolderCheckboxRowProps {
  folder: FolderRecord
  depth: number
  folders: FolderRecord[]
  cards: ReturnType<typeof useCardsStore.getState>['cards']
  now: Date
  selectedFolderIds: Set<string>
  onToggle: (id: string) => void
}

function FolderCheckboxRow({ folder, depth, folders, cards, now, selectedFolderIds, onToggle }: FolderCheckboxRowProps): JSX.Element {
  const children = getChildren(folders, folder.id)
  const dueCount = dueCards(cards, { kind: 'folder', folderId: folder.id }, now).length

  return (
    <div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: depth * 16 + 6, padding: '3px 6px', cursor: 'pointer' }}>
        <input type="checkbox" checked={selectedFolderIds.has(folder.id)} onChange={() => onToggle(folder.id)} />
        <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', fontSize: 'var(--font-sm)' }}>📁 {folder.name}</span>
        {dueCount > 0 && <span style={{ color: 'var(--fg-faint)', fontSize: 'var(--font-xs)', flexShrink: 0 }}>{dueCount} due</span>}
      </label>
      {children.map((child) => (
        <FolderCheckboxRow
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

const sectionHeaderStyle: CSSProperties = {
  fontSize: 'var(--font-md)',
  fontWeight: 600,
  margin: '0 0 var(--space-2)',
  color: 'var(--fg-muted)'
}

const dueRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: 'var(--space-2)',
  border: 'none',
  background: 'none',
  textAlign: 'left',
  padding: '6px 8px',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  color: 'inherit',
  fontSize: 'var(--font-md)'
}

const smallTextButton: CSSProperties = {
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  color: 'var(--accent)',
  fontSize: 'var(--font-xs)',
  padding: 0
}

const primaryButtonStyle: CSSProperties = {
  border: '1px solid var(--accent)',
  background: 'var(--accent-soft)',
  color: 'var(--accent)',
  fontWeight: 600,
  width: '100%'
}
