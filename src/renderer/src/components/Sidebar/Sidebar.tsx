import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import type { CardRecord, DocumentFolderRecord, DocumentRecord, FolderRecord } from '../../../../shared/types'
import { useDocumentsStore } from '../../state/documentsStore'
import { useCardsStore } from '../../state/cardsStore'
import { useFoldersStore } from '../../state/foldersStore'
import { useUiStore, type MainView } from '../../state/uiStore'
import { useConnectivityStore } from '../../state/connectivityStore'
import { useAiAdminStore } from '../../state/aiAdminStore'
import { parsePdf } from '../../parsers/pdfParser'
import { parsePptx } from '../../parsers/pptxParser'
import { parseVideoFile } from '../../parsers/videoParser'
import { formatDuration } from '../../utils/formatDuration'
import { computeMove, getChildren, type DropPosition } from '../../utils/folderTree'

const DOCUMENT_DRAG_MIME = 'application/x-document-id'
import { bySortOrder, computeCardReorder } from '../../utils/cardOrder'
import { dueCards } from '../../utils/srsQueue'
import { CARD_DRAG_MIME, readCardDragIds, writeCardDragIds } from '../CardBrowser/CardItem'
import { MarqueeSelect } from '../Grid/MarqueeSelect'
import type { ImportProgress } from '../../types/importProgress'
import { ImportProgressBar } from './ImportProgressBar'
import { RowMenu } from './RowMenu'
import { Logo } from '../Logo'
import { DocTypeIcon, Icon, type IconName } from '../Icon'

function ext(file: File): string | undefined {
  return file.name.split('.').pop()?.toLowerCase()
}

function isView(a: MainView, b: MainView): boolean {
  if (a.type !== b.type) return false
  if (a.type === 'folder' && b.type === 'folder') return a.folderId === b.folderId
  return true
}

/** Scrolls the main content pane back to the top. Switching to a different page snaps (the new page
 *  should simply appear at its top); clicking the page you're already on glides, as a "back to top". */
function scrollContentToTop(smooth: boolean): void {
  const main = document.querySelector('main')
  if (!main) return
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (smooth && !reduceMotion) main.scrollTo({ top: 0, behavior: 'smooth' })
  else main.scrollTop = 0
}

/** The store's setView, plus resetting the content pane's scroll — otherwise a page you'd scrolled
 *  down keeps its scroll offset when you navigate to another, and clicking the current page did nothing. */
function useSidebarNavigate(): (target: MainView) => void {
  const view = useUiStore((s) => s.view)
  const setViewInStore = useUiStore((s) => s.setView)
  return (target) => {
    const samePage = isView(view, target)
    setViewInStore(target)
    scrollContentToTop(samePage)
  }
}

const SIDEBAR_MIN = 188
const SIDEBAR_MAX = 264
const SIDEBAR_VW = 0.2

/** The expanded sidebar's width in plain pixels: 20% of the window, kept between 188 and 264. This is
 *  what CSS `clamp(188px, 20vw, 264px)` would give, computed here instead because browsers can't
 *  interpolate between a clamp() and an ordinary length — with the clamp, collapsing/expanding would
 *  flip instantly rather than glide. Uses innerWidth (CSS px), which webFrame zoom scales exactly as
 *  it would vw. */
