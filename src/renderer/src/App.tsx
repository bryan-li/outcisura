import { useEffect } from 'react'
import { useDocumentsStore } from './state/documentsStore'
import { useCardsStore } from './state/cardsStore'
import { useFoldersStore } from './state/foldersStore'
import { useReviewLogStore } from './state/reviewLogStore'
import { useUiStore } from './state/uiStore'
import { Sidebar } from './components/Sidebar/Sidebar'
import { HomePage } from './components/Home/HomePage'
import { DocumentViewer } from './components/Viewer/DocumentViewer'
import { CardList } from './components/CardBrowser/CardList'
import { FolderCardsView } from './components/CardBrowser/FolderCardsView'
import { FoldersGrid } from './components/CardBrowser/FoldersGrid'
import { LibraryGrid } from './components/Library/LibraryGrid'
import { CombineBasketBar } from './components/CardEditor/CombineBasketBar'
import { ZoomControl } from './components/ZoomControl'
import { ReviewSession } from './components/Review/ReviewSession'
import { ReviewDashboard } from './components/Review/ReviewDashboard'
import { GraphPage } from './components/Graph/GraphPage'
import { SettingsView } from './components/Settings/SettingsView'
import { useDeleteSelectedCardsShortcut } from './hooks/useDeleteSelectedCardsShortcut'

export default function App(): JSX.Element {
  const view = useUiStore((s) => s.view)
  const combineMode = useUiStore((s) => s.combineMode)

  const documents = useDocumentsStore((s) => s.documents)
  const activeDocumentId = useDocumentsStore((s) => s.activeDocumentId)
  const loadDocuments = useDocumentsStore((s) => s.loadDocuments)
  const loadCards = useCardsStore((s) => s.loadCards)
  const loadFolders = useFoldersStore((s) => s.loadFolders)
  const loadReviewLog = useReviewLogStore((s) => s.loadReviewLog)

  useEffect(() => {
    loadDocuments()
    loadCards()
    loadFolders()
    loadReviewLog()
  }, [loadDocuments, loadCards, loadFolders, loadReviewLog])

  useDeleteSelectedCardsShortcut()

  const activeDocument = documents.find((d) => d.id === activeDocumentId) ?? null

  // Keyed so switching views (or folders within the "folder" view) remounts this wrapper and
  // replays its fade-in — a plain conditional swap wouldn't otherwise animate anything, since
  // React just unmounts one branch and mounts another with no transition of its own.
  const viewKey = view.type === 'folder' ? `folder:${view.folderId}` : view.type

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <Sidebar />

      <main style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 'var(--space-6)' }}>
        <div key={viewKey} style={{ animation: 'fade-in 180ms ease' }}>
          {view.type === 'home' && <HomePage />}
          {view.type === 'library-index' && <LibraryGrid />}
          {view.type === 'folders-index' && <FoldersGrid />}
          {view.type === 'library' &&
            (activeDocument ? (
              <DocumentViewer document={activeDocument} />
            ) : (
              <p style={{ color: 'var(--fg-muted)' }}>Import a PDF or PPTX from the sidebar to get started.</p>
            ))}
          {view.type === 'cards' && <CardList />}
          {view.type === 'folder' && <FolderCardsView folderId={view.folderId} />}
          {view.type === 'review-dashboard' && <ReviewDashboard />}
          {view.type === 'review' && <ReviewSession scope={view.scope} returnTo={view.returnTo} force={view.force} />}
          {view.type === 'graph' && <GraphPage />}
          {view.type === 'settings' && <SettingsView />}
        </div>
      </main>

      {combineMode && <CombineBasketBar />}
      <ZoomControl />
    </div>
  )
}
