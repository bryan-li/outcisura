import { supabase } from './supabase'
export { supabaseErrorMessage as socialErrorMessage } from './supabaseError'
import { downloadDeck } from './deckImport'
import type { ImportSharedDeckResult } from '../../../shared/types'

/** Friends + deck sharing — plain Supabase queries against the friendships/deck_shares tables from
 *  the friends_and_deck_shares migration, same "bypass local-first sync, go straight to the cloud"
 *  reasoning as hostableDecks.ts's public decks (a friend's cards have no local counterpart until
 *  you actually import them — see importSharedDeck below). RLS does the real enforcement (who can
 *  request/accept/share/see what); this file just shapes the queries and joins in usernames, since
 *  friendships/deck_shares reference auth.users directly, not profiles, so PostgREST can't embed the
 *  username join automatically the way a same-table foreign key would let it. */

export interface FriendProfile {
  userId: string
  username: string
}

export interface Friend extends FriendProfile {
  /** The friendships row id — needed to remove/unfriend, since that's a delete on this specific
   *  row, not something keyed by the other person's user id alone. */
  friendshipId: string
}

export interface FriendRequest {
  id: string
  otherUser: FriendProfile
  createdAt: string
}

export interface SharedDeck {
  shareId: string
  folderId: string
  folderName: string
  owner: FriendProfile
  cardCount: number
}

interface FriendshipRow {
  id: string
  requester_id: string
  addressee_id: string
  status: 'pending' | 'accepted'
  created_at: string
}

async function profilesByIds(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map()
  const { data, error } = await supabase.from('profiles').select('user_id, username').in('user_id', [...new Set(userIds)])
  if (error) throw error
  return new Map((data ?? []).map((r) => [r.user_id as string, r.username as string]))
}

/** Username prefix search, for "Add a friend" — profiles are globally readable (see profiles_select),
 *  so this needs no RPC. Excludes the signed-in user themselves. */
export async function searchUsers(query: string, excludeUserId: string, limit = 8): Promise<FriendProfile[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, username')
    .ilike('username', `${trimmed}%`)
    .neq('user_id', excludeUserId)
    .limit(limit)
  if (error) throw error
  return (data ?? []).map((r) => ({ userId: r.user_id as string, username: r.username as string }))
}

export interface FriendsSnapshot {
  friends: Friend[]
  incoming: FriendRequest[]
  outgoing: FriendRequest[]
}

export async function loadFriendsSnapshot(myUserId: string): Promise<FriendsSnapshot> {
  const { data, error } = await supabase
    .from('friendships')
    .select('id, requester_id, addressee_id, status, created_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  const rows = (data ?? []) as FriendshipRow[]

  const otherIds = rows.map((r) => (r.requester_id === myUserId ? r.addressee_id : r.requester_id))
  const usernames = await profilesByIds(otherIds)
  const profileFor = (userId: string): FriendProfile => ({ userId, username: usernames.get(userId) ?? '(unknown)' })

  const friends: Friend[] = []
  const incoming: FriendRequest[] = []
  const outgoing: FriendRequest[] = []
  for (const row of rows) {
    const otherId = row.requester_id === myUserId ? row.addressee_id : row.requester_id
    if (row.status === 'accepted') {
      friends.push({ ...profileFor(otherId), friendshipId: row.id })
    } else if (row.addressee_id === myUserId) {
      incoming.push({ id: row.id, otherUser: profileFor(otherId), createdAt: row.created_at })
    } else {
      outgoing.push({ id: row.id, otherUser: profileFor(otherId), createdAt: row.created_at })
    }
  }
  return { friends, incoming, outgoing }
}

export async function sendFriendRequest(addresseeId: string): Promise<void> {
  const { error } = await supabase.from('friendships').insert({ addressee_id: addresseeId })
  if (error) throw error
}

export async function acceptFriendRequest(friendshipId: string): Promise<void> {
  const { error } = await supabase.from('friendships').update({ status: 'accepted', responded_at: new Date().toISOString() }).eq('id', friendshipId)
  if (error) throw error
}

/** Declines an incoming request, cancels one you sent, or unfriends an accepted one — all the same
 *  operation from the RLS's point of view (either party can delete a row they're part of). */
export async function removeFriendship(friendshipId: string): Promise<void> {
  const { error } = await supabase.from('friendships').delete().eq('id', friendshipId)
  if (error) throw error
}

export async function shareFolderWithFriend(folderId: string, folderName: string, friendUserId: string): Promise<void> {
  const { error } = await supabase.from('deck_shares').insert({
    folder_id: folderId,
    shared_with_id: friendUserId,
    folder_name_snapshot: folderName
  })
  if (error) throw error
}

export async function unshareDeck(shareId: string): Promise<void> {
  const { error } = await supabase.from('deck_shares').delete().eq('id', shareId)
  if (error) throw error
}

/** Same as unshareDeck, but for ShareDeckModal's toggle view, which only knows the folder and which
 *  friend to remove — not that share row's own id (see listMySharesFor, which only returns ids of
 *  the OTHER side, not the rows themselves, since that's all the toggle grid needs to render). */
export async function unshareDeckForFriend(folderId: string, friendUserId: string): Promise<void> {
  const { error } = await supabase.from('deck_shares').delete().eq('folder_id', folderId).eq('shared_with_id', friendUserId)
  if (error) throw error
}

/** Decks shared with the signed-in user, one row per friend×folder — a folder shared with several
 *  friends of yours (each their own share) would appear once per share here, which is fine, since
 *  each row lists whichever friend shared it. */
export async function listSharedWithMe(): Promise<SharedDeck[]> {
  const { data: shares, error: sharesError } = await supabase
    .from('deck_shares')
    .select('id, folder_id, owner_id, folder_name_snapshot')
    .order('created_at', { ascending: false })
  if (sharesError) throw sharesError
  const rows = shares ?? []
  if (rows.length === 0) return []

  const [usernames, cardCounts] = await Promise.all([
    profilesByIds(rows.map((r) => r.owner_id as string)),
    supabase
      .from('cards')
      .select('folder_id')
      .in('folder_id', rows.map((r) => r.folder_id as string))
      .then(({ data, error }) => {
        if (error) throw error
        const counts = new Map<string, number>()
        for (const row of data ?? []) counts.set(row.folder_id as string, (counts.get(row.folder_id as string) ?? 0) + 1)
        return counts
      })
  ])

  return rows.map((r) => ({
    shareId: r.id as string,
    folderId: r.folder_id as string,
    folderName: r.folder_name_snapshot as string,
    owner: { userId: r.owner_id as string, username: usernames.get(r.owner_id as string) ?? '(unknown)' },
    cardCount: cardCounts.get(r.folder_id as string) ?? 0
  }))
}

/** Which of your own folders you've already shared with which friends — used so "Share with a
 *  friend…" can grey out someone you've already shared this exact folder with instead of erroring
 *  on the unique-per-folder-per-friend constraint. */
export async function listMySharesFor(folderId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from('deck_shares').select('shared_with_id').eq('folder_id', folderId)
  if (error) throw error
  return new Set((data ?? []).map((r) => r.shared_with_id as string))
}

/** Thin wrapper — see downloadDeck in lib/deckImport.ts, the general "download any folder you can
 *  currently read" version this and HostableDecksView's public decks both call. */
export async function importSharedDeck(deck: SharedDeck): Promise<ImportSharedDeckResult> {
  return downloadDeck(deck.folderId, deck.folderName)
}
