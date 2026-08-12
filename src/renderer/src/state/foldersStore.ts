import { create } from 'zustand'
import type { FolderRecord, FolderReorderItem, FolderUpdatePatch } from '../../../shared/types'

interface FoldersState {
  folders: FolderRecord[]
  loadFolders: () => Promise<void>
  createFolder: (name: string, parentId?: string | null) => Promise<FolderRecord>
  updateFolder: (id: string, patch: FolderUpdatePatch) => Promise<void>
  reorderFolders: (items: FolderReorderItem[]) => Promise<void>
  deleteFolder: (id: string) => Promise<void>
}

export const useFoldersStore = create<FoldersState>((set, get) => ({
  folders: [],

  loadFolders: async () => {
    const folders = await window.api.folders.list()
    set({ folders })
  },

  createFolder: async (name, parentId = null) => {
    const folder = await window.api.folders.create(name, parentId)
    set({ folders: [...get().folders, folder] })
    return folder
  },

  updateFolder: async (id, patch) => {
    const updated = await window.api.folders.update(id, patch)
    set({ folders: get().folders.map((f) => (f.id === id ? updated : f)) })
  },

  reorderFolders: async (items) => {
    // Apply optimistically so the tree doesn't visually snap back while the IPC round-trips.
    const byId = new Map(items.map((i) => [i.id, i]))
    set({
      folders: get().folders.map((f) => {
        const next = byId.get(f.id)
        return next ? { ...f, parentId: next.parentId, sortOrder: next.sortOrder } : f
      })
    })
    await window.api.folders.reorder(items)
  },

  deleteFolder: async (id) => {
    await window.api.folders.delete(id)
    // Deleting a folder cascades to its whole subfolder subtree in the DB — reload rather than
    // trying to replicate that cascade client-side.
    const folders = await window.api.folders.list()
    set({ folders })
  }
}))
