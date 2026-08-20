import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import type { CardRecord, DocumentRecord, FolderRecord } from '../../../../shared/types'
import { useDocumentsStore } from '../../state/documentsStore'
import { useCardsStore } from '../../state/cardsStore'
import { useFoldersStore } from '../../state/foldersStore'
import { useUiStore, type MainView } from '../../state/uiStore'
import { useConnectivityStore } from '../../state/connectivityStore'
import { parsePdf } from '../../parsers/pdfParser'
import { parsePptx } from '../../parsers/pptxParser'
import { parseVideoFile } from '../../parsers/videoParser'
import { formatDuration } from '../../utils/formatDuration'
import { computeMove, getChildren, type DropPosition } from '../../utils/folderTree'
import { bySortOrder, computeCardReorder } from '../../utils/cardOrder'
import { dueCards } from '../../utils/srsQueue'
import { CARD_DRAG_MIME, readCardDragIds, writeCardDragIds } from '../CardBrowser/CardItem'
import { MarqueeSelect } from '../Grid/MarqueeSelect'
import type { ImportProgress } from '../../types/importProgress'
import { ImportProgressBar } from './ImportProgressBar'

function ext(file: File): string | undefined {
  return file.name.split('.').pop()?.toLowerCase()
}

function isView(a: MainView, b: MainView): boolean {
  if (a.type !== b.type) return false
  if (a.type === 'folder' && b.type === 'folder') return a.folderId === b.folderId
  return true
}

