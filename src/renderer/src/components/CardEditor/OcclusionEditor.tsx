import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Stage, Layer, Image as KonvaImage, Rect } from 'react-konva'
import type Konva from 'konva'
import type { BBox } from '../../../../shared/types'
import { useResolvedImage } from '../../hooks/useResolvedImage'
import { useCardsStore } from '../../state/cardsStore'

const MAX_WIDTH = 700
const GROUP_COLORS = ['#ff9500', '#4c8bf5', '#34c759', '#af52de', '#ff375f', '#5ac8fa', '#ffcc00', '#8e8e93']

interface Mask {
  x: number
  y: number
  w: number
  h: number
}

interface MaskInfo {
  id: number
  rect: Mask
}

interface OcclusionEditorProps {
  documentId: string
  pageId: string
  documentLabel: string
  /** How to describe this source in generated card copy — "Slide 3" for a pdf/pptx page, "at 0:42"
   *  for a captured video frame. Fully caller-formatted so this component stays agnostic to what
   *  kind of document it came from. */
  sourceLabel: string
  /** The image to occlude — either a parsed page image element's crop, or a fresh screenshot crop. */
  sourceImagePath: string
  /** That image's own position/size on the page, for converting mask coordinates back to page space. */
  sourceBBox: BBox
  onClose: () => void
  onSaved: () => void
}

function groupColor(groupId: number): string {
  return GROUP_COLORS[groupId % GROUP_COLORS.length]
}

