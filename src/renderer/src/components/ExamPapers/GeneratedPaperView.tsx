import { useEffect, useMemo, useState } from 'react'
import { useCardsStore } from '../../state/cardsStore'
import { useUiStore } from '../../state/uiStore'
import { Icon } from '../Icon'
import { EmptyHint, pageStyle, panelStyle, panelTitleStyle, secondaryPillStyle } from '../dashboardKit'
import type { GeneratedPaperRecord, GeneratedPaperQuestionRecord } from '../../../../shared/types'

interface GeneratedPaperViewProps {
  paperId: string
}

const FORMAT_LABEL: Record<GeneratedPaperQuestionRecord['format'], string> = {
  short_answer: 'Short answer',
  long_answer: 'Long answer',
  mcq: 'Multiple choice',
  essay: 'Essay'
}

/** Renders one generated paper: sections in order, each question with a reveal-on-demand model
 *  answer and a backlink to every source card it was drawn from (via uiStore's focusCard — the
 *  same jump-to-card mechanism the sidebar/search/graph already use). See GeneratePaperModal for
 *  how a paper gets created and repository.ts's getGeneratedPaper for the shape fetched here. */
export function GeneratedPaperView({ paperId }: GeneratedPaperViewProps): JSX.Element {
  const cards = useCardsStore((s) => s.cards)
  const focusCard = useUiStore((s) => s.focusCard)
  const setView = useUiStore((s) => s.setView)

  const [paper, setPaper] = useState<GeneratedPaperRecord | null | undefined>(undefined)
  const [revealed, setRevealed] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    setPaper(undefined)
    void window.api.generatedPapers.get(paperId).then((result) => {
      if (!cancelled) setPaper(result)
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

  function toggleReveal(id: string): void {
    setRevealed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
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
        <button onClick={() => setView({ type: 'exam-papers' })} style={secondaryPillStyle}>
          <Icon name="arrow-left" bare size={14} />Back
        </button>
      </div>

      {sections.map(([sectionIndex, section], sIdx) => (
        <div key={sectionIndex} className="home-rise" style={{ ...panelStyle, animationDelay: `${60 + sIdx * 60}ms` }}>
          <h2 style={panelTitleStyle}>{section.name}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {section.questions.map((q, qIdx) => (
              <QuestionRow
                key={q.id}
                question={q}
                index={qIdx}
                revealed={revealed.has(q.id)}
                onToggleReveal={() => toggleReveal(q.id)}
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

function QuestionRow({
  question,
  index,
  revealed,
  onToggleReveal,
  onJumpToCard,
  cardsById
}: {
  question: GeneratedPaperQuestionRecord
  index: number
  revealed: boolean
  onToggleReveal: () => void
  onJumpToCard: (cardId: string) => void
  cardsById: Map<string, { folderId: string | null }>
}): JSX.Element {
  const liveCardIds = question.cardIds.filter((id) => cardsById.has(id))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', padding: 'var(--space-3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-row)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', alignItems: 'baseline' }}>
        <strong style={{ fontSize: 'var(--font-sm)' }}>
          {index + 1}. {question.prompt}
        </strong>
        <span style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-muted)', flexShrink: 0 }}>
          {FORMAT_LABEL[question.format]}
          {question.marks !== null ? ` · ${question.marks} mark${question.marks === 1 ? '' : 's'}` : ''}
        </span>
      </div>

      {question.format === 'mcq' && question.mcqOptions && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {question.mcqOptions.map((opt, i) => {
            const isCorrect = revealed && i === question.mcqCorrectIndex
            return (
              <div
                key={i}
                style={{
                  fontSize: 'var(--font-sm)',
                  padding: '4px 8px',
                  borderRadius: 'var(--radius-sm)',
                  background: isCorrect ? 'var(--accent-soft)' : 'transparent',
                  color: isCorrect ? 'var(--accent)' : 'inherit',
                  fontWeight: isCorrect ? 600 : 400
                }}
              >
                {String.fromCharCode(65 + i)}. {opt}
                {isCorrect && <Icon name="check" bare size={12} />}
              </div>
            )
          })}
        </div>
      )}

      {revealed && question.format !== 'mcq' && (
        <p style={{ fontSize: 'var(--font-sm)', color: 'var(--fg-muted)', margin: 0, whiteSpace: 'pre-wrap' }}>{question.modelAnswer}</p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <button onClick={onToggleReveal} style={{ ...secondaryPillStyle, fontSize: 'var(--font-xs)', padding: '4px 10px' }}>
          <Icon name={revealed ? 'eye' : 'eye'} bare size={12} />
          {revealed ? 'Hide answer' : 'Show answer'}
        </button>
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
