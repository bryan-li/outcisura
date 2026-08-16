import { supabase } from '../supabase'

/** Mirrors sharePrep.ts's own staleness idiom exactly: a card is "ready" when its AI share-prep
 *  cache exists AND was computed from its current front/back, not a stale earlier edit. Deliberately
 *  computed on demand, never a stored column — the same drift risk (a front/back edit silently
 *  desyncing a cached flag) that ruled out a stored is_public/is_ready flag on folders applies here
 *  too, for the same reason. */
export interface FolderReadiness {
  folderId: string
  totalCards: number
  readyCards: number
  isReady: boolean
}

interface CardReadinessRow {
  id: string
  front: string
  back: string
  share_format: string | null
  share_prep_source_front: string | null
  share_prep_source_back: string | null
}

function isCardReady(row: CardReadinessRow): boolean {
  return row.share_format !== null && row.share_prep_source_front === row.front && row.share_prep_source_back === row.back
}

function summarize(folderId: string, rows: CardReadinessRow[]): FolderReadiness {
  const readyCards = rows.filter(isCardReady).length
  return { folderId, totalCards: rows.length, readyCards, isReady: rows.length > 0 && readyCards === rows.length }
}

export async function computeFolderReadiness(folderId: string): Promise<FolderReadiness> {
  const { data, error } = await supabase
    .from('cards')
    .select('id, front, back, share_format, share_prep_source_front, share_prep_source_back')
    .eq('folder_id', folderId)
  if (error) throw error
  return summarize(folderId, (data ?? []) as CardReadinessRow[])
}

/** Batched via `.in('folder_id', ...)` — used when scanning every folder a user has (e.g. Hostable
 *  Decks' "Your decks" section) to avoid N separate round-trips. */
export async function computeReadinessForFolders(folderIds: string[]): Promise<Map<string, FolderReadiness>> {
  const result = new Map<string, FolderReadiness>()
  if (folderIds.length === 0) return result

  const { data, error } = await supabase
    .from('cards')
    .select('id, front, back, share_format, share_prep_source_front, share_prep_source_back, folder_id')
    .in('folder_id', folderIds)
  if (error) throw error

  const byFolder = new Map<string, CardReadinessRow[]>()
  for (const row of (data ?? []) as (CardReadinessRow & { folder_id: string })[]) {
    const list = byFolder.get(row.folder_id) ?? []
    list.push(row)
    byFolder.set(row.folder_id, list)
  }
  for (const folderId of folderIds) {
    result.set(folderId, summarize(folderId, byFolder.get(folderId) ?? []))
  }
  return result
}
