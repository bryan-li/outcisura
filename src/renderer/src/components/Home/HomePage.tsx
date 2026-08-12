import type { CSSProperties } from 'react'
import { useCardsStore } from '../../state/cardsStore'
import { useFoldersStore } from '../../state/foldersStore'
import { useDocumentsStore } from '../../state/documentsStore'
import { useUiStore } from '../../state/uiStore'
import { dueCards } from '../../utils/srsQueue'

export function HomePage(): JSX.Element {
  const cards = useCardsStore((s) => s.cards)
  const folders = useFoldersStore((s) => s.folders)
  const documents = useDocumentsStore((s) => s.documents)
  const openDocument = useDocumentsStore((s) => s.openDocument)
  const setView = useUiStore((s) => s.setView)

  const aiGeneratedCount = cards.filter((c) => c.aiGenerated).length
  const occlusionCount = cards.filter((c) => c.cardType === 'image_occlusion').length
  const dueCount = dueCards(cards, { kind: 'all' }, new Date()).length

  function goToReviewDashboard(): void {
    setView({ type: 'review-dashboard' })
  }

  const recentDocuments = [...documents]
    .sort((a, b) => (a.importedAt < b.importedAt ? 1 : -1))
    .slice(0, 5)
  const recentCards = [...cards].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 5)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', maxWidth: 880 }}>
      <div>
        <h1 style={{ fontSize: 'var(--font-xxl)', margin: 0 }}>Welcome back</h1>
        <p style={{ color: 'var(--fg-muted)', marginTop: 'var(--space-1)' }}>Here's where things stand.</p>
      </div>

      {dueCount > 0 && (
        <button onClick={goToReviewDashboard} style={reviewCtaStyle} className="hover-lift">
          <span style={{ fontSize: 'var(--font-xl)' }}>🔁</span>
          <span style={{ flex: 1, textAlign: 'left' }}>
            <div style={{ fontSize: 'var(--font-lg)', fontWeight: 600 }}>
              {dueCount} card{dueCount === 1 ? '' : 's'} due for review
            </div>
            <div style={{ fontSize: 'var(--font-sm)', color: 'var(--fg-muted)' }}>Keep your streak going.</div>
          </span>
          <span style={{ fontWeight: 600, color: 'var(--accent)' }}>Start Review →</span>
        </button>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--space-3)' }}>
        <StatTile label="Due for review" value={dueCount} onClick={dueCount > 0 ? goToReviewDashboard : undefined} />
        <StatTile label="Flashcards" value={cards.length} onClick={() => setView({ type: 'cards' })} />
        <StatTile label="Documents" value={documents.length} onClick={() => setView({ type: 'library-index' })} />
        <StatTile label="Folders" value={folders.length} onClick={() => setView({ type: 'folders-index' })} />
        <StatTile label="AI-generated" value={aiGeneratedCount} />
        <StatTile label="Image occlusion" value={occlusionCount} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-5)' }}>
        <div>
          <h2 style={sectionHeaderStyle}>Recent documents</h2>
          {recentDocuments.length === 0 ? (
            <EmptyHint text="Nothing imported yet." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {recentDocuments.map((doc) => (
                <button
                  key={doc.id}
                  onClick={async () => {
                    setView({ type: 'library' })
                    await openDocument(doc.id)
                  }}
                  style={rowLinkStyle}
                >
                  <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{doc.filename}</span>
                  <span style={{ color: 'var(--fg-faint)', fontSize: 'var(--font-xs)', flexShrink: 0 }}>
                    {doc.type.toUpperCase()} · {doc.pageCount}p
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 style={sectionHeaderStyle}>Recent cards</h2>
          {recentCards.length === 0 ? (
            <EmptyHint text="Nothing created yet." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {recentCards.map((card) => (
                <button
                  key={card.id}
                  onClick={() => setView(card.folderId ? { type: 'folder', folderId: card.folderId } : { type: 'cards' })}
                  style={rowLinkStyle}
                >
                  <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{card.front.trim() || '(no question yet)'}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function StatTile({ label, value, onClick }: { label: string; value: number; onClick?: () => void }): JSX.Element {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={onClick ? 'hover-lift' : undefined}
      style={{ ...statTileStyle, cursor: onClick ? 'pointer' : 'default' }}
    >
      <div style={{ fontSize: 'var(--font-xxl)', fontWeight: 600, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 'var(--font-sm)', color: 'var(--fg-muted)', marginTop: 'var(--space-1)' }}>{label}</div>
    </Tag>
  )
}

function EmptyHint({ text }: { text: string }): JSX.Element {
  return <p style={{ color: 'var(--fg-faint)', fontSize: 'var(--font-sm)' }}>{text}</p>
}

const sectionHeaderStyle: CSSProperties = {
  fontSize: 'var(--font-md)',
  fontWeight: 600,
  margin: '0 0 var(--space-2)',
  color: 'var(--fg-muted)'
}

const reviewCtaStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-3)',
  border: '1px solid var(--accent)',
  backgroundColor: 'var(--accent-soft)',
  // A faint dot-grain, dithered rather than a flat fill — the one ascii/print-adjacent texture
  // touch kept from the style exploration, sized small enough to read as paper grain, not pattern.
  backgroundImage: 'radial-gradient(circle at 1px 1px, var(--grain-dot) 1px, transparent 0)',
  backgroundSize: '5px 5px',
  borderRadius: 'var(--radius-lg)',
  padding: 'var(--space-4)',
  textAlign: 'left',
  color: 'inherit',
  cursor: 'pointer'
}

const statTileStyle: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  padding: 'var(--space-4)',
  background: 'var(--bg)',
  textAlign: 'left',
  transition: 'border-color var(--transition-fast), background-color var(--transition-fast)'
}

const rowLinkStyle: CSSProperties = {
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