export function Sidebar(): JSX.Element {
  const view = useUiStore((s) => s.view)
  const setView = useUiStore((s) => s.setView)
  const focusCard = useUiStore((s) => s.focusCard)
  const openSearch = useUiStore((s) => s.openSearch)

  const documents = useDocumentsStore((s) => s.documents)
  const activeDocumentId = useDocumentsStore((s) => s.activeDocumentId)
  const loadDocuments = useDocumentsStore((s) => s.loadDocuments)
  const openDocument = useDocumentsStore((s) => s.openDocument)
  const deleteDocument = useDocumentsStore((s) => s.deleteDocument)
  const loadCards = useCardsStore((s) => s.loadCards)
  const updateCard = useCardsStore((s) => s.updateCard)

  const folders = useFoldersStore((s) => s.folders)
  const cards = useCardsStore((s) => s.cards)
  // Recomputed whenever `cards` changes, not on a live clock — a card crossing its due threshold
  // purely from time passing won't tick the badge down until something else refreshes the store.
  const dueCount = dueCards(cards, { kind: 'all' }, new Date()).length

  // Refetched whenever a sync cycle finishes (idle<->syncing transitions) — orphans are only ever
  // discovered during a pull, so this is a cheap, good-enough trigger rather than a live subscription.
  const syncStatus = useConnectivityStore((s) => s.status)
  const [orphanCount, setOrphanCount] = useState(0)
  useEffect(() => {
    window.api.cards.getOrphanedSources().then((orphans) => setOrphanCount(orphans.length))
  }, [syncStatus])

  const createFolder = useFoldersStore((s) => s.createFolder)
  const updateFolder = useFoldersStore((s) => s.updateFolder)
  const reorderFolders = useFoldersStore((s) => s.reorderFolders)
  const deleteFolder = useFoldersStore((s) => s.deleteFolder)

  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [creatingUnder, setCreatingUnder] = useState<string | null | undefined>(undefined)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [rootDropActive, setRootDropActive] = useState(false)
  const [libraryCollapsed, setLibraryCollapsed] = useState(false)
  const [foldersCollapsed, setFoldersCollapsed] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  async function handleFileChosen(file: File): Promise<void> {
    setImportError(null)
    setImporting(true)
    const fileExt = ext(file)

    // Video has no pages to parse and a genuinely different payload (a path, not a ParsedDocument)
    // — kept as its own early branch rather than forcing it through the pdf/pptx shape below.
    if (fileExt === 'mp4') {
      setImportProgress({ phase: 'parsing', current: 0, total: 1 })
      try {
        const input = await parseVideoFile(file)
        setImportProgress({ phase: 'saving' })
        const record = await window.api.documents.importVideo(input)
        await loadDocuments()
        setView({ type: 'library' })
        await openDocument(record.id)
      } catch (err) {
        setImportError(err instanceof Error ? err.message : String(err))
      } finally {
        setImporting(false)
        setImportProgress(null)
      }
      return
    }

    setImportProgress(fileExt === 'pptx' ? { phase: 'converting' } : { phase: 'parsing', current: 0, total: 1 })
    try {
      const parsed =
        fileExt === 'pdf'
          ? await parsePdf(file, setImportProgress)
          : fileExt === 'pptx'
            ? await parsePptx(file, setImportProgress)
            : null
      if (!parsed) throw new Error('Unsupported file type — choose a .pdf, .pptx, or .mp4 file')
      setImportProgress({ phase: 'saving' })
      const record = await window.api.documents.import(parsed)
      await loadDocuments()
      setView({ type: 'library' })
      await openDocument(record.id)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err))
    } finally {
      setImporting(false)
      setImportProgress(null)
    }
  }

  async function handleDeleteDocument(doc: DocumentRecord): Promise<void> {
    if (!window.confirm(`Delete "${doc.filename}"? Any flashcards made from it stay, but lose their backlink.`)) return
    await deleteDocument(doc.id)
    await loadCards()
  }

  async function handleDeleteFolder(folder: FolderRecord): Promise<void> {
    if (
      !window.confirm(
        `Delete "${folder.name}" (and any subfolders)? Cards inside aren't deleted — they'll go back to being grouped by source.`
      )
    ) {
      return
    }
    if (view.type === 'folder' && view.folderId === folder.id) setView({ type: 'cards' })
    await deleteFolder(folder.id)
    await loadCards()
  }

  async function handleCreate(name: string, parentId: string | null): Promise<void> {
    await createFolder(name, parentId)
    setCreatingUnder(undefined)
  }

  function handleFolderDrop(draggedId: string, targetId: string | null, position: DropPosition): void {
    const updates = computeMove(folders, draggedId, targetId, position)
    if (updates) reorderFolders(updates)
  }

  function handleCardDrop(cardIds: string[], folderId: string): void {
    for (const id of cardIds) updateCard(id, { folderId })
  }

  if (collapsed) {
    return (
      <aside style={collapsedSidebarStyle}>
        <button onClick={() => setView({ type: 'home' })} title="Outcisura" style={collapsedMarkButtonStyle}>
          <pre aria-hidden="true" style={wordmarkMarkStyle}>{PILLAR_MARK}</pre>
        </button>
        <button onClick={() => setCollapsed(false)} title="Expand sidebar" style={collapseToggleStyle}>
          »
        </button>
        <button
          onClick={() => setView({ type: 'settings', returnTo: view })}
          title="Settings"
          style={{ ...collapsedMarkButtonStyle, marginTop: 'auto', fontSize: 'var(--font-md)' }}
        >
          ⚙️
        </button>
      </aside>
    )
  }

  return (
    <aside style={sidebarStyle}>
      <div style={{ display: 'flex', alignItems: 'center', padding: 'var(--space-3) 0 0' }}>
        <button
          onClick={() => setView({ type: 'home' })}
          title="Outcisura"
          style={{ ...wordmarkStyle, flex: 1, minWidth: 0 }}
        >
          <pre aria-hidden="true" style={wordmarkMarkStyle}>{PILLAR_MARK}</pre>
          Outcisura
        </button>
        <button onClick={() => setCollapsed(true)} title="Collapse sidebar" style={collapseToggleStyle}>
          «
        </button>
      </div>

      <div style={sidebarScrollStyle}>
      <div style={{ padding: '0 var(--space-2)' }}>
        <NavItem label="🔍 Search" active={false} onClick={openSearch} title="Search cards and documents (⌘K)" />
        <NavItem label="🏠 Home" active={isView(view, { type: 'home' })} onClick={() => setView({ type: 'home' })} />
        <NavItem label="🗂 All Cards" active={isView(view, { type: 'cards' })} onClick={() => setView({ type: 'cards' })} />
        <NavItem
          label={`🔁 Review${dueCount > 0 ? ` (${dueCount})` : ''}`}
          active={view.type === 'review' || view.type === 'review-dashboard'}
          onClick={() => setView({ type: 'review-dashboard' })}
        />
        <NavItem label="🕸️ Graph" active={isView(view, { type: 'graph' })} onClick={() => setView({ type: 'graph' })} />
        <NavItem
          label="📡 Hostable Decks"
          active={isView(view, { type: 'hostable-decks' })}
          onClick={() => setView({ type: 'hostable-decks' })}
        />
        <NavItem
          label="🎮 Join a session"
          active={view.type === 'live-session-join' || view.type === 'live-session-play'}
          onClick={() => setView({ type: 'live-session-join' })}
        />
        {orphanCount > 0 && (
          <NavItem
            label={`⚠️ Missing Sources (${orphanCount})`}
            active={isView(view, { type: 'missing-sources' })}
            onClick={() => setView({ type: 'missing-sources' })}
          />
        )}
      </div>

      <div style={sectionStyle}>
        <SectionHeader
          label="Library"
          collapsed={libraryCollapsed}
          active={isView(view, { type: 'library-index' })}
          onToggle={() => setLibraryCollapsed((v) => !v)}
          onOpen={() => setView({ type: 'library-index' })}
          action={
            <label style={{ cursor: 'pointer', display: 'inline-flex' }}>
              <input
                type="file"
                accept=".pdf,.pptx,.mp4"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void handleFileChosen(file)
                  e.target.value = ''
                }}
              />
              <span title="Import PDF/PPTX" style={smallIconButton}>
                {importing ? '…' : '＋'}
              </span>
            </label>
          }
        />
        {importProgress && <ImportProgressBar progress={importProgress} />}
        {importError && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-xs)', padding: '0 var(--space-2)' }}>{importError}</p>}
        {!libraryCollapsed && (
          <div style={{ display: 'flex', flexDirection: 'column', animation: 'expand-collapse 120ms ease' }}>
            {documents.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                active={view.type === 'library' && activeDocumentId === doc.id}
                onOpen={async () => {
                  setView({ type: 'library' })
                  await openDocument(doc.id)
                }}
                onDelete={() => handleDeleteDocument(doc)}
              />
            ))}
            {documents.length === 0 && <EmptySidebarHint text="Import a PDF or PPTX to get started." />}
          </div>
        )}
      </div>

      <div style={sectionStyle}>
        <SectionHeader
          label="Folders"
          collapsed={foldersCollapsed}
          active={isView(view, { type: 'folders-index' })}
          onToggle={() => setFoldersCollapsed((v) => !v)}
          onOpen={() => setView({ type: 'folders-index' })}
          action={
            <button onClick={() => setCreatingUnder(null)} title="New folder" style={smallIconButton}>
              ＋
            </button>
          }
        />
        <MarqueeSelect
          style={{
            display: foldersCollapsed ? 'none' : undefined,
            borderRadius: 'var(--radius-md)',
            outline: rootDropActive ? '2px dashed var(--accent)' : 'none',
            outlineOffset: -2,
            minHeight: 8
          }}
        >
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setRootDropActive(true)
            }}
            onDragLeave={() => setRootDropActive(false)}
            onDrop={(e) => {
              e.preventDefault()
              setRootDropActive(false)
              const draggedId = e.dataTransfer.getData('text/plain')
              if (draggedId) handleFolderDrop(draggedId, null, 'after')
            }}
          >
            {getChildren(folders, null).map((folder) => (
              <FolderNode
                key={folder.id}
                folder={folder}
                depth={0}
                folders={folders}
                cards={cards}
                view={view}
                renamingId={renamingId}
                creatingUnder={creatingUnder}
                setView={setView}
                onToggleCollapse={() => updateFolder(folder.id, { collapsed: !folder.collapsed })}
                onStartRename={() => setRenamingId(folder.id)}
                onFinishRename={async (name) => {
                  if (name.trim()) await updateFolder(folder.id, { name: name.trim() })
                  setRenamingId(null)
                }}
                onCancelRename={() => setRenamingId(null)}
                onStartCreateChild={() => setCreatingUnder(folder.id)}
                onCreate={handleCreate}
                onCancelCreate={() => setCreatingUnder(undefined)}
                onDelete={() => handleDeleteFolder(folder)}
                onDrop={handleFolderDrop}
                onDropCard={handleCardDrop}
                focusCard={focusCard}
              />
            ))}
            {creatingUnder === null && (
              <InlineTextInput depth={0} placeholder="Folder name" onSubmit={(name) => handleCreate(name, null)} onCancel={() => setCreatingUnder(undefined)} />
            )}
            {folders.length === 0 && creatingUnder === undefined && <EmptySidebarHint text="Cards default to grouping by source until you make one." />}
          </div>
        </MarqueeSelect>
      </div>

      <NewlyCreatedSection />
      </div>

      <div style={sidebarFooterStyle}>
        <button onClick={() => setView({ type: 'settings', returnTo: view })} style={settingsButtonStyle} title="Settings">
          ⚙️ Settings
        </button>
      </div>
    </aside>
  )
}

