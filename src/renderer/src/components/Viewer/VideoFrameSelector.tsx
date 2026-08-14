import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { BBox } from '../../../../shared/types'

/** Screen-space pixels of mouse movement before a mousedown counts as a drag — mirrors PageView's
 *  own DRAG_THRESHOLD, same rationale (a plain click shouldn't register as a zero-size selection). */
const DRAG_THRESHOLD = 4

interface VideoFrameSelectorProps {
  /** The video's true pixel dimensions (videoWidth/videoHeight) — or, when reused over a PDF/PPTX
   *  page (see PageView), that page's own width/height. Used both to derive the live on-screen
   *  scale from this overlay's own rendered rect, and as the coordinate space the returned bbox is
   *  expressed in. */
  nativeWidth: number
  nativeHeight: number
  /** A drag past the threshold finished — bbox is in the native/page coordinate space passed in,
   *  ready to feed straight into a canvas crop at native resolution. */
  onCapture: (bbox: BBox) => void
}

/** A plain absolutely-positioned drag layer over whatever's rendering underneath (a paused <video>,
 *  or a PDF/PPTX page image in PageView) — deliberately not reusing PageView's element-hit-test
 *  drag-select (nothing here depends on parsed `elements`) and not Konva (nothing needs compositing;
 *  the content renders itself underneath). The drag rectangle itself becomes the returned bbox.
 *
 *  Uses the same dual-scale split as SelectableElementsOverlay, for the same reason (see that
 *  component's own comments for the full rationale): `renderScale` — transform-UNAWARE, read via
 *  ResizeObserver's contentRect — is what actually shrinks the rendered drag box, and comes out to 1
 *  when an ancestor CSS transform already does the one shrink needed (PageView) or the real ratio
 *  when nothing upstream transforms (VideoPlayer, sized directly). `screenScale` — transform-AWARE,
 *  via getBoundingClientRect, computed fresh per event — is used only to convert a real mouse
 *  position back into this component's own local coordinate space. Conflating the two (this
 *  component's original implementation, before it had a second consumer) is exactly what made the
 *  drag box render shrunk-and-offset toward the top-left once reused inside PageView's ancestor-
 *  transform layout — VideoPlayer's own layout has no such ancestor transform, so the two factors
 *  happened to coincide there and the bug never showed up in that context. */
export function VideoFrameSelector({ nativeWidth, nativeHeight, onCapture }: VideoFrameSelectorProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const [dragRect, setDragRect] = useState<BBox | null>(null)
  const [renderScale, setRenderScale] = useState(1)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const renderedWidth = entries[0]?.contentRect.width
      if (renderedWidth) setRenderScale(renderedWidth / nativeWidth || 1)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [nativeWidth])

  function toNativeCoords(e: React.MouseEvent): { x: number; y: number } {
    const rect = containerRef.current!.getBoundingClientRect()
    const screenScale = rect.width / nativeWidth || 1
    return { x: (e.clientX - rect.left) / screenScale, y: (e.clientY - rect.top) / screenScale }
  }

  function handleMouseDown(e: React.MouseEvent): void {
    if (e.button !== 0) return
    dragStartRef.current = toNativeCoords(e)
  }

  function handleMouseMove(e: React.MouseEvent): void {
    const start = dragStartRef.current
    if (!start) return
    const current = toNativeCoords(e)
    // Back to real screen pixels for the threshold check — current/start are native-space
    // coordinates, so this must multiply by the same screenScale toNativeCoords divided by, not
    // renderScale (a different factor whenever an ancestor transform is involved).
    const screenScale = containerRef.current!.getBoundingClientRect().width / nativeWidth || 1
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

  function handleMouseUp(): void {
    if (dragRect && dragRect.w > 5 && dragRect.h > 5) onCapture(dragRect)
    dragStartRef.current = null
    setDragRect(null)
  }

  function handleMouseLeave(): void {
    dragStartRef.current = null
    setDragRect(null)
  }

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      style={overlayStyle}
    >
      {/* Raw native-space coordinates below are only correct once shrunk by this transform — see the
          `renderScale` comment above. transform-origin: top left matches how PageView's own ancestor
          transform already anchors, so both contexts agree on which corner is fixed. */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: nativeWidth, height: nativeHeight, transform: `scale(${renderScale})`, transformOrigin: 'top left' }}>
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

const overlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  cursor: 'crosshair'
}
