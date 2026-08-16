import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { CardRecord, DocumentRecord } from '../../../../shared/types'
import { useCardsStore } from '../../state/cardsStore'
import { useDocumentsStore } from '../../state/documentsStore'
import { useUiStore } from '../../state/uiStore'

const MAX_RESULTS_PER_GROUP = 8

/** A global Cmd/Ctrl+K palette over the already-loaded cards/documents state — a personal deck
 *  doesn't need a real search index or backend, just a client-side substring filter (see the
 *  "Search bar" Notion task). Matches card front/back text and document filenames. */
export function SearchPalette(): JSX.Element | null {
  const open = useUiStore((s) => s.searchOpen)
  const closeSearch = useUiStore((s) => s.closeSearch)
  const focusCard = useUiStore((s) => s.focusCard)
  const setView = useUiStore((s) => s.setView)
  const cards = useCardsStore((s) => s.cards)
  const documents = useDocumentsStore((s) => s.documents)
  const openDocument = useDocumentsStore((s) => s.openDocument)

  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) setQuery('')
  }, [open])

  // Re-focus every time the palette opens, not just on first mount — this component stays mounted
  // (returning null when closed would still need this), and a stale focus from the last time it
  // was open won't land back in the input on the next Cmd+K.
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const q = query.trim().toLowerCase()

  const matchedCards = useMemo(() => {
    if (!q) return []
    return cards.filter((c) => c.front.toLowerCase().includes(q) || c.back.toLowerCase().includes(q)).slice(0, MAX_RESULTS_PER_GROUP)
  }, [cards, q])

  const matchedDocuments = useMemo(() => {
    if (!q) return []
    return documents.filter((d) => d.filename.toLowerCase().includes(q)).slice(0, MAX_RESULTS_PER_GROUP)
  }, [documents, q])

  useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') closeSearch()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, closeSearch])

  if (!open) return null

  function openCard(card: CardRecord): void {
    closeSearch()
    focusCard(card.id, card.folderId)
  }

  async function openDoc(doc: DocumentRecord): Promise<void> {
    closeSearch()
    setView({ type: 'library' })
    await openDocument(doc.id)
  }

  const hasQuery = q.length > 0
  const hasResults = matchedCards.length > 0 || matchedDocuments.length > 0

  return (
    <div style={overlayStyle} onClick={closeSearch}>
      <div style={paletteStyle} onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search cards and documents…"
          style={inputStyle}
        />

        <div style={resultsStyle}>
          {!hasQuery && <p style={hintStyle}>Type to search card front/back text and document filenames.</p>}
          {hasQuery && !hasResults && <p style={hintStyle}>No matches for "{query}".</p>}

          {matchedCards.length > 0 && (
            <ResultGroup label="Cards">
              {matchedCards.map((card) => (
                <button key={card.id} onClick={() => openCard(card)} style={resultRowStyle}>
                  <span style={resultTitleStyle}>{card.front.trim() || 'Untitled'}</span>
                  {card.back.trim() && <span style={resultSubtitleStyle}>{card.back.trim()}</span>}
                </button>
              ))}
            </ResultGroup>
          )}

          {matchedDocuments.length > 0 && (
            <ResultGroup label="Documents">
              {matchedDocuments.map((doc) => (
                <button key={doc.id} onClick={() => void openDoc(doc)} style={resultRowStyle}>
                  <span style={resultTitleStyle}>
                    {doc.type === 'pdf' ? '📕' : doc.type === 'pptx' ? '📽' : '🎬'} {doc.filename}
                  </span>
                </button>
              ))}
            </ResultGroup>
          )}
        </div>
      </div>
    </div>
  )
}

function ResultGroup({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div>
      <div style={groupLabelStyle}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: '#00000066',
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  paddingTop: '12vh',
  zIndex: 70,
  animation: 'fade-in 120ms ease'
}

const paletteStyle: CSSProperties = {
  width: 560,
  maxWidth: '90vw',
  maxHeight: '65vh',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--modal-bg)',
  color: 'var(--modal-fg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: '0 10px 40px #00000040',
  animation: 'scale-in 150ms ease',
  overflow: 'hidden'
}

const inputStyle: CSSProperties = {
  fontSize: 'var(--font-lg)',
  padding: 'var(--space-4)',
  border: 'none',
  borderBottom: '1px solid var(--border)',
  background: 'transparent',
  color: 'inherit',
  fontFamily: 'inherit',
  outline: 'none'
}

const resultsStyle: CSSProperties = {
  overflowY: 'auto',
  padding: 'var(--space-2)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)'
}

const hintStyle: CSSProperties = {
  color: 'var(--fg-faint)',
  fontSize: 'var(--font-sm)',
  padding: 'var(--space-2)',
  margin: 0
}

const groupLabelStyle: CSSProperties = {
  fontSize: 'var(--font-xs)',
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--fg-faint)',
  padding: '4px 8px'
}

const resultRowStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 2,
  width: '100%',
  textAlign: 'left',
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  padding: '6px 8px',
  borderRadius: 'var(--radius-sm)',
  fontFamily: 'inherit'
}

const resultTitleStyle: CSSProperties = {
  fontSize: 'var(--font-md)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  width: '100%'
}

const resultSubtitleStyle: CSSProperties = {
  fontSize: 'var(--font-xs)',
  color: 'var(--fg-muted)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  width: '100%'
}
