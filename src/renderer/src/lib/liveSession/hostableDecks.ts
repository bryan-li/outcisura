import { supabase } from '../supabase'

/** Public decks from ANY user — bypasses local-first sync entirely, same as sharePrep.ts already
 *  does (share_* columns have no local counterpart). Doubly necessary now: syncEngine.ts's pull is
 *  filtered to the current user's own rows specifically so OTHER users' public folders never enter
 *  local SQLite (see its own comment) — browsing them has to go through this separate path. */
export interface PublicDeckSummary {
  folderId: string
  name: string
  cardCount: number
}

interface PublicFolderRow {
  id: string
  name: string
}

export async function listPublicDecks(): Promise<PublicDeckSummary[]> {
  const { data: folders, error: foldersError } = await supabase.from('folders').select('id, name').eq('is_public', true)
  if (foldersError) throw foldersError
  const publicFolders = (folders ?? []) as PublicFolderRow[]
  if (publicFolders.length === 0) return []

  const { data: cards, error: cardsError } = await supabase
    .from('cards')
    .select('folder_id')
    .in(
      'folder_id',
      publicFolders.map((f) => f.id)
    )
  if (cardsError) throw cardsError

  const countByFolder = new Map<string, number>()
  for (const row of (cards ?? []) as { folder_id: string }[]) {
    countByFolder.set(row.folder_id, (countByFolder.get(row.folder_id) ?? 0) + 1)
  }

  return publicFolders.map((f) => ({ folderId: f.id, name: f.name, cardCount: countByFolder.get(f.id) ?? 0 }))
}