/**
 * Cards not yet filed into a folder, grouped by the document they came from. Virtual — these
 * aren't real folder rows, they're just where new cards land so they're visible and can be
 * dragged into a real folder.
 */
function NewlyCreatedSection(): JSX.Element | null {
  const cards = useCardsStore((s) => s.cards)
  const documents = useDocumentsStore((s) => s.documents)
  const view = useUiStore((s) => s.view)
  const setView = useUiStore((s) => s.setView)
  const focusCard = useUiStore((s) => s.focusCard)
  const [collapsedDocs, setCollapsedDocs] = useState<Set<string>>(new Set())
  const [sectionCollapsed, setSectionCollapsed] = useState(false)

  const unfiled = cards.filter((c) => !c.folderId)
  if (unfiled.length === 0) return null

  const byDocument = new Map<string, CardRecord[]>()
  for (const card of unfiled) {
    const key = card.sources[0]?.documentId ?? '__none__'
    const list = byDocument.get(key) ?? []
    list.push(card)
    byDocument.set(key, list)
  }

  function toggle(key: string): void {
    setCollapsedDocs((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div style={sectionStyle}>
      <SectionHeader
        label="Newly Created"
        collapsed={sectionCollapsed}
        active={isView(view, { type: 'cards' })}
        onToggle={() => setSectionCollapsed((v) => !v)}
        onOpen={() => setView({ type: 'cards' })}
        action={<span style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)', paddingRight: 4 }}>{unfiled.length}</span>}
      />
      {!sectionCollapsed &&
        [...byDocument.entries()].map(([key, docCards]) => {
          const collapsed = collapsedDocs.has(key)
          const name = key === '__none__' ? 'No source' : documents.find((d) => d.id === key)?.filename ?? 'Unknown document'
          const sorted = [...docCards].sort(bySortOrder)
          const ids = sorted.map((c) => c.id)
          return (
            <div key={key}>
              <button onClick={() => toggle(key)} style={docGroupRowStyle} title={name}>
                <span style={{ ...caretButtonStyle, cursor: 'inherit' }}>{collapsed ? '▶' : '▼'}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', overflowWrap: 'anywhere' }}>📄 {name}</span>
                <span style={{ color: 'var(--fg-faint)', flexShrink: 0 }}>({sorted.length})</span>
              </button>
              {!collapsed && (
                <MarqueeSelect style={{ animation: 'expand-collapse 120ms ease' }}>
                  {sorted.map((card) => (
                    <CardLeaf key={card.id} card={card} depth={1} siblingIds={ids} onClick={() => focusCard(card.id, null)} />
                  ))}
                </MarqueeSelect>
              )}
            </div>
          )
        })}
    </div>
  )
}

function NavItem({
  label,
  active,
  onClick,
  grow,
  title
}: {
  label: string
  active: boolean
  onClick: () => void
  grow?: boolean
  title?: string
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: 'block',
        width: grow ? undefined : '100%',
        flex: grow ? 1 : undefined,
        minWidth: 0,
        textAlign: 'left',
        overflow: 'hidden',
        overflowWrap: 'anywhere',
        padding: '6px 10px',
        borderRadius: 'var(--radius-sm)',
        border: 'none',
        background: active ? 'var(--bg-active)' : 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        fontSize: 'var(--font-md)',
        fontWeight: active ? 600 : 400,
        transition: 'background-color var(--transition-fast)'
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'var(--bg-hover)'
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent'
      }}
    >
      {label}
    </button>
  )
}

