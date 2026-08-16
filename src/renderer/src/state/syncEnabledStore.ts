import { create } from 'zustand'

const KEY = 'outcisura:syncEnabled'

/** Defaults to on — local SQLite is always the primary read/write path regardless of this setting
 *  (see cardsStore.ts etc.), so this purely controls whether the background engine also keeps
 *  Supabase in sync. Off behaves exactly like the old pure "local" mode: fully local, no network
 *  dependency at all. */
function loadInitial(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'false'
  } catch {
    return true
  }
}

interface SyncEnabledState {
  enabled: boolean
  setEnabled: (enabled: boolean) => void
}

export const useSyncEnabledStore = create<SyncEnabledState>((set) => ({
  enabled: loadInitial(),
  setEnabled: (enabled) => {
    try {
      localStorage.setItem(KEY, String(enabled))
    } catch {
      // best-effort persistence, same tradeoff as elsewhere in this app
    }
    set({ enabled })
  }
}))
