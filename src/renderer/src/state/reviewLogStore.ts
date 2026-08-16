import { create } from 'zustand'
import type { ReviewLogEntry } from '../../../shared/types'
import { localReviewLogApi } from '../lib/api/localReviewLog'

interface ReviewLogState {
  entries: ReviewLogEntry[]
  loadReviewLog: () => Promise<void>
}

export const useReviewLogStore = create<ReviewLogState>((set) => ({
  entries: [],

  loadReviewLog: async () => {
    set({ entries: await localReviewLogApi.list() })
  }
}))
