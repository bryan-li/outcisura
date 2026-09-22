import { useEffect, useState } from 'react'
import { useCardsStore } from '../../state/cardsStore'
import { useFoldersStore } from '../../state/foldersStore'
import { useHostSessionStore } from '../../state/hostSessionStore'
import { useUiStore } from '../../state/uiStore'
import { computeReadinessForFolders, type FolderReadiness } from '../../lib/liveSession/deckReadiness'
import { listPublicDecks, type PublicDeckSummary } from '../../lib/liveSession/hostableDecks'
import { downloadDeck } from '../../lib/deckImport'
import { supabaseErrorMessage } from '../../lib/supabaseError'
import { BentoGrid, BentoTile } from '../Grid/Bento'
import { Icon } from '../Icon'
import { PageHeader, pageStyle, panelTitleStyle, primaryPillStyle, secondaryPillStyle } from '../dashboardKit'

/** Decks ready to host: the current user's own prepped folders, plus public premade decks from any
 *  user (approved via the publish workflow — see 0024_publish_approval_workflow.sql). "Your decks"
 *  tiles navigate to the existing FolderCardsView, where hosting/editing already lives. A public
 *  deck isn't yours to open that way (FolderCardsView's actions assume ownership), so its tile
 *  instead offers two direct actions: Host (if its cards are actually prepped — createLiveSession
 *  has no ownership check, only cards_select's public-folder RLS branch, so this already works for
 *  a deck you don't own) and Download (a copy into your own library, via the same import machinery
 *  Anki import and friend-shared decks use). */
