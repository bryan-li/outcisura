import { create } from 'zustand'
import type { NewReviewSessionInput, ReviewSessionRecord } from '../../../shared/types'

interface ReviewSessionsState {
  sessions: ReviewSessionRecord[]
  loadReviewSessions: () => Promise<void>
  /** Fire-and-forget from ReviewSession.tsx's own exit() — local-only, no sync engine involved,
   *  same "direct IPC" shape as documentFolders. */
  logReviewSession: (input: NewReviewSessionInput) => Promise<void>
}

export const useReviewSessionsStore = create<ReviewSessionsState>((set, get) => ({
  sessions: [],

  loadReviewSessions: async () => {
    set({ sessions: await window.api.reviewSessions.list() })
  },

  logReviewSession: async (input) => {
    const session = await window.api.reviewSessions.log(input)
    set({ sessions: [session, ...get().sessions] })
  }
}))
