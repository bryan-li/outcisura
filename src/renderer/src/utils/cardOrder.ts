import type { CardRecord } from '../../../shared/types'

/** Stable ordering for any filtered subset of cards — sort_order only ever gets compared within
 *  one such subset (a folder's own cards, or a by-source group), never globally. */
export function bySortOrder(a: CardRecord, b: CardRecord): number {
  return a.sortOrder - b.sortOrder
}

/**
 * Full-list reindex after a drag-drop reorder within a single rendered list: cards not being
 * dragged keep their relative order, the dragged ids are spliced in at the drop position relative
 * to `targetId`, then everyone in the list gets a fresh 0..n-1 sortOrder.
 */
export function computeCardReorder(
  orderedIds: string[],
  draggedIds: string[],
  targetId: string,
  position: 'before' | 'after'
): { id: string; sortOrder: number }[] {
  if (draggedIds.includes(targetId)) return []
  const remaining = orderedIds.filter((id) => !draggedIds.includes(id))
  const targetIndex = remaining.indexOf(targetId)
  if (targetIndex === -1) return []
  const insertAt = position === 'before' ? targetIndex : targetIndex + 1
  const next = [...remaining.slice(0, insertAt), ...draggedIds, ...remaining.slice(insertAt)]
  return next.map((id, sortOrder) => ({ id, sortOrder }))
}