function useExpandedSidebarWidth(): number {
  const compute = (): number => Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, window.innerWidth * SIDEBAR_VW)))
  const [width, setWidth] = useState(compute)
  useEffect(() => {
    const onResize = (): void => setWidth(compute())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}

export function Sidebar(): JSX.Element {
  const view = useUiStore((s) => s.view)
  const setView = useSidebarNavigate()
  const focusCard = useUiStore((s) => s.focusCard)
  const openSearch = useUiStore((s) => s.openSearch)
  const isAiAdmin = useAiAdminStore((s) => s.isAdmin)
  const expandedWidth = useExpandedSidebarWidth()

  const documents = useDocumentsStore((s) => s.documents)
  const documentFolders = useDocumentsStore((s) => s.documentFolders)
  const activeDocumentId = useDocumentsStore((s) => s.activeDocumentId)
  const loadDocuments = useDocumentsStore((s) => s.loadDocuments)
  const openDocument = useDocumentsStore((s) => s.openDocument)
  const deleteDocument = useDocumentsStore((s) => s.deleteDocument)
  const createDocumentFolder = useDocumentsStore((s) => s.createDocumentFolder)
  const updateDocumentFolder = useDocumentsStore((s) => s.updateDocumentFolder)
  const reorderDocumentFolders = useDocumentsStore((s) => s.reorderDocumentFolders)
  const deleteDocumentFolder = useDocumentsStore((s) => s.deleteDocumentFolder)
  const moveDocumentToFolder = useDocumentsStore((s) => s.moveDocumentToFolder)
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
  const [creatingDocFolderUnder, setCreatingDocFolderUnder] = useState<string | null | undefined>(undefined)
  const [renamingDocFolderId, setRenamingDocFolderId] = useState<string | null>(null)
  const [rootDropActive, setRootDropActive] = useState(false)
  const [libraryRootDropActive, setLibraryRootDropActive] = useState(false)
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

  async function handleDeleteDocumentFolder(folder: DocumentFolderRecord): Promise<void> {
    if (
      !window.confirm(
        `Delete "${folder.name}" (and any subfolders)? Documents inside aren't deleted — they'll go back to being unfiled.`
      )
    ) {
      return
    }
    await deleteDocumentFolder(folder.id)
  }

  async function handleCreateDocumentFolder(name: string, parentId: string | null): Promise<void> {
    await createDocumentFolder(name, parentId)
    setCreatingDocFolderUnder(undefined)
  }

  function handleDocumentFolderDrop(draggedId: string, targetId: string | null, position: DropPosition): void {
    const updates = computeMove(documentFolders, draggedId, targetId, position)
    if (updates) reorderDocumentFolders(updates)
  }

  function handleDocumentDrop(documentId: string, folderId: string | null): void {
    void moveDocumentToFolder(documentId, folderId)
  }

  if (collapsed) {
    return (
      <aside style={collapsedSidebarStyle}>
        <button onClick={() => setView({ type: 'home' })} title="Outcisura" style={collapsedMarkButtonStyle}>
          <Logo size={24} />
        </button>
        <button onClick={() => setCollapsed(false)} title="Expand sidebar" style={collapseToggleStyle}>
          <Icon name="chevrons-right" bare />
        </button>
        <div style={railDividerStyle} />
        <RailButton icon="search" title="Search (⌘K)" active={false} onClick={openSearch} />
        <RailButton icon="home" title="Home" active={isView(view, { type: 'home' })} onClick={() => setView({ type: 'home' })} />
        <RailButton
          icon="review"
          title={dueCount > 0 ? `Review (${dueCount} due)` : 'Review'}
          active={view.type === 'review' || view.type === 'review-dashboard'}
          dot={dueCount > 0}
          onClick={() => setView({ type: 'review-dashboard' })}
        />
        <RailButton icon="layers" title="All Cards" active={isView(view, { type: 'cards' })} onClick={() => setView({ type: 'cards' })} />
        <RailButton icon="graph" title="Graph" active={isView(view, { type: 'graph' })} onClick={() => setView({ type: 'graph' })} />
        {orphanCount > 0 && (
          <RailButton
            icon="warning"
            title={`Missing Sources (${orphanCount})`}
            active={isView(view, { type: 'missing-sources' })}
            onClick={() => setView({ type: 'missing-sources' })}
          />
        )}
        <div style={railDividerStyle} />
        <RailButton icon="broadcast" title="Host a deck" active={isView(view, { type: 'hostable-decks' })} onClick={() => setView({ type: 'hostable-decks' })} />
        <RailButton
          icon="join"
          title="Join a session"
          active={view.type === 'live-session-join' || view.type === 'live-session-play'}
          onClick={() => setView({ type: 'live-session-join' })}
        />
        <div style={{ flex: 1 }} />
        {isAiAdmin && <RailButton icon="shield" title="AI Admin" active={isView(view, { type: 'admin' })} onClick={() => setView({ type: 'admin' })} />}
        <RailButton icon="sliders" title="Settings" active={view.type === 'settings'} onClick={() => setView({ type: 'settings', returnTo: view })} />
      </aside>
    )
  }

  return (
    <aside style={{ ...sidebarStyle, width: expandedWidth }}>
      <div style={{ ...sidebarInnerStyle, width: expandedWidth - 3 }}>
      <div style={sidebarHeaderStyle}>
        <button
          onClick={() => setView({ type: 'home' })}
          title="Outcisura"
          style={{ ...wordmarkStyle, flex: 1, minWidth: 0 }}
        >
          <Logo size={20} />
          Outcisura
        </button>
        <button onClick={() => setCollapsed(true)} title="Collapse sidebar" style={collapseToggleStyle}>
          <Icon name="chevrons-left" bare />
        </button>
      </div>

      <div className="sidebar-scroll" style={sidebarScrollStyle}>
      <div style={{ padding: '0 10px' }}>
        <NavItem label={<><Icon name="search" />Search</>} active={false} onClick={openSearch} title="Search cards and documents (⌘K)" />

        <NavGroupLabel>Study</NavGroupLabel>
        <NavItem label={<><Icon name="home" />Home</>} active={isView(view, { type: 'home' })} onClick={() => setView({ type: 'home' })} />
        <NavItem
          label={<><Icon name="review" />Review</>}
          badge={dueCount}
          active={view.type === 'review' || view.type === 'review-dashboard'}
          onClick={() => setView({ type: 'review-dashboard' })}
        />
        <NavItem label={<><Icon name="layers" />All Cards</>} active={isView(view, { type: 'cards' })} onClick={() => setView({ type: 'cards' })} />
        <NavItem label={<><Icon name="graph" />Graph</>} active={isView(view, { type: 'graph' })} onClick={() => setView({ type: 'graph' })} />
        {orphanCount > 0 && (
          <NavItem
            label={<><Icon name="warning" />Missing Sources</>}
            badge={orphanCount}
            active={isView(view, { type: 'missing-sources' })}
            onClick={() => setView({ type: 'missing-sources' })}
          />
        )}

        <NavGroupLabel>Live sessions</NavGroupLabel>
        <NavItem
          label={<><Icon name="broadcast" />Host a deck</>}
          active={isView(view, { type: 'hostable-decks' })}
          onClick={() => setView({ type: 'hostable-decks' })}
        />
        <NavItem
          label={<><Icon name="join" />Join a session</>}
          active={view.type === 'live-session-join' || view.type === 'live-session-play'}
          onClick={() => setView({ type: 'live-session-join' })}
        />
      </div>

      <div style={sectionStyle}>
        <SectionHeader
          label="Library"
          collapsed={libraryCollapsed}
          active={isView(view, { type: 'library-index' })}
          onToggle={() => setLibraryCollapsed((v) => !v)}
          onOpen={() => setView({ type: 'library-index' })}
          action={
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <button onClick={() => setCreatingDocFolderUnder(null)} title="New folder" style={smallIconButton}>
                <Icon name="folder-plus" bare size="1.3em" />
              </button>
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
                <span title="Import PDF/PPTX/MP4" style={smallIconButton}>
                  {importing ? '…' : <Icon name="plus" bare size="1.3em" />}
                </span>
              </label>
            </div>
          }
        />
        {importProgress && <ImportProgressBar progress={importProgress} />}
        {importError && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-xs)', padding: '0 var(--space-2)' }}>{importError}</p>}
        {!libraryCollapsed && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              animation: 'expand-collapse 120ms ease',
              borderRadius: 'var(--radius-md)',
              outline: libraryRootDropActive ? '2px dashed var(--accent)' : 'none',
              outlineOffset: -2,
              minHeight: 8
            }}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(DOCUMENT_DRAG_MIME)) return
              e.preventDefault()
              setLibraryRootDropActive(true)
            }}
            onDragLeave={() => setLibraryRootDropActive(false)}
            onDrop={(e) => {
              const draggedId = e.dataTransfer.getData(DOCUMENT_DRAG_MIME)
              setLibraryRootDropActive(false)
              if (!draggedId) return
              e.preventDefault()
              handleDocumentDrop(draggedId, null)
            }}
          >
            {getChildren(documentFolders, null).map((folder) => (
              <DocumentFolderNode
                key={folder.id}
                folder={folder}
                depth={0}
                documentFolders={documentFolders}
                documents={documents}
                view={view}
                activeDocumentId={activeDocumentId}
                renamingId={renamingDocFolderId}
                creatingUnder={creatingDocFolderUnder}
                setView={setView}
                onOpenDocument={async (doc) => {
                  setView({ type: 'library' })
                  await openDocument(doc.id)
                }}
                onDeleteDocument={handleDeleteDocument}
                onToggleCollapse={() => updateDocumentFolder(folder.id, { collapsed: !folder.collapsed })}
                onStartRename={() => setRenamingDocFolderId(folder.id)}
                onFinishRename={async (name) => {
                  if (name.trim()) await updateDocumentFolder(folder.id, { name: name.trim() })
                  setRenamingDocFolderId(null)
                }}
                onCancelRename={() => setRenamingDocFolderId(null)}
                onStartCreateChild={() => setCreatingDocFolderUnder(folder.id)}
                onCreate={handleCreateDocumentFolder}
                onCancelCreate={() => setCreatingDocFolderUnder(undefined)}
                onDelete={() => handleDeleteDocumentFolder(folder)}
                onDrop={handleDocumentFolderDrop}
                onDropDocument={handleDocumentDrop}
              />
            ))}
            {creatingDocFolderUnder === null && (
              <InlineTextInput
                depth={0}
                placeholder="Folder name"
                onSubmit={(name) => handleCreateDocumentFolder(name, null)}
                onCancel={() => setCreatingDocFolderUnder(undefined)}
              />
            )}
            {documents
              .filter((d) => d.folderId === null)
              .map((doc) => (
                <DocumentRow
                  key={doc.id}
                  doc={doc}
                  active={view.type === 'library' && activeDocumentId === doc.id}
                  draggable
                  onOpen={async () => {
                    setView({ type: 'library' })
                    await openDocument(doc.id)
                  }}
                  onDelete={() => handleDeleteDocument(doc)}
                />
              ))}
            {documents.length === 0 && documentFolders.length === 0 && creatingDocFolderUnder === undefined && (
              <EmptySidebarHint text="Import a PDF, PPTX, or MP4 to get started." />
            )}
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
              <Icon name="plus" bare size="1.3em" />
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
        {isAiAdmin && (
          <button
            onClick={() => setView({ type: 'admin' })}
            className="nav-pill"
            style={footerButtonStyle(isView(view, { type: 'admin' }))}
            title="Manage AI budgets and accounts"
          >
            <ActiveFill active={isView(view, { type: 'admin' })} />
            <span style={{ position: 'relative' }}>
              <Icon name="shield" />AI Admin
            </span>
          </button>
        )}
        <button
          onClick={() => setView({ type: 'settings', returnTo: view })}
          className="nav-pill"
          style={footerButtonStyle(view.type === 'settings')}
          title="Settings"
        >
          <ActiveFill active={view.type === 'settings'} />
          <span style={{ position: 'relative' }}>
            <Icon name="sliders" />Settings
          </span>
        </button>
      </div>
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
  const setView = useSidebarNavigate()
  const focusCard = useUiStore((s) => s.focusCard)
  // Groups start COLLAPSED: with dozens of unfiled cards, listing every one under the tree buried the
  // folders below it. Track which the user has opened, rather than which they've closed.
  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(new Set())
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
    setExpandedDocs((prev) => {
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
          const collapsed = !expandedDocs.has(key)
          const name = key === '__none__' ? 'No source' : documents.find((d) => d.id === key)?.filename ?? 'Unknown document'
          const sorted = [...docCards].sort(bySortOrder)
          const ids = sorted.map((c) => c.id)
          return (
            <div key={key}>
              <button onClick={() => toggle(key)} style={docGroupRowStyle} title={name}>
                <span style={{ ...caretButtonStyle, cursor: 'inherit' }}>
                  <Caret open={!collapsed} />
                </span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', overflowWrap: 'anywhere' }}>
                  <Icon name="file" />
                  {name}
                </span>
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

/** Small uppercase label that groups the nav items under it — same look as the Library/Folders
 *  section headers, minus the caret and click target (these groups don't collapse). */
/** One chevron that rotates open/closed, rather than swapping between two icons. */
function Caret({ open }: { open: boolean }): JSX.Element {
  return <Icon name="chevron-right" bare size={12} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 160ms ease' }} />
}

function NavGroupLabel({ children }: { children: string }): JSX.Element {
  return <div style={navGroupLabelStyle}>{children}</div>
}

function NavItem({
  label,
  active,
  onClick,
  grow,
  title,
  badge
}: {
  label: ReactNode
  active: boolean
  onClick: () => void
  grow?: boolean
  title?: string
  /** A count shown as a circular badge on the right (e.g. cards due). Hidden at 0. */
  badge?: number
}): JSX.Element {
  return (
    <button
      className="nav-pill"
      onClick={onClick}
      title={title}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: grow ? undefined : '100%',
        flex: grow ? 1 : undefined,
        minWidth: 0,
        textAlign: 'left',
        padding: '6px 12px',
        borderRadius: 'var(--radius-pill)',
        border: 'none',
        // The current page's fill is the <ActiveFill> layer below; this button only ever carries the
        // hover wash, and the text colour, which eases along with the fade.
        background: 'transparent',
        color: active ? 'var(--on-accent)' : 'inherit',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        transition: 'background-color var(--transition-fast), color 200ms ease, transform 80ms ease'
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'var(--bg-hover)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <ActiveFill active={active} />
      <span style={{ position: 'relative', flex: 1, minWidth: 0, overflow: 'hidden', overflowWrap: 'anywhere' }}>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span style={{ position: 'relative', display: 'inline-flex' }}>
          <CountBadge count={badge} onAccent={active} />
        </span>
      )}
    </button>
  )
}

/** One round icon button in the collapsed rail; the current page is a solid accent disc, like the
 *  active pill in the expanded sidebar. `dot` flags something needing attention (cards due). */
function RailButton({
  icon,
  title,
  active,
  dot,
  onClick
}: {
  icon: IconName
  title: string
  active: boolean
  dot?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className="nav-pill"
      style={{
        position: 'relative',
        width: 34,
        height: 34,
        padding: 0,
        border: 'none',
        borderRadius: '50%',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        cursor: 'pointer',
        background: 'transparent',
        color: active ? 'var(--on-accent)' : 'var(--fg-muted)',
        // Rail buttons fade in as the panel collapses, rather than appearing fully formed.
        animation: 'fade-in 260ms ease both',
        transition: 'background-color var(--transition-fast), color 200ms ease, transform 80ms ease'
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'var(--bg-hover)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <ActiveFill active={active} radius="50%" />
      <span style={{ position: 'relative', display: 'inline-flex' }}>
        <Icon name={icon} bare size={17} />
      </span>
      {dot && (
        <span
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: active ? 'var(--on-accent)' : 'var(--accent)',
            border: '1.5px solid var(--bg-sidebar)'
          }}
        />
      )}
    </button>
  )
}

/** Small circular count (cards due, missing sources). Inverts on the active pill so it stays legible
 *  against the solid accent. */
function CountBadge({ count, onAccent }: { count: number; onAccent: boolean }): JSX.Element {
  return (
    <span
      style={{
        minWidth: 18,
        height: 18,
        // Negative margin so the badge doesn't make its row taller than rows without one.
        margin: '-2px 0',
        padding: '0 5px',
        borderRadius: 'var(--radius-pill)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 10.5,
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
        flexShrink: 0,
        background: onAccent ? 'var(--on-accent)' : 'var(--fg)',
        color: onAccent ? 'var(--accent)' : 'var(--bg)',
        transition: 'background-color 200ms ease, color 200ms ease'
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

/** A document row in the Library section, styled to match a folder row: same fixed-width
 *  caret gutter (hidden here since documents don't expand/collapse, but keeps names aligned
 *  under the same grid), a type icon, a page count badge, and row-level hover/active background. */
function DocumentRow({
  doc,
  active,
  onOpen,
  onDelete,
  depth = 0,
  draggable = false
}: {
  doc: DocumentRecord
  active: boolean
  onOpen: () => void
  onDelete: () => void
  depth?: number
  /** Only root-level and in-folder document rows are drag sources — DocumentFolderNode passes
   *  this; other callers (e.g. LibraryGrid, if ever reused there) default to non-draggable. */
  draggable?: boolean
}): JSX.Element {
  return (
    <div
      className="doc-row"
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData(DOCUMENT_DRAG_MIME, doc.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        paddingLeft: depth * 14 + 6,
        paddingRight: 6,
        borderRadius: 'var(--radius-row)',
        background: active ? 'var(--bg-active)' : 'transparent',
        boxShadow: active ? 'var(--glass-pill)' : undefined,
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
        <DocTypeIcon type={doc.type} />
        {doc.filename}{' '}
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
        <Icon name="x" bare size="1.2em" />
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
        <Caret open={!collapsed} />
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
          boxShadow: active ? 'var(--glass-pill)' : undefined,
          cursor: 'pointer',
          padding: '2px 6px',
          borderRadius: 'var(--radius-row)',
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
        borderRadius: 'var(--radius-row)',
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
        <Icon name="grip" bare size={14} />
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
        <Icon name="x" bare size="1.2em" />
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
  // Classic Finder "spring-loading": hovering a drag over a collapsed folder auto-opens it after a
  // beat, so you can drop deeper without a separate expand-then-drag-again step. Ref (not state) —
  // dragover fires continuously while hovering, and re-arming the timer every time would mean it
  // never actually fires.
  const springLoadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function armSpringLoad(): void {
    if (springLoadTimer.current || !folder.collapsed || !hasContent) return
    springLoadTimer.current = setTimeout(() => {
      springLoadTimer.current = null
      props.onToggleCollapse()
    }, 600)
  }

  function disarmSpringLoad(): void {
    if (springLoadTimer.current) {
      clearTimeout(springLoadTimer.current)
      springLoadTimer.current = null
    }
  }

  useEffect(() => disarmSpringLoad, [])

  function handleDragOver(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    e.stopPropagation()
    // A dragged card always lands *in* the folder; only folder drags get before/inside/after zones.
    if (e.dataTransfer.types.includes(CARD_DRAG_MIME)) {
      setCardDropActive(true)
      armSpringLoad()
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const relY = (e.clientY - rect.top) / rect.height
    const position = relY < 0.25 ? 'before' : relY > 0.75 ? 'after' : 'inside'
    setDropIndicator(position)
    if (position === 'inside') armSpringLoad()
    else disarmSpringLoad()
  }

  function clearDropState(): void {
    setDropIndicator(null)
    setCardDropActive(false)
    disarmSpringLoad()
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

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'ArrowRight' && folder.collapsed && hasContent) {
      e.preventDefault()
      props.onToggleCollapse()
    } else if (e.key === 'ArrowLeft' && !folder.collapsed && hasContent) {
      e.preventDefault()
      props.onToggleCollapse()
    }
  }

  return (
    <div>
      {renamingId === folder.id ? (
        <InlineTextInput depth={depth} initialValue={folder.name} onSubmit={props.onFinishRename} onCancel={props.onCancelRename} />
      ) : (
        <div
          draggable
          tabIndex={0}
          role="treeitem"
          aria-expanded={hasContent ? !folder.collapsed : undefined}
          onKeyDown={handleKeyDown}
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
            borderRadius: 'var(--radius-row)',
            background:
              cardDropActive || dropIndicator === 'inside' ? 'var(--accent-soft)' : active ? 'var(--bg-active)' : 'transparent',
            boxShadow: active && !cardDropActive && !dropIndicator ? 'var(--glass-pill)' : undefined,
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
            <Caret open={!folder.collapsed} />
          </button>
          <button
            onClick={() => props.setView({ type: 'folder', folderId: folder.id })}
            style={{ ...navFolderTitleStyle, fontWeight: active ? 600 : 400 }}
          >
            <Icon name="folder" />
            {folder.name} <span style={{ color: 'var(--fg-faint)' }}>({ownCardCount})</span>
          </button>
          <button
            onClick={() =>
              props.setView({ type: 'review', scope: { kind: 'folder', folderId: folder.id }, returnTo: view })
            }
            disabled={dueCount === 0}
            title={dueCount === 0 ? 'Nothing due in this folder' : `Review this folder (${dueCount} due)`}
            style={smallIconButton}
          >
            <Icon name="review" bare size="1.2em" />
          </button>
          <RowMenu
            items={[
              { label: 'New subfolder', onSelect: props.onStartCreateChild },
              { label: 'Rename', onSelect: props.onStartRename },
              { label: 'Delete folder', onSelect: props.onDelete, danger: true }
            ]}
          />
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
            borderRadius: 'var(--radius-row)',
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

interface DocumentFolderNodeProps {
  folder: DocumentFolderRecord
  depth: number
  documentFolders: DocumentFolderRecord[]
  documents: DocumentRecord[]
  view: MainView
  activeDocumentId: string | null
  renamingId: string | null
  creatingUnder: string | null | undefined
  setView: (view: MainView) => void
  onOpenDocument: (doc: DocumentRecord) => void
  onDeleteDocument: (doc: DocumentRecord) => void
  onToggleCollapse: () => void
  onStartRename: () => void
  onFinishRename: (name: string) => void
  onCancelRename: () => void
  onStartCreateChild: () => void
  onCreate: (name: string, parentId: string | null) => void
  onCancelCreate: () => void
  onDelete: () => void
  onDrop: (draggedId: string, targetId: string, position: DropPosition) => void
  onDropDocument: (documentId: string, folderId: string) => void
}

/** Library's folder tree, mirroring FolderNode above almost exactly — same nesting/drag-drop
 *  shape, just over document_folders/documents instead of folders/cards. Kept as a separate
 *  component rather than generalizing FolderNode itself: the two leaf types (CardLeaf vs
 *  DocumentRow) and their per-item actions (focusCard vs open/delete a document) differ enough
 *  that a shared component would need as many branches as it saves lines. */
function DocumentFolderNode(props: DocumentFolderNodeProps): JSX.Element {
  const { folder, depth, documentFolders, documents, view, activeDocumentId, renamingId, creatingUnder } = props
  const [dropIndicator, setDropIndicator] = useState<DropPosition | null>(null)
  const [documentDropActive, setDocumentDropActive] = useState(false)
  const [bodyDropActive, setBodyDropActive] = useState(false)
  const children = getChildren(documentFolders, folder.id)
  const ownDocuments = documents.filter((d) => d.folderId === folder.id)
  const hasContent = children.length > 0 || ownDocuments.length > 0
  // Same spring-loading as FolderNode above — see its own comment on why a ref, not state.
  const springLoadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function armSpringLoad(): void {
    if (springLoadTimer.current || !folder.collapsed || !hasContent) return
    springLoadTimer.current = setTimeout(() => {
      springLoadTimer.current = null
      props.onToggleCollapse()
    }, 600)
  }

  function disarmSpringLoad(): void {
    if (springLoadTimer.current) {
      clearTimeout(springLoadTimer.current)
      springLoadTimer.current = null
    }
  }

  useEffect(() => disarmSpringLoad, [])

  function handleDragOver(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.types.includes(DOCUMENT_DRAG_MIME)) {
      setDocumentDropActive(true)
      armSpringLoad()
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const relY = (e.clientY - rect.top) / rect.height
    const position = relY < 0.25 ? 'before' : relY > 0.75 ? 'after' : 'inside'
    setDropIndicator(position)
    if (position === 'inside') armSpringLoad()
    else disarmSpringLoad()
  }

  function clearDropState(): void {
    setDropIndicator(null)
    setDocumentDropActive(false)
    disarmSpringLoad()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'ArrowRight' && folder.collapsed && hasContent) {
      e.preventDefault()
      props.onToggleCollapse()
    } else if (e.key === 'ArrowLeft' && !folder.collapsed && hasContent) {
      e.preventDefault()
      props.onToggleCollapse()
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    e.stopPropagation()
    const documentId = e.dataTransfer.getData(DOCUMENT_DRAG_MIME)
    if (documentId) {
      props.onDropDocument(documentId, folder.id)
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
          tabIndex={0}
          role="treeitem"
          aria-expanded={hasContent ? !folder.collapsed : undefined}
          onKeyDown={handleKeyDown}
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
            borderRadius: 'var(--radius-row)',
            background: documentDropActive || dropIndicator === 'inside' ? 'var(--accent-soft)' : 'transparent',
            borderTop: dropIndicator === 'before' ? '2px solid var(--accent)' : '2px solid transparent',
            borderBottom: dropIndicator === 'after' ? '2px solid var(--accent)' : '2px solid transparent',
            transition: 'background-color var(--transition-fast)'
          }}
          onMouseEnter={(e) => {
            if (!dropIndicator && !documentDropActive) e.currentTarget.style.background = 'var(--bg-hover)'
          }}
          onMouseLeave={(e) => {
            if (!dropIndicator && !documentDropActive) e.currentTarget.style.background = 'transparent'
          }}
        >
          <button onClick={props.onToggleCollapse} style={{ ...caretButtonStyle, visibility: hasContent ? 'visible' : 'hidden' }}>
            <Caret open={!folder.collapsed} />
          </button>
          <button onClick={props.onToggleCollapse} style={navFolderTitleStyle}>
            <Icon name="folder" />
            {folder.name} <span style={{ color: 'var(--fg-faint)' }}>({ownDocuments.length})</span>
          </button>
          <RowMenu
            items={[
              { label: 'New subfolder', onSelect: props.onStartCreateChild },
              { label: 'Rename', onSelect: props.onStartRename },
              { label: 'Delete folder', onSelect: props.onDelete, danger: true }
            ]}
          />
        </div>
      )}

      {!folder.collapsed && (
        <div
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(DOCUMENT_DRAG_MIME)) return
            e.preventDefault()
            setBodyDropActive(true)
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setBodyDropActive(false)
          }}
          onDrop={(e) => {
            const documentId = e.dataTransfer.getData(DOCUMENT_DRAG_MIME)
            if (!documentId) return
            e.preventDefault()
            e.stopPropagation()
            props.onDropDocument(documentId, folder.id)
            setBodyDropActive(false)
          }}
          style={{
            animation: 'expand-collapse 120ms ease',
            borderRadius: 'var(--radius-row)',
            background: bodyDropActive ? 'var(--accent-soft)' : 'transparent',
            transition: 'background-color var(--transition-fast)'
          }}
        >
          {children.map((child) => (
            <DocumentFolderNode key={child.id} {...props} folder={child} depth={depth + 1} />
          ))}
          {creatingUnder === folder.id && (
            <InlineTextInput depth={depth + 1} placeholder="Subfolder name" onSubmit={(name) => props.onCreate(name, folder.id)} onCancel={props.onCancelCreate} />
          )}
          {ownDocuments.map((doc) => (
            <DocumentRow
              key={doc.id}
              doc={doc}
              depth={depth + 1}
              draggable
              active={view.type === 'library' && activeDocumentId === doc.id}
              onOpen={() => props.onOpenDocument(doc)}
              onDelete={() => props.onDeleteDocument(doc)}
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
        borderRadius: 'var(--radius-row)',
        background: 'var(--bg)',
        color: 'inherit'
      }}
    />
  )
}

const wordmarkStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  margin: '0 var(--space-2)',
  padding: '2px 8px 2px 6px',
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  fontSize: 15,
  fontWeight: 700,
  letterSpacing: '-0.01em',
  color: 'var(--fg)',
  textAlign: 'left'
}

/** The panel's glass finish: a thin gradient border that catches light at opposite corners (the
 *  "rim"), a faint sheen over the top, and the body gradient — all layered as backgrounds so the rim
 *  follows the rounded corners. Colours come from --glass-* tokens, tuned separately per theme. */
const glassPanel: CSSProperties = {
  border: '1.5px solid transparent',
  background:
    'var(--glass-sheen) padding-box, linear-gradient(180deg, var(--bg-sidebar), color-mix(in srgb, var(--bg-sidebar) 90%, var(--fg))) padding-box, var(--glass-rim) border-box',
  boxShadow: '0 0 0 1px var(--glass-ring), 0 1px 2px #0000000a, 0 10px 28px #00000012, var(--glass-inner)',
  borderRadius: 'var(--radius-panel)'
}

/** The fill behind the current page, drawn as its own layer that fades in and out — so moving between
 *  pages crossfades the orange pill instead of snapping. The parent must be position: relative. */
function ActiveFill({ active, radius = 'var(--radius-pill)' }: { active: boolean; radius?: string }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, borderRadius: radius, ...activePill, opacity: active ? 1 : 0, transition: 'opacity 200ms ease', pointerEvents: 'none' }}
    />
  )
}

/** The current page: a flat accent pill with a lit finish — a bright inner top edge, a faint ring and
 *  a soft glow — but a single solid colour, no gradient across the fill. */
const activePill: CSSProperties = {
  background: 'var(--accent)',
  boxShadow: 'inset 0 1px 0 #ffffff73, inset 0 0 0 1px #ffffff2e, 0 1px 3px color-mix(in srgb, var(--accent) 45%, transparent)'
}

const sidebarStyle: CSSProperties = {
  ...glassPanel,
  // Width is set inline from useExpandedSidebarWidth (proportional to the window: at higher zoom the
  // window fits fewer CSS pixels, so a fixed width would squeeze names into ellipses).
  flexShrink: 0,
  // A floating panel rather than a full-height strip: inset from the window edges, stretched to fill
  // the row minus its margins.
  alignSelf: 'stretch',
  // Collapsing/expanding is the same <aside> element in both states (React reuses it), so animating
  // width here is what makes the panel glide instead of popping.
  transition: 'width 260ms cubic-bezier(0.22, 1, 0.36, 1), padding 260ms cubic-bezier(0.22, 1, 0.36, 1)',
  margin: 'var(--space-4) 0 var(--space-4) var(--space-2)',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column'
}

/** Expanded content is laid out at the panel's full width even while the panel is still growing or
 *  shrinking, and simply clipped by the aside's overflow — so expanding reveals the labels from the left
 *  instead of squashing and re-wrapping them mid-animation. (-3px: the panel's 1.5px borders.) */
const sidebarInnerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  // width is set inline (useExpandedSidebarWidth minus the panel's 3px of border)
  flexShrink: 0
}

const sidebarHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: 'var(--space-3) var(--space-2) var(--space-2)',
  borderBottom: '1px solid color-mix(in srgb, var(--border) 70%, transparent)'
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
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  padding: 'var(--space-2) 10px',
  borderTop: '1px solid color-mix(in srgb, var(--border) 70%, transparent)'
}

/** Footer rows (Settings, AI Admin) match the nav pills: muted until they're the current page. */
function footerButtonStyle(active: boolean): CSSProperties {
  return {
    position: 'relative',
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    border: 'none',
    cursor: 'pointer',
    fontSize: 13,
    padding: '6px 12px',
    borderRadius: 'var(--radius-pill)',
    // The fill is an <ActiveFill> layer in the button, so it can fade rather than snap.
    background: 'none',
    color: active ? 'var(--on-accent)' : 'var(--fg-muted)',
    fontWeight: active ? 600 : 400,
    transition: 'background-color var(--transition-fast), color 200ms ease, transform 80ms ease'
  }
}

const navGroupLabelStyle: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  color: 'var(--fg-faint)',
  padding: '12px 12px 3px'
}

const sectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  // Same 10px inset as the nav pills, so every row in the panel shares its left and right edges.
  padding: '0 10px'
}

