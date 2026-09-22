import { useEffect, useState, type CSSProperties } from 'react'
import { useAuthStore } from '../../state/authStore'
import { useSocialStore } from '../../state/socialStore'
import { useCardsStore } from '../../state/cardsStore'
import { useFoldersStore } from '../../state/foldersStore'
import { useUiStore } from '../../state/uiStore'
import { importSharedDeck, searchUsers, socialErrorMessage, type FriendProfile, type SharedDeck } from '../../lib/social'
import { Icon } from '../Icon'
import { EmptyHint, PageHeader, eyebrowStyle, listStyle, pageStyle, panelStyle, panelTitleStyle, primaryPillStyle, rowLabelStyle, rowMetaStyle, rowStyle, secondaryPillStyle } from '../dashboardKit'

/** Friends, friend requests, and decks your friends have shared with you — see lib/social.ts for
 *  the underlying Supabase queries and the friends_and_deck_shares migration for how sharing is
 *  actually gated (you must be accepted friends before you can share a folder with someone). */
export function SocialView(): JSX.Element {
  const userId = useAuthStore((s) => s.session?.user.id)
  const store = useSocialStore()
  const setView = useUiStore((s) => s.setView)
  const loadCards = useCardsStore((s) => s.loadCards)
  const loadFolders = useFoldersStore((s) => s.loadFolders)

  useEffect(() => {
    if (userId) void store.load(userId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FriendProfile[]>([])
  const [searching, setSearching] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId || query.trim().length < 2) {
      setResults([])
      return
    }
    let cancelled = false
    setSearching(true)
    const timer = setTimeout(() => {
      searchUsers(query, userId)
        .then((found) => {
          if (!cancelled) setResults(found)
        })
        .catch((err) => {
          if (!cancelled) setError(socialErrorMessage(err, 'Search failed'))
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, userId])

  if (!userId) return <EmptyHint text="Sign in to add friends and share decks." />
  // A plain `string`-typed rebinding — TS narrowing from the guard above doesn't carry into the
  // nested closures below (handleAdd/handleImport), since they're independent function bodies.
  const myUserId = userId

  const knownIds = new Set([...store.friends.map((f) => f.userId), ...store.incoming.map((r) => r.otherUser.userId), ...store.outgoing.map((r) => r.otherUser.userId)])

  async function withBusy(id: string, fn: () => Promise<void>): Promise<void> {
    setBusyId(id)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(socialErrorMessage(err, 'Something went wrong'))
    } finally {
      setBusyId(null)
    }
  }

  async function handleAdd(friend: FriendProfile): Promise<void> {
    await withBusy(friend.userId, async () => {
      await store.sendRequest(myUserId, friend.userId)
      setQuery('')
      setResults([])
    })
  }

  async function handleImport(deck: SharedDeck): Promise<void> {
    await withBusy(deck.shareId, async () => {
      const result = await importSharedDeck(deck)
      await Promise.all([loadCards(), loadFolders()])
      setError(
        result.skipped > 0
          ? `Added ${result.imported} card${result.imported === 1 ? '' : 's'} (${result.skipped} you already had were skipped).`
          : `Added ${result.imported} card${result.imported === 1 ? '' : 's'} to your library.`
      )
    })
  }

  return (
    <div style={pageStyle}>
      <PageHeader title="Social" subtitle="Add friends, and share decks with the ones you have." />

      {error && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', margin: 0 }}>{error}</p>}

      <div style={panelStyle}>
        <span style={eyebrowStyle}>Add a friend</span>
        <div style={searchRowStyle}>
          <Icon name="search" bare size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by username"
            aria-label="Search by username"
            style={searchInputStyle}
          />
        </div>
        {searching && <p style={{ ...rowMetaStyle, margin: 0 }}>Searching…</p>}
        {results.length > 0 && (
          <div style={listStyle}>
            {results.map((r) => {
              const already = knownIds.has(r.userId)
              return (
                <div key={r.userId} style={rowStyle}>
                  <span style={rowLabelStyle}>{r.username}</span>
                  <button disabled={already || busyId === r.userId} onClick={() => void handleAdd(r)} style={secondaryPillStyle}>
                    {already ? 'Already added' : busyId === r.userId ? 'Adding…' : 'Add friend'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div style={columnsStyle}>
        <div style={panelStyle}>
          <h2 style={panelTitleStyle}>Requests</h2>
          {store.incoming.length === 0 && store.outgoing.length === 0 && <EmptyHint text="No pending requests." />}
          {store.incoming.length > 0 && (
            <div style={listStyle}>
              {store.incoming.map((r) => (
                <div key={r.id} style={rowStyle}>
                  <span style={rowLabelStyle}>{r.otherUser.username}</span>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button disabled={busyId === r.id} onClick={() => void withBusy(r.id, () => store.accept(myUserId, r.id))} style={primaryPillStyle}>
                      Accept
                    </button>
                    <button disabled={busyId === r.id} onClick={() => void withBusy(r.id, () => store.remove(myUserId, r.id))} style={secondaryPillStyle}>
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {store.outgoing.length > 0 && (
            <div style={listStyle}>
              {store.outgoing.map((r) => (
                <div key={r.id} style={rowStyle}>
                  <span style={rowLabelStyle}>{r.otherUser.username}</span>
                  <span style={{ ...rowMetaStyle, flexShrink: 0 }}>Requested</span>
                  <button disabled={busyId === r.id} onClick={() => void withBusy(r.id, () => store.remove(myUserId, r.id))} style={secondaryPillStyle}>
                    Cancel
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={panelStyle}>
          <h2 style={panelTitleStyle}>Friends {store.friends.length > 0 && `(${store.friends.length})`}</h2>
          {store.friends.length === 0 ? (
            <EmptyHint text="No friends yet — search for a username above." />
          ) : (
            <div style={listStyle}>
              {store.friends.map((f) => (
                <div key={f.userId} style={rowStyle}>
                  <span style={rowLabelStyle}>{f.username}</span>
                  <button disabled={busyId === f.friendshipId} onClick={() => void withBusy(f.friendshipId, () => store.remove(myUserId, f.friendshipId))} style={secondaryPillStyle}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={panelStyle}>
        <h2 style={panelTitleStyle}>Shared with you</h2>
        {store.sharedWithMe.length === 0 ? (
          <EmptyHint text="Nothing yet — ask a friend to share a deck from its ⋯ menu." />
        ) : (
          <div style={listStyle}>
            {store.sharedWithMe.map((deck) => (
              <div key={deck.shareId} style={rowStyle}>
                <span style={rowLabelStyle}>
                  <Icon name="folder" size="1em" />
                  {deck.folderName}
                </span>
                <span style={{ ...rowMetaStyle, flexShrink: 0 }}>
                  {deck.cardCount} card{deck.cardCount === 1 ? '' : 's'} · from {deck.owner.username}
                </span>
                <button disabled={busyId === deck.shareId} onClick={() => void handleImport(deck)} style={primaryPillStyle}>
                  {busyId === deck.shareId ? 'Adding…' : 'Add to my library'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <button onClick={() => setView({ type: 'home' })} style={{ ...secondaryPillStyle, alignSelf: 'flex-start' }}>
        <Icon name="arrow-left" bare size={14} />Back home
      </button>
    </div>
  )
}

const searchRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 12px',
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

const columnsStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
  gap: 'var(--space-4)',
  alignItems: 'start'
}
