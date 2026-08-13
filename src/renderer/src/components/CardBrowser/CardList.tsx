import { useState, type CSSProperties, type ReactNode } from 'react'
import type { CardRecord } from '../../../../shared/types'
import { useCardsStore } from '../../state/cardsStore'
import { useDocumentsStore } from '../../state/documentsStore'
import { useFoldersStore } from '../../state/foldersStore'
import { useUiStore } from '../../state/uiStore'
import { bySortOrder } from '../../utils/cardOrder'
import { CardItem } from './CardItem'
import { MarqueeSelect } from '../Grid/MarqueeSelect'

/** Every card, grouped by source document — foldered cards are included too (each gets a small
 *  folder badge), since this is meant to be a literal "every card" view, not just the unfiled
 *  ones left over before you make a folder. */
const NO_SOURCE_KEY = '__no-source__'

export function CardList(): JSX.Element {
  const cards = useCardsStore((s) => s.cards)
  const documents = useDocumentsStore((s) => s.documents)
  const folders = useFoldersStore((s) => s.folders)
  const setView = useUiStore((s) => s.setView)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  function toggleGroup(key: string): void {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (cards.length === 0) {
    return <p style={{ color: 'var(--fg-muted)' }}>No flashcards yet — select content in the Library and hit "Create Flashcard".</p>
  }

  const bySource = new Map<string, CardRecord[]>()
  const noSource: CardRecord[] = []
  for (const card of cards) {
    const documentId = card.sources[0]?.documentId
    if (!documentId) {
      noSource.push(card)
      continue
    }
    const list = bySource.get(documentId) ?? []
    list.push(card)
    bySource.set(documentId, list)
  }

  function folderLabel(card: CardRecord): string | undefined {
    return card.folderId ? folders.find((f) => f.id === card.folderId)?.name : undefined
  }

  function goToFolder(card: CardRecord): void {
    if (card.folderId) setView({ type: 'folder', folderId: card.folderId })
  }

  return (
    <MarqueeSelect style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', width: '100%' }}>
      <h1 style={{ fontSize: 'var(--font-xl)', margin: 0 }}>Cards</h1>
      {[...bySource.entries()].map(([documentId, docCards]) => {
        const sorted = [...docCards].sort(bySortOrder)
        const ids = sorted.map((c) => c.id)
        return (
          <GroupSection
            key={documentId}
            title={`${documents.find((d) => d.id === documentId)?.filename ?? 'Unknown document'} (${sorted.length})`}
            collapsed={collapsedGroups.has(documentId)}
            onToggle={() => toggleGroup(documentId)}
          >
            {sorted.map((card) => (
              <CardItem key={card.id} card={card} siblingIds={ids} folderLabel={folderLabel(card)} onFolderClick={() => goToFolder(card)} />
            ))}
          </GroupSection>
        )
      })}
      {noSource.length > 0 &&
        (() => {
          const sorted = [...noSource].sort(bySortOrder)
          const ids = sorted.map((c) => c.id)
          return (
            <GroupSection
              title={`No source (${sorted.length})`}
              collapsed={collapsedGroups.has(NO_SOURCE_KEY)}
              onToggle={() => toggleGroup(NO_SOURCE_KEY)}
            >
              {sorted.map((card) => (
                <CardItem key={card.id} card={card} siblingIds={ids} folderLabel={folderLabel(card)} onFolderClick={() => goToFolder(card)} />
              ))}
            </GroupSection>
          )
        })()}
    </MarqueeSelect>
  )
}

function GroupSection({
  title,
  collapsed,
  onToggle,
  children
}: {
  title: string
  collapsed: boolean
  onToggle: () => void
  children: ReactNode
}): JSX.Element {
  return (
    <section>
      <button onClick={onToggle} style={groupHeaderStyle} title={collapsed ? `Expand ${title}` : `Collapse ${title}`}>
        <span style={{ fontSize: 10, color: 'var(--fg-faint)', flexShrink: 0 }}>{collapsed ? '▶' : '▼'}</span>
        {title}
      </button>
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '3px 0', animation: 'expand-collapse 120ms ease' }}>
          {children}
        </div>
      )}
    </section>
  )
}

const groupHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  margin: '0 0 var(--space-2)',
  padding: '2px 4px',
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  fontSize: 'var(--font-md)',
  color: 'var(--fg-muted)',
  fontWeight: 600,
  textAlign: 'left',
  borderRadius: 'var(--radius-sm)'
}
