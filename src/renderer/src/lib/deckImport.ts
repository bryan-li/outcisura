import { supabase } from './supabase'
import type { CardType, ImportSharedDeckResult, SharedDeckCard } from '../../../shared/types'

/** Downloads any folder's cards you can currently read (RLS decides that — your own, a friend's
 *  share, or a public deck) and files them into your own local library as a new folder, via the
 *  same import/dedupe machinery Anki import uses (see registerIpc.ts's sharedDecks:import handler
 *  and ankiImport.ts). Text only — see SharedDeckCard's own doc comment on why images don't come
 *  along (they're a local file path on the OTHER device, meaningless on yours). */
export async function downloadDeck(folderId: string, folderName: string): Promise<ImportSharedDeckResult> {
  const { data, error } = await supabase.from('cards').select('front, back, card_type').eq('folder_id', folderId)
  if (error) throw error
  const cards: SharedDeckCard[] = (data ?? []).map((r) => ({ front: r.front as string, back: r.back as string, cardType: r.card_type as CardType }))
  return window.api.sharedDecks.import({ folderName, cards })
}
