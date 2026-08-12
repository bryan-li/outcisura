import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { BBox, CardRecord, CardSourceRecord, ElementRecord, PageRecord } from '../../../../shared/types'
import { useResolvedImage } from '../../hooks/useResolvedImage'

/** Screen-space pixels of mouse movement before a mousedown counts as a drag rather than a click. */
const DRAG_THRESHOLD = 4

interface PageViewProps {
  page: PageRecord
  elements: ElementRecord[]
  selectedIds: Set<string>
  onToggleSelect: (element: ElementRecord) => void
  /** A marquee drag finished over these elements. `additive` is true when the drag was shift-held. */
  onDragSelect: (elements: ElementRecord[], additive: boolean) => void
  /** A plain click landed on empty space (not an element, and not the tail end of a drag). */
  onClearSelection: () => void
  flashBBox?: BBox | null
  /** Existing flashcards already sourced from this page — shown as boundary boxes when the
   *  "show flashcards" toggle is on, empty otherwise (see DocumentViewer). */
  cardSources?: { card: CardRecord; source: CardSourceRecord }[]
  onNavigateToCard?: (card: CardRecord) => void
}

export function PageView({
  page,
  elements,
  selectedIds,
  onToggleSelect,
  onDragSelect,
  onClearSelection,
  flashBBox,
  cardSources = [],
  onNavigateToCard
}: PageViewProps): JSX.Element {
  const backgroundSrc = useResolvedImage(page.backgroundImagePath)

  const wrapperRef = useRef<HTMLDivElement>(null)
  // Tracks the actual available width so the slide scales with the window/pane instead of sitting
  // at a fixed pixel size — capped at 900 as a sane upper bound so a huge monitor doesn't blow the
  // slide up past a comfortable reading size, and at 1 so it never upscales past its native pixels.
  const [availableWidth, setAvailableWidth] = useState(900)

  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width) setAvailableWidth(width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const scale = Math.min(1, Math.min(900, availableWidth) / page.width)

  const containerRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  // Set right before a real drag ends, so the click event that follows the mouseup on whatever
  // element is under the cursor doesn't also toggle that element on top of the marquee result.
  const suppressClickRef = useRef(false)
  const [dragRect, setDragRect] = useState<BBox | null>(null)

  function toPageCoords(e: React.MouseEvent): { x: number; y: number } {
    const rect = containerRef.current!.getBoundingClientRect()
    // Derive the on-screen scale from the rendered rect rather than the `scale` constant, so this
    // stays correct under any additional scaling applied above us.
    const renderedScale = rect.width / page.width || scale
    return { x: (e.clientX - rect.left) / renderedScale, y: (e.clientY - rect.top) / renderedScale }
  }

  function handleMouseDown(e: React.MouseEvent): void {
    if (e.button !== 0) return
    dragStartRef.current = toPageCoords(e)
  }

  function handleMouseMove(e: React.MouseEvent): void {
    const start = dragStartRef.current
    if (!start) return
    const current = toPageCoords(e)
    if (!dragRect && Math.hypot((current.x - start.x) * scale, (current.y - start.y) * scale) < DRAG_THRESHOLD) {
      return
    }
    setDragRect({
      x: Math.min(start.x, current.x),
      y: Math.min(start.y, current.y),
      w: Math.abs(current.x - start.x),
      h: Math.abs(current.y - start.y)
    })
  }

  function handleMouseUp(e: React.MouseEvent): void {
    if (dragRect) {
      const hits = elements.filter((el) => rectsIntersect(padBBox(el.bbox), dragRect))
      onDragSelect(hits, e.shiftKey)
      suppressClickRef.current = true
    }
    dragStartRef.current = null
    setDragRect(null)
  }

  function handleMouseLeave(): void {
    dragStartRef.current = null
    setDragRect(null)
  }

  function handleContainerClick(e: React.MouseEvent): void {
    if (suppressClickRef.current) {
      // Tail end of a real drag landing on empty space — the drag already set the selection
      // via onDragSelect; don't immediately clear it.
      suppressClickRef.current = false
      return
    }
    if ((e.target as HTMLElement).tagName === 'BUTTON') return // handled by that element's own onToggle
    onClearSelection()
  }

  return (
    <div ref={wrapperRef} style={{ width: '100%' }}>
      <div style={{ width: page.width * scale, height: page.height * scale, overflow: 'visible' }}>
        <div
          ref={containerRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onClick={handleContainerClick}
          style={{
            position: 'relative',
            width: page.width,
            height: page.height,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
            boxShadow: '0 1px 3px #0000001a, 0 8px 24px #00000014',
            background: '#fff',
            cursor: 'crosshair'
          }}
        >
          {backgroundSrc && (
            <img
              src={backgroundSrc}
              alt=""
              style={{ position: 'absolute', top: 0, left: 0, width: page.width, height: page.height }}
              draggable={false}
            />
          )}

          {elements.map((el) => (
            <ElementOverlay
              key={el.id}
              element={el}
              selected={selectedIds.has(el.id)}
              onToggle={() => {
                if (suppressClickRef.current) {
                  suppressClickRef.current = false
                  return
                }
                onToggleSelect(el)
              }}
            />
          ))}

          {cardSources.map(({ card, source }) => (
            <CardSourceOverlay
              key={source.id}
              card={card}
              bbox={source.bbox}
              pageHeight={page.height}
              scale={scale}
              onClick={() => onNavigateToCard?.(card)}
            />
          ))}

          {dragRect && (
            <div
              style={{
                position: 'absolute',
                left: dragRect.x,
                top: dragRect.y,
                width: dragRect.w,
                height: dragRect.h,
                border: '1px dashed #4c8bf5',
                background: '#4c8bf51a',
                pointerEvents: 'none'
              }}
            />
          )}

          {flashBBox && <FlashHighlight bbox={flashBBox} />}
        </div>
      </div>
    </div>
  )
}

function rectsIntersect(a: BBox, b: BBox): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

/**
 * Word-tight boxes are precise but fiddly to click and look fragmented when several are selected.
 * Pad a bit — proportional to the element's own size so a title doesn't get a speck of padding and
 * a caption doesn't get an oversized one, capped so large images don't balloon.
 */
function padBBox(b: BBox): BBox {
  const pad = Math.min(10, Math.max(2, Math.min(b.w, b.h) * 0.2))
  return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 }
}

