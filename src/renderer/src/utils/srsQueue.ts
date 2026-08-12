import type { CardRecord } from '../../../shared/types'
import type { ReviewScope } from '../state/uiStore'

export function isDue(card: CardRecord, now: Date): boolean {
  return new Date(card.dueAt).getTime() <= now.getTime()
}

function matchesScope(card: CardRecord, scope: ReviewScope): boolean {
  if (scope.kind === 'all') return true
  if (scope.kind === 'folder') return card.folderId === scope.folderId
  return card.folderId !== null && scope.folderIds.includes(card.folderId)
}

export function dueCards(cards: CardRecord[], scope: ReviewScope, now: Date): CardRecord[] {
  return cards
    .filter((c) => matchesScope(c, scope))
    .filter((c) => isDue(c, now))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
}

/** Same scope-match + sort as dueCards but without the due-filter — a forecast of what's coming
 *  up next (due or not), for the dashboard's "due next" list. */
export function upcomingCards(cards: CardRecord[], scope: ReviewScope, limit: number): CardRecord[] {
  return cards
    .filter((c) => matchesScope(c, scope))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
    .slice(0, limit)
}

/** Same scope-match + sort as dueCards but with neither the due-filter nor a limit — every card
 *  in scope, for a forced "review regardless of schedule" session. */
export function allCardsInScope(cards: CardRecord[], scope: ReviewScope): CardRecord[] {
  return cards.filter((c) => matchesScope(c, scope)).sort((a, b) => a.dueAt.localeCompare(b.dueAt))
}

/**
 * "Again" doesn't just reschedule for ~10min from now — it needs to resurface later in THIS same
 * session, so the graded (post-grade!) card is spliced back into the in-memory queue a few slots
 * ahead rather than relying solely on its new due date. Splicing the pre-grade object back in here
 * would corrupt the SM-2 math if it lapses a second time this session — always pass the record
 * gradeCard returned, never the one that was on screen before grading.
 */
export function requeueAfterAgain(
  queue: CardRecord[],
  index: number,
  gradedCard: CardRecord,
  offset = 3
): { queue: CardRecord[]; nextIndex: number } {
  const withoutCurrent = [...queue.slice(0, index), ...queue.slice(index + 1)]
  const insertAt = Math.min(index + offset, withoutCurrent.length)
  const queueOut = [...withoutCurrent.slice(0, insertAt), gradedCard, ...withoutCurrent.slice(insertAt)]
  // Removal shifted everything after `index` down by one, so `index` already points at what was
  // the next card — no increment needed.
  return { queue: queueOut, nextIndex: index }
}
