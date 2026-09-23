import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useHostSessionStore } from '../../state/hostSessionStore'
import { useSessionChannel } from '../../lib/liveSession/realtime'
import { LeaderboardList } from './LeaderboardList'
import {
  AnsweredDots,
  CountdownRing,
  Eyebrow,
  OptionLetter,
  QuestionText,
  TimeLimitPicker,
  optionPillStyle,
  pillPrimaryStyle,
  pillSecondaryStyle,
  sessionCardStyle
} from './liveKit'
import { Icon } from '../Icon'

interface HostControlViewProps {
  sessionId: string
}

/** How long to hold on "everyone answered" before the auto-reveal fires, so the room gets a beat to
 *  see the last dot fill rather than the question vanishing under the final answer. */
const AUTO_REVEAL_GRACE_MS = 1200

/** The host's live control panel — current question + countdown while `phase === 'question'`, then
 *  a per-participant correctness breakdown + leaderboard once revealed, then Next/End.
 *
 *  Three things close the answering window: the countdown expiring (a local timer keyed to the
 *  broadcast `deadline`), every participant having answered (after a short grace — see
 *  AUTO_REVEAL_GRACE_MS), or the host pressing "Reveal now". All of them funnel through the same
 *  `handleReveal`, which is idempotent per question index. The host can also re-time the question
 *  mid-flight with the time picker, which moves the deadline for everyone. */
