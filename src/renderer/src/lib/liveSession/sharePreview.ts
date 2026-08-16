import { supabase } from '../supabase'
import type { ShareFormat } from '../../../../shared/types'

/** Read-only preview of a folder's AI share-prep content — what a host would see if they wanted to
 *  sanity-check the generated questions before actually hosting with this deck. Cards that haven't
 *  been prepped yet (or were edited since, per sharePrep.ts's own staleness check) are included with
 *  null prep fields so the caller can show "not prepared yet" rather than silently omitting them. */
export interface CardSharePreview {
  cardId: string
  front: string
  back: string
  isPrepped: boolean
  recommendedFormat: ShareFormat | null
  mcqDistractors: string[] | null
  freeTextRubric: string | null
}

interface CardPreviewRow {
  id: string
  front: string
  back: string
  share_format: ShareFormat | null
  share_mcq_distractors: string[] | null
  share_free_text_rubric: string | null
  share_prep_source_front: string | null
  share_prep_source_back: string | null
}

export async function getCardSharePreviews(folderId: string): Promise<CardSharePreview[]> {
  const { data, error } = await supabase
    .from('cards')
    .select(
      'id, front, back, share_format, share_mcq_distractors, share_free_text_rubric, share_prep_source_front, share_prep_source_back'
    )
    .eq('folder_id', folderId)
  if (error) throw error

  return ((data ?? []) as CardPreviewRow[]).map((row) => {
    const isPrepped = row.share_format !== null && row.share_prep_source_front === row.front && row.share_prep_source_back === row.back
    return {
      cardId: row.id,
      front: row.front,
      back: row.back,
      isPrepped,
      recommendedFormat: isPrepped ? row.share_format : null,
      mcqDistractors: isPrepped ? row.share_mcq_distractors : null,
      freeTextRubric: isPrepped ? row.share_free_text_rubric : null
    }
  })
}
