import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { useCardsStore } from '../../state/cardsStore'
import { useFoldersStore } from '../../state/foldersStore'
import { useUiStore } from '../../state/uiStore'
import { useHostPrepStore } from '../../state/hostPrepStore'
import { blockTextToCard } from '../../utils/blockCard'
import { bySortOrder } from '../../utils/cardOrder'
import { allCardsInScope, dueCards } from '../../utils/srsQueue'
import { computeFolderReadiness, type FolderReadiness } from '../../lib/liveSession/deckReadiness'
import { useHostSessionStore } from '../../state/hostSessionStore'
import { supabase } from '../../lib/supabase'
import { CardItem } from './CardItem'
import { MarqueeSelect } from '../Grid/MarqueeSelect'
import { SharePreviewModal } from './SharePreviewModal'

interface FolderCardsViewProps {
  folderId: string
}

export function FolderCardsView({ folderId }: FolderCardsViewProps): JSX.Element {
  const cards = useCardsStore((s) => s.cards)
  const folders = useFoldersStore((s) => s.folders)
  const setView = useUiStore((s) => s.setView)

  const folder = folders.find((f) => f.id === folderId)
  const ownCards = cards.filter((c) => c.folderId === folderId).sort(bySortOrder)
  const ownCardIds = ownCards.map((c) => c.id)
  const dueCount = dueCards(cards, { kind: 'folder', folderId }, new Date()).length
  const totalCount = allCardsInScope(cards, { kind: 'folder', folderId }).length

  const activeFolderId = useHostPrepStore((s) => s.activeFolderId)
  const prepProgress = useHostPrepStore((s) => s.progress)
  const startPrep = useHostPrepStore((s) => s.startPrep)
  const lastCompletion = useHostPrepStore((s) => s.lastCompletion)
  const isThisFolderPrepping = activeFolderId === folderId

  const [readiness, setReadiness] = useState<FolderReadiness | null>(null)
  const [isPublic, setIsPublic] = useState(false)
  const [publicToggleBusy, setPublicToggleBusy] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [hostBusy, setHostBusy] = useState(false)
  const [hostError, setHostError] = useState<string | null>(null)
  const createAndHost = useHostSessionStore((s) => s.createAndHost)

  // Recomputed after this folder's own prep run finishes (lastCompletion changes), not on every
  // render — cloud round trip, and readiness only ever changes as a result of a prep run or an
  // edit to a card's front/back elsewhere.
  useEffect(() => {
    let cancelled = false
    computeFolderReadiness(folderId).then((r) => {
      if (!cancelled) setReadiness(r)
    })
    return () => {
      cancelled = true
    }
  }, [folderId, lastCompletion])

  useEffect(() => {
    let cancelled = false
    supabase
      .from('folders')
      .select('is_public')
      .eq('id', folderId)
      .single()
      .then(({ data }) => {
        if (!cancelled && data) setIsPublic((data as { is_public: boolean }).is_public)
      })
    return () => {
      cancelled = true
    }
  }, [folderId])

  async function togglePublic(): Promise<void> {
    const next = !isPublic
    setPublicToggleBusy(true)
    try {
      const { error } = await supabase.from('folders').update({ is_public: next }).eq('id', folderId).select()
      if (error) throw error
      setIsPublic(next)
    } finally {
      setPublicToggleBusy(false)
    }
  }

  async function handleHostSession(): Promise<void> {
    if (!folder) return
    setHostBusy(true)
    setHostError(null)
    try {
      await createAndHost(folderId, folder.name)
      const { sessionId } = useHostSessionStore.getState()
      if (sessionId) setView({ type: 'host-lobby', sessionId })
    } catch (err) {
      setHostError(err instanceof Error ? err.message : 'Failed to create session')
    } finally {
      setHostBusy(false)
    }
  }

  const breadcrumb: typeof folders = []
  let cursor = folder?.parentId ?? null
  while (cursor) {
    const parent = folders.find((f) => f.id === cursor)
    if (!parent) break
    breadcrumb.unshift(parent)
    cursor = parent.parentId
  }

  if (!folder) {
    return <p style={{ color: 'var(--fg-muted)' }}>That folder doesn't exist anymore.</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', width: '100%' }}>
      <div>
        {breadcrumb.length > 0 && (
          <div style={{ fontSize: 'var(--font-sm)', color: 'var(--fg-muted)', marginBottom: 4 }}>
            {breadcrumb.map((b) => (
              <span key={b.id}>
                <button
                  onClick={() => setView({ type: 'folder', folderId: b.id })}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', padding: 0 }}
                >
                  {b.name}
                </button>{' '}
                /{' '}
              </span>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <h1 style={{ fontSize: 'var(--font-xl)', margin: 0 }}>📁 {folder.name}</h1>
          <button
            disabled={dueCount === 0}
            title={dueCount === 0 ? 'Nothing due in this folder' : undefined}
            onClick={() =>
              setView({ type: 'review', scope: { kind: 'folder', folderId }, returnTo: { type: 'folder', folderId } })
            }
          >
            🔁 Review this folder {dueCount > 0 ? `(${dueCount} due)` : ''}
          </button>
          <button
            disabled={totalCount === 0}
            title={totalCount === 0 ? 'No cards in this folder yet' : 'Review every card in this folder, regardless of when it’s due'}
            onClick={() =>
              setView({
                type: 'review',
                scope: { kind: 'folder', folderId },
                returnTo: { type: 'folder', folderId },
                force: true
              })
            }
          >
            🔥 Review All {totalCount > 0 ? `(${totalCount})` : ''}
          </button>
          <button
            disabled={totalCount === 0 || (activeFolderId !== null && !isThisFolderPrepping)}
            title={
              totalCount === 0
                ? 'No cards in this folder yet'
                : activeFolderId !== null && !isThisFolderPrepping
                  ? 'Another folder is being prepared'
                  : 'Runs AI prep (multiple-choice/free-text question content) across every card in this folder, so it can be hosted as a live session'
            }
            onClick={() => startPrep(folderId, folder.name)}
          >
            {isThisFolderPrepping
              ? `🚀 Preparing… (${prepProgress?.current ?? 0}/${prepProgress?.total ?? 0})`
              : readiness?.isReady
                ? '✅ Ready to host'
                : '🚀 Prepare for hosting'}
          </button>
          <button
            disabled={!readiness?.isReady || publicToggleBusy}
            title={!readiness?.isReady ? 'Prepare this folder for hosting first' : undefined}
            onClick={togglePublic}
          >
            {isPublic ? '🌐 Public — click to unpublish' : '🔒 Make public'}
          </button>
          <button
            disabled={!readiness || readiness.readyCards === 0}
            title={!readiness || readiness.readyCards === 0 ? 'No cards prepared yet' : "See each card's generated question format, distractors, and rubric"}
            onClick={() => setPreviewOpen(true)}
          >
            👁 Preview questions
          </button>
          <button
            disabled={!readiness?.isReady || hostBusy}
            title={!readiness?.isReady ? 'Prepare this folder for hosting first' : undefined}
            onClick={() => void handleHostSession()}
          >
            {hostBusy ? '🎙 Starting…' : '🎙 Host a session'}
          </button>
        </div>
        {hostError && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', margin: '4px 0 0' }}>{hostError}</p>}
      </div>

      {previewOpen && <SharePreviewModal folderId={folderId} folderName={folder.name} onClose={() => setPreviewOpen(false)} />}

      {ownCards.length === 0 ? (
        <p style={{ color: 'var(--fg-muted)' }}>No cards yet — type below to add one.</p>
      ) : (
        // The tiny gap + padding aren't just breathing room: they're real DOM space that belongs
        // to this wrapper rather than to any CardItem, so a marquee-select drag has somewhere to
        // start from between/around cards — flush-adjacent blocks would leave nowhere to click.
        <MarqueeSelect style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '3px 0' }}>
          {ownCards.map((card) => (
            <CardItem key={card.id} card={card} siblingIds={ownCardIds} />
          ))}
        </MarqueeSelect>
      )}

      <NewCardComposer folderId={folderId} />
    </div>
  )
}

/**
 * A page-bottom composer, Notion-style: type a line ("Question :> answer"), press Enter to drop
 * it in as a new card and keep typing the next one. Shift+Enter adds a line within the same card
 * (for multi-bullet answers). Text without `:>` still becomes a card — just front-only.
 */
function NewCardComposer({ folderId }: { folderId: string }): JSX.Element {
  const createCard = useCardsStore((s) => s.createCard)
  const updateCard = useCardsStore((s) => s.updateCard)
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  async function commit(): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed) return
    setText('')
    const { front, back } = blockTextToCard(trimmed)
    const card = await createCard({ front, back, cardType: 'basic', sources: [] })
    await updateCard(card.id, { folderId })
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void commit()
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, padding: '4px 6px' }}>
      <span style={{ ...composerGutterStyle }}>+</span>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Type a question, :> for the answer... (Enter to add, Shift+Enter for a new line)"
        rows={Math.max(1, text.split('\n').length)}
        style={{ ...composerTextareaStyle, borderColor: focused ? 'var(--accent)' : 'transparent' }}
      />
    </div>
  )
}

const composerGutterStyle: CSSProperties = {
  width: 16,
  height: 22,
  flexShrink: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 12,
  color: 'var(--fg-faint)'
}

const composerTextareaStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontFamily: 'inherit',
  fontSize: 'var(--font-md)',
  lineHeight: '22px',
  padding: '0 4px',
  border: '1px solid transparent',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  color: 'inherit',
  resize: 'none',
  outline: 'none'
}
