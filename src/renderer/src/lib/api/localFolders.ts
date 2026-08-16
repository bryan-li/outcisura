import type { FoldersBackend } from './backendTypes'

/** Local-mode counterpart to folders.ts — see localCards.ts's doc comment for the general
 *  pattern (thin window.api wrappers, `existing` accepted-but-unused for interface parity). */
export const localFoldersApi: FoldersBackend = {
  create: (name, parentId) => window.api.folders.create(name, parentId),
  list: () => window.api.folders.list(),
  update: (id, patch) => window.api.folders.update(id, patch),
  reorder: (items) => window.api.folders.reorder(items),
  delete: (id) => window.api.folders.delete(id)
}
