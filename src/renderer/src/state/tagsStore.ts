import { create } from 'zustand'
import type { TagRecord } from '../../../shared/types'

interface TagsState {
  tags: TagRecord[]
  loadTags: () => Promise<void>
  /** Case-insensitive find-or-create — reuses an existing tag if the name matches. */
  createTag: (name: string) => Promise<TagRecord>
  deleteTag: (id: string) => Promise<void>
}

export const useTagsStore = create<TagsState>((set, get) => ({
  tags: [],

  loadTags: async () => {
    set({ tags: await window.api.tags.list() })
  },

  createTag: async (name) => {
    const tag = await window.api.tags.create(name)
    if (!get().tags.some((t) => t.id === tag.id)) {
      set({ tags: [...get().tags, tag].sort((a, b) => a.name.localeCompare(b.name)) })
    }
    return tag
  },

  deleteTag: async (id) => {
    await window.api.tags.delete(id)
    set({ tags: get().tags.filter((t) => t.id !== id) })
  }
}))
