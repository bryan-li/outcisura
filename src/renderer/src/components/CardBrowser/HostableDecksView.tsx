import { useEffect, useState } from 'react'
import { useFoldersStore } from '../../state/foldersStore'
import { useUiStore } from '../../state/uiStore'
import { computeReadinessForFolders, type FolderReadiness } from '../../lib/liveSession/deckReadiness'
import { listPublicDecks, type PublicDeckSummary } from '../../lib/liveSession/hostableDecks'
import { BentoGrid, BentoTile } from '../Grid/Bento'

/** Decks ready to host: the current user's own prepped folders, plus public premade decks from any
 *  user. Doesn't build the actual "start a session" flow (M1, not built yet) — "Your decks" tiles
 *  navigate to the existing FolderCardsView (where that action will eventually live); "Public
 *  decks" tiles are a non-clickable preview only, since FolderCardsView's edit/delete affordances
 *  assume ownership and the still-owner-only RLS would just reject them for a public deck browsed
 *  from another account. */
export function HostableDecksView(): JSX.Element {
  const folders = useFoldersStore((s) => s.folders)
  const setView = useUiStore((s) => s.setView)

  const [readinessByFolder, setReadinessByFolder] = useState<Map<string, FolderReadiness>>(new Map())
  const [publicDecks, setPublicDecks] = useState<PublicDeckSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    computeReadinessForFolders(folders.map((f) => f.id))
      .then((result) => {
        if (!cancelled) setReadinessByFolder(result)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to check deck readiness')
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders.length])

  useEffect(() => {
    let cancelled = false
    listPublicDecks()
      .then((decks) => {
        if (!cancelled) setPublicDecks(decks)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load public decks')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const yourReadyFolders = folders.filter((f) => readinessByFolder.get(f.id)?.isReady)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div>
        <h1 style={{ fontSize: 'var(--font-xxl)', margin: 0 }}>📡 Hostable Decks</h1>
        <p style={{ color: 'var(--fg-muted)', marginTop: 'var(--space-1)' }}>
          Decks ready for a live session — prepare a folder from its own page, then it shows up here.
        </p>
      </div>

      {error && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', margin: 0 }}>{error}</p>}

      <div>
        <h2 style={{ fontSize: 'var(--font-lg)', margin: '0 0 var(--space-2)' }}>Your decks</h2>
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
                    📁 {folder.name}
                  </div>
                  <div style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)' }}>
                    {readiness?.totalCards ?? 0} card{(readiness?.totalCards ?? 0) === 1 ? '' : 's'} · ✅ Ready to host
                  </div>
                </BentoTile>
              )
            })}
          </BentoGrid>
        )}
      </div>

      <div>
        <h2 style={{ fontSize: 'var(--font-lg)', margin: '0 0 var(--space-2)' }}>Public decks</h2>
        {publicDecks === null ? (
          <p style={{ color: 'var(--fg-muted)', fontSize: 'var(--font-sm)' }}>Loading…</p>
        ) : publicDecks.length === 0 ? (
          <p style={{ color: 'var(--fg-muted)', fontSize: 'var(--font-sm)' }}>No public decks yet.</p>
        ) : (
          <BentoGrid>
            {publicDecks.map((deck) => (
              <BentoTile key={deck.folderId}>
                <div style={{ fontSize: 'var(--font-lg)', fontWeight: 600, overflowWrap: 'anywhere', lineHeight: 1.25 }}>
                  📁 {deck.name}
                </div>
                <div style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)' }}>
                  {deck.cardCount} card{deck.cardCount === 1 ? '' : 's'} · 🌐 Public
                </div>
              </BentoTile>
            ))}
          </BentoGrid>
        )}
      </div>
    </div>
  )
}
