import type { CardRecord, ReviewLogEntry } from '../../../shared/types'

export interface ReviewStats {
  dueNow: number
  newCards: number
  matureCards: number
  totalCards: number
  reviewedToday: number
  streakDays: number
}

const DAY_MS = 86400000

/** LOCAL calendar day, deliberately — slicing the ISO string's UTC date would misfile a late-
 *  evening review into "tomorrow" for any non-UTC user, fragmenting the streak around their own
 *  midnight rather than the app's. */
function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/** "Mature" mirrors Anki's own threshold (interval >= 21 days) — a recognizable convention rather
 *  than an invented one. */
export function computeReviewStats(cards: CardRecord[], log: ReviewLogEntry[], now: Date): ReviewStats {
  const todayKey = dayKey(now.toISOString())
  const dueNow = cards.filter((c) => new Date(c.dueAt).getTime() <= now.getTime()).length
  const newCards = cards.filter((c) => c.repetitions === 0).length
  const matureCards = cards.filter((c) => c.repetitions > 0 && c.intervalDays >= 21).length
  const reviewedToday = log.filter((l) => dayKey(l.reviewedAt) === todayKey).length

  const activeDays = new Set(log.map((l) => dayKey(l.reviewedAt)))
  let streakDays = 0
  const cursor = new Date(now)
  // Not having reviewed anything YET today doesn't break the streak — it just hasn't extended it
  // yet — so start counting from yesterday back in that case rather than zeroing out at day 0.
  if (!activeDays.has(todayKey)) cursor.setTime(cursor.getTime() - DAY_MS)
  while (activeDays.has(dayKey(cursor.toISOString()))) {
    streakDays += 1
    cursor.setTime(cursor.getTime() - DAY_MS)
  }

  return { dueNow, newCards, matureCards, totalCards: cards.length, reviewedToday, streakDays }
}
