import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useUiStore } from '../../state/uiStore'

/** Movement (px) before a mousedown counts as a marquee rather than a click. */
const DRAG_THRESHOLD = 4

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

interface MarqueeSelectProps {
  children: ReactNode
  style?: CSSProperties
}

/**
 * Rubber-band selection over any descendants tagged `data-card-id`. Dragging from empty space
 * selects every card the band touches; a plain click on empty space clears the selection.
 * Works for both the sidebar tree and the main card lists.
 *
 * Move/up are tracked on `window`, not on this container: a real drag gesture routinely carries
 * the cursor outside the container's own bounds (dragging past the last card toward the composer
 * below, or just overshooting past the edge), and React's synthetic mouse events only fire while
 * the cursor is directly over the element they're bound to. Scoping them locally means the drag
 * dies the instant the pointer leaves — which, with how tightly the lists are packed, is almost
 * immediately. `bandRef` (not the `band` state) gates the movement math so the listener closures
 * captured at drag-start never need updating — they read refs and call stable setters only.
 *
 * Dragging near the top/bottom edge of the nearest scrollable ancestor auto-scrolls it (see
 * autoScrollTick), and the band is anchored in container coordinates so it keeps growing over the
 * content as it scrolls past.
 */
export function MarqueeSelect({ children, style }: MarqueeSelectProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  // The drag's anchor lives in *container* coordinates (offset from the container's own top-left),
  // not viewport coordinates, so it stays glued to the content it started on while an auto-scroll
  // moves that content under a stationary cursor. `startViewportRef` is only for the click-vs-drag
  // threshold, which is about how far the mouse physically moved.
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const startViewportRef = useRef<{ x: number; y: number } | null>(null)
  const lastMouseRef = useRef<{ x: number; y: number } | null>(null)
  const scrollerRef = useRef<HTMLElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const additiveRef = useRef(false)
  const baseSelectionRef = useRef<string[]>([])
  const bandRef = useRef<Rect | null>(null)
  // Band in container coordinates (what's actually drawn — the container is position:relative and
  // scrolls with its content, so this needs no viewport conversion at render time).
  const [band, setBand] = useState<Rect | null>(null)

  const setSelectedCardIds = useUiStore((s) => s.setSelectedCardIds)
  const clearCardSelection = useUiStore((s) => s.clearCardSelection)

  function updateBand(rect: Rect | null): void {
    bandRef.current = rect
    setBand(rect)
  }

  /** Recomputes the band + selection from the anchor and the latest mouse position. Called on every
   *  mouse move and on every auto-scroll tick — scrolling moves the content under a stationary
   *  cursor, so the band has to grow even when no mousemove fires. */
  function refreshBand(): void {
    const start = startRef.current
    const startViewport = startViewportRef.current
    const mouse = lastMouseRef.current
    const container = containerRef.current
    if (!start || !startViewport || !mouse || !container) return
    if (!bandRef.current && Math.hypot(mouse.x - startViewport.x, mouse.y - startViewport.y) < DRAG_THRESHOLD) return

    const cr = container.getBoundingClientRect()
    // Clamped to the container: the band is an absolutely-positioned child, so one that follows the
    // cursor out past the container's bottom edge would itself extend the scroller's scrollable
    // area — which auto-scroll then chases, growing it again, forever. Cards only exist inside the
    // container anyway, so nothing outside it can be hit.
    const cur = {
      x: Math.max(0, Math.min(cr.width, mouse.x - cr.left)),
      y: Math.max(0, Math.min(cr.height, mouse.y - cr.top))
    }
    const rect: Rect = {
      left: Math.min(start.x, cur.x),
      top: Math.min(start.y, cur.y),
      width: Math.abs(cur.x - start.x),
      height: Math.abs(cur.y - start.y)
    }
    updateBand(rect)

    const vLeft = rect.left + cr.left
    const vTop = rect.top + cr.top
    const hits = new Set(baseSelectionRef.current)
    for (const el of container.querySelectorAll<HTMLElement>('[data-card-id]')) {
      const r = el.getBoundingClientRect()
      const intersects = r.left < vLeft + rect.width && r.right > vLeft && r.top < vTop + rect.height && r.bottom > vTop
      if (intersects) hits.add(el.dataset.cardId!)
    }
    setSelectedCardIds([...hits])
  }

  function findScroller(from: HTMLElement | null): HTMLElement | null {
    for (let el = from; el; el = el.parentElement) {
      const overflowY = getComputedStyle(el).overflowY
      if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) return el
    }
    return null
  }

  /** While a drag is live, nudges the nearest scrollable ancestor when the cursor is near (or past)
   *  its top/bottom edge — faster the closer to/further past the edge — so a marquee can reach cards
   *  that start off-screen instead of being capped to the visible window. */
  function autoScrollTick(): void {
    rafRef.current = null
    if (!startRef.current) return
    const scroller = scrollerRef.current
    const mouse = lastMouseRef.current
    if (scroller && mouse && bandRef.current) {
      const r = scroller.getBoundingClientRect()
      const ZONE = 48
      const MAX_SPEED = 22
      let dy = 0
      if (mouse.y < r.top + ZONE) dy = -Math.min(MAX_SPEED, ((r.top + ZONE - mouse.y) / ZONE) * MAX_SPEED)
      else if (mouse.y > r.bottom - ZONE) dy = Math.min(MAX_SPEED, ((mouse.y - (r.bottom - ZONE)) / ZONE) * MAX_SPEED)
      if (dy !== 0) {
        const before = scroller.scrollTop
        scroller.scrollTop += dy
        if (scroller.scrollTop !== before) refreshBand()
      }
    }
    rafRef.current = requestAnimationFrame(autoScrollTick)
  }

  function handleWindowMouseMove(e: MouseEvent): void {
    if (!startRef.current) return
    lastMouseRef.current = { x: e.clientX, y: e.clientY }
    refreshBand()
  }

  function handleWindowMouseUp(): void {
    // A press-and-release with no band is a click on empty space: drop the selection.
    if (!bandRef.current && startRef.current && !additiveRef.current) clearCardSelection()
    startRef.current = null
    startViewportRef.current = null
    lastMouseRef.current = null
    scrollerRef.current = null
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    updateBand(null)
    window.removeEventListener('mousemove', handleWindowMouseMove)
    window.removeEventListener('mouseup', handleWindowMouseUp)
  }

  function handleMouseDown(e: React.MouseEvent): void {
    if (e.button !== 0) return
    // Only bail for genuinely interactive elements — a card's own padding/background still counts
    // as empty space, otherwise the whole list surface is "occupied" and there's nowhere left to
    // start a marquee from. A plain (non-drag) click still reaches the card's own onClick normally;
    // this only stops the click from ALSO being interpreted as a selection-drag start.
    const target = e.target as HTMLElement
    if (target.closest('button, input, textarea, select, a, [draggable="true"]')) return
    // Without this, the browser starts its own native text-selection drag as soon as the mouse
    // moves over the card text — that fights our own band, and losing that race looks exactly
    // like the marquee doing nothing (blue text highlight instead of the accent selection band).
    e.preventDefault()
    const cr = containerRef.current?.getBoundingClientRect()
    if (!cr) return
    startRef.current = { x: e.clientX - cr.left, y: e.clientY - cr.top }
    startViewportRef.current = { x: e.clientX, y: e.clientY }
    lastMouseRef.current = { x: e.clientX, y: e.clientY }
    scrollerRef.current = findScroller(containerRef.current)
    additiveRef.current = e.shiftKey
    baseSelectionRef.current = e.shiftKey ? useUiStore.getState().selectedCardIds : []
    window.addEventListener('mousemove', handleWindowMouseMove)
    window.addEventListener('mouseup', handleWindowMouseUp)
    rafRef.current = requestAnimationFrame(autoScrollTick)
  }

  return (
    <div ref={containerRef} onMouseDown={handleMouseDown} style={{ position: 'relative', ...style }}>
      {children}
      {band && (
        <div
          style={{
            position: 'absolute',
            left: band.left,
            top: band.top,
            width: band.width,
            height: band.height,
            border: '1px dashed var(--accent)',
            background: 'var(--accent-soft)',
            pointerEvents: 'none',
            zIndex: 5
          }}
        />
      )}
    </div>
  )
}
