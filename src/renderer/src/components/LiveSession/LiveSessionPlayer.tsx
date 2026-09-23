import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useSessionChannel } from '../../lib/liveSession/realtime'
import { computeLeaderboard, type LeaderboardEntry } from '../../lib/liveSession/leaderboard'
import type { ShareFormat } from '../../../../shared/types'
import { LeaderboardList } from './LeaderboardList'
import {
  CountdownRing,
  Eyebrow,
  KeyHint,
  OptionLetter,
  QuestionText,
  inputPillStyle,
  optionPillSelectedStyle,
  optionPillStyle,
  pillPrimaryStyle,
  pillQuietStyle,
  sessionCardStyle,
  stageStyle
} from './liveKit'
import { Icon } from '../Icon'

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

/** The actual live-session play loop (waiting → answering → submitted → revealed → ended), shared
 *  by anonymous guests (GuestSessionView) and signed-in participants (PlayLiveSessionView) — the
 *  gameplay itself doesn't care which kind of account is playing, only `onLeave` differs (a guest
 *  leaving signs out of their throwaway anonymous identity; a signed-in user leaving just navigates
 *  away, still logged in). */
export function LiveSessionPlayer({
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
  /** The full window this question was given, so the countdown ring has something to drain against.
   *  Measured when the question opens, and re-measured if the host re-times it mid-question. */
  const [windowSeconds, setWindowSeconds] = useState(1)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [freeText, setFreeText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [ownResult, setOwnResult] = useState<{ isCorrect: boolean | null; pointsAwarded: number | null } | null>(null)
  const [revealedAnswerText, setRevealedAnswerText] = useState<string | null>(null)
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
    setWindowSeconds(Math.max(1, Math.round((new Date(dl).getTime() - Date.now()) / 1000)))
    setSelectedIndex(null)
    setFreeText('')
    setOwnResult(null)
    setRevealedAnswerText(null)
    setError(null)
    setPhase('answering')
  }

  async function loadResults(questionId: string, answerText: string): Promise<void> {
    const { data } = await supabase
      .from('live_session_answers')
      .select('is_correct, points_awarded')
      .eq('question_id', questionId)
      .eq('user_id', userId)
      .maybeSingle()
    const row = data as OwnAnswerRow | null
    setOwnResult({ isCorrect: row?.is_correct ?? null, pointsAwarded: row?.points_awarded ?? null })
    setRevealedAnswerText(answerText || null)
    setLeaderboard(await computeLeaderboard(sessionId))
    setPhase('revealed')
  }

  const send = useSessionChannel(sessionId, (event) => {
    if (event.type === 'question_advanced') void loadQuestion(event.questionIndex, event.deadline)
    // The host re-timed the question we're already on: move the clock, touch nothing else — an
    // answer half-typed into the box has to survive this.
    else if (event.type === 'deadline_changed') {
      if (!question || event.questionIndex !== question.questionIndex) return
      setDeadline(event.deadline)
      setWindowSeconds(Math.max(1, Math.round((new Date(event.deadline).getTime() - Date.now()) / 1000)))
    } else if (event.type === 'results_revealed' && question) void loadResults(question.id, event.answerText)
    else if (event.type === 'session_ended') void computeLeaderboard(sessionId).then((board) => { setLeaderboard(board); setPhase('ended') })
  })

  useEffect(() => {
    if ((phase !== 'answering' && phase !== 'submitted') || !deadline) return
    const target = new Date(deadline).getTime()
    const tick = (): void => setRemainingSeconds(Math.max(0, Math.ceil((target - Date.now()) / 1000)))
    tick()
    const timer = setInterval(tick, 250)
    return () => clearInterval(timer)
  }, [phase, deadline])

  const canSubmit =
    !!question && !submitting && remainingSeconds > 0 && (question.format === 'mcq' ? selectedIndex !== null : freeText.trim().length > 0)

  // handleSubmit is re-created every render (it closes over the current answer), so the Enter
  // shortcut below reads it through a ref rather than resubscribing a window listener each time.
  const submitRef = useRef<() => void>(() => {})

  async function handleSubmit(): Promise<void> {
    if (!question || !canSubmit) return
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
  submitRef.current = () => void handleSubmit()

  /** Enter submits. For MCQ that means picking with 1-4 (or a click) and confirming with Enter,
   *  without ever leaving the keyboard; the free-text box handles Enter itself (below) so this
   *  listener skips anything typed into a field. */
  useEffect(() => {
    if (phase !== 'answering') return
    function handleKeyDown(e: KeyboardEvent): void {
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      if (e.key === 'Enter') {
        e.preventDefault()
        submitRef.current()
        return
      }
      if (question?.format === 'mcq' && question.mcqOptions && /^[1-9]$/.test(e.key)) {
        const index = Number(e.key) - 1
        if (index < question.mcqOptions.length) {
          e.preventDefault()
          setSelectedIndex(index)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [phase, question])

  /** Enter submits from inside the free-text box too; Shift+Enter still starts a new line, since an
   *  answer can legitimately be more than one. */
  function handleTextKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key !== 'Enter' || e.shiftKey) return
    e.preventDefault()
    submitRef.current()
  }

  return (
    <div style={stageStyle}>
      <div style={sessionCardStyle}>
        {phase === 'waiting-for-start' && (
          <>
            <Eyebrow tinted>
              <Icon name="broadcast" size="1em" />You&apos;re in
            </Eyebrow>
            <QuestionText>Waiting for the host…</QuestionText>
            <p style={{ fontSize: 'var(--font-sm)', color: 'var(--fg-muted)', margin: 0 }}>
              Joined as <strong style={{ color: 'var(--fg)' }}>{displayName}</strong>
              {folderNameSnapshot ? (
                <>
                  {' '}for <strong style={{ color: 'var(--fg)' }}>{folderNameSnapshot}</strong>
                </>
              ) : null}
              .
            </p>
          </>
        )}

        {(phase === 'answering' || phase === 'submitted') && question && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
              <Eyebrow tinted>Question {question.questionIndex + 1}</Eyebrow>
              <CountdownRing remaining={remainingSeconds} total={windowSeconds} size={56} />
            </div>

            <QuestionText>{question.frontSnapshot}</QuestionText>

            {phase === 'answering' ? (
              <>
                {question.format === 'mcq' && question.mcqOptions ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {question.mcqOptions.map((opt, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setSelectedIndex(i)}
                        style={{ ...optionPillStyle, ...(selectedIndex === i ? optionPillSelectedStyle : {}) }}
                      >
                        <OptionLetter index={i} selected={selectedIndex === i} />
                        {opt}
                      </button>
                    ))}
                  </div>
                ) : (
                  <textarea
                    autoFocus
                    value={freeText}
                    onChange={(e) => setFreeText(e.target.value)}
                    onKeyDown={handleTextKeyDown}
                    placeholder="Type your answer…"
                    rows={3}
                    style={{ ...inputPillStyle, resize: 'vertical' }}
                  />
                )}

                {error && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', margin: 0 }}>{error}</p>}

                <button type="button" disabled={!canSubmit} onClick={() => void handleSubmit()} style={pillPrimaryStyle}>
                  {remainingSeconds <= 0 ? "Time's up" : submitting ? 'Submitting…' : 'Submit'}
                </button>
                <KeyHint>
                  {question.format === 'mcq' ? 'Press 1–9 to pick · Enter to submit' : 'Enter to submit · Shift+Enter for a new line'}
                </KeyHint>
              </>
            ) : (
              <div style={lockedStyle}>
                <Icon name="check-circle" bare style={{ color: 'var(--accent)' }} />
                Answer locked in. Waiting for the others…
              </div>
            )}
          </>
        )}

        {phase === 'revealed' && (
          <>
            <div style={{ ...resultBannerStyle, ...(ownResult?.isCorrect ? resultCorrectStyle : resultWrongStyle) }}>
              <Icon name={ownResult?.isCorrect ? 'check-circle' : 'x-circle'} size="1.4em" bare />
              <span style={{ fontSize: 'var(--font-xl)', fontWeight: 700, letterSpacing: '-0.02em' }}>
                {ownResult?.isCorrect ? 'Correct!' : 'Not quite'}
              </span>
              {ownResult?.pointsAwarded ? <span style={{ marginLeft: 'auto', fontWeight: 700 }}>+{ownResult.pointsAwarded}</span> : null}
            </div>

            {revealedAnswerText && (
              <div>
                <Eyebrow>Correct answer</Eyebrow>
                <p style={{ margin: '4px 0 0', fontSize: 'var(--font-md)', fontWeight: 600 }}>{revealedAnswerText}</p>
              </div>
            )}

            <div>
              <Eyebrow>Leaderboard</Eyebrow>
              <div style={{ marginTop: 6 }}>
                <LeaderboardList entries={leaderboard} />
              </div>
            </div>

            <KeyHint>Waiting for the next question…</KeyHint>
          </>
        )}

        {phase === 'ended' && (
          <>
            <Eyebrow tinted>
              <Icon name="flag" size="1em" />Session over
            </Eyebrow>
            <LeaderboardList entries={leaderboard} podium />
          </>
        )}

        <button type="button" onClick={onLeave} style={{ ...pillQuietStyle, alignSelf: 'center' }}>
          Leave
        </button>
      </div>
    </div>
  )
}

const lockedStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 'var(--font-sm)',
  color: 'var(--fg-muted)',
  padding: 'var(--space-3) var(--space-4)',
  borderRadius: 'var(--radius-row)',
  background: 'var(--bg-sidebar)'
}

const resultBannerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: 'var(--space-3) var(--space-4)',
  borderRadius: 'var(--radius-row)',
  animation: 'pop-in 220ms ease'
}

const resultCorrectStyle: CSSProperties = { background: 'var(--accent-soft)', color: 'var(--accent)' }

const resultWrongStyle: CSSProperties = { background: 'color-mix(in srgb, var(--danger) 12%, transparent)', color: 'var(--danger)' }