/** A document row in the Library section, styled to match a folder row: same fixed-width
 *  caret gutter (hidden here since documents don't expand/collapse, but keeps names aligned
 *  under the same grid), a type icon, a page count badge, and row-level hover/active background. */
function DocumentRow({
  doc,
  active,
  onOpen,
  onDelete
}: {
  doc: DocumentRecord
  active: boolean
  onOpen: () => void
  onDelete: () => void
}): JSX.Element {
  return (
    <div
      className="doc-row"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        paddingLeft: 6,
        paddingRight: 6,
        borderRadius: 'var(--radius-sm)',
        background: active ? 'var(--bg-active)' : 'transparent',
        transition: 'background-color var(--transition-fast)'
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'var(--bg-hover)'
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent'
      }}
    >
      <span style={{ ...caretButtonStyle, visibility: 'hidden' }} />
      <button onClick={onOpen} style={{ ...navFolderTitleStyle, fontWeight: active ? 600 : 400 }}>
        {doc.type === 'pdf' ? '📕' : doc.type === 'pptx' ? '📽' : '🎬'} {doc.filename}{' '}
        <span style={{ color: 'var(--fg-faint)' }}>
          (
          {doc.type === 'video'
            ? doc.durationSeconds !== null
              ? formatDuration(doc.durationSeconds)
              : '—'
            : `${doc.pageCount} ${doc.pageCount === 1 ? 'page' : 'pages'}`}
          )
        </span>
      </button>
      <button className="doc-del" onClick={onDelete} title="Delete document" style={{ ...smallIconButton, color: 'var(--danger)' }}>
        ✕
      </button>
    </div>
  )
}

