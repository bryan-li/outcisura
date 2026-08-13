import { useEffect, useRef, useState } from 'react'
import type { BBox, ElementRecord } from '../../../../shared/types'

/** Screen-space pixels of mouse movement before a mousedown counts as a drag rather than a click. */
const DRAG_THRESHOLD = 4

interface SelectableElementsOverlayProps {
  /** The logical (native, pre-scale) pixel dimensions of the space elements are positioned in —
   *  used only to derive the live on-screen scale from this overlay's own rendered rect, the same
   *  way PageView's own coordinate math always has. Works whether the ambient shrink comes from an
   *  ancestor's CSS transform (PageView) or direct sizing (VideoPlayer) — this component only ever
   *  measures its own actual rendered box, never assumes how it got that size. */
  width: number
  height: number
  elements: ElementRecord[]
  selectedIds: Set<string>
  onToggleSelect: (element: ElementRecord) => void
  /** A marquee drag finished over these elements. `additive` is true when the drag was shift-held. */
  onDragSelect: (elements: ElementRecord[], additive: boolean) => void
  /** A plain click landed on empty space (not an element, and not the tail end of a drag). */
  onClearSelection: () => void
}

/** Extracted from PageView.tsx once a second real consumer appeared (VideoPlayer, for post-OCR
 *  video-frame elements) — the marquee-drag math and per-element hit boxes never depended on
 *  anything PDF/PPTX-specific, just a width/height (for scale) and an ElementRecord[]. Shaped like
 *  VideoFrameSelector (owns its own inset:0 container + handlers) rather than PageView's old shape
 *  (handlers on the same div as the background image), since VideoPlayer needs to layer this over a
 *  <video>, not an <img>. */
export function SelectableElementsOverlay({
  width,
  height,
  elements,
  selectedIds,
  onToggleSelect,
  onDragSelect,
  onClearSelection
}: SelectableElementsOverlayProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  // Set right before a real drag ends, so the click event that follows the mouseup on whatever
  // element is under the cursor doesn't also toggle that element on top of the marquee result.
  const suppressClickRef = useRef(false)
  const [dragRect, setDragRect] = useState<BBox | null>(null)

  // Drives the CSS transform below — children render at raw width/height-space coordinates
  // unconditionally, and this is what makes that correct regardless of how the ambient container
  // achieved its own size. Deliberately read via ResizeObserver's contentRect (transform-UNAWARE —
  // reports the pre-transform local layout box), not getBoundingClientRect() (transform-AWARE):
  // PageView shrinks via an ancestor's own CSS `transform: scale()`, so this container's *local*
  // layout box is already the raw, unshrunk `width` — contentRect correctly gives 1 here, a no-op,
  // since the ancestor transform alone already does the (single) shrink these children need.
  // VideoPlayer instead sizes its wrapper directly to width*outerScale with no ancestor transform,
  // so contentRect picks up that real ratio instead — also correct, since nothing else is shrinking
  // these children. Using getBoundingClientRect() here instead would double-apply PageView's
  // ancestor shrink (once via that ancestor's real transform, once more via this one) — exactly the
  // bug that made a 200px mouse-drag render as a ~40px box under PageView.
  const [renderScale, setRenderScale] = useState(1)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const renderedWidth = entries[0]?.contentRect.width
      if (renderedWidth) setRenderScale(renderedWidth / width || 1)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [width])

  // Separate from renderScale above, and deliberately NOT state — this needs the container's real,
  // transform-AWARE on-screen size (getBoundingClientRect, computed fresh per event, not cached),
  // since it's converting a real mouse position (also always in on-screen/viewport space) back into
  // local width/height-space coordinates. Under PageView this is the ancestor's own transform ratio
  // (≠ renderScale, which is 1 there); under VideoPlayer the two happen to coincide (no ancestor
  // transform to diverge from). Conflating this with renderScale is what made marquee drags start
  // away from the cursor under PageView — the two only agree when nothing upstream is transforming.
  function toLocalCoords(e: React.MouseEvent): { x: number; y: number } {
    const rect = containerRef.current!.getBoundingClientRect()
    const screenScale = rect.width / width || 1
    return { x: (e.clientX - rect.left) / screenScale, y: (e.clientY - rect.top) / screenScale }
  }

  function handleMouseDown(e: React.MouseEvent): void {
    if (e.button !== 0) return
    dragStartRef.current = toLocalCoords(e)
  }

  function handleMouseMove(e: React.MouseEvent): void {
    const start = dragStartRef.current
    if (!start) return
    const current = toLocalCoords(e)
    // Back to real screen pixels for the threshold check — current/start are local (width/height-
    // space) coordinates, so this must multiply by the same screenScale toLocalCoords divided by,
    // not renderScale (which is a different factor whenever an ancestor transform is involved).
    const screenScale = containerRef.current!.getBoundingClientRect().width / width || 1
    if (!dragRect && Math.hypot((current.x - start.x) * screenScale, (current.y - start.y) * screenScale) < DRAG_THRESHOLD) {
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
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onClick={handleContainerClick}
      style={{ position: 'absolute', inset: 0, cursor: 'crosshair' }}
    >
      {/* Raw width/height-space coordinates below are only correct once shrunk by this transform —
          see the `renderScale` comment above. transform-origin: top left matches how PageView's own
          ancestor transform already anchors, so both contexts agree on which corner is fixed. */}
      <div style={{ position: 'absolute', top: 0, left: 0, width, height, transform: `scale(${renderScale})`, transformOrigin: 'top left' }}>
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

        {dragRect && (
          <div
            style={{
              position: 'absolute',
              left: dragRect.x,
              top: dragRect.y,
              width: dragRect.w,
              height: dragRect.h,
              border: '1px dashed #e86b0f',
              background: '#e86b0f1a',
              pointerEvents: 'none'
            }}
          />
        )}
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
        border: selected ? '2px solid #e86b0f' : hovered ? '2px solid #e86b0f80' : 'none',
        background: selected ? '#e86b0f26' : hovered ? '#e86b0f12' : 'transparent',
        cursor: 'pointer'
      }}
      title={element.text ?? undefined}
    />
  )
}
