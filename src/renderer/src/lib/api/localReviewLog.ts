import type { ReviewLogBackend } from './backendTypes'

/** Thin wrapper around the local IPC bridge — the only implementation left now that cloud sync
 *  goes through syncEngine.ts's own applyReviewLogInsert path instead of this interface. */
export const localReviewLogApi: ReviewLogBackend = {
  list: () => window.api.reviewLog.list()
}
