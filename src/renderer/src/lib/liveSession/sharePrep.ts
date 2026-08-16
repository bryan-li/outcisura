import { supabase } from '../supabase'
import type { ShareFormat } from '../../../../shared/types'

/** The AI "share-ready" cache read straight off a Supabase `cards` row's `share_*` columns (see
 *  migration 0005_card_share_prep.sql). Deliberately not part of `CardRecord`/`repository.ts` — the
 *  local-SQLite-backed shape used everywhere else in the app — since these columns have no local
 *  counterpart at all; a live session reads decks via Supabase directly, the same way
 *  syncEngine.ts's pull phase already does. */
export interface CardShareState {
  cardId: string
  shareFormat: ShareFormat | null
  mcqDistractors: string[] | null
  freeTextRubric: string | null
  sourceFront: string | null
  sourceBack: string | null
}

interface ShareStateRow {
  id: string
  share_format: ShareFormat | null
  share_mcq_distractors: string[] | null
  share_free_text_rubric: string | null
  share_prep_source_front: string | null
  share_prep_source_back: string | null
}

function hydrate(row: ShareStateRow): CardShareState {
  return {
    cardId: row.id,
    shareFormat: row.share_format,
    mcqDistractors: row.share_mcq_distractors,
    freeTextRubric: row.share_free_text_rubric,
    sourceFront: row.share_prep_source_front,
    sourceBack: row.share_prep_source_back
  }
}

async function fetchShareState(cardId: string): Promise<CardShareState> {
  const { data, error } = await supabase
    .from('cards')
    .select('id, share_format, share_mcq_distractors, share_free_text_rubric, share_prep_source_front, share_prep_source_back')
    .eq('id', cardId)
    .single()
  if (error) throw error
  return hydrate(data as ShareStateRow)
}

/** Lazily prepares (or returns the already-cached) share-ready content for one card. A cache hit
 *  costs one Supabase read and zero AI calls — it recomputes only when the live front/back text no
 *  longer matches the snapshot the cache was last computed from (a remote edit synced in from
 *  another device is caught by this too, since the comparison is against the card's actual current
 *  content, not an edit-time hook — no need to wire this into every card-edit call site). */
export async function ensureSharePrepped(cardId: string, front: string, back: string): Promise<CardShareState> {
  const existing = await fetchShareState(cardId)
  if (existing.shareFormat && existing.sourceFront === front && existing.sourceBack === back) {
    return existing
  }

  const result = await window.api.ai.prepareForSharing({ front, back })
  const { error } = await supabase
    .from('cards')
    .update({
      share_format: result.recommendedFormat,
      share_mcq_distractors: result.mcqDistractors,
      share_free_text_rubric: result.freeTextRubric,
      share_prep_source_front: front,
      share_prep_source_back: back
    })
    .eq('id', cardId)
  if (error) throw error

  return {
    cardId,
    shareFormat: result.recommendedFormat,
    mcqDistractors: result.mcqDistractors,
    freeTextRubric: result.freeTextRubric,
    sourceFront: front,
    sourceBack: back
  }
}
