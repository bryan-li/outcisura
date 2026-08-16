import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { ensureSharePrepped } from '../lib/liveSession/sharePrep'

interface HostPrepCompletion {
  folderId: string
  folderName: string
  preparedCount: number
  failedCount: number
  /** Date.now() — a fresh value on every completion, so effects keyed on this object (e.g. the
   *  toast's auto-clear timer) fire again even if a folder is prepared twice in a row. */
  completedAt: number
}

interface HostPrepState {
  /** Single-flight, global — mirrors Sidebar.tsx's own importing/importProgress pair: only one prep
   *  run happens at a time, regardless of which folder started it. */
  activeFolderId: string | null
  progress: { current: number; total: number } | null
  lastCompletion: HostPrepCompletion | null
  startPrep: (folderId: string, folderName: string) => Promise<void>
  clearCompletion: () => void
}

interface UnpreppedCardRow {
  id: string
  front: string
  back: string
  share_format: string | null
  share_prep_source_front: string | null
  share_prep_source_back: string | null
}

export const useHostPrepStore = create<HostPrepState>((set, get) => ({
  activeFolderId: null,
  progress: null,
  lastCompletion: null,

  startPrep: async (folderId, folderName) => {
    if (get().activeFolderId) return // single-flight guard
    set({ activeFolderId: folderId, progress: null })

    const { data, error } = await supabase
      .from('cards')
      .select('id, front, back, share_format, share_prep_source_front, share_prep_source_back')
      .eq('folder_id', folderId)
    if (error) {
      set({ activeFolderId: null, progress: null })
      throw error
    }

    const cards = (data ?? []) as UnpreppedCardRow[]
    const unprepped = cards.filter(
      (c) => c.share_format === null || c.share_prep_source_front !== c.front || c.share_prep_source_back !== c.back
    )
    set({ progress: { current: 0, total: unprepped.length } })

    // Sequential, not Promise.all — respects the AI provider's rate limits, matching this app's
    // general one-call-at-a-time posture for user-triggered AI work elsewhere.
    let preparedCount = 0
    let failedCount = 0
    for (const card of unprepped) {
      try {
        await ensureSharePrepped(card.id, card.front, card.back)
        preparedCount++
      } catch (err) {
        // One bad AI response shouldn't strand the rest of the folder unprepped.
        console.warn('Host prep: failed to prepare card', card.id, err)
        failedCount++
      }
      set((state) => ({ progress: state.progress ? { ...state.progress, current: state.progress.current + 1 } : null }))
    }

    set({
      activeFolderId: null,
      progress: null,
      lastCompletion: { folderId, folderName, preparedCount, failedCount, completedAt: Date.now() }
    })
  },

  clearCompletion: () => set({ lastCompletion: null })
}))
