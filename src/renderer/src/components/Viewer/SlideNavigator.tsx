import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { ElementRecord, PageRecord } from '../../../../shared/types'
import { findSlideMatches } from '../../utils/slideSearch'
import { Icon } from '../Icon'

interface SlideNavigatorProps {
  pages: PageRecord[]
  elementsByPage: Record<string, ElementRecord[]>
  activePageIndex: number
  /** How many existing flashcards cite each page — drives the badge and the "with cards" filter. */
  cardCountByPageId: Record<string, number>
  onGoTo: (index: number) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * The slide position control in the document toolbar: the same prev / "3 / 40" / next cluster as
 * before, except the counter is now a button that opens a finder popover over it. Everything extra
 * (text search across the whole document, jump-to-number, first/last, the "only slides I've made
 * cards from" filter) lives inside that popover rather than as more toolbar buttons — the toolbar
 * is already full, and none of this is needed often enough to earn permanent space.
 *
 * Search is a plain substring pass over the element text already in the store (openDocument loads
 * every page's elements up front), so there's no index to build and no IPC on each keystroke.
 */
export function SlideNavigator({
  pages,
  elementsByPage,
  activePageIndex,
  cardCountByPageId,
  onGoTo,
  open,
  onOpenChange
}: SlideNavigatorProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [withCardsOnly, setWithCardsOnly] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const popoverRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // One flat "slide index → its text" pass, rebuilt only when the document's pages/elements change
  // rather than on every keystroke.
  const slideTexts = useMemo(
    () =>
      pages.map((page) =>
        (elementsByPage[page.id] ?? [])
          .map((el) => el.text)
          .filter((t): t is string => !!t && t.trim().length > 0)
          .join(' · ')
      ),
    [pages, elementsByPage]
  )

  const q = query.trim().toLowerCase()
  // A bare number is treated as "go to that slide" instead of as search text — typing "12" almost
  // never means "find the string 12", and it's the fastest way through a long deck.
  const typedSlideNumber = /^\d+$/.test(query.trim()) ? Number(query.trim()) : null

  const results = useMemo(
    () =>
      findSlideMatches({
        slideTexts,
        // A bare number means "jump there", so it must not also filter the list out from under the
        // rows you'd otherwise still want to see.
        query: typedSlideNumber !== null ? '' : q,
        withCardsOnly,
        hasCards: (i) => (cardCountByPageId[pages[i].id] ?? 0) > 0
      }),
    [pages, slideTexts, q, typedSlideNumber, withCardsOnly, cardCountByPageId]
  )

  // The highlighted row resets to the current slide whenever the result set changes shape, so
  // opening the popover with no query lands on where you already are rather than on slide 1.
  useEffect(() => {
    const atActive = results.findIndex((r) => r.index === activePageIndex)
    setHighlighted(atActive === -1 ? 0 : atActive)
  }, [results, activePageIndex])

  useEffect(() => {
    if (!open) return
    setQuery('')
    inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    function handleOutside(e: MouseEvent): void {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) onOpenChange(false)
    }
    window.addEventListener('mousedown', handleOutside)
    return () => window.removeEventListener('mousedown', handleOutside)
  }, [open, onOpenChange])

  // Keeps the keyboard-highlighted row in view without scrolling the page behind the popover.
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector('[data-highlighted="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, highlighted])

  function go(index: number): void {
    if (index < 0 || index >= pages.length) return
    onGoTo(index)
    onOpenChange(false)
  }

  function handleInputKeyDown(e: ReactKeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      // Arrows steer the result list here; DocumentViewer's own arrow-key slide stepping is
      // suppressed while this popover is open, so the two never both fire.
      e.preventDefault()
      if (results.length === 0) return
      setHighlighted((h) => (e.key === 'ArrowDown' ? Math.min(results.length - 1, h + 1) : Math.max(0, h - 1)))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (typedSlideNumber !== null) go(typedSlideNumber - 1)
      else if (results[highlighted]) go(results[highlighted].index)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      onOpenChange(false)
    }
  }

  const numberOutOfRange = typedSlideNumber !== null && (typedSlideNumber < 1 || typedSlideNumber > pages.length)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, position: 'relative' }} ref={popoverRef}>
      <button
        disabled={activePageIndex === 0}
        onClick={() => go(activePageIndex - 1)}
        style={segmentButtonStyle}
        title="Previous slide (←)"
      >
        <Icon name="arrow-left" bare />
      </button>

      <button
        onClick={() => onOpenChange(!open)}
        style={{
          ...counterButtonStyle,
          border: open ? '1px solid var(--accent)' : '1px solid transparent',
          background: open ? 'var(--accent-soft)' : 'transparent',
          color: open ? 'var(--accent)' : 'var(--fg-muted)'
        }}
        title="Find a slide — search its text, or jump to a number (⌘F)"
      >
        {activePageIndex + 1} / {pages.length}
      </button>

      <button
        disabled={activePageIndex === pages.length - 1}
        onClick={() => go(activePageIndex + 1)}
        style={segmentButtonStyle}
        title="Next slide (→)"
      >
        <Icon name="arrow-right" bare />
      </button>

