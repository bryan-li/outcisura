import { create } from 'zustand'
import type { UpdateStatus } from '../../../shared/types'

interface UpdatesState {
  status: UpdateStatus | null
  /** Version the user waved away this session, so the banner doesn't nag about it again. */
  dismissedVersion: string | null
  init: () => void
  check: () => Promise<void>
  download: () => Promise<void>
  install: () => Promise<void>
  dismiss: () => void
}

let subscribed = false

export const useUpdatesStore = create<UpdatesState>((set, get) => ({
  status: null,
  dismissedVersion: null,
  init: () => {
    if (subscribed) return
    subscribed = true
    void window.api.updates.getStatus().then((status) => set({ status }))
    window.api.updates.onStatus((status) => set({ status }))
  },
  check: async () => {
    set({ status: await window.api.updates.check() })
  },
  download: async () => {
    set({ status: await window.api.updates.download() })
  },
  install: async () => {
    await window.api.updates.install()
  },
  dismiss: () => set({ dismissedVersion: get().status?.version ?? null })
}))
