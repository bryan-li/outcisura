import { create } from 'zustand'
import type { ReviewLogEntry } from '../../../shared/types'

interface ReviewLogState {
  entries: ReviewLogEntry[]
  loadReviewLog: () => Promise<void>
}

export const useReviewLogStore = create<ReviewLogState>((set) => ({
  entries: [],

  loadReviewLog: async () => {
    const entries = await window.api.reviewLog.list()
    set({ entries })
  }
}))
