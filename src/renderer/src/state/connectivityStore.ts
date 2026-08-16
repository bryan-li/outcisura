import { create } from 'zustand'

export type SyncStatus = 'idle' | 'syncing' | 'error'

interface ConnectivityState {
  /** Whether the sync engine is mid-cycle right now, and what happened the last time it wasn't —
   *  'error' means the last cycle threw (most likely a real network outage; see syncEngine.ts's
   *  own error handling), not that any local data was lost — reads/writes always succeed locally
   *  regardless of sync status. */
  status: SyncStatus
  lastSyncedAt: string | null
  lastError: string | null
  /** How many local operations are waiting to push — refreshed by syncEngine.ts at the start and
   *  end of each cycle (there's no live-updating IPC subscription, just an explicit poke). */
  pendingCount: number
  setSyncing: () => void
  setSynced: () => void
  setSyncError: (message: string) => void
  setPendingCount: (count: number) => void
}

export const useConnectivityStore = create<ConnectivityState>((set) => ({
  status: 'idle',
  lastSyncedAt: null,
  lastError: null,
  pendingCount: 0,
  setSyncing: () => set({ status: 'syncing' }),
  setSynced: () => set({ status: 'idle', lastSyncedAt: new Date().toISOString(), lastError: null }),
  setSyncError: (message) => set({ status: 'error', lastError: message }),
  setPendingCount: (count) => set({ pendingCount: count })
}))