// Collapsed: a slim rounded pill of round icon buttons, same glass finish as the full panel.
const collapsedSidebarStyle: CSSProperties = {
  ...glassPanel,
  width: 52,
  flexShrink: 0,
  alignSelf: 'stretch',
  transition: 'width 260ms cubic-bezier(0.22, 1, 0.36, 1), padding 260ms cubic-bezier(0.22, 1, 0.36, 1)',
  margin: 'var(--space-4) 0 var(--space-4) var(--space-2)',
  padding: 'var(--space-2) 0',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 2,
  overflowY: 'auto',
  overflowX: 'hidden'
}

const railDividerStyle: CSSProperties = {
  width: 20,
  height: 1,
  background: 'color-mix(in srgb, var(--border) 70%, transparent)',
  margin: '3px 0',
  flexShrink: 0
}

const collapsedMarkButtonStyle: CSSProperties = {
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  padding: 6,
  borderRadius: 'var(--radius-row)'
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
  borderRadius: 'var(--radius-row)',
  flexShrink: 0
}

const sectionHeaderRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  // With the section's own 10px inset, this puts the caret glyph on the same line as the nav icons above.
  padding: '0 10px',
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
  borderRadius: 'var(--radius-row)'
}

const navFolderTitleStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  overflowWrap: 'anywhere',
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  fontSize: 13,
  fontFamily: 'inherit',
  textAlign: 'left',
  padding: '3px 0',
  color: 'inherit'
}
