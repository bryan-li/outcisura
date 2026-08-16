import { supabase } from '../supabase'

export interface LeaderboardEntry {
  userId: string
  displayName: string
  totalPoints: number
}

interface AnswerPointsRow {
  user_id: string
  points_awarded: number | null
}

interface ParticipantRow {
  user_id: string
  display_name: string
}

/** Aggregated client-side (at most a few hundred rows per session — no need for a server-side
 *  GROUP BY RPC). Shared by HostControlView and GuestSessionView so the two never compute standings
 *  differently. */
export async function computeLeaderboard(sessionId: string): Promise<LeaderboardEntry[]> {
  const [{ data: answers, error: answersError }, { data: participants, error: participantsError }] = await Promise.all([
    supabase.from('live_session_answers').select('user_id, points_awarded').eq('session_id', sessionId),
    supabase.from('live_session_participants').select('user_id, display_name').eq('session_id', sessionId)
  ])
  if (answersError) throw answersError
  if (participantsError) throw participantsError

  const totals = new Map<string, number>()
  for (const row of (answers ?? []) as AnswerPointsRow[]) {
    totals.set(row.user_id, (totals.get(row.user_id) ?? 0) + (row.points_awarded ?? 0))
  }

  return ((participants ?? []) as ParticipantRow[])
    .map((p) => ({ userId: p.user_id, displayName: p.display_name, totalPoints: totals.get(p.user_id) ?? 0 }))
    .sort((a, b) => b.totalPoints - a.totalPoints)
}