interface ElementOverlayProps {
  element: ElementRecord
  selected: boolean
  onToggle: () => void
}

function ElementOverlay({ element, selected, onToggle }: ElementOverlayProps): JSX.Element {
  const [hovered, setHovered] = useState(false)
  const { x, y, w, h } = padBBox(element.bbox)

  return (
    <button
      type="button"
      onClick={onToggle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        margin: 0,
        padding: 0,
        borderRadius: 3,
        border: selected ? '2px solid #4c8bf5' : hovered ? '2px solid #4c8bf580' : 'none',
        background: selected ? '#4c8bf526' : hovered ? '#4c8bf512' : 'transparent',
        cursor: 'pointer'
      }}
      title={element.text ?? undefined}
    />
  )
}

interface CardSourceOverlayProps {
  card: CardRecord
  bbox: BBox
  pageHeight: number
  /** Page render scale — the thumbnail applies the inverse so its text stays a constant, readable
   *  size on screen regardless of how zoomed-out the slide itself currently is. */
  scale: number
  onClick: () => void
}

/** A boundary box for a flashcard already sourced from this slide (toggled on from the toolbar),
 *  distinct from the plain blue ElementOverlay hover boxes used for making new cards. Hovering
 *  shows a small question thumbnail; clicking jumps to that card. */
function CardSourceOverlay({ card, bbox, pageHeight, scale, onClick }: CardSourceOverlayProps): JSX.Element {
  const [hovered, setHovered] = useState(false)
  // Near the top of the slide there's no room for a thumbnail above the box without it getting
  // clipped by the container's overflow:hidden — flip it below instead.
  const flipBelow = bbox.y < pageHeight * 0.15

  return (
    <div
      style={{ position: 'absolute', left: bbox.x, top: bbox.y, width: bbox.w, height: bbox.h }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* No title attribute — the custom thumbnail below is the hover affordance; a native
          tooltip would just render on top of it at the same spot and visually fight with it. */}
      <button
        type="button"
        onClick={onClick}
        style={{
          position: 'absolute',
          inset: 0,
          margin: 0,
          padding: 0,
          borderRadius: 3,
          border: `2px dashed ${hovered ? '#af52de' : '#af52dea0'}`,
          background: hovered ? '#af52de1f' : '#af52de0d',
          cursor: 'pointer'
        }}
      />
      {hovered && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            ...(flipBelow ? { top: '100%', marginTop: 6 } : { bottom: '100%', marginBottom: 6 }),
            transform: `scale(${1 / scale})`,
            transformOrigin: flipBelow ? 'top left' : 'bottom left',
            pointerEvents: 'none',
            zIndex: 10
          }}
        >
          <div style={cardThumbnailStyle}>
            <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{card.front.trim() || 'Untitled'}</div>
          </div>
        </div>
      )}
    </div>
  )
}

const cardThumbnailStyle: CSSProperties = {
  maxWidth: 220,
  padding: '6px 8px',
  fontSize: 12,
  lineHeight: 1.3,
  background: 'var(--modal-bg)',
  color: 'var(--modal-fg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  boxShadow: '0 4px 16px #00000030'
}

function FlashHighlight({ bbox }: { bbox: BBox }): JSX.Element {
  return (
    <div
      style={{
        position: 'absolute',
        left: bbox.x,
        top: bbox.y,
        width: bbox.w,
        height: bbox.h,
        border: '3px solid #ff9500',
        boxShadow: '0 0 0 4px #ff950040',
        pointerEvents: 'none',
        animation: 'flash-pulse 1.2s ease-out 2'
      }}
    />
  )
}