export function HostableDecksView(): JSX.Element {
  const folders = useFoldersStore((s) => s.folders)
  const setView = useUiStore((s) => s.setView)
  const createAndHost = useHostSessionStore((s) => s.createAndHost)
  const loadCards = useCardsStore((s) => s.loadCards)
  const loadFolders = useFoldersStore((s) => s.loadFolders)

  const [readinessByFolder, setReadinessByFolder] = useState<Map<string, FolderReadiness>>(new Map())
  const [publicDecks, setPublicDecks] = useState<PublicDeckSummary[] | null>(null)
  const [publicReadiness, setPublicReadiness] = useState<Map<string, FolderReadiness>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    computeReadinessForFolders(folders.map((f) => f.id))
      .then((result) => {
        if (!cancelled) setReadinessByFolder(result)
      })
      .catch((err) => {
        if (!cancelled) setError(supabaseErrorMessage(err, 'Failed to check deck readiness'))
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders.length])

  useEffect(() => {
    let cancelled = false
    listPublicDecks()
      .then(async (decks) => {
        if (cancelled) return
        setPublicDecks(decks)
        setPublicReadiness(await computeReadinessForFolders(decks.map((d) => d.folderId)))
      })
      .catch((err) => {
        if (!cancelled) setError(supabaseErrorMessage(err, 'Failed to load public decks'))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const yourReadyFolders = folders.filter((f) => readinessByFolder.get(f.id)?.isReady)

  async function hostPublicDeck(deck: PublicDeckSummary): Promise<void> {
    setBusyId(deck.folderId)
    setError(null)
    try {
      await createAndHost(deck.folderId, deck.name)
      const { sessionId } = useHostSessionStore.getState()
      if (sessionId) setView({ type: 'host-lobby', sessionId })
    } catch (err) {
      setError(supabaseErrorMessage(err, 'Failed to start a session with this deck'))
    } finally {
      setBusyId(null)
    }
  }

  async function downloadPublicDeck(deck: PublicDeckSummary): Promise<void> {
    setBusyId(deck.folderId)
    setError(null)
    setMessage(null)
    try {
      const result = await downloadDeck(deck.folderId, deck.name)
      await Promise.all([loadCards(), loadFolders()])
      setMessage(
        result.skipped > 0
          ? `Added ${result.imported} card${result.imported === 1 ? '' : 's'} from "${deck.name}" (${result.skipped} you already had were skipped).`
          : `Added ${result.imported} card${result.imported === 1 ? '' : 's'} from "${deck.name}" to your library.`
      )
    } catch (err) {
      setError(supabaseErrorMessage(err, 'Failed to download this deck'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div style={pageStyle}>
      <PageHeader
        title="Hostable decks"
        subtitle="Decks ready for a live session — prepare a folder from its own page, then it shows up here."
      />

      {error && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', margin: 0 }}>{error}</p>}
      {message && <p style={{ color: 'var(--accent)', fontSize: 'var(--font-sm)', margin: 0 }}>{message}</p>}

      <div className="home-rise" style={{ animationDelay: '80ms' }}>
        <h2 style={{ ...panelTitleStyle, margin: '0 0 var(--space-2)' }}>Your decks</h2>
        {yourReadyFolders.length === 0 ? (
          <p style={{ color: 'var(--fg-muted)', fontSize: 'var(--font-sm)' }}>
            Nothing ready yet — open a folder and click "Prepare for hosting."
          </p>
        ) : (
          <BentoGrid>
            {yourReadyFolders.map((folder) => {
              const readiness = readinessByFolder.get(folder.id)
              return (
                <BentoTile key={folder.id} onClick={() => setView({ type: 'folder', folderId: folder.id })}>
                  <div style={{ fontSize: 'var(--font-lg)', fontWeight: 600, overflowWrap: 'anywhere', lineHeight: 1.25 }}>
                    <Icon name="folder" />
                    {folder.name}
                  </div>
                  <div style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)' }}>
                    {readiness?.totalCards ?? 0} card{(readiness?.totalCards ?? 0) === 1 ? '' : 's'} · <Icon name="check-circle" size="1em" />Ready to host
                  </div>
                </BentoTile>
              )
            })}
          </BentoGrid>
        )}
      </div>

      <div className="home-rise" style={{ animationDelay: '140ms' }}>
        <h2 style={{ ...panelTitleStyle, margin: '0 0 var(--space-2)' }}>Public decks</h2>
        {publicDecks === null ? (
          <p style={{ color: 'var(--fg-muted)', fontSize: 'var(--font-sm)' }}>Loading…</p>
        ) : publicDecks.length === 0 ? (
          <p style={{ color: 'var(--fg-muted)', fontSize: 'var(--font-sm)' }}>No public decks yet.</p>
        ) : (
          <BentoGrid>
            {publicDecks.map((deck) => {
              const ready = publicReadiness.get(deck.folderId)?.isReady ?? false
              const busy = busyId === deck.folderId
              return (
                <BentoTile key={deck.folderId}>
                  <div style={{ fontSize: 'var(--font-lg)', fontWeight: 600, overflowWrap: 'anywhere', lineHeight: 1.25 }}>
                    <Icon name="folder" />
                    {deck.name}
                  </div>
                  <div style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)' }}>
                    {deck.cardCount} card{deck.cardCount === 1 ? '' : 's'} · <Icon name="globe" size="1em" />Public
                  </div>
                  <div style={{ flex: 1 }} />
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button
                      disabled={busy || !ready}
                      title={ready ? undefined : "The owner hasn't prepared this deck for hosting yet"}
                      onClick={(e) => {
                        e.stopPropagation()
                        void hostPublicDeck(deck)
                      }}
                      style={{ ...primaryPillStyle, padding: '5px 12px', fontSize: 'var(--font-xs)' }}
                    >
                      {busy ? '…' : 'Host'}
                    </button>
                    <button
                      disabled={busy || deck.cardCount === 0}
                      onClick={(e) => {
                        e.stopPropagation()
                        void downloadPublicDeck(deck)
                      }}
                      style={{ ...secondaryPillStyle, padding: '5px 12px', fontSize: 'var(--font-xs)' }}
                    >
                      {busy ? '…' : 'Download'}
                    </button>
                  </div>
                </BentoTile>
              )
            })}
          </BentoGrid>
        )}
      </div>
    </div>
  )
}
