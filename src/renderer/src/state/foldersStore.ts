import { create } from 'zustand'
import type { FolderRecord, FolderReorderItem, FolderUpdatePatch } from '../../../shared/types'
import { localFoldersApi } from '../lib/api/localFolders'
import { triggerSync } from '../lib/syncEngine'

interface FoldersState {
  folders: FolderRecord[]
  loadFolders: () => Promise<void>
  createFolder: (name: string, parentId?: string | null) => Promise<FolderRecord>
  updateFolder: (id: string, patch: FolderUpdatePatch) => Promise<void>
  reorderFolders: (items: FolderReorderItem[]) => Promise<void>
  deleteFolder: (id: string) => Promise<void>
}

export const useFoldersStore = create<FoldersState>((set, get) => {
  function persist(folders: FolderRecord[]): void {
    set({ folders })
  }

  return {
    folders: [],

    loadFolders: async () => {
      set({ folders: await localFoldersApi.list() })
    },

    createFolder: async (name, parentId = null) => {
      const folder = await localFoldersApi.create(name, parentId)
      persist([...get().folders, folder])
      triggerSync()
      return folder
    },

    updateFolder: async (id, patch) => {
      const existing = get().folders.find((f) => f.id === id)
      if (!existing) throw new Error(`Folder ${id} not found`)
      const updated = await localFoldersApi.update(id, patch, existing)
      persist(get().folders.map((f) => (f.id === id ? updated : f)))
      triggerSync()
    },

    // Not synced — see repository.ts's reorderFolders doc comment.
    reorderFolders: async (items) => {
      // Apply optimistically so the tree doesn't visually snap back while the write completes.
      const byId = new Map(items.map((i) => [i.id, i]))
      persist(
        get().folders.map((f) => {
          const next = byId.get(f.id)
          return next ? { ...f, parentId: next.parentId, sortOrder: next.sortOrder } : f
        })
      )
      await localFoldersApi.reorder(items)
    },

    deleteFolder: async (id) => {
      await localFoldersApi.delete(id)
      // Deleting a folder cascades to its whole subfolder subtree in the DB — reload rather than
      // trying to replicate that cascade client-side.
      await get().loadFolders()
      triggerSync()
    }
  }
})
