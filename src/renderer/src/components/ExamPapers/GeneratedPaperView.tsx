import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useCardsStore } from '../../state/cardsStore'
import { useHostSessionStore } from '../../state/hostSessionStore'
import { useUiStore } from '../../state/uiStore'
import { supabaseErrorMessage } from '../../lib/supabaseError'
import { Icon } from '../Icon'
import { EmptyHint, pageStyle, panelStyle, panelTitleStyle, primaryPillStyle, secondaryPillStyle } from '../dashboardKit'
import type { GeneratedPaperAttemptSummary, GeneratedPaperAttemptRecord, GeneratedPaperRecord, GeneratedPaperQuestionRecord, PaperAttemptAnswer } from '../../../../shared/types'

interface GeneratedPaperViewProps {
  paperId: string
}

const FORMAT_LABEL: Record<GeneratedPaperQuestionRecord['format'], string> = {
  short_answer: 'Short answer',
  long_answer: 'Long answer',
  mcq: 'Multiple choice',
  essay: 'Essay'
}

type Mode = 'review' | 'result'

/** Renders one generated paper in one of two modes:
 *  - 'review' (default): browse questions with a reveal-on-demand model answer and source
 *    backlinks.
 *  - 'result': a past attempt, marked — mcq graded locally by index comparison, free-text answers
 *    graded by one AI call (aiService.markPaperAnswers) against each question's model answer.
 *
 *  Actually TAKING the paper is a separate, dedicated view (PaperAttemptSession.tsx) — mirrors the
 *  flashcard review queue's own architecture (a full-screen session, its own MainView entry with a
 *  `returnTo`) rather than answering inline here. "Take this paper"/"Retake" below just navigate
 *  there; this view's job is browsing the paper and its past attempts, not the taking itself.
 *
 *  "Host a session" hands the paper to the same live-session infrastructure regular card decks use
 *  (join code, lobby, speed-ranked scoring, leaderboard) — see createPaperSession.ts for why a
 *  generated paper needs no separate "prepare for hosting" step first, unlike a card folder. */
