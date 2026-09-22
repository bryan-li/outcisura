import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useUiStore, type MainView } from '../../state/uiStore'
import { supabaseErrorMessage } from '../../lib/supabaseError'
import { Icon } from '../Icon'
import { GenerationProgressBar } from './GenerationProgressBar'
import type { GeneratedPaperRecord, GeneratedPaperQuestionRecord, PaperAttemptAnswer } from '../../../../shared/types'

interface PaperAttemptSessionProps {
  paperId: string
  returnTo: MainView
}

interface InProgressAnswer {
  selectedMcqIndex: number | null
  answerText: string
}

type Phase = 'loading' | 'not-found' | 'answering' | 'marking' | 'done'

/** Taking a generated paper, one question at a time — mirrors ReviewSession.tsx's own queue
 *  architecture (a dedicated full-screen session view with its own MainView entry and `returnTo`,
 *  a centered progress bar + card, Esc to exit) and LiveSessionPlayer.tsx's per-question answer
 *  capture (mcq option buttons / a free-text textarea), rather than answering inline on the
 *  paper's own browsing page (GeneratedPaperView). Unlike a review session's forward-only queue,
 *  answering an exam question has no side effect until the whole thing is submitted, so this just
 *  lets you move Previous/Next freely and change an answer any time before finishing.
 *
 *  Finishing marks the whole attempt in one go — mcq locally by index comparison, free-text via
 *  one AI call (aiService.markPaperAnswers) — and persists it (generatedPaperAttempts.create)
 *  before landing on a small score screen and returning to `returnTo` (GeneratedPaperView, where
 *  the new attempt is now the top of "Past attempts"). */