export function HostControlView({ sessionId }: HostControlViewProps): JSX.Element {
  const questions = useHostSessionStore((s) => s.questions)
  const currentQuestionIndex = useHostSessionStore((s) => s.currentQuestionIndex)
  const phase = useHostSessionStore((s) => s.phase)
  const deadline = useHostSessionStore((s) => s.deadline)
  const participants = useHostSessionStore((s) => s.participants)
  const answeredCount = useHostSessionStore((s) => s.answeredCount)
  const questionSeconds = useHostSessionStore((s) => s.questionSeconds)
  const revealedAnswers = useHostSessionStore((s) => s.revealedAnswers)
  const revealedAnswerText = useHostSessionStore((s) => s.revealedAnswerText)
  const leaderboard = useHostSessionStore((s) => s.leaderboard)
  const refreshAnsweredCount = useHostSessionStore((s) => s.refreshAnsweredCount)
  const refreshParticipants = useHostSessionStore((s) => s.refreshParticipants)
  const setQuestionSeconds = useHostSessionStore((s) => s.setQuestionSeconds)
  const revealResults = useHostSessionStore((s) => s.revealResults)
  const nextQuestion = useHostSessionStore((s) => s.nextQuestion)
  const endSession = useHostSessionStore((s) => s.endSession)

  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const revealedForIndexRef = useRef<number | null>(null)

  const send = useSessionChannel(sessionId, (event) => {
    if (event.type === 'answer_submitted') void refreshAnsweredCount()
    // Someone joining mid-game changes what "everyone has answered" means, so the auto-reveal
    // threshold below has to move with it.
    else if (event.type === 'participant_joined') void refreshParticipants()
  })

  const question = questions[currentQuestionIndex]
  const isLastQuestion = currentQuestionIndex === questions.length - 1
  const everyoneAnswered = participants.length > 0 && answeredCount >= participants.length

  async function handleReveal(): Promise<void> {
    if (revealedForIndexRef.current === currentQuestionIndex) return
    revealedForIndexRef.current = currentQuestionIndex
    try {
      await revealResults()
      const { revealedAnswerText: answerText } = useHostSessionStore.getState()
      send({ type: 'results_revealed', questionIndex: currentQuestionIndex, answerText: answerText ?? '' })
    } catch (err) {
      revealedForIndexRef.current = null
      setError(err instanceof Error ? err.message : 'Failed to reveal results')
    }
  }

  // The participant list is loaded by the lobby, but the host can land here on a reload (or after
  // hosting from elsewhere) with an empty one — and an empty list would disable the auto-reveal
  // entirely, since "everyone" of nobody is never satisfied.
  useEffect(() => {
    void refreshParticipants()
  }, [refreshParticipants])

  useEffect(() => {
    if (phase !== 'question' || !deadline) return
    const target = new Date(deadline).getTime()
    const tick = (): void => {
      const remaining = target - Date.now()
      setRemainingSeconds(Math.max(0, Math.ceil(remaining / 1000)))
      if (remaining <= 0) void handleReveal()
    }
    tick()
    const timer = setInterval(tick, 250)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, deadline, currentQuestionIndex])

  // Auto-reveal once the last participant is in. Deliberately separate from the countdown timer:
  // it's the same reveal, just triggered by the room rather than by the clock.
  useEffect(() => {
    if (phase !== 'question' || !everyoneAnswered) return
    const timer = setTimeout(() => void handleReveal(), AUTO_REVEAL_GRACE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, everyoneAnswered, currentQuestionIndex])

  function handleTimeChange(seconds: number): void {
    const newDeadline = setQuestionSeconds(seconds)
    // Null while a question isn't open (between questions) — the new limit still applies to the
    // next one, there's just nothing live to re-time and nothing for guests to hear about yet.
    if (newDeadline) send({ type: 'deadline_changed', questionIndex: currentQuestionIndex, deadline: newDeadline })
  }

  async function handleNext(): Promise<void> {
    try {
      await nextQuestion()
      const { currentQuestionIndex: idx, deadline: dl } = useHostSessionStore.getState()
      if (!dl) return
      send({ type: 'question_advanced', questionIndex: idx, deadline: dl })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to advance to the next question')
    }
  }

  async function handleEnd(): Promise<void> {
    try {
      await endSession()
      send({ type: 'session_ended' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to end the session')
    }
  }

  if (!question) return <p style={{ color: 'var(--fg-muted)' }}>No question loaded.</p>

  const progress = questions.length > 0 ? ((currentQuestionIndex + 1) / questions.length) * 100 : 0

  return (
    <div style={columnStyle}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
          <Eyebrow tinted>
            Question {currentQuestionIndex + 1} of {questions.length}
          </Eyebrow>
          <span style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)' }}>
            {participants.length} player{participants.length === 1 ? '' : 's'}
          </span>
        </div>
        <div style={progressTrackStyle}>
          <div style={{ ...progressFillStyle, width: `${progress}%` }} />
        </div>
      </div>

      {error && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', margin: 0 }}>{error}</p>}

      <div style={{ ...sessionCardStyle, width: '100%' }}>
        <QuestionText>{question.frontSnapshot}</QuestionText>
        {question.format === 'mcq' && question.mcqOptions ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {question.mcqOptions.map((opt, i) => (
              <div key={i} style={{ ...optionPillStyle, cursor: 'default' }}>
                <OptionLetter index={i} selected={false} />
                {opt}
              </div>
            ))}
          </div>
        ) : (
          <Eyebrow>Free-text answer</Eyebrow>
        )}
      </div>

      {phase === 'question' && (
        <div style={{ ...sessionCardStyle, width: '100%', gap: 'var(--space-4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
            <CountdownRing remaining={remainingSeconds} total={questionSeconds} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <AnsweredDots answered={answeredCount} total={participants.length} />
              {everyoneAnswered && (
                <p style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)', margin: '6px 0 0' }}>Revealing automatically…</p>
              )}
            </div>
            <button type="button" onClick={() => void handleReveal()} style={pillSecondaryStyle}>
              <Icon name="eye" size="0.95em" bare />Reveal now
            </button>
          </div>

          <TimeLimitPicker seconds={questionSeconds} onChange={handleTimeChange} hint="Applies to this question too" />
        </div>
      )}

      {phase === 'revealed' && (
        <div style={{ ...sessionCardStyle, width: '100%' }}>
          {revealedAnswerText && (
            <div style={answerBannerStyle}>
              <Eyebrow>Correct answer</Eyebrow>
              <p style={{ margin: 0, fontSize: 'var(--font-md)', fontWeight: 600 }}>{revealedAnswerText}</p>
            </div>
          )}

          <div>
            <Eyebrow>This question</Eyebrow>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 6 }}>
              {revealedAnswers.length === 0 ? (
                <p style={{ color: 'var(--fg-faint)', fontSize: 'var(--font-sm)', margin: 0 }}>Nobody answered this one.</p>
              ) : (
                revealedAnswers.map((a) => (
                  <div key={a.userId} style={breakdownRowStyle}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <Icon
                        name={a.isCorrect ? 'check-circle' : 'x-circle'}
                        bare
                        style={{ color: a.isCorrect ? 'var(--accent)' : 'var(--danger)' }}
                      />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.displayName}</span>
                    </span>
                    <span style={{ color: 'var(--fg-faint)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                      {a.pointsAwarded ?? 0} pts
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <Eyebrow>Leaderboard</Eyebrow>
            <div style={{ marginTop: 6 }}>
              <LeaderboardList entries={leaderboard} />
            </div>
          </div>

          <TimeLimitPicker seconds={questionSeconds} onChange={handleTimeChange} hint="For the next question" />

          {isLastQuestion ? (
            <button type="button" onClick={() => void handleEnd()} style={pillPrimaryStyle}>
              <Icon name="flag" size="0.95em" bare />End session
            </button>
          ) : (
            <button type="button" onClick={() => void handleNext()} style={pillPrimaryStyle}>
              Next question
              <Icon name="arrow-right" size="0.95em" bare />
            </button>
          )}
        </div>
      )}

      {phase === 'ended' && (
        <div style={{ ...sessionCardStyle, width: '100%', alignItems: 'center' }}>
          <Eyebrow tinted>
            <Icon name="flag" size="1em" />Session over
          </Eyebrow>
          <div style={{ width: '100%' }}>
            <LeaderboardList entries={leaderboard} podium />
          </div>
        </div>
      )}
    </div>
  )
}

const columnStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-4)',
  width: '100%',
  maxWidth: 620,
  margin: '0 auto'
}

const progressTrackStyle: CSSProperties = {
  height: 6,
  borderRadius: 'var(--radius-pill)',
  background: 'var(--border)',
  overflow: 'hidden'
}

const progressFillStyle: CSSProperties = {
  height: '100%',
  background: 'var(--accent)',
  borderRadius: 'var(--radius-pill)',
  transition: 'width 300ms cubic-bezier(0.22, 1, 0.36, 1)'
}

const answerBannerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: 'var(--space-3) var(--space-4)',
  borderRadius: 'var(--radius-row)',
  background: 'var(--accent-soft)',
  color: 'var(--accent)'
}

const breakdownRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-2)',
  fontSize: 'var(--font-sm)',
  padding: '5px 8px',
  borderRadius: 'var(--radius-row)'
}
