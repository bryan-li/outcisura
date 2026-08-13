import type { BBox } from '../../../shared/types'

/** The smallest box containing every given box — used when a multi-element selection becomes a
 *  single card source (one rectangle spanning everything selected, not one source per element). */
export function unionBBox(boxes: BBox[]): BBox {
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  const right = Math.max(...boxes.map((b) => b.x + b.w))
  const bottom = Math.max(...boxes.map((b) => b.y + b.h))
  return { x, y, w: right - x, h: bottom - y }
}

/** Grows a box outward by a margin proportional to its own size (so a small selection gets a
 *  small buffer and a large one gets a large one), clamped to the page's own bounds. Used before
 *  cropping a multi-select screenshot for image occlusion — a pixel-tight union box tends to
 *  clip right up against whatever was selected, so a little breathing room on every side makes
 *  the capture forgiving of an imprecise selection instead of demanding a pixel-perfect one. */
export function padBBoxForCrop(b: BBox, pageWidth: number, pageHeight: number): BBox {
  const padX = Math.max(4, b.w * 0.06)
  const padY = Math.max(4, b.h * 0.06)
  const x = Math.max(0, b.x - padX)
  const y = Math.max(0, b.y - padY)
  const right = Math.min(pageWidth, b.x + b.w + padX)
  const bottom = Math.min(pageHeight, b.y + b.h + padY)
  return { x, y, w: right - x, h: bottom - y }
}