      {open && (
        <div style={popoverStyle}>
          <div style={inputRowStyle}>
            <Icon name="search" bare style={{ color: 'var(--fg-faint)' }} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="Find on slides, or type a number…"
              style={inputStyle}
            />
          </div>

          <div style={controlRowStyle}>
            <button onClick={() => go(0)} disabled={activePageIndex === 0} style={miniButtonStyle} title="First slide (Home)">
              <Icon name="chevrons-left" bare />First
            </button>
            <button
              onClick={() => go(pages.length - 1)}
              disabled={activePageIndex === pages.length - 1}
              style={miniButtonStyle}
              title="Last slide (End)"
            >
              Last<Icon name="chevrons-right" bare />
            </button>
            <span style={{ flex: 1 }} />
            <button
              onClick={() => setWithCardsOnly((v) => !v)}
              style={{
                ...miniButtonStyle,
                border: withCardsOnly ? '1px solid var(--accent)' : '1px solid var(--border)',
                background: withCardsOnly ? 'var(--accent-soft)' : 'transparent',
                color: withCardsOnly ? 'var(--accent)' : 'var(--fg-muted)'
              }}
              title="Only list slides you've already made flashcards from"
            >
              <Icon name="bookmark" bare />With cards
            </button>
          </div>

          <div style={listStyle} ref={listRef}>
            {numberOutOfRange && <p style={hintStyle}>This document only goes up to slide {pages.length}.</p>}
            {!numberOutOfRange && results.length === 0 && (
              <p style={hintStyle}>{q ? `No slide text matches "${query}".` : 'No slides have flashcards yet.'}</p>
            )}
            {results.map((result, i) => {
              const page = pages[result.index]
              const cardCount = cardCountByPageId[page.id] ?? 0
              const isActive = result.index === activePageIndex
              const isHighlighted = i === highlighted
              return (
                <button
                  key={page.id}
                  data-highlighted={isHighlighted}
                  onMouseEnter={() => setHighlighted(i)}
                  onClick={() => go(result.index)}
                  style={{
                    ...rowStyle,
                    background: isHighlighted ? 'var(--bg-hover)' : 'transparent',
                    color: isActive ? 'var(--accent)' : 'inherit'
                  }}
                >
                  <span style={{ ...rowNumberStyle, fontWeight: isActive ? 700 : 500 }}>{result.index + 1}</span>
                  <span style={rowTextStyle}>
                    {result.matchStart === -1 ? (
                      result.snippet || <span style={{ color: 'var(--fg-faint)' }}>No text on this slide</span>
                    ) : (
                      <>
                        {result.snippet.slice(0, result.matchStart)}
                        <mark style={markStyle}>
                          {result.snippet.slice(result.matchStart, result.matchStart + result.matchLength)}
                        </mark>
                        {result.snippet.slice(result.matchStart + result.matchLength)}
                      </>
                    )}
                  </span>
                  {cardCount > 0 && <span style={rowBadgeStyle}>{cardCount}</span>}
                </button>
              )
            })}
          </div>

          <p style={footerStyle}>↑↓ to pick · Enter to go · ← → step slides · Esc to close</p>
        </div>
      )}
    </div>
  )
}

const segmentButtonStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--fg-muted)',
  padding: '2px 8px'
}

const counterButtonStyle: CSSProperties = {
  fontSize: 'var(--font-sm)',
  padding: '2px 6px',
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums'
}

const popoverStyle: CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  marginTop: 6,
  width: 340,
  maxWidth: '80vw',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--modal-bg)',
  color: 'var(--modal-fg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  boxShadow: '0 8px 24px #00000030',
  zIndex: 20,
  overflow: 'hidden',
  animation: 'pop-in 150ms ease'
}

const inputRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  padding: '8px 10px',
  borderBottom: '1px solid var(--border)'
}

const inputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  fontSize: 'var(--font-sm)',
  outline: 'none'
}

const controlRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '6px 8px',
  borderBottom: '1px solid var(--border)'
}

const miniButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 'var(--font-xs)',
  padding: '2px 7px',
  background: 'transparent',
  color: 'var(--fg-muted)'
}

const listStyle: CSSProperties = {
  maxHeight: 260,
  overflowY: 'auto',
  padding: 4,
  display: 'flex',
  flexDirection: 'column',
  gap: 1
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 'var(--space-2)',
  width: '100%',
  textAlign: 'left',
  border: '1px solid transparent',
  padding: '5px 7px',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--font-sm)',
  cursor: 'pointer'
}

const rowNumberStyle: CSSProperties = {
  fontSize: 'var(--font-xs)',
  fontVariantNumeric: 'tabular-nums',
  minWidth: 20,
  flexShrink: 0,
  color: 'var(--fg-faint)'
}

const rowTextStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const rowBadgeStyle: CSSProperties = {
  flexShrink: 0,
  fontSize: 'var(--font-xs)',
  color: 'var(--fg-faint)',
  border: '1px solid var(--border)',
  borderRadius: 999,
  padding: '0 6px'
}

const markStyle: CSSProperties = {
  background: 'var(--accent-soft)',
  color: 'var(--accent)',
  borderRadius: 3,
  padding: '0 1px'
}

const hintStyle: CSSProperties = {
  margin: 0,
  padding: '10px 8px',
  fontSize: 'var(--font-sm)',
  color: 'var(--fg-faint)'
}

const footerStyle: CSSProperties = {
  margin: 0,
  padding: '6px 10px',
  borderTop: '1px solid var(--border)',
  fontSize: 'var(--font-xs)',
  color: 'var(--fg-faint)'
}