/** Section heading whose caret collapses the list and whose label opens that section's index view. */
function SectionHeader({
  label,
  collapsed,
  active,
  onToggle,
  onOpen,
  action
}: {
  label: string
  collapsed: boolean
  active: boolean
  onToggle: () => void
  onOpen: () => void
  action?: JSX.Element
}): JSX.Element {
  return (
    <div style={sectionHeaderRow}>
      <button onClick={onToggle} title={collapsed ? `Expand ${label}` : `Collapse ${label}`} style={{ ...caretButtonStyle, height: 16 }}>
        {collapsed ? '▶' : '▼'}
      </button>
      <button
        onClick={onOpen}
        title={`Open ${label}`}
        style={{
          ...sectionHeaderText,
          flex: 1,
          minWidth: 0,
          textAlign: 'left',
          border: 'none',
          background: active ? 'var(--bg-active)' : 'transparent',
          cursor: 'pointer',
          padding: '2px 4px',
          borderRadius: 'var(--radius-sm)',
          color: active ? 'var(--accent)' : 'var(--fg-faint)'
        }}
      >
        {label}
      </button>
      {action}
    </div>
  )
}

function EmptySidebarHint({ text }: { text: string }): JSX.Element {
  return <p style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)', padding: '2px 10px' }}>{text}</p>
}

interface FolderNodeProps {
  folder: FolderRecord
  depth: number
  folders: FolderRecord[]
  cards: ReturnType<typeof useCardsStore.getState>['cards']
  view: MainView
  renamingId: string | null
  creatingUnder: string | null | undefined
  setView: (view: MainView) => void
  onToggleCollapse: () => void
  onStartRename: () => void
  onFinishRename: (name: string) => void
  onCancelRename: () => void
  onStartCreateChild: () => void
  onCreate: (name: string, parentId: string | null) => void
  onCancelCreate: () => void
  onDelete: () => void
  onDrop: (draggedId: string, targetId: string, position: DropPosition) => void
  onDropCard: (cardIds: string[], folderId: string) => void
  focusCard: (cardId: string, folderId: string | null) => void
}

