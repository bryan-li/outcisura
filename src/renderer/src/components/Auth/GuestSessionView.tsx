import { useEffect, useState, type CSSProperties } from 'react'
import { useAuthStore } from '../../state/authStore'
import { useGuestSessionStore } from '../../state/guestSessionStore'
import { supabase } from '../../lib/supabase'
import { useSessionChannel } from '../../lib/liveSession/realtime'
import { computeLeaderboard, type LeaderboardEntry } from '../../lib/liveSession/leaderboard'
import type { ShareFormat } from '../../../../shared/types'
import { JoinSessionForm } from './JoinSessionForm'

/** Rendered by App.tsx in place of the normal AppShell whenever the current Supabase session is
 *  anonymous (session.user.is_anonymous) — a guest never sees the flashcard library, review
 *  dashboard, or Settings, only this. Covers two distinct paths into this same screen:
 *  - A guest who just submitted LoginView's "Join a session" form.
 *  - A *returning* guest whose anonymous Supabase session persisted across an app relaunch but
 *    whose in-memory guestSessionStore reset to 'idle' on this fresh load — they see the join form
 *    again rather than a broken blank screen.
 *  Once joined, hands off to LiveGame below for the actual answering/waiting/reveal loop. */
export function GuestSessionView(): JSX.Element {
  const status = useGuestSessionStore((s) => s.status)
  const displayName = useGuestSessionStore((s) => s.displayName)
  const joinedSession = useGuestSessionStore((s) => s.joinedSession)
  const reset = useGuestSessionStore((s) => s.reset)
  const signOut = useAuthStore((s) => s.signOut)
  const userId = useAuthStore((s) => s.session?.user.id)

  if (status !== 'joined' || !joinedSession || !userId) {
    return <JoinSessionForm title="Join a session" subtitle="Enter the code from your host — no account needed." />
  }

  return (
    <LiveGame
      sessionId={joinedSession.id}
      userId={userId}
      displayName={displayName ?? 'Player'}
      folderNameSnapshot={joinedSession.folderNameSnapshot}
      onLeave={() => {
        reset()
        void signOut()
      }}
    />
  )
}

type GuestPhase = 'waiting-for-start' | 'answering' | 'submitted' | 'revealed' | 'ended'

interface GuestQuestion {
  id: string
  questionIndex: number
  frontSnapshot: string
  format: ShareFormat
  mcqOptions: string[] | null
}

interface QuestionRow {
  id: string
  question_index: number
  front_snapshot: string
  format: ShareFormat
  mcq_options: string[] | null
}

interface OwnAnswerRow {
  is_correct: boolean | null
  points_awarded: number | null
}