export function OcclusionEditor({
  documentId,
  pageId,
  documentLabel,
  sourceLabel,
  sourceImagePath,
  sourceBBox,
  onClose,
  onSaved
}: OcclusionEditorProps): JSX.Element {
  const imageSrc = useResolvedImage(sourceImagePath)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [masks, setMasks] = useState<MaskInfo[]>([])
  const [groupOf, setGroupOf] = useState<Record<number, number>>({})
  const [checkedMaskIds, setCheckedMaskIds] = useState<Set<number>>(new Set())
  /** Which mask the pointer (on canvas) or a list-panel row (via its own hover) currently targets
   *  — one shared piece of state, so hovering either surface highlights both. See maskAt below for
   *  why this needs its own hit-test instead of per-Rect Konva event handlers. */
  const [hoveredMaskId, setHoveredMaskId] = useState<number | null>(null)
  const nextMaskIdRef = useRef(0)
  const nextGroupIdRef = useRef(0)
  const drawing = useRef<Mask | null>(null)
  const [liveRect, setLiveRect] = useState<Mask | null>(null)
  const [saving, setSaving] = useState(false)
  const createCard = useCardsStore((s) => s.createCard)

  useEffect(() => {
    if (!imageSrc) return
    const el = new window.Image()
    el.onload = () => setImg(el)
    el.src = imageSrc
  }, [imageSrc])

  if (!img) return <div>Loading image…</div>

  const scale = Math.min(1, MAX_WIDTH / img.naturalWidth)
  const stageWidth = img.naturalWidth * scale
  const stageHeight = img.naturalHeight * scale

  function relativePointer(layer: Konva.Layer | null): { x: number; y: number } | null {
    if (!layer) return null
    const pos = layer.getRelativePointerPosition()
    return pos ? { x: pos.x, y: pos.y } : null
  }

  function handleMouseDown(e: Konva.KonvaEventObject<MouseEvent>): void {
    const pos = relativePointer(e.target.getLayer())
    if (!pos) return
    drawing.current = { x: pos.x, y: pos.y, w: 0, h: 0 }
    setLiveRect(drawing.current)
  }

  function handleMouseMove(e: Konva.KonvaEventObject<MouseEvent>): void {
    const pos = relativePointer(e.target.getLayer())
    if (drawing.current) {
      if (!pos) return
      const start = drawing.current
      const rect = { x: Math.min(start.x, pos.x), y: Math.min(start.y, pos.y), w: Math.abs(pos.x - start.x), h: Math.abs(pos.y - start.y) }
      setLiveRect(rect)
      return
    }
    setHoveredMaskId(pos ? (maskAt(pos)?.id ?? null) : null)
  }

  /** Smallest-area mask whose rect contains the point, not "whichever Konva Rect happens to be
   *  topmost" — when a larger mask fully wraps a smaller one, raw paint/hit order would always
   *  favor whichever was drawn later (Konva hit-tests in the same order it paints), leaving the
   *  other permanently unreachable depending on draw order. Checking every mask and picking the
   *  smallest match makes the more specific (nested) box reachable regardless of draw order. */
  function maskAt(pos: { x: number; y: number }): MaskInfo | null {
    let best: MaskInfo | null = null
    let bestArea = Infinity
    for (const m of masks) {
      const { x, y, w, h } = m.rect
      if (pos.x < x || pos.x > x + w || pos.y < y || pos.y > y + h) continue
      const area = w * h
      if (area < bestArea) {
        bestArea = area
        best = m
      }
    }
    return best
  }

  function handleMouseUp(): void {
    if (liveRect && liveRect.w > 5 && liveRect.h > 5) {
      const id = nextMaskIdRef.current++
      const groupId = nextGroupIdRef.current++
      setMasks((prev) => [...prev, { id, rect: liveRect }])
      setGroupOf((prev) => ({ ...prev, [id]: groupId }))
    }
    drawing.current = null
    setLiveRect(null)
  }

  function removeMask(id: number): void {
    setMasks((prev) => prev.filter((m) => m.id !== id))
    setGroupOf((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setCheckedMaskIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    setHoveredMaskId((prev) => (prev === id ? null : prev))
  }

  function toggleChecked(id: number): void {
    setCheckedMaskIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function groupSelected(): void {
    if (checkedMaskIds.size < 2) return
    const newGroupId = nextGroupIdRef.current++
    setGroupOf((prev) => {
      const next = { ...prev }
      for (const id of checkedMaskIds) next[id] = newGroupId
      return next
    })
    setCheckedMaskIds(new Set())
  }

  function ungroupSelected(): void {
    if (checkedMaskIds.size === 0) return
    setGroupOf((prev) => {
      const next = { ...prev }
      for (const id of checkedMaskIds) next[id] = nextGroupIdRef.current++
      return next
    })
    setCheckedMaskIds(new Set())
  }

  function maskToPageBBox(mask: Mask): BBox {
    return {
      x: sourceBBox.x + (mask.x / img!.naturalWidth) * sourceBBox.w,
      y: sourceBBox.y + (mask.y / img!.naturalHeight) * sourceBBox.h,
      w: (mask.w / img!.naturalWidth) * sourceBBox.w,
      h: (mask.h / img!.naturalHeight) * sourceBBox.h
    }
  }

  /** The mask's position as a fraction of the image itself, for rendering a masked preview later
   *  without needing to know pixel dimensions at that point — see card_sources.mask_* migration. */
  function maskToFraction(mask: Mask): BBox {
    return {
      x: mask.x / img!.naturalWidth,
      y: mask.y / img!.naturalHeight,
      w: mask.w / img!.naturalWidth,
      h: mask.h / img!.naturalHeight
    }
  }

  // Largest-first paint order, so a smaller nested mask's highlighted stroke renders on top of
  // its enclosing one instead of underneath it — matches maskAt's own smallest-area-wins priority,
  // just for visual stacking instead of hit-testing.
  const masksByPaintOrder = [...masks].sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h)

  // Masks sharing a group id become one card with multiple sources, all hidden together.
  const groups = new Map<number, MaskInfo[]>()
  for (const mask of masks) {
    const groupId = groupOf[mask.id]
    const list = groups.get(groupId) ?? []
    list.push(mask)
    groups.set(groupId, list)
  }
  const groupEntries = [...groups.entries()].sort((a, b) => a[1][0].id - b[1][0].id)

  async function handleCreateCards(): Promise<void> {
    setSaving(true)
    try {
      for (const [, groupMasks] of groupEntries) {
        // Give occlusion cards real text so they read sensibly in the card list / sidebar instead
        // of showing as "Untitled" — the user can rewrite either line like any other card.
        const regionLabel = groupMasks.length > 1 ? `${groupMasks.length} hidden regions` : '1 hidden region'
        await createCard({
          front: `🖼 What is hidden here? — ${sourceLabel}`,
          back: `• ${regionLabel} on ${documentLabel} · ${sourceLabel}`,
          cardType: 'image_occlusion',
          sources: groupMasks.map((mask, i) => ({
            documentId,
            pageId,
            elementId: null,
            bbox: maskToPageBBox(mask.rect),
            label:
              groupMasks.length > 1
                ? `${documentLabel} · ${sourceLabel} (mask ${i + 1} of ${groupMasks.length})`
                : `${documentLabel} · ${sourceLabel} (mask)`,
            imagePath: sourceImagePath,
            maskBBox: maskToFraction(mask.rect)
          }))
        })
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Image Occlusion</h2>
        <p style={{ fontSize: 13, opacity: 0.7 }}>
          Drag rectangles over the parts to hide. Each mask is its own card by default — check two or more and
          hit "Group" to hide them together on one card instead.
        </p>

        <Stage
          width={stageWidth}
          height={stageHeight}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => setHoveredMaskId(null)}
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            cursor: drawing.current ? 'crosshair' : hoveredMaskId !== null ? 'pointer' : 'crosshair'
          }}
        >
          <Layer scaleX={scale} scaleY={scale}>
            <KonvaImage image={img} width={img.naturalWidth} height={img.naturalHeight} />
            {masksByPaintOrder.map((m) => {
              const isHovered = hoveredMaskId === m.id
              return (
                <Rect
                  key={m.id}
                  x={m.rect.x}
                  y={m.rect.y}
                  width={m.rect.w}
                  height={m.rect.h}
                  fill={`${groupColor(groupOf[m.id])}${isHovered ? 'cc' : '99'}`}
                  stroke={groupColor(groupOf[m.id])}
                  strokeWidth={isHovered ? 4 : 2}
                  shadowColor={isHovered ? groupColor(groupOf[m.id]) : undefined}
                  shadowBlur={isHovered ? 12 : 0}
                  shadowOpacity={isHovered ? 0.9 : 0}
                />
              )
            })}
            {liveRect && <Rect x={liveRect.x} y={liveRect.y} width={liveRect.w} height={liveRect.h} fill="#e86b0f55" stroke="#e86b0f" />}
          </Layer>
        </Stage>

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button disabled={checkedMaskIds.size < 2} onClick={groupSelected}>
            Group selected
          </button>
          <button disabled={checkedMaskIds.size === 0} onClick={ungroupSelected}>
            Ungroup selected
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
          {groupEntries.map(([groupId, groupMasks]) => (
            <div
              key={groupId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                flexWrap: 'wrap',
                border: `1px solid ${groupColor(groupId)}`,
                borderRadius: 6,
                padding: '4px 8px'
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: groupColor(groupId), flexShrink: 0 }} />
              {groupMasks.length > 1 && <span style={{ fontSize: 12, opacity: 0.7 }}>Group ({groupMasks.length}):</span>}
              {groupMasks.map((m, i) => (
                <label
                  key={m.id}
                  onMouseEnter={() => setHoveredMaskId(m.id)}
                  onMouseLeave={() => setHoveredMaskId((prev) => (prev === m.id ? null : prev))}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 13,
                    padding: '2px 4px',
                    borderRadius: 4,
                    background: hoveredMaskId === m.id ? `${groupColor(groupId)}33` : 'transparent'
                  }}
                >
                  <input type="checkbox" checked={checkedMaskIds.has(m.id)} onChange={() => toggleChecked(m.id)} />
                  Mask {i + 1}
                  <button onClick={() => removeMask(m.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit' }}>
                    ✕
                  </button>
                </label>
              ))}
            </div>
          ))}
          {masks.length === 0 && <p style={{ fontSize: 12, opacity: 0.6 }}>No masks yet — drag on the image above.</p>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button onClick={handleCreateCards} disabled={saving || groupEntries.length === 0}>
            {saving
              ? 'Creating…'
              : `Create ${groupEntries.length || ''} flashcard${groupEntries.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: '#00000066',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 50,
  animation: 'fade-in 150ms ease'
}

const modalStyle: CSSProperties = {
  background: 'var(--modal-bg)',
  color: 'var(--modal-fg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  padding: 'var(--space-5)',
  maxWidth: '90vw',
  maxHeight: '90vh',
  overflow: 'auto',
  boxShadow: '0 10px 40px #00000040',
  animation: 'scale-in 180ms ease'
}
