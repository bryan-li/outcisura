import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useHostSessionStore } from '../../state/hostSessionStore'
import { useSessionChannel } from '../../lib/liveSession/realtime'
import { LeaderboardList } from './LeaderboardList'

interface HostControlViewProps {
  sessionId: string
}

/** The host's live control panel — current question + countdown while `phase === 'question'`, then
 *  a per-participant correctness breakdown + leaderboard once revealed, then Next/End. The
 *  countdown auto-reveals on expiry (a local setTimeout keyed to the broadcast `deadline`); "Reveal
 *  now" lets the host close the window early. */
export function HostControlView({ sessionId }: HostControlViewProps): JSX.Element {
  const questions = useHostSessionStore((s) => s.questions)
  const currentQuestionIndex = useHostSessionStore((s) => s.currentQuestionIndex)
  const phase = useHostSessionStore((s) => s.phase)
  const deadline = useHostSessionStore((s) => s.deadline)
  const participants = useHostSessionStore((s) => s.participants)
  const answeredCount = useHostSessionStore((s) => s.answeredCount)
  const revealedAnswers = useHostSessionStore((s) => s.revealedAnswers)
  const revealedAnswerText = useHostSessionStore((s) => s.revealedAnswerText)
  const leaderboard = useHostSessionStore((s) => s.leaderboard)
  const refreshAnsweredCount = useHostSessionStore((s) => s.refreshAnsweredCount)
  const revealResults = useHostSessionStore((s) => s.revealResults)
  const nextQuestion = useHostSessionStore((s) => s.nextQuestion)
  const endSession = useHostSessionStore((s) => s.endSession)

  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const revealedForIndexRef = useRef<number | null>(null)

  const send = useSessionChannel(sessionId, (event) => {
    if (event.type === 'answer_submitted') void refreshAnsweredCount()
  })

  const question = questions[currentQuestionIndex]
  const isLastQuestion = currentQuestionIndex === questions.length - 1

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

  useEffect(() => {
    if (phase !== 'question' || !deadline) return
    const target = new Date(deadline).getTime()
    const timer = setInterval(() => {
      const remaining = target - Date.now()
      setRemainingSeconds(Math.max(0, Math.ceil(remaining / 1000)))
      if (remaining <= 0) void handleReveal()
    }, 250)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, deadline, currentQuestionIndex])

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: 640 }}>
      {error && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', margin: 0 }}>{error}</p>}

      <p style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)', margin: 0 }}>
        Question {currentQuestionIndex + 1} of {questions.length}
      </p>

      <div style={questionCardStyle}>
        <p style={{ fontSize: 'var(--font-lg)', fontWeight: 600, margin: 0 }}>{question.frontSnapshot}</p>
        {question.format === 'mcq' && question.mcqOptions ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {question.mcqOptions.map((opt, i) => (
              <div key={i} style={optionRowStyle}>
                {opt}
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 'var(--font-sm)', color: 'var(--fg-muted)', margin: 0 }}>Free-text answer</p>
        )}
      </div>

      {phase === 'question' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 'var(--font-sm)', color: 'var(--fg-muted)' }}>
            {answeredCount} / {participants.length || '?'} answered
          </span>
          <span style={{ fontSize: 'var(--font-xl)', fontWeight: 700, color: 'var(--accent)' }}>{remainingSeconds}s</span>
          <button type="button" onClick={() => void handleReveal()} style={secondaryButtonStyle}>
            ⏹ Reveal now
          </button>
        </div>
      )}

      {phase === 'revealed' && (
        <>
          {revealedAnswerText && (
            <p style={{ fontSize: 'var(--font-sm)', margin: 0 }}>
              <span style={{ color: 'var(--fg-faint)' }}>Correct answer: </span>
              <strong>{revealedAnswerText}</strong>
            </p>
          )}

          <div>
            <p style={{ fontSize: 'var(--font-xs)', fontWeight: 600, color: 'var(--fg-faint)', textTransform: 'uppercase', margin: '0 0 6px' }}>
              This question
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {revealedAnswers.map((a) => (
                <div key={a.userId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-sm)' }}>
                  <span>
                    {a.isCorrect ? '✅' : '❌'} {a.displayName}
                  </span>
                  <span style={{ color: 'var(--fg-muted)' }}>{a.pointsAwarded ?? 0} pts</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p style={{ fontSize: 'var(--font-xs)', fontWeight: 600, color: 'var(--fg-faint)', textTransform: 'uppercase', margin: '0 0 6px' }}>
              Leaderboard
            </p>
            <LeaderboardList entries={leaderboard} />
          </div>

          {isLastQuestion ? (
            <button type="button" onClick={() => void handleEnd()} style={primaryButtonStyle}>
              🏁 End session
            </button>
          ) : (
            <button type="button" onClick={() => void handleNext()} style={primaryButtonStyle}>
              Next question →
            </button>
          )}
        </>
      )}

      {phase === 'ended' && (
        <>
          <p style={{ fontSize: 'var(--font-lg)', fontWeight: 600, margin: 0 }}>🏁 Session over</p>
          <LeaderboardList entries={leaderboard} podium />
        </>
      )}
    </div>
  )
}

const questionCardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
  padding: 'var(--space-4)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)'
}

const optionRowStyle: CSSProperties = {
  fontSize: 'var(--font-sm)',
  padding: '6px 10px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)'
}

const primaryButtonStyle: CSSProperties = {
  border: '1px solid var(--accent)',
  background: 'var(--accent-soft)',
  color: 'var(--accent)',
  fontWeight: 600,
  borderRadius: 'var(--radius-sm)',
  padding: '10px 14px',
  cursor: 'pointer',
  fontSize: 'var(--font-md)'
}

const secondaryButtonStyle: CSSProperties = {
  border: '1px solid var(--border)',
  background: 'none',
  color: 'inherit',
  borderRadius: 'var(--radius-sm)',
  padding: '6px 10px',
  cursor: 'pointer',
  fontSize: 'var(--font-sm)'
}
