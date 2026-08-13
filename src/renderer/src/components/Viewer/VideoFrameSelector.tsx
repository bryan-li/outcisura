import { useRef, useState, type CSSProperties } from 'react'
import type { BBox } from '../../../../shared/types'

/** Screen-space pixels of mouse movement before a mousedown counts as a drag — mirrors PageView's
 *  own DRAG_THRESHOLD, same rationale (a plain click shouldn't register as a zero-size selection). */
const DRAG_THRESHOLD = 4

interface VideoFrameSelectorProps {
  /** The video's true pixel dimensions (videoWidth/videoHeight) — the overlay itself is sized to
   *  match the video's rendered (possibly scaled-down) on-screen box via CSS `inset: 0` on its
   *  wrapper; this is only needed to convert drag coordinates back to native pixel space. */
  nativeWidth: number
  nativeHeight: number
  /** A drag past the threshold finished — bbox is in the video's own native pixel space, ready to
   *  feed straight into a canvas crop at native resolution. */
  onCapture: (bbox: BBox) => void
}

/** A plain absolutely-positioned drag layer on top of a paused <video> — deliberately not reusing
 *  PageView's element-hit-test drag-select (there are no parsed `elements` on a video frame to hit)
 *  and not Konva (nothing needs compositing over an image; the <video> renders itself underneath).
 *  The drag rectangle itself becomes the bbox directly. */
export function VideoFrameSelector({ nativeWidth, nativeHeight, onCapture }: VideoFrameSelectorProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const [dragRect, setDragRect] = useState<BBox | null>(null)

  function toNativeCoords(e: React.MouseEvent): { x: number; y: number } {
    const rect = containerRef.current!.getBoundingClientRect()
    const scaleX = nativeWidth / rect.width
    const scaleY = nativeHeight / rect.height
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }
  }

  function handleMouseDown(e: React.MouseEvent): void {
    if (e.button !== 0) return
    dragStartRef.current = toNativeCoords(e)
  }

  function handleMouseMove(e: React.MouseEvent): void {
    const start = dragStartRef.current
    if (!start) return
    const current = toNativeCoords(e)
    const rect = containerRef.current!.getBoundingClientRect()
    const screenDist = Math.hypot(
      (current.x - start.x) * (rect.width / nativeWidth),
      (current.y - start.y) * (rect.height / nativeHeight)
    )
    if (!dragRect && screenDist < DRAG_THRESHOLD) return
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

  // dragRect is in native pixel space; the visible box needs to be drawn back in the overlay's own
  // rendered space, so it's scaled by the container's own rect on each render rather than stored
  // pre-converted (simpler than threading the inverse scale through state).
  const rect = containerRef.current?.getBoundingClientRect()
  const displayRect =
    dragRect && rect
      ? {
          x: dragRect.x * (rect.width / nativeWidth),
          y: dragRect.y * (rect.height / nativeHeight),
          w: dragRect.w * (rect.width / nativeWidth),
          h: dragRect.h * (rect.height / nativeHeight)
        }
      : null

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      style={overlayStyle}
    >
      {displayRect && (
        <div
          style={{
            position: 'absolute',
            left: displayRect.x,
            top: displayRect.y,
            width: displayRect.w,
            height: displayRect.h,
            border: '1px dashed #e86b0f',
            background: '#e86b0f1a',
            pointerEvents: 'none'
          }}
        />
      )}
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  cursor: 'crosshair'
}