/** A flashcard shown as a leaf row under its folder in the sidebar tree. */
function CardLeaf({
  card,
  depth,
  siblingIds,
  onFileInto,
  onClick
}: {
  card: CardRecord
  depth: number
  /** Current visual order of the list this leaf renders in (a folder's own cards, or a
   *  by-source group) — the scope within which drag-to-reorder repositions it. */
  siblingIds: string[]
  /** Files dragged-in cards from elsewhere into this leaf's folder. Omitted for the "Newly
   *  Created" groups, where there's no folder to file into — only same-group reordering applies. */
  onFileInto?: (cardIds: string[]) => void
  onClick: () => void
}): JSX.Element {
  const selectedCardIds = useUiStore((s) => s.selectedCardIds)
  const deleteCard = useCardsStore((s) => s.deleteCard)
  const reorderCards = useCardsStore((s) => s.reorderCards)
  const selected = selectedCardIds.includes(card.id)
  const [dropPosition, setDropPosition] = useState<'before' | 'after' | null>(null)

  function handleDelete(): void {
    if (window.confirm("Delete this flashcard? This can't be undone.")) deleteCard(card.id)
  }

  function dropPositionOf(e: DragEvent<HTMLDivElement>): 'before' | 'after' {
    const rect = e.currentTarget.getBoundingClientRect()
    const relY = (e.clientY - rect.top) / rect.height
    return relY < 0.5 ? 'before' : 'after'
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>): void {
    if (!e.dataTransfer.types.includes(CARD_DRAG_MIME)) return
    e.preventDefault()
    e.stopPropagation()
    setDropPosition(dropPositionOf(e))
  }

  function handleReorderDrop(e: DragEvent<HTMLDivElement>): void {
    const draggedIds = readCardDragIds(e.dataTransfer)
    const position = dropPositionOf(e)
    setDropPosition(null)
    if (draggedIds.length === 0 || draggedIds.includes(card.id)) return
    // Dropping cards from elsewhere only makes sense if this leaf can file them into its folder;
    // in an unfiled "Newly Created" group, only reordering the cards already there is meaningful.
    if (!onFileInto && !draggedIds.every((id) => siblingIds.includes(id))) return
    e.preventDefault()
    e.stopPropagation()
    onFileInto?.(draggedIds)
    const items = computeCardReorder(siblingIds, draggedIds, card.id, position)
    if (items.length > 0) void reorderCards(items)
  }

  return (
    <div
      className="card-leaf-row"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 2,
        paddingLeft: depth * 14 + 6,
        // A hairline of real margin — not covered by the row's own buttons — gives a
        // marquee-select drag somewhere to land between two adjacent leaves.
        marginBottom: 2,
        background: selected ? 'var(--accent-soft)' : 'transparent',
        boxShadow: selected ? 'inset 0 0 0 1px var(--accent)' : undefined,
        borderTop: dropPosition === 'before' ? '2px solid var(--accent)' : '2px solid transparent',
        borderBottom: dropPosition === 'after' ? '2px solid var(--accent)' : '2px solid transparent',
        borderRadius: 'var(--radius-sm)',
        transition: 'background-color var(--transition-fast)'
      }}
      onMouseEnter={(e) => {
        if (!selected) e.currentTarget.style.background = 'var(--bg-hover)'
      }}
      onMouseLeave={(e) => {
        if (!selected) e.currentTarget.style.background = 'transparent'
      }}
      onDragOver={handleDragOver}
      onDragLeave={() => setDropPosition(null)}
      onDrop={handleReorderDrop}
    >
      <span
        draggable
        onDragStart={(e) => writeCardDragIds(e.dataTransfer, selected ? selectedCardIds : [card.id])}
        title={selected && selectedCardIds.length > 1 ? `Drag ${selectedCardIds.length} cards to reorder or file into a folder` : 'Drag to reorder or file into a folder'}
        style={{
          width: 16,
          height: 20,
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 10,
          color: 'var(--fg-faint)',
          cursor: 'grab',
          marginTop: 3
        }}
      >
        ⠿
      </span>
      {/* A plain div (not a button) so a marquee-select drag can still start here — only the
          handle above and the delete button below are excluded from that as "real" controls. */}
      <div
        data-card-id={card.id}
        onClick={onClick}
        title={card.front}
        style={{
          // -webkit-box + line-clamp: two lines max, enough to read a question stem without one long
          // card dominating the tree.
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          flex: 1,
          minWidth: 0,
          paddingRight: 2,
          paddingTop: 3,
          paddingBottom: 3,
          color: 'var(--fg-muted)',
          cursor: 'pointer',
          fontSize: 'var(--font-sm)',
          overflow: 'hidden',
          overflowWrap: 'anywhere'
        }}
      >
        {card.front.trim() || 'Untitled'}
      </div>
      <button
        className="card-leaf-del"
        onClick={handleDelete}
        title="Delete card"
        style={{ ...smallIconButton, color: 'var(--danger)', marginTop: 3, marginRight: 4 }}
      >
        ✕
      </button>
    </div>
  )
}

