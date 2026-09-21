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
import { Icon } from '../Icon'
import { countPillStyle, eyebrowStyle, panelStyle } from '../dashboardKit'

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
  const [query, setQuery] = useState('')

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
    return (
      <div style={pageStyle}>
        <h1 style={titleStyle}>Cards</h1>
        <div style={{ ...panelStyle, alignItems: 'flex-start' }}>
          <span style={eyebrowStyle}>Nothing here yet</span>
          <p style={{ margin: 0, color: 'var(--fg-muted)' }}>Select content in the Library and hit "Create Flashcard".</p>
        </div>
      </div>
    )
  }

  const needle = query.trim().toLowerCase()
  const filteredCards = cards.filter(
    (c) =>
      (selectedTagIds.size === 0 || c.tagIds.some((id) => selectedTagIds.has(id))) &&
      (needle === '' || c.front.toLowerCase().includes(needle) || c.back.toLowerCase().includes(needle))
  )
  const filtering = selectedTagIds.size > 0 || needle !== ''
  const dueCount = cards.filter((c) => c.dueAt <= new Date().toISOString()).length

  const tagChips = allTags.length > 0 && (
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
    <MarqueeSelect style={{ ...pageStyle, gap: 'var(--space-4)' }}>
      <div>
        <h1 style={titleStyle}>Cards</h1>
        <p style={{ color: 'var(--fg-muted)', margin: 'var(--space-1) 0 0' }}>
          {filtering ? `${filteredCards.length} of ${cards.length} cards` : `${cards.length} card${cards.length === 1 ? '' : 's'}`}
          {dueCount > 0 && ` · ${dueCount} due`}
        </p>
      </div>
      <div style={toolbarStyle}>
        <label style={searchStyle}>
          <Icon name="search" bare size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter cards"
            aria-label="Filter cards"
            style={searchInputStyle}
          />
          {query && (
            <button onClick={() => setQuery('')} title="Clear filter" style={clearButtonStyle}>
              <Icon name="x" bare size={12} />
            </button>
          )}
        </label>
        {tagChips}
      </div>
      {filteredCards.length === 0 && (
        <div style={panelStyle}>
          <span style={{ color: 'var(--fg-muted)' }}>No cards match your filter.</span>
        </div>
      )}
      {[...bySource.entries()].map(([documentId, docCards]) => {
        const sorted = [...docCards].sort(bySortOrder)
        const ids = sorted.map((c) => c.id)
        return (
          <GroupSection
            key={documentId}
            title={documents.find((d) => d.id === documentId)?.filename ?? 'Unknown document'}
            count={sorted.length}
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
              title="No source"
              count={sorted.length}
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
  count,
  collapsed,
  onToggle,
  children
}: {
  title: string
  count: number
  collapsed: boolean
  onToggle: () => void
  children: ReactNode
}): JSX.Element {
  return (
    <section style={{ ...panelStyle, gap: 0, padding: 'var(--space-2)' }}>
      <button onClick={onToggle} style={groupHeaderStyle} title={collapsed ? `Expand ${title}` : `Collapse ${title}`} aria-expanded={!collapsed}>
        <span style={{ color: 'var(--fg-faint)', flexShrink: 0, display: 'inline-flex' }}>
          <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} bare size={12} />
        </span>
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        <span style={countPillStyle}>{count}</span>
      </button>
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '3px 4px 4px', animation: 'expand-collapse 120ms ease' }}>
          {children}
        </div>
      )}
    </section>
  )
}

const pageStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', width: '100%', maxWidth: 940 }

const titleStyle: CSSProperties = { fontSize: 'var(--font-xxl)', margin: 0 }

const toolbarStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2)' }

const searchStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 12px',
  minWidth: 220,
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-pill)',
  background: 'var(--bg)',
  color: 'var(--fg-faint)'
}

const searchInputStyle: CSSProperties = {
  border: 'none',
  outline: 'none',
  background: 'none',
  color: 'var(--fg)',
  fontSize: 'var(--font-sm)',
  flex: 1,
  minWidth: 0
}

const clearButtonStyle: CSSProperties = {
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  color: 'var(--fg-faint)',
  display: 'inline-flex',
  padding: 0
}

const tagFilterBarStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6
}

const tagFilterChipStyle: CSSProperties = {
  border: '1px solid var(--border)',
  background: 'none',
  cursor: 'pointer',
  color: 'var(--fg-muted)',
  fontSize: 'var(--font-xs)',
  padding: '4px 12px',
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
  padding: '6px 8px',
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  fontSize: 'var(--font-md)',
  color: 'var(--fg)',
  fontWeight: 600,
  textAlign: 'left',
  borderRadius: 'var(--radius-row)'
}
