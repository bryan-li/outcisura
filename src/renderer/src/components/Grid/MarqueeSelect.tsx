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
 */
export function MarqueeSelect({ children, style }: MarqueeSelectProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const additiveRef = useRef(false)
  const baseSelectionRef = useRef<string[]>([])
  const bandRef = useRef<Rect | null>(null)
  const [band, setBand] = useState<Rect | null>(null)

  const setSelectedCardIds = useUiStore((s) => s.setSelectedCardIds)
  const clearCardSelection = useUiStore((s) => s.clearCardSelection)

  function updateBand(rect: Rect | null): void {
    bandRef.current = rect
    setBand(rect)
  }

  function handleWindowMouseMove(e: MouseEvent): void {
    const start = startRef.current
    if (!start) return
    if (!bandRef.current && Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_THRESHOLD) return

    const rect: Rect = {
      left: Math.min(start.x, e.clientX),
      top: Math.min(start.y, e.clientY),
      width: Math.abs(e.clientX - start.x),
      height: Math.abs(e.clientY - start.y)
    }
    updateBand(rect)

    const hits = new Set(baseSelectionRef.current)
    for (const el of containerRef.current?.querySelectorAll<HTMLElement>('[data-card-id]') ?? []) {
      const r = el.getBoundingClientRect()
      const intersects =
        r.left < rect.left + rect.width && r.right > rect.left && r.top < rect.top + rect.height && r.bottom > rect.top
      if (intersects) hits.add(el.dataset.cardId!)
    }
    setSelectedCardIds([...hits])
  }

  function handleWindowMouseUp(): void {
    // A press-and-release with no band is a click on empty space: drop the selection.
    if (!bandRef.current && startRef.current && !additiveRef.current) clearCardSelection()
    startRef.current = null
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
    startRef.current = { x: e.clientX, y: e.clientY }
    additiveRef.current = e.shiftKey
    baseSelectionRef.current = e.shiftKey ? useUiStore.getState().selectedCardIds : []
    window.addEventListener('mousemove', handleWindowMouseMove)
    window.addEventListener('mouseup', handleWindowMouseUp)
  }

  const containerRect = containerRef.current?.getBoundingClientRect()

  return (
    <div ref={containerRef} onMouseDown={handleMouseDown} style={{ position: 'relative', ...style }}>
      {children}
      {band && containerRect && (
        <div
          style={{
            position: 'absolute',
            left: band.left - containerRect.left,
            top: band.top - containerRect.top,
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
