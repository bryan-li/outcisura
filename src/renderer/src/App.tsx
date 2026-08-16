import { useEffect } from 'react'
import { useAuthStore } from './state/authStore'
import { useDocumentsStore } from './state/documentsStore'
import { useCardsStore } from './state/cardsStore'
import { useFoldersStore } from './state/foldersStore'
import { useReviewLogStore } from './state/reviewLogStore'
import { useUiStore } from './state/uiStore'
import { useSyncEnabledStore } from './state/syncEnabledStore'
import { useConnectivityStore } from './state/connectivityStore'
import { startSyncEngine, stopSyncEngine } from './lib/syncEngine'
import { LoginView } from './components/Auth/LoginView'
import { GuestSessionView } from './components/Auth/GuestSessionView'
import { Sidebar } from './components/Sidebar/Sidebar'
import { HomePage } from './components/Home/HomePage'
import { DocumentViewer } from './components/Viewer/DocumentViewer'
import { CardList } from './components/CardBrowser/CardList'
import { FolderCardsView } from './components/CardBrowser/FolderCardsView'
import { FoldersGrid } from './components/CardBrowser/FoldersGrid'
import { LibraryGrid } from './components/Library/LibraryGrid'
import { CombineBasketBar } from './components/CardEditor/CombineBasketBar'
import { ZoomControl } from './components/ZoomControl'
import { SearchPalette } from './components/Search/SearchPalette'
import { ReviewSession } from './components/Review/ReviewSession'
import { ReviewDashboard } from './components/Review/ReviewDashboard'
import { GraphPage } from './components/Graph/GraphPage'
import { SettingsView } from './components/Settings/SettingsView'
import { MissingSourcesView } from './components/MissingSources/MissingSourcesView'
import { HostableDecksView } from './components/CardBrowser/HostableDecksView'
import { HostPrepToast } from './components/Toast/HostPrepToast'
import { HostLobbyView } from './components/LiveSession/HostLobbyView'
import { HostControlView } from './components/LiveSession/HostControlView'
import { useDeleteSelectedCardsShortcut } from './hooks/useDeleteSelectedCardsShortcut'
import { useSearchShortcut } from './hooks/useSearchShortcut'

export default function App(): JSX.Element | null {
  const session = useAuthStore((s) => s.session)
  const authLoading = useAuthStore((s) => s.loading)
  const init = useAuthStore((s) => s.init)

  useEffect(() => {
    init()
  }, [init])

  // Renders nothing during the initial getSession() check rather than flashing LoginView first —
  // see authStore's own `loading` doc comment.
  if (authLoading) return null
  if (!session) return <LoginView />
  // An anonymous session (guestAuth.ts's signInAsGuest, used only by the "join a session" flow)
  // never reaches the normal app — no flashcard library, no Settings, nothing beyond the live
  // session it was created for. This check is deliberately unconditional here (not, say, gated on
  // "did this session arrive via the join form this launch") so a persisted anonymous session from
  // a previous run is caught exactly the same way as a brand-new one — see GuestSessionView's own
  // note on why. RLS backs this up server-side too (live_sessions_insert's own is_anonymous check),
  // so this isn't the only thing standing between a guest identity and hosting — but it's what keeps
  // a guest out of every *other* screen in the app, which RLS alone wouldn't do.
  if (session.user.is_anonymous) return <GuestSessionView />
  return <AppShell />
}

function AppShell(): JSX.Element {
  const view = useUiStore((s) => s.view)
  const combineMode = useUiStore((s) => s.combineMode)

  const documents = useDocumentsStore((s) => s.documents)
  const activeDocumentId = useDocumentsStore((s) => s.activeDocumentId)
  const loadDocuments = useDocumentsStore((s) => s.loadDocuments)
  const loadCards = useCardsStore((s) => s.loadCards)
  const loadFolders = useFoldersStore((s) => s.loadFolders)
  const loadReviewLog = useReviewLogStore((s) => s.loadReviewLog)
  const syncEnabled = useSyncEnabledStore((s) => s.enabled)
  const lastSyncedAt = useConnectivityStore((s) => s.lastSyncedAt)

  useEffect(() => {
    loadDocuments()
    loadCards()
    loadFolders()
    loadReviewLog()
  }, [loadDocuments, loadCards, loadFolders, loadReviewLog])

  // Local SQLite is always the primary read/write path (loaded above regardless), so this only
  // controls whether the background engine also keeps Supabase in sync — see syncEngine.ts and
  // the "Cloud sync" toggle in Settings.
  useEffect(() => {
    if (!syncEnabled) return
    startSyncEngine()
    return () => stopSyncEngine()
  }, [syncEnabled])

  // A sync cycle's pull phase writes straight to local SQLite via IPC — it never touches these
  // Zustand stores directly, so without this the UI would only ever reflect data pulled from
  // another device after a full app restart. Reload whenever a cycle completes (lastSyncedAt
  // bumps on every successful cycle, not just ones that changed something — cheap enough at
  // personal-deck scale to not bother diffing).
  useEffect(() => {
    if (!lastSyncedAt) return
    loadCards()
    loadFolders()
    loadReviewLog()
  }, [lastSyncedAt, loadCards, loadFolders, loadReviewLog])

  useDeleteSelectedCardsShortcut()
  useSearchShortcut()

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
          {view.type === 'missing-sources' && <MissingSourcesView />}
          {view.type === 'hostable-decks' && <HostableDecksView />}
          {view.type === 'host-lobby' && <HostLobbyView sessionId={view.sessionId} />}
          {view.type === 'host-control' && <HostControlView sessionId={view.sessionId} />}
          {view.type === 'settings' && <SettingsView />}
        </div>
      </main>

      {combineMode && <CombineBasketBar />}
      <ZoomControl />
      <SearchPalette />
      <HostPrepToast />
    </div>
  )
}