export function GeneratedPaperView({ paperId }: GeneratedPaperViewProps): JSX.Element {
  const cards = useCardsStore((s) => s.cards)
  const focusCard = useUiStore((s) => s.focusCard)
  const setView = useUiStore((s) => s.setView)
  const createAndHostFromPaper = useHostSessionStore((s) => s.createAndHostFromPaper)

  const [paper, setPaper] = useState<GeneratedPaperRecord | null | undefined>(undefined)
  const [revealed, setRevealed] = useState<Set<string>>(new Set())

  const [mode, setMode] = useState<Mode>('review')
  const [activeAttempt, setActiveAttempt] = useState<GeneratedPaperAttemptRecord | null>(null)
  const [pastAttempts, setPastAttempts] = useState<GeneratedPaperAttemptSummary[]>([])
  const [hostBusy, setHostBusy] = useState(false)
  const [hostError, setHostError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setPaper(undefined)
    void window.api.generatedPapers.get(paperId).then((result) => {
      if (!cancelled) setPaper(result)
    })
    void window.api.generatedPaperAttempts.listForPaper(paperId).then((result) => {
      if (!cancelled) setPastAttempts(result)
    })
    return () => {
      cancelled = true
    }
  }, [paperId])

  const cardsById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])

  const sections = useMemo(() => {
    if (!paper) return []
    const bySection = new Map<number, { name: string; questions: GeneratedPaperQuestionRecord[] }>()
    for (const q of paper.questions) {
      const entry = bySection.get(q.sectionIndex) ?? { name: q.sectionName, questions: [] }
      entry.questions.push(q)
      bySection.set(q.sectionIndex, entry)
    }
    return [...bySection.entries()].sort(([a], [b]) => a - b)
  }, [paper])

  const answersByQuestionId = useMemo(
    () => (activeAttempt ? new Map(activeAttempt.answers.map((a) => [a.questionId, a])) : null),
    [activeAttempt]
  )

  function toggleReveal(id: string): void {
    setRevealed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function takeThisPaper(): void {
    setView({ type: 'paper-attempt', paperId, returnTo: { type: 'exam-paper', paperId } })
  }

  async function handleHostSession(): Promise<void> {
    if (!paper) return
    setHostBusy(true)
    setHostError(null)
    try {
      await createAndHostFromPaper(paper)
      const { sessionId } = useHostSessionStore.getState()
      if (sessionId) setView({ type: 'host-lobby', sessionId })
    } catch (err) {
      setHostError(supabaseErrorMessage(err, 'Failed to start a session with this paper'))
    } finally {
      setHostBusy(false)
    }
  }

  function backToPaper(): void {
    setActiveAttempt(null)
    setMode('review')
  }

  function viewAttempt(id: string): void {
    void window.api.generatedPaperAttempts.get(id).then((result) => {
      if (result) {
        setActiveAttempt(result)
        setMode('result')
      }
    })
  }

  async function deleteAttempt(id: string): Promise<void> {
    await window.api.generatedPaperAttempts.delete(id)
    setPastAttempts((prev) => prev.filter((a) => a.id !== id))
    if (activeAttempt?.id === id) {
      setActiveAttempt(null)
      setMode('review')
    }
  }

  if (paper === undefined) {
    return (
      <div style={pageStyle}>
        <p style={{ color: 'var(--fg-muted)' }}>Loading…</p>
      </div>
    )
  }

  if (paper === null) {
    return (
      <div style={pageStyle}>
        <EmptyHint text="This paper no longer exists." />
        <button onClick={() => setView({ type: 'exam-papers' })} style={{ ...secondaryPillStyle, alignSelf: 'flex-start' }}>
          <Icon name="arrow-left" bare size={14} />Back to exam papers
        </button>
      </div>
    )
  }

  return (
    <div style={pageStyle}>
      <div className="home-rise" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 'var(--font-xxl)', margin: 0, letterSpacing: '-0.02em' }}>{paper.name}</h1>
          <p style={{ color: 'var(--fg-muted)', margin: 'var(--space-1) 0 0', fontSize: 'var(--font-md)' }}>
            From {paper.templateNameSnapshot} · {paper.folderNamesSnapshot.join(', ')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {mode === 'review' && (
            <>
              <button onClick={takeThisPaper} style={primaryPillStyle}>
                <Icon name="check-circle" bare size={14} />Take this paper
              </button>
              <button onClick={() => void handleHostSession()} disabled={hostBusy} style={secondaryPillStyle}>
                <Icon name="mic" bare size={14} />
                {hostBusy ? 'Starting…' : 'Host a session'}
              </button>
            </>
          )}
          {mode === 'result' && (
            <>
              <button onClick={backToPaper} style={secondaryPillStyle}>
                Back to paper
              </button>
              <button onClick={takeThisPaper} style={primaryPillStyle}>
                <Icon name="refresh" bare size={14} />Retake
              </button>
            </>
          )}
          <button onClick={() => setView({ type: 'exam-papers' })} style={secondaryPillStyle}>
            <Icon name="arrow-left" bare size={14} />Back
          </button>
        </div>
      </div>

      {hostError && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', margin: 0 }}>{hostError}</p>}

      {mode === 'result' && activeAttempt && <ScoreBanner attempt={activeAttempt} />}

      {mode === 'review' && pastAttempts.length > 0 && (
        <div className="home-rise" style={{ ...panelStyle, animationDelay: '30ms' }}>
          <h2 style={panelTitleStyle}>Past attempts</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {pastAttempts.map((a) => (
              <div key={a.id} style={attemptRowStyle}>
                <button onClick={() => viewAttempt(a.id)} style={attemptRowButtonStyle}>
                  {new Date(a.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                </button>
                <span style={{ fontSize: 'var(--font-sm)', color: 'var(--fg-muted)', flexShrink: 0 }}>
                  {a.marksAwarded}/{a.marksPossible} ({a.marksPossible > 0 ? Math.round((a.marksAwarded / a.marksPossible) * 100) : 0}%)
                </span>
                <button onClick={() => void deleteAttempt(a.id)} title="Delete attempt" style={iconOnlyButtonStyle}>
                  <Icon name="trash" bare size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {sections.map(([sectionIndex, section], sIdx) => (
        <div key={sectionIndex} className="home-rise" style={{ ...panelStyle, animationDelay: `${60 + sIdx * 60}ms` }}>
          <h2 style={panelTitleStyle}>{section.name}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {section.questions.map((q, qIdx) => (
              <QuestionRow
                key={q.id}
                question={q}
                index={qIdx}
                mode={mode}
                revealed={revealed.has(q.id)}
                onToggleReveal={() => toggleReveal(q.id)}
                marked={mode === 'result' ? (answersByQuestionId?.get(q.id) ?? null) : null}
                onJumpToCard={(cardId) => {
                  const card = cardsById.get(cardId)
                  if (card) focusCard(card.id, card.folderId)
                }}
                cardsById={cardsById}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function ScoreBanner({ attempt }: { attempt: GeneratedPaperAttemptRecord }): JSX.Element {
  const pct = attempt.marksPossible > 0 ? Math.round((attempt.marksAwarded / attempt.marksPossible) * 100) : 0
  const color = pct >= 70 ? 'var(--success, #2fa86a)' : pct >= 40 ? 'var(--accent)' : 'var(--danger)'
  return (
    <div className="home-rise" style={{ ...panelStyle, animationDelay: '0ms', display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)' }}>
      <span style={{ fontSize: 'var(--font-xxl)', fontWeight: 700, color, letterSpacing: '-0.02em' }}>
        {attempt.marksAwarded}/{attempt.marksPossible}
      </span>
      <span style={{ fontSize: 'var(--font-md)', color: 'var(--fg-muted)' }}>{pct}% · {new Date(attempt.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
    </div>
  )
}

function QuestionRow({
  question,
  index,
  mode,
  revealed,
  onToggleReveal,
  marked,
  onJumpToCard,
  cardsById
}: {
  question: GeneratedPaperQuestionRecord
  index: number
  mode: Mode
  revealed: boolean
  onToggleReveal: () => void
  marked: PaperAttemptAnswer | null
  onJumpToCard: (cardId: string) => void
  cardsById: Map<string, { folderId: string | null }>
}): JSX.Element {
  const liveCardIds = question.cardIds.filter((id) => cardsById.has(id))
  const showModelAnswer = mode === 'review' ? revealed : true

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', padding: 'var(--space-3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-row)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', alignItems: 'baseline' }}>
        <strong style={{ fontSize: 'var(--font-sm)' }}>
          {index + 1}. {question.prompt}
        </strong>
        <span style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-muted)', flexShrink: 0 }}>
          {FORMAT_LABEL[question.format]}
          {question.marks !== null ? ` · ${question.marks} mark${question.marks === 1 ? '' : 's'}` : ''}
          {marked && (
            <strong style={{ marginLeft: 6, color: marked.marksAwarded >= marked.marksPossible ? 'var(--success, #2fa86a)' : marked.marksAwarded > 0 ? 'var(--accent)' : 'var(--danger)' }}>
              · {marked.marksAwarded}/{marked.marksPossible}
            </strong>
          )}
        </span>
      </div>

      {question.format === 'mcq' && question.mcqOptions && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {question.mcqOptions.map((opt, i) => {
            const isCorrect = showModelAnswer && i === question.mcqCorrectIndex
            const isYourWrongPick = mode === 'result' && marked?.selectedMcqIndex === i && i !== question.mcqCorrectIndex
            return (
              <div
                key={i}
                style={{
                  ...mcqOptionStyle,
                  background: isCorrect ? 'var(--accent-soft)' : isYourWrongPick ? 'var(--danger-soft, #e5484d29)' : 'transparent',
                  color: isCorrect ? 'var(--accent)' : isYourWrongPick ? 'var(--danger)' : 'inherit',
                  fontWeight: isCorrect || isYourWrongPick ? 600 : 400
                }}
              >
                {String.fromCharCode(65 + i)}. {opt}
                {isCorrect && <Icon name="check" bare size={12} />}
                {isYourWrongPick && <Icon name="x" bare size={12} />}
                {mode === 'result' && (isCorrect || isYourWrongPick) && (
                  <span style={{ fontSize: 'var(--font-xs)', marginLeft: 6, fontWeight: 400 }}>{isCorrect ? '(correct)' : '(your answer)'}</span>
                )}
              </div>
            )
          })}
          {mode === 'result' && marked?.selectedMcqIndex === null && <p style={{ ...mutedTextStyle, fontStyle: 'italic' }}>You left this blank.</p>}
        </div>
      )}

      {question.format !== 'mcq' && mode === 'result' && marked && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <p style={mutedTextStyle}>
            <strong>Your answer: </strong>
            {marked.answerText ? marked.answerText : <em>left blank</em>}
          </p>
          {marked.feedback && <p style={mutedTextStyle}>{marked.feedback}</p>}
        </div>
      )}

      {showModelAnswer && question.format !== 'mcq' && (
        <p style={{ ...mutedTextStyle, whiteSpace: 'pre-wrap' }}>
          {mode === 'result' && <strong>Model answer: </strong>}
          {question.modelAnswer}
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        {mode === 'review' && (
          <button onClick={onToggleReveal} style={{ ...secondaryPillStyle, fontSize: 'var(--font-xs)', padding: '4px 10px' }}>
            <Icon name="eye" bare size={12} />
            {revealed ? 'Hide answer' : 'Show answer'}
          </button>
        )}
        {liveCardIds.map((cardId) => (
          <button
            key={cardId}
            onClick={() => onJumpToCard(cardId)}
            title="Jump to source flashcard"
            style={{ ...secondaryPillStyle, fontSize: 'var(--font-xs)', padding: '4px 10px' }}
          >
            <Icon name="link" bare size={12} />Source
          </button>
        ))}
      </div>
    </div>
  )
}

const mcqOptionStyle: CSSProperties = {
  fontSize: 'var(--font-sm)',
  padding: '4px 8px',
  borderRadius: 'var(--radius-sm)',
  border: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontFamily: 'inherit'
}

const mutedTextStyle: CSSProperties = { fontSize: 'var(--font-sm)', color: 'var(--fg-muted)', margin: 0 }

const attemptRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '4px 8px' }

const attemptRowButtonStyle: CSSProperties = { border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', padding: 0, fontSize: 'var(--font-sm)', flex: 1, textAlign: 'left' }

const iconOnlyButtonStyle: CSSProperties = {
  border: 'none',
  background: 'none',
  color: 'var(--fg-faint)',
  cursor: 'pointer',
  padding: 4,
  display: 'inline-flex',
  flexShrink: 0
}