export function PaperAttemptSession({ paperId, returnTo }: PaperAttemptSessionProps): JSX.Element {
  const setView = useUiStore((s) => s.setView)

  const [paper, setPaper] = useState<GeneratedPaperRecord | null | undefined>(undefined)
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, InProgressAnswer>>({})
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ marksAwarded: number; marksPossible: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.generatedPapers.get(paperId).then((p) => {
      if (cancelled) return
      setPaper(p)
      setPhase(p ? 'answering' : 'not-found')
    })
    return () => {
      cancelled = true
    }
  }, [paperId])

  const questions = useMemo(
    () => (paper ? [...paper.questions].sort((a, b) => a.sectionIndex - b.sectionIndex || a.questionIndex - b.questionIndex) : []),
    [paper]
  )

  const question = questions[index]
  const answer: InProgressAnswer = question ? (answers[question.id] ?? { selectedMcqIndex: null, answerText: '' }) : { selectedMcqIndex: null, answerText: '' }

  function updateAnswer(next: InProgressAnswer): void {
    if (!question) return
    setAnswers((prev) => ({ ...prev, [question.id]: next }))
  }

  function exit(): void {
    if (phase === 'answering' && Object.keys(answers).length > 0) {
      if (!window.confirm('Leave without finishing? Your answers so far will be lost.')) return
    }
    setView(returnTo)
  }

  async function handleFinish(): Promise<void> {
    if (!paper) return
    setPhase('marking')
    setError(null)
    try {
      const resultsByQuestionId = new Map<string, PaperAttemptAnswer>()
      const toMark: { ref: number; questionId: string; text: string; q: GeneratedPaperQuestionRecord }[] = []
      let nextRef = 1

      for (const q of paper.questions) {
        const marksPossible = q.marks ?? 1
        const a = answers[q.id]
        if (q.format === 'mcq') {
          const selected = a?.selectedMcqIndex ?? null
          const correct = selected !== null && selected === q.mcqCorrectIndex
          resultsByQuestionId.set(q.id, {
            questionId: q.id,
            selectedMcqIndex: selected,
            answerText: null,
            marksAwarded: correct ? marksPossible : 0,
            marksPossible,
            feedback: null
          })
        } else {
          const text = (a?.answerText ?? '').trim()
          if (!text) {
            resultsByQuestionId.set(q.id, {
              questionId: q.id,
              selectedMcqIndex: null,
              answerText: '',
              marksAwarded: 0,
              marksPossible,
              feedback: 'No answer provided.'
            })
          } else {
            toMark.push({ ref: nextRef, questionId: q.id, text, q })
            nextRef++
          }
        }
      }

      if (toMark.length > 0) {
        const markResult = await window.api.ai.markPaperAnswers({
          items: toMark.map((t) => ({ ref: t.ref, prompt: t.q.prompt, format: t.q.format, marks: t.q.marks ?? 1, modelAnswer: t.q.modelAnswer, studentAnswer: t.text }))
        })
        const byRef = new Map(markResult.marked.map((m) => [m.ref, m]))
        for (const t of toMark) {
          const m = byRef.get(t.ref)
          resultsByQuestionId.set(t.questionId, {
            questionId: t.questionId,
            selectedMcqIndex: null,
            answerText: t.text,
            marksAwarded: m?.marksAwarded ?? 0,
            marksPossible: t.q.marks ?? 1,
            feedback: m?.feedback ?? 'Could not be marked automatically — review it yourself against the model answer.'
          })
        }
      }

      const finalAnswers = paper.questions.map((q) => resultsByQuestionId.get(q.id)!)
      const marksAwarded = finalAnswers.reduce((sum, a) => sum + a.marksAwarded, 0)
      const marksPossible = finalAnswers.reduce((sum, a) => sum + a.marksPossible, 0)

      await window.api.generatedPaperAttempts.create({ paperId: paper.id, marksAwarded, marksPossible, answers: finalAnswers })
      setResult({ marksAwarded, marksPossible })
      setPhase('done')
    } catch (err) {
      setError(supabaseErrorMessage(err, 'Failed to mark the paper'))
      setPhase('answering')
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') exit()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, answers])

  if (phase === 'loading') {
    return (
      <div style={containerStyle}>
        <p style={{ color: 'var(--fg-muted)' }}>Loading…</p>
      </div>
    )
  }

  if (phase === 'not-found' || !paper) {
    return (
      <div style={containerStyle}>
        <p style={{ color: 'var(--fg-muted)' }}>This paper no longer exists.</p>
        <button onClick={() => setView(returnTo)}>Back</button>
      </div>
    )
  }

  if (phase === 'done' && result) {
    const pct = result.marksPossible > 0 ? Math.round((result.marksAwarded / result.marksPossible) * 100) : 0
    const color = pct >= 70 ? 'var(--success, #2fa86a)' : pct >= 40 ? 'var(--accent)' : 'var(--danger)'
    return (
      <div style={containerStyle}>
        <div style={{ textAlign: 'center', animation: 'scale-in 200ms ease' }}>
          <div style={{ fontSize: 'var(--font-xxl)' }}>
            <Icon name="sparkles" bare size="1.2em" />
          </div>
          <h1 style={{ fontSize: 'var(--font-xl)', margin: 'var(--space-3) 0' }}>Marked!</h1>
          <p style={{ fontSize: 'var(--font-xxl)', fontWeight: 700, color, margin: '0 0 var(--space-2)' }}>
            {result.marksAwarded}/{result.marksPossible}
          </p>
          <p style={{ color: 'var(--fg-muted)' }}>{pct}%</p>
          <button onClick={() => setView(returnTo)} style={{ marginTop: 'var(--space-4)' }}>
            Done
          </button>
        </div>
      </div>
    )
  }

  if (!question) {
    return (
      <div style={containerStyle}>
        <p style={{ color: 'var(--fg-muted)' }}>This paper has no questions.</p>
        <button onClick={() => setView(returnTo)}>Back</button>
      </div>
    )
  }

  const percent = Math.round((index / questions.length) * 100)
  const marking = phase === 'marking'
  const isLast = index === questions.length - 1

  return (
    <div style={containerStyle}>
      <div style={{ width: '100%', maxWidth: 560 }}>
        <div style={topBarStyle}>
          <span style={{ fontSize: 'var(--font-sm)', color: 'var(--fg-muted)' }}>{paper.name}</span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 'var(--font-sm)', color: 'var(--fg-muted)' }}>
            {index + 1} / {questions.length}
          </span>
          <button onClick={exit} title="Exit (Esc)" style={smallIconButton}>
            <Icon name="x" bare size="1.2em" />
          </button>
        </div>
        <div style={progressTrackStyle}>
          <div style={{ ...progressFillStyle, width: `${percent}%` }} />
        </div>

        {/* Keyed by question id — moving to a genuinely different question replays the entrance
            animation; changing an already-selected answer in place shouldn't re-trigger it. */}
        <div key={question.id} style={cardStyle}>
          <span style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.02em' }}>
            {question.sectionName}
            {question.marks !== null ? ` · ${question.marks} mark${question.marks === 1 ? '' : 's'}` : ''}
          </span>
          <p style={{ fontSize: 'var(--font-lg)', fontWeight: 600, margin: 'var(--space-2) 0 0' }}>{question.prompt}</p>

          {question.format === 'mcq' && question.mcqOptions ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 'var(--space-4)' }}>
              {question.mcqOptions.map((opt, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => updateAnswer({ ...answer, selectedMcqIndex: i })}
                  disabled={marking}
                  style={{ ...optionButtonStyle, ...(answer.selectedMcqIndex === i ? optionButtonSelectedStyle : {}) }}
                >
                  {String.fromCharCode(65 + i)}. {opt}
                </button>
              ))}
            </div>
          ) : (
            <textarea
              value={answer.answerText}
              onChange={(e) => updateAnswer({ ...answer, answerText: e.target.value })}
              disabled={marking}
              placeholder="Write your answer…"
              rows={6}
              style={{ ...textareaStyle, marginTop: 'var(--space-4)' }}
            />
          )}
        </div>

        {marking && (
          <div style={{ marginTop: 'var(--space-4)' }}>
            <GenerationProgressBar label="Marking your paper…" />
          </div>
        )}
        {error && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)' }}>{error}</p>}

        <div style={footerRowStyle}>
          <button disabled={index === 0 || marking} onClick={() => setIndex((i) => i - 1)} style={smallTextButton}>
            <Icon name="arrow-left" size="1em" />Previous
          </button>
          {isLast ? (
            <button disabled={marking} onClick={() => void handleFinish()} style={primaryButtonStyle}>
              {marking ? 'Marking…' : 'Finish & mark'}
            </button>
          ) : (
            <button disabled={marking} onClick={() => setIndex((i) => i + 1)} style={primaryButtonStyle}>
              Next<Icon name="arrow-right" size="1em" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const containerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '100%',
  padding: 'var(--space-6)'
}

const topBarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  marginBottom: 'var(--space-2)'
}

