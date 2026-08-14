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
function dayKeyFromDate(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function dayKey(iso: string): string {
  return dayKeyFromDate(new Date(iso))
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

export interface HeatmapDay {
  date: Date
  count: number
}

/** One column of the heatmap grid (a calendar week, Sun–Sat). */
export type HeatmapWeek = HeatmapDay[]

/** Buckets review_log entries into a GitHub-contributions-style grid: `weeks` columns of 7 days
 *  each (Sun–Sat), ending on the Saturday of the current week so the grid never shows a partial
 *  trailing column. Built from local calendar days via dayKeyFromDate directly (not a Date→ISO→
 *  Date round trip), since toISOString() would normalize to UTC and could shift a day near
 *  midnight for non-UTC users the same way dayKey's own doc comment warns against. */
export function computeReviewHeatmap(log: ReviewLogEntry[], now: Date, weeks = 53): HeatmapWeek[] {
  const counts = new Map<string, number>()
  for (const entry of log) {
    const key = dayKey(entry.reviewedAt)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const gridEnd = new Date(today)
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()))
  const gridStart = new Date(gridEnd)
  gridStart.setDate(gridStart.getDate() - (weeks * 7 - 1))

  const result: HeatmapWeek[] = []
  const cursor = new Date(gridStart)
  for (let w = 0; w < weeks; w++) {
    const week: HeatmapWeek = []
    for (let d = 0; d < 7; d++) {
      week.push({ date: new Date(cursor), count: counts.get(dayKeyFromDate(cursor)) ?? 0 })
      cursor.setDate(cursor.getDate() + 1)
    }
    result.push(week)
  }
  return result
}
