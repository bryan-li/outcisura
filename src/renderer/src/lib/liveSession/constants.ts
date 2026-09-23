/** How long each question stays open for answers by default. The host can change this per question
 *  (see hostSessionStore.setQuestionSeconds); whatever is in force is synced to guests purely
 *  through the broadcast `deadline` (see realtime.ts), so nothing about the limit is persisted —
 *  the deadline itself is the whole contract between host and guests. */
export const QUESTION_SECONDS = 20

/** The limits the host can pick from. Presets rather than a free number field: it's a control the
 *  host reaches for mid-game with everyone watching, so one tap beats typing. */
export const QUESTION_SECONDS_PRESETS = [10, 20, 30, 45, 60, 90] as const

/** A shortened limit must never land in the past (or so close that guests can't act on it) — if the
 *  host cuts the timer below what has already elapsed, everyone still gets this long to answer. */
export const MIN_REMAINING_SECONDS_AFTER_CHANGE = 3
