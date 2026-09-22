import { create } from 'zustand'
import {
  acceptFriendRequest,
  listSharedWithMe,
  loadFriendsSnapshot,
  removeFriendship,
  sendFriendRequest,
  type Friend,
  type FriendRequest,
  type SharedDeck
} from '../lib/social'

interface SocialState {
  friends: Friend[]
  incoming: FriendRequest[]
  outgoing: FriendRequest[]
  sharedWithMe: SharedDeck[]
  /** True once a load has completed at least once — lets the sidebar badge stay silent (rather
   *  than briefly showing 0) until it actually knows. */
  loaded: boolean
  error: string | null
  load: (myUserId: string) => Promise<void>
  sendRequest: (myUserId: string, addresseeId: string) => Promise<void>
  accept: (myUserId: string, friendshipId: string) => Promise<void>
  remove: (myUserId: string, friendshipId: string) => Promise<void>
  /** Called after a share/unshare elsewhere (ShareDeckModal, "Remove from my library" etc.) so the
   *  "shared with me" list picks it up without a full reload of friends too. */
  refreshShared: () => Promise<void>
}

export const useSocialStore = create<SocialState>((set, get) => ({
  friends: [],
  incoming: [],
  outgoing: [],
  sharedWithMe: [],
  loaded: false,
  error: null,

  load: async (myUserId) => {
    try {
      const [snapshot, sharedWithMe] = await Promise.all([loadFriendsSnapshot(myUserId), listSharedWithMe()])
      set({ ...snapshot, sharedWithMe, loaded: true, error: null })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load friends', loaded: true })
    }
  },

  sendRequest: async (myUserId, addresseeId) => {
    await sendFriendRequest(addresseeId)
    await get().load(myUserId)
  },

  accept: async (myUserId, friendshipId) => {
    await acceptFriendRequest(friendshipId)
    await get().load(myUserId)
  },

  remove: async (myUserId, friendshipId) => {
    await removeFriendship(friendshipId)
    await get().load(myUserId)
  },

  refreshShared: async () => {
    set({ sharedWithMe: await listSharedWithMe() })
  }
}))
