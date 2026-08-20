import { useState, type CSSProperties, type ReactNode } from 'react'
import type { CardRecord } from '../../../../shared/types'
import { useCardsStore } from '../../state/cardsStore'
import { useDocumentsStore } from '../../state/documentsStore'
import { useFoldersStore } from '../../state/foldersStore'
import { useTagsStore } from '../../state/tagsStore'
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
  const allTags = useTagsStore((s) => s.tags)
  const setView = useUiStore((s) => s.setView)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  // Tags are independent of folder membership, so this filter narrows across every group below
  // rather than being scoped to one — a card matches if it carries ANY selected tag.
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set())

  function toggleGroup(key: string): void {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleTagFilter(tagId: string): void {
    setSelectedTagIds((prev) => {
      const next = new Set(prev)
      if (next.has(tagId)) next.delete(tagId)
      else next.add(tagId)
      return next
    })
  }

  if (cards.length === 0) {
    return <p style={{ color: 'var(--fg-muted)' }}>No flashcards yet — select content in the Library and hit "Create Flashcard".</p>
  }

  const filteredCards = selectedTagIds.size === 0 ? cards : cards.filter((c) => c.tagIds.some((id) => selectedTagIds.has(id)))

  const tagFilterBar = allTags.length > 0 && (
    <div style={tagFilterBarStyle}>
      {allTags.map((tag) => {
        const active = selectedTagIds.has(tag.id)
        return (
          <button key={tag.id} onClick={() => toggleTagFilter(tag.id)} style={active ? tagFilterChipActiveStyle : tagFilterChipStyle}>
            {tag.name}
          </button>
        )
      })}
      {selectedTagIds.size > 0 && (
        <button onClick={() => setSelectedTagIds(new Set())} style={tagFilterClearStyle}>
          Clear
        </button>
      )}
    </div>
  )

  const bySource = new Map<string, CardRecord[]>()
  const noSource: CardRecord[] = []
  for (const card of filteredCards) {
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
      {tagFilterBar}
      {filteredCards.length === 0 && (
        <p style={{ color: 'var(--fg-muted)' }}>No cards match the selected tag{selectedTagIds.size === 1 ? '' : 's'}.</p>
      )}
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

const tagFilterBarStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
  marginTop: -8
}

const tagFilterChipStyle: CSSProperties = {
  border: '1px solid var(--border)',
  background: 'none',
  cursor: 'pointer',
  color: 'var(--fg-muted)',
  fontSize: 'var(--font-xs)',
  padding: '2px 10px',
  borderRadius: 999
}

const tagFilterChipActiveStyle: CSSProperties = {
  ...tagFilterChipStyle,
  border: '1px solid var(--accent)',
  color: 'var(--accent)',
  background: 'var(--accent-soft)'
}

const tagFilterClearStyle: CSSProperties = {
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  color: 'var(--fg-faint)',
  fontSize: 'var(--font-xs)',
  textDecoration: 'underline',
  padding: '2px 4px'
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