function FolderNode(props: FolderNodeProps): JSX.Element {
  const { folder, depth, folders, cards, view, renamingId, creatingUnder } = props
  const [dropIndicator, setDropIndicator] = useState<DropPosition | null>(null)
  const [cardDropActive, setCardDropActive] = useState(false)
  const [bodyDropActive, setBodyDropActive] = useState(false)
  const children = getChildren(folders, folder.id)
  const ownCards = cards.filter((c) => c.folderId === folder.id).sort(bySortOrder)
  const ownCardIds = ownCards.map((c) => c.id)
  const ownCardCount = ownCards.length
  const hasContent = children.length > 0 || ownCards.length > 0
  const dueCount = dueCards(cards, { kind: 'folder', folderId: folder.id }, new Date()).length
  const active = view.type === 'folder' && view.folderId === folder.id

  function handleDragOver(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    e.stopPropagation()
    // A dragged card always lands *in* the folder; only folder drags get before/inside/after zones.
    if (e.dataTransfer.types.includes(CARD_DRAG_MIME)) {
      setCardDropActive(true)
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const relY = (e.clientY - rect.top) / rect.height
    setDropIndicator(relY < 0.25 ? 'before' : relY > 0.75 ? 'after' : 'inside')
  }

  function clearDropState(): void {
    setDropIndicator(null)
    setCardDropActive(false)
  }

  function handleDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    e.stopPropagation()
    const cardIds = readCardDragIds(e.dataTransfer)
    if (cardIds.length > 0) {
      props.onDropCard(cardIds, folder.id)
      clearDropState()
      return
    }
    const draggedId = e.dataTransfer.getData('text/plain')
    if (draggedId && dropIndicator) props.onDrop(draggedId, folder.id, dropIndicator)
    clearDropState()
  }

  return (
    <div>
      {renamingId === folder.id ? (
        <InlineTextInput depth={depth} initialValue={folder.name} onSubmit={props.onFinishRename} onCancel={props.onCancelRename} />
      ) : (
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', folder.id)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragOver={handleDragOver}
          onDragLeave={clearDropState}
          onDrop={handleDrop}
          className="folder-row"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            paddingLeft: depth * 14 + 6,
            paddingRight: 6,
            borderRadius: 'var(--radius-sm)',
            background:
              cardDropActive || dropIndicator === 'inside' ? 'var(--accent-soft)' : active ? 'var(--bg-active)' : 'transparent',
            borderTop: dropIndicator === 'before' ? '2px solid var(--accent)' : '2px solid transparent',
            borderBottom: dropIndicator === 'after' ? '2px solid var(--accent)' : '2px solid transparent',
            transition: 'background-color var(--transition-fast)'
          }}
          onMouseEnter={(e) => {
            if (!active && !dropIndicator && !cardDropActive) e.currentTarget.style.background = 'var(--bg-hover)'
          }}
          onMouseLeave={(e) => {
            if (!active && !dropIndicator && !cardDropActive) e.currentTarget.style.background = 'transparent'
          }}
        >
          <button onClick={props.onToggleCollapse} style={{ ...caretButtonStyle, visibility: hasContent ? 'visible' : 'hidden' }}>
            {folder.collapsed ? '▶' : '▼'}
          </button>
          <button
            onClick={() => props.setView({ type: 'folder', folderId: folder.id })}
            style={{ ...navFolderTitleStyle, fontWeight: active ? 600 : 400 }}
          >
            📁 {folder.name} <span style={{ color: 'var(--fg-faint)' }}>({ownCardCount})</span>
          </button>
          <button
            onClick={() =>
              props.setView({ type: 'review', scope: { kind: 'folder', folderId: folder.id }, returnTo: view })
            }
            disabled={dueCount === 0}
            title={dueCount === 0 ? 'Nothing due in this folder' : `Review this folder (${dueCount} due)`}
            style={smallIconButton}
          >
            🔁
          </button>
          <button onClick={props.onStartCreateChild} title="New subfolder" style={smallIconButton}>
            ＋
          </button>
          <button onClick={props.onStartRename} title="Rename" style={smallIconButton}>
            ✏️
          </button>
          <button onClick={props.onDelete} title="Delete folder" style={smallIconButton}>
            🗑
          </button>
        </div>
      )}

      {!folder.collapsed && (
        <div
          // The expanded body is a drop target too: dragging a card anywhere inside a folder's
          // open region (including onto one of its existing card rows) files it into that folder.
          // Subfolder rows stopPropagation, so they still claim their own drops.
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(CARD_DRAG_MIME)) return
            e.preventDefault()
            setBodyDropActive(true)
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setBodyDropActive(false)
          }}
          onDrop={(e) => {
            const ids = readCardDragIds(e.dataTransfer)
            if (ids.length === 0) return
            e.preventDefault()
            e.stopPropagation()
            props.onDropCard(ids, folder.id)
            setBodyDropActive(false)
          }}
          style={{
            animation: 'expand-collapse 120ms ease',
            borderRadius: 'var(--radius-sm)',
            background: bodyDropActive ? 'var(--accent-soft)' : 'transparent',
            transition: 'background-color var(--transition-fast)'
          }}
        >
          {children.map((child) => (
            <FolderNode key={child.id} {...props} folder={child} depth={depth + 1} />
          ))}
          {creatingUnder === folder.id && (
            <InlineTextInput depth={depth + 1} placeholder="Subfolder name" onSubmit={(name) => props.onCreate(name, folder.id)} onCancel={props.onCancelCreate} />
          )}
          {ownCards.map((card) => (
            <CardLeaf
              key={card.id}
              card={card}
              depth={depth + 1}
              siblingIds={ownCardIds}
              onFileInto={(ids) => props.onDropCard(ids, folder.id)}
              onClick={() => props.focusCard(card.id, folder.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface InlineTextInputProps {
  depth: number
  initialValue?: string
  placeholder?: string
  onSubmit: (value: string) => void
  onCancel: () => void
}

function InlineTextInput({ depth, initialValue, placeholder, onSubmit, onCancel }: InlineTextInputProps): JSX.Element {
  const [value, setValue] = useState(initialValue ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  function submit(): void {
    const trimmed = value.trim()
    if (trimmed) onSubmit(trimmed)
    else onCancel()
  }

  return (
    <input
      ref={inputRef}
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onBlur={submit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') submit()
        if (e.key === 'Escape') onCancel()
      }}
      style={{
        display: 'block',
        width: `calc(100% - ${depth * 14 + 8}px)`,
        marginLeft: depth * 14 + 4,
        marginTop: 2,
        marginBottom: 2,
        padding: '4px 6px',
        fontSize: 'var(--font-sm)',
        fontFamily: 'inherit',
        border: '1px solid var(--accent)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--bg)',
        color: 'inherit'
      }}
    />
  )
}

const wordmarkStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  margin: '0 var(--space-2)',
  padding: '2px 8px 2px 6px',
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  fontSize: 'var(--font-lg)',
  fontWeight: 700,
  letterSpacing: '-0.01em',
  color: 'var(--fg)',
  textAlign: 'left'
}

// A tiny ascii-art column — capital, fluted shaft, base — kept to the wordmark's own line height
// (font-size 6 * line-height 0.62 * 5 rows ≈ text cap-height) so it sits flush next to the text
// instead of towering over it like a full-size illustration would.
const PILLAR_MARK = '▛▀▀▀▜\n ▐█▌ \n ▐█▌ \n ▐█▌ \n▙▄▄▄▟'

const wordmarkMarkStyle: CSSProperties = {
  margin: 0,
  fontFamily: 'ui-monospace, "SF Mono", "Cascadia Mono", Consolas, "Liberation Mono", monospace',
  fontSize: 6,
  lineHeight: 0.62,
  color: 'var(--accent)',
  userSelect: 'none',
  flexShrink: 0
}

const sidebarStyle: CSSProperties = {
  // Proportional rather than a hard 240px: at higher zoom the window fits fewer CSS pixels, so a
  // fixed width would eat the content area and squeeze names into ellipses.
  width: 'clamp(180px, 22vw, 300px)',
  flexShrink: 0,
  height: '100%',
  background: 'var(--bg-sidebar)',
  borderRight: '1px solid var(--border)',
  display: 'flex',
  flexDirection: 'column'
}

// Everything between the wordmark header and the settings footer scrolls on its own — those two
// stay pinned (settings reachable from anywhere, without needing to scroll a long folder/library
// list first) instead of the whole aside scrolling as one unit like it used to.
const sidebarScrollStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: 'var(--space-3) 0',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-4)'
}

const sidebarFooterStyle: CSSProperties = {
  flexShrink: 0,
  padding: 'var(--space-2)',
  borderTop: '1px solid var(--border)'
}

const settingsButtonStyle: CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  border: 'none',
  background: 'none',
  color: 'var(--fg-muted)',
  cursor: 'pointer',
  fontSize: 'var(--font-sm)',
  padding: '6px 8px',
  borderRadius: 'var(--radius-sm)'
}

const sectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1
}

