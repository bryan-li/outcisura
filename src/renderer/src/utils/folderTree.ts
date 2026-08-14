import type { FolderRecord, FolderReorderItem } from '../../../shared/types'

export type DropPosition = 'before' | 'inside' | 'after'

export function getChildren(folders: FolderRecord[], parentId: string | null): FolderRecord[] {
  return folders.filter((f) => f.parentId === parentId).sort((a, b) => a.sortOrder - b.sortOrder)
}

/** A folder's chain of ancestors, nearest first, not including the folder itself — the empty
 *  array for a root-level folder. Symmetric with getDescendantIds below. */
export function getAncestorIds(folders: FolderRecord[], folderId: string): string[] {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const result: string[] = []
  let current = byId.get(folderId)
  while (current?.parentId) {
    result.push(current.parentId)
    current = byId.get(current.parentId)
  }
  return result
}

export function getDescendantIds(folders: FolderRecord[], rootId: string): Set<string> {
  const result = new Set<string>()
  const stack = [rootId]
  while (stack.length > 0) {
    const id = stack.pop()!
    for (const child of folders.filter((f) => f.parentId === id)) {
      if (!result.has(child.id)) {
        result.add(child.id)
        stack.push(child.id)
      }
    }
  }
  return result
}

/** Pure position math for a drag-drop move — resolved into a flat batch of {id, parentId, sortOrder}. */
export function computeMove(
  folders: FolderRecord[],
  draggedId: string,
  targetId: string | null,
  position: DropPosition
): FolderReorderItem[] | null {
  const dragged = folders.find((f) => f.id === draggedId)
  if (!dragged || draggedId === targetId) return null

  const target = targetId ? folders.find((f) => f.id === targetId) : null
  if (targetId && !target) return null

  const forbidden = getDescendantIds(folders, draggedId)
  forbidden.add(draggedId)

  const newParentId = targetId === null ? null : position === 'inside' ? targetId : target!.parentId
  if (newParentId !== null && forbidden.has(newParentId)) return null // would nest a folder inside itself

  const oldParentId = dragged.parentId
  let newSiblings = getChildren(folders, newParentId).filter((f) => f.id !== draggedId)

  if (targetId === null || position === 'inside') {
    newSiblings = [...newSiblings, dragged]
  } else {
    const targetIndex = newSiblings.findIndex((f) => f.id === targetId)
    const insertAt = position === 'before' ? targetIndex : targetIndex + 1
    newSiblings = [...newSiblings.slice(0, insertAt), dragged, ...newSiblings.slice(insertAt)]
  }

  const updates: FolderReorderItem[] = newSiblings.map((f, i) => ({ id: f.id, parentId: newParentId, sortOrder: i }))

  if (oldParentId !== newParentId) {
    const oldSiblings = getChildren(folders, oldParentId).filter((f) => f.id !== draggedId)
    updates.push(...oldSiblings.map((f, i) => ({ id: f.id, parentId: oldParentId, sortOrder: i })))
  }

  return updates
}
