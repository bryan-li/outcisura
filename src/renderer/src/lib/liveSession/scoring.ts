/** Speed-ranked point scale for one question's correct answers — fastest correct answer scores
 *  highest, every correct answer past the scale's length still scores the floor (never zero for a
 *  correct answer). Pure/rank-based rather than needing an absolute "window duration": the only
 *  timing signal used is relative ordering of `answered_at`, which is already server-stamped (see
 *  the `force_server_answered_at` trigger) and trustworthy regardless of client clock skew. */
export const POINT_SCALE = [1000, 900, 800, 700, 600, 500]

export interface TimedAnswer {
  userId: string
  answeredAt: string
}

/** Wrong/unanswered participants simply have no entry in the returned map (0 points). */
export function computeSpeedRankedPoints(correctAnswers: TimedAnswer[]): Map<string, number> {
  const sorted = [...correctAnswers].sort((a, b) => new Date(a.answeredAt).getTime() - new Date(b.answeredAt).getTime())
  const points = new Map<string, number>()
  sorted.forEach((answer, rank) => {
    points.set(answer.userId, POINT_SCALE[Math.min(rank, POINT_SCALE.length - 1)])
  })
  return points
}