const progressTrackStyle: CSSProperties = {
  height: 4,
  borderRadius: 999,
  background: 'var(--border)',
  overflow: 'hidden',
  marginBottom: 'var(--space-5)'
}

const progressFillStyle: CSSProperties = {
  height: '100%',
  background: 'var(--accent)',
  borderRadius: 999,
  transition: 'width 150ms ease'
}

const cardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  padding: 'var(--space-6)',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: '0 1px 3px #0000001a, 0 8px 24px #00000014',
  animation: 'pop-in 200ms ease'
}

const optionButtonStyle: CSSProperties = {
  textAlign: 'left',
  fontSize: 'var(--font-sm)',
  padding: '10px 12px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg)',
  color: 'inherit',
  cursor: 'pointer',
  fontFamily: 'inherit'
}

const optionButtonSelectedStyle: CSSProperties = {
  border: '1px solid var(--accent)',
  background: 'var(--accent-soft)',
  color: 'var(--accent)',
  fontWeight: 600
}

const textareaStyle: CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 'var(--font-sm)',
  padding: '10px 12px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg)',
  color: 'inherit',
  resize: 'vertical'
}

const footerRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginTop: 'var(--space-4)'
}

const smallIconButton: CSSProperties = {
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  fontSize: 12,
  padding: '2px 4px',
  color: 'inherit'
}

const smallTextButton: CSSProperties = {
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  color: 'inherit',
  fontSize: 'var(--font-sm)',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '6px 4px'
}

const primaryButtonStyle: CSSProperties = {
  border: '1px solid var(--accent)',
  background: 'var(--accent-soft)',
  color: 'var(--accent)',
  fontWeight: 600,
  borderRadius: 'var(--radius-sm)',
  padding: '10px 16px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 4
}