const collapsedSidebarStyle: CSSProperties = {
  width: 44,
  flexShrink: 0,
  height: '100%',
  background: 'var(--bg-sidebar)',
  borderRight: '1px solid var(--border)',
  padding: 'var(--space-3) 0',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'var(--space-2)'
}

const collapsedMarkButtonStyle: CSSProperties = {
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  padding: 6,
  borderRadius: 'var(--radius-sm)'
}

// Shared by both the expand (in the collapsed rail) and collapse (in the full sidebar's wordmark
// row) toggles — kept small and quiet since it's a secondary affordance, not primary navigation.
const collapseToggleStyle: CSSProperties = {
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  color: 'var(--fg-muted)',
  fontSize: 'var(--font-md)',
  lineHeight: 1,
  padding: '4px 6px',
  borderRadius: 'var(--radius-sm)',
  flexShrink: 0
}

const sectionHeaderRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  padding: '0 var(--space-2)',
  marginBottom: 2
}

const sectionHeaderText: CSSProperties = {
  fontSize: 'var(--font-xs)',
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--fg-faint)'
}

const smallIconButton: CSSProperties = {
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  fontSize: 12,
  padding: '2px 4px',
  color: 'inherit',
  transition: 'opacity var(--transition-fast)'
}

/** Square, centered caret so the arrow sits on the folder name's optical center. */
const caretButtonStyle: CSSProperties = {
  width: 16,
  height: 20,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  fontSize: 9,
  padding: 0,
  color: 'var(--fg-faint)',
  flexShrink: 0
}

const docGroupRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 4,
  width: '100%',
  minWidth: 0,
  textAlign: 'left',
  border: 'none',
  background: 'transparent',
  color: 'var(--fg-muted)',
  cursor: 'pointer',
  fontSize: 'var(--font-sm)',
  padding: '2px 6px',
  borderRadius: 'var(--radius-sm)'
}

const navFolderTitleStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  overflowWrap: 'anywhere',
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  fontSize: 'var(--font-md)',
  fontFamily: 'inherit',
  textAlign: 'left',
  padding: '4px 0',
  color: 'inherit'
}