function LiveGame({
  sessionId,
  userId,
  displayName,
  folderNameSnapshot,
  onLeave
}: {
  sessionId: string
  userId: string
  displayName: string
  folderNameSnapshot: string | null
  onLeave: () => void
}): JSX.Element {
  const [phase, setPhase] = useState<GuestPhase>('waiting-for-start')
  const [question, setQuestion] = useState<GuestQuestion | null>(null)
  const [deadline, setDeadline] = useState<string | null>(null)
  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [freeText, setFreeText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [ownResult, setOwnResult] = useState<{ isCorrect: boolean | null; pointsAwarded: number | null } | null>(null)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  async function loadQuestion(questionIndex: number, dl: string): Promise<void> {
    const { data, error: fetchError } = await supabase
      .from('live_session_questions')
      .select('id, question_index, front_snapshot, format, mcq_options')
      .eq('session_id', sessionId)
      .eq('question_index', questionIndex)
      .single()
    if (fetchError) {
      setError(fetchError.message)
      return
    }
    const row = data as QuestionRow
    setQuestion({ id: row.id, questionIndex: row.question_index, frontSnapshot: row.front_snapshot, format: row.format, mcqOptions: row.mcq_options })
    setDeadline(dl)
    setSelectedIndex(null)
    setFreeText('')
    setOwnResult(null)
    setError(null)
    setPhase('answering')
  }

  async function loadResults(questionId: string): Promise<void> {
    const { data } = await supabase
      .from('live_session_answers')
      .select('is_correct, points_awarded')
      .eq('question_id', questionId)
      .eq('user_id', userId)
      .maybeSingle()
    const row = data as OwnAnswerRow | null
    setOwnResult({ isCorrect: row?.is_correct ?? null, pointsAwarded: row?.points_awarded ?? null })
    setLeaderboard(await computeLeaderboard(sessionId))
    setPhase('revealed')
  }

  const send = useSessionChannel(sessionId, (event) => {
    if (event.type === 'question_advanced') void loadQuestion(event.questionIndex, event.deadline)
    else if (event.type === 'results_revealed' && question) void loadResults(question.id)
    else if (event.type === 'session_ended') void computeLeaderboard(sessionId).then((board) => { setLeaderboard(board); setPhase('ended') })
  })

  useEffect(() => {
    if ((phase !== 'answering' && phase !== 'submitted') || !deadline) return
    const target = new Date(deadline).getTime()
    const timer = setInterval(() => setRemainingSeconds(Math.max(0, Math.ceil((target - Date.now()) / 1000))), 250)
    return () => clearInterval(timer)
  }, [phase, deadline])

  async function handleSubmit(): Promise<void> {
    if (!question || submitting || remainingSeconds <= 0) return
    if (question.format === 'mcq' && selectedIndex === null) return
    if (question.format === 'free_text' && !freeText.trim()) return
    setSubmitting(true)
    try {
      const { error: insertError } = await supabase.from('live_session_answers').insert({
        session_id: sessionId,
        question_id: question.id,
        user_id: userId,
        selected_mcq_index: question.format === 'mcq' ? selectedIndex : null,
        free_text_answer: question.format === 'free_text' ? freeText.trim() : null
      })
      if (insertError) throw insertError
      send({ type: 'answer_submitted' })
      setPhase('submitted')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit answer')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        {phase === 'waiting-for-start' && (
          <>
            <h1 style={{ fontSize: 'var(--font-xl)', margin: 0 }}>You&apos;re in!</h1>
            <p style={{ fontSize: 'var(--font-sm)', color: 'var(--fg-muted)', margin: 0 }}>
              Joined as <strong>{displayName}</strong>
              {folderNameSnapshot ? (
                <>
                  {' '}for <strong>{folderNameSnapshot}</strong>
                </>
              ) : null}
              . Waiting for the host to start the session…
            </p>
          </>
        )}

        {(phase === 'answering' || phase === 'submitted') && question && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)' }}>Question {question.questionIndex + 1}</span>
              <span style={{ fontSize: 'var(--font-lg)', fontWeight: 700, color: 'var(--accent)' }}>{remainingSeconds}s</span>
            </div>
            <p style={{ fontSize: 'var(--font-lg)', fontWeight: 600, margin: 0 }}>{question.frontSnapshot}</p>

            {phase === 'answering' ? (
              <>
                {question.format === 'mcq' && question.mcqOptions ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {question.mcqOptions.map((opt, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setSelectedIndex(i)}
                        style={{ ...optionButtonStyle, ...(selectedIndex === i ? optionButtonSelectedStyle : {}) }}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                ) : (
                  <textarea
                    autoFocus
                    value={freeText}
                    onChange={(e) => setFreeText(e.target.value)}
                    placeholder="Type your answer…"
                    rows={3}
                    style={inputStyle}
                  />
                )}
                {error && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', margin: 0 }}>{error}</p>}
                <button
                  type="button"
                  disabled={submitting || remainingSeconds <= 0 || (question.format === 'mcq' ? selectedIndex === null : !freeText.trim())}
                  onClick={() => void handleSubmit()}
                  style={primaryButtonStyle}
                >
                  {remainingSeconds <= 0 ? "Time's up" : submitting ? 'Submitting…' : 'Submit'}
                </button>
              </>
            ) : (
              <p style={{ fontSize: 'var(--font-sm)', color: 'var(--fg-muted)', margin: 0 }}>Answer locked in. Waiting for other players…</p>
            )}
          </>
        )}

        {phase === 'revealed' && (
          <>
            <p style={{ fontSize: 'var(--font-xl)', margin: 0 }}>
              {ownResult?.isCorrect ? '✅ Correct!' : '❌ Not quite'} {ownResult?.pointsAwarded ? `+${ownResult.pointsAwarded}` : ''}
            </p>
            <div>
              <p style={{ fontSize: 'var(--font-xs)', fontWeight: 600, color: 'var(--fg-faint)', textTransform: 'uppercase', margin: '0 0 6px' }}>
                Leaderboard
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {leaderboard.map((entry, i) => (
                  <div key={entry.userId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-sm)' }}>
                    <span>
                      {i + 1}. {entry.displayName}
                    </span>
                    <span style={{ fontWeight: 600 }}>{entry.totalPoints}</span>
                  </div>
                ))}
              </div>
            </div>
            <p style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)', margin: 0 }}>Waiting for the next question…</p>
          </>
        )}

        {phase === 'ended' && (
          <>
            <h1 style={{ fontSize: 'var(--font-xl)', margin: 0 }}>🏁 Session over</h1>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {leaderboard.map((entry, i) => (
                <div key={entry.userId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-sm)' }}>
                  <span>
                    {i + 1}. {entry.displayName}
                  </span>
                  <span style={{ fontWeight: 600 }}>{entry.totalPoints}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <button type="button" onClick={onLeave} style={quietTextButtonStyle}>
          Not you? Leave
        </button>
      </div>
    </div>
  )
}

const pageStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  background: 'var(--bg)'
}

const cardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
  width: 380,
  padding: 'var(--space-6)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)'
}

const quietTextButtonStyle: CSSProperties = {
  border: 'none',
  background: 'none',
  color: 'var(--fg-muted)',
  cursor: 'pointer',
  fontSize: 'var(--font-xs)'
}

const optionButtonStyle: CSSProperties = {
  textAlign: 'left',
  fontSize: 'var(--font-sm)',
  padding: '10px 12px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg)',
  color: 'inherit',
  cursor: 'pointer'
}

const optionButtonSelectedStyle: CSSProperties = {
  border: '1px solid var(--accent)',
  background: 'var(--accent-soft)',
  color: 'var(--accent)',
  fontWeight: 600
}

const inputStyle: CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 'var(--font-sm)',
  padding: '8px 10px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg)',
  color: 'inherit',
  resize: 'vertical'
}

const primaryButtonStyle: CSSProperties = {
  border: '1px solid var(--accent)',
  background: 'var(--accent-soft)',
  color: 'var(--accent)',
  fontWeight: 600,
  borderRadius: 'var(--radius-sm)',
  padding: '10px 14px',
  cursor: 'pointer'
}
