/**
 * Spaced-repetition scheduling — a standard 4-button SM-2 variant (Anki/RemNote-style). Pure and
 * framework-agnostic so the renderer can also use it to preview "grading this shows it again in
 * ___" under each grade button before the user picks one, and main can use it to persist the
 * authoritative result.
 */

export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy'

export interface SrsState {
  intervalDays: number
  easeFactor: number
  repetitions: number
  lapses: number
}

export interface SrsResult extends SrsState {
  dueAt: string
}

const MIN_EASE = 1.3

export function nextSrsState(state: SrsState, grade: ReviewGrade, now: Date = new Date()): SrsResult {
  let { intervalDays, easeFactor, repetitions, lapses } = state

  if (grade === 'again') {
    if (repetitions > 0) lapses += 1 // only a "lapse" if it had previously been learned
    repetitions = 0
    easeFactor = Math.max(MIN_EASE, easeFactor - 0.2)
    intervalDays = 1 / 144 // ~10 minutes — resurfaces later the same session via requeueAfterAgain
  } else if (grade === 'hard') {
    easeFactor = Math.max(MIN_EASE, easeFactor - 0.15)
    // Deliberately shorter than `good`'s first-ever interval — otherwise a brand-new card's first
    // Hard and first Good press schedule identically, which reads as a bug even though it isn't.
    intervalDays = repetitions === 0 ? 0.5 : Math.max(intervalDays * 1.2, intervalDays + 1)
    repetitions += 1
  } else if (grade === 'good') {
    intervalDays = repetitions === 0 ? 1 : repetitions === 1 ? 6 : intervalDays * easeFactor
    repetitions += 1
  } else {
    easeFactor += 0.15
    intervalDays = (repetitions === 0 ? 1 : repetitions === 1 ? 6 : intervalDays * easeFactor) * 1.3
    repetitions += 1
  }

  // Minute precision under a day (so the ~10min "again" interval survives rounding intact —
  // Math.round(x*100)/100 at day-scale would round 0.00694 up to 0.01, i.e. 14.4min not 10);
  // day precision otherwise, since nobody needs interval precision finer than that at that scale.
  intervalDays = intervalDays < 1 ? Math.round(intervalDays * 1440) / 1440 : Math.round(intervalDays * 100) / 100
  const dueAt = new Date(now.getTime() + intervalDays * 86400000).toISOString()
  return { intervalDays, easeFactor: Math.round(easeFactor * 100) / 100, repetitions, lapses, dueAt }
}

export function formatInterval(days: number): string {
  if (days < 1) {
    const mins = Math.round(days * 1440)
    return mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`
  }
  if (days < 30) return `${Math.round(days)}d`
  if (days < 365) return `${Math.round(days / 30)}mo`
  return `${Math.round(days / 365)}y`
}
