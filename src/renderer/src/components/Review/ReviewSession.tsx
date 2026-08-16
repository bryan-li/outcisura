import { useEffect, useState, type CSSProperties } from 'react'
import type { BBox, CardRecord, SrsSnapshot } from '../../../../shared/types'
import { nextSrsState, formatInterval, type ReviewGrade } from '../../../../shared/srs'
import { useCardsStore } from '../../state/cardsStore'
import { useFoldersStore } from '../../state/foldersStore'
import { useUiStore, type MainView, type ReviewScope } from '../../state/uiStore'
import { allCardsInScope, dueCards, requeueAfterAgain } from '../../utils/srsQueue'
import { backTextToLines } from '../../utils/blockCard'
import { firstImageSourcePath, maskBBoxesFor, hasFaceTaggedImages, imageSourcesForFace } from '../../utils/occlusion'
import { parseCloze } from '../../utils/cloze'
import { OcclusionImage } from '../CardBrowser/OcclusionImage'

interface ReviewSessionProps {
  scope: ReviewScope
  returnTo: MainView
  /** Skip the due-date filter entirely — every card in scope, regardless of schedule. */
  force?: boolean
}

const GRADES: { grade: ReviewGrade; label: string; key: string; color: string }[] = [
  { grade: 'again', label: 'Again', key: '1', color: 'var(--danger)' },
  { grade: 'hard', label: 'Hard', key: '2', color: '#ff9500' },
  { grade: 'good', label: 'Good', key: '3', color: 'var(--accent)' },
  { grade: 'easy', label: 'Easy', key: '4', color: '#34c759' }
]

function srsSnapshotOf(card: CardRecord): SrsSnapshot {
  return {
    dueAt: card.dueAt,
    intervalDays: card.intervalDays,
    easeFactor: card.easeFactor,
    repetitions: card.repetitions,
    lapses: card.lapses,
    lastReviewedAt: card.lastReviewedAt
  }
}

interface LastGrade {
  /** The full pre-grade card — restoring undo needs its old SRS fields *and* a real object to
   *  splice back into the queue, not just the SRS snapshot. */
  card: CardRecord
  grade: ReviewGrade
  /** Queue position the graded duplicate landed at, or null for a normal (non-"again") advance. */
  requeuedAt: number | null
  /** Queue position the card was at before grading — where undo puts it back. */
  index: number
}

export function ReviewSession({ scope, returnTo, force = false }: ReviewSessionProps): JSX.Element {
  const cards = useCardsStore((s) => s.cards)
  const folders = useFoldersStore((s) => s.folders)
  const setView = useUiStore((s) => s.setView)
  const gradeCard = useCardsStore((s) => s.gradeCard)
  const restoreCardSrs = useCardsStore((s) => s.restoreCardSrs)

  const [queue, setQueue] = useState<CardRecord[]>(() => (force ? allCardsInScope(cards, scope) : dueCards(cards, scope, new Date())))
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [counts, setCounts] = useState<Record<ReviewGrade, number>>({ again: 0, hard: 0, good: 0, easy: 0 })
  const [lastGrade, setLastGrade] = useState<LastGrade | null>(null)
  const [grading, setGrading] = useState(false)

  const folder = scope.kind === 'folder' ? folders.find((f) => f.id === scope.folderId) : null
  const card = queue[index]
  const done = index >= queue.length

  function exit(): void {
    setView(returnTo)
  }

  async function handleGrade(grade: ReviewGrade): Promise<void> {
    if (!card || grading) return
    setGrading(true)
    try {
      const previousCard = card
      const graded = await gradeCard(card.id, grade)

      if (grade === 'again') {
        const { queue: nextQueue, nextIndex } = requeueAfterAgain(queue, index, graded, 3)
        const requeuedAt = Math.min(index + 3, queue.length - 1)
        setQueue(nextQueue)
        setIndex(nextIndex)
        setLastGrade({ card: previousCard, grade, requeuedAt, index })
      } else {
        const nextQueue = [...queue]
        nextQueue[index] = graded
        setQueue(nextQueue)
        setIndex(index + 1)
        setLastGrade({ card: previousCard, grade, requeuedAt: null, index })
      }

      setCounts((c) => ({ ...c, [grade]: c[grade] + 1 }))
      setRevealed(false)
    } finally {
      setGrading(false)
    }
  }

  /** Moves the current card to the end of the queue without grading it — no gradeCard call, so
   *  its SRS fields (and dueAt) are untouched and it's still due whenever this session ends. Pushed
   *  to the end (not just skipped over) rather than dropped from the session entirely, so it's
   *  still reachable again before this review is done — except when it's already the last card,
   *  where "push to the end" would just put it right back at the same spot; there, skipping simply
   *  ends the session instead of looping on it forever. */
  function handleSkip(): void {
    if (!card || grading) return
    if (index === queue.length - 1) {
      setIndex(index + 1)
    } else {
      setQueue([...queue.slice(0, index), ...queue.slice(index + 1), card])
    }
    setRevealed(false)
  }

  async function handleUndo(): Promise<void> {
    if (!lastGrade || grading) return
    setGrading(true)
    try {
      const { card: previousCard, requeuedAt, index: priorIndex, grade } = lastGrade
      await restoreCardSrs(previousCard.id, srsSnapshotOf(previousCard))
      setQueue((q) => {
        if (requeuedAt === null) {
          const next = [...q]
          next[priorIndex] = previousCard
          return next
        }
        const withoutRequeued = [...q.slice(0, requeuedAt), ...q.slice(requeuedAt + 1)]
        return [...withoutRequeued.slice(0, priorIndex), previousCard, ...withoutRequeued.slice(priorIndex)]
      })
      setIndex(priorIndex)
      setCounts((c) => ({ ...c, [grade]: Math.max(0, c[grade] - 1) }))
      setLastGrade(null)
      setRevealed(true)
    } finally {
      setGrading(false)
    }
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        exit()
        return
      }
      // Undo has to work even once the queue is exhausted (completion screen, card undefined) —
      // fixing your last grade is often exactly when you've just noticed the mistake.
      if (e.key === 'u' || e.key === 'U') {
        void handleUndo()
        return
      }
      if (!card) return
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault()
        handleSkip()
        return
      }
      if ((e.key === ' ' || e.key === 'Enter') && !revealed) {
        e.preventDefault()
        setRevealed(true)
        return
      }
      if (revealed) {
        const match = GRADES.find((g) => g.key === e.key)
        if (match) {
          e.preventDefault()
          void handleGrade(match.grade)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, revealed, grading, lastGrade, queue, index])

  if (scope.kind === 'folder' && !folder) {
    return (
      <div style={containerStyle}>
        <p style={{ color: 'var(--fg-muted)' }}>That folder doesn't exist anymore.</p>
        <button onClick={exit}>Back</button>
      </div>
    )
  }

  const scopeLabel =
    scope.kind === 'folder'
      ? folder!.name
      : scope.kind === 'folders'
        ? scope.folderIds.length <= 3
          ? scope.folderIds.map((id) => folders.find((f) => f.id === id)?.name ?? 'Unknown folder').join(', ')
          : `${scope.folderIds.length} folders`
        : null

  const title = force
    ? `🔥 Cram: ${scopeLabel ?? 'all cards'} (ignoring schedule)`
    : scopeLabel
      ? `Reviewing: ${scopeLabel}`
      : 'Reviewing all due cards'

  if (queue.length === 0) {
    return (
      <div style={containerStyle}>
        <div style={{ textAlign: 'center', animation: 'scale-in 200ms ease' }}>
          <div style={{ fontSize: 'var(--font-xxl)' }}>{force ? '📭' : '🎉'}</div>
          <h1 style={{ fontSize: 'var(--font-xl)', margin: 'var(--space-3) 0' }}>
            {force ? 'No cards here yet' : 'Nothing due right now'}
          </h1>
          <p style={{ color: 'var(--fg-muted)' }}>
            {force ? "This selection doesn't have any cards to cram." : 'Nothing in this queue needs reviewing yet.'}
          </p>
          <button onClick={exit} style={{ marginTop: 'var(--space-4)' }}>
            Back
          </button>
        </div>
      </div>
    )
  }

  if (done) {
    const total = counts.again + counts.hard + counts.good + counts.easy
    return (
      <div style={containerStyle}>
        <div style={{ textAlign: 'center', animation: 'scale-in 200ms ease' }}>
          <div style={{ fontSize: 'var(--font-xxl)' }}>🎉</div>
          <h1 style={{ fontSize: 'var(--font-xl)', margin: 'var(--space-3) 0' }}>All caught up!</h1>
          <p style={{ color: 'var(--fg-muted)' }}>
            {total} reviewed · {counts.again} again · {counts.hard} hard · {counts.good} good · {counts.easy} easy
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'center', marginTop: 'var(--space-4)' }}>
            <button disabled={!lastGrade || grading} onClick={handleUndo} title="Undo the last grade (U)">
              ↩ Undo last grade
            </button>
            <button onClick={exit}>Done</button>
          </div>
        </div>
      </div>
    )
  }

  const percent = Math.round((index / queue.length) * 100)

  return (
    <div style={containerStyle}>
      <div style={{ width: '100%', maxWidth: 560 }}>
        <div style={topBarStyle}>
          <span style={{ fontSize: 'var(--font-sm)', color: 'var(--fg-muted)' }}>{title}</span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 'var(--font-sm)', color: 'var(--fg-muted)' }}>
            {index + 1} / {queue.length}
          </span>
          <button onClick={exit} title="Exit (Esc)" style={{ ...smallIconButton }}>
            ✕
          </button>
        </div>
        <div style={progressTrackStyle}>
          <div style={{ ...progressFillStyle, width: `${percent}%` }} />
        </div>

        {/* Keyed by card id, not just position — advancing to a genuinely different card should
            remount and replay the entrance animation; grading in place (undo restoring the same
            card) shouldn't re-trigger it. */}
        <CardFace key={card.id} card={card} revealed={revealed} onReveal={() => setRevealed(true)} />

        {revealed && (
          <div style={gradeRowStyle}>
            {GRADES.map(({ grade, label, key, color }) => (
              <button
                key={grade}
                disabled={grading}
                className="hover-lift"
                onClick={() => handleGrade(grade)}
                style={{ ...gradeButtonStyle, borderColor: color, color }}
              >
                <span style={{ fontWeight: 600 }}>{label}</span>
                <span style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)' }}>
                  {key} · {formatInterval(nextSrsState(card, grade).intervalDays)}
                </span>
              </button>
            ))}
          </div>
        )}

        <div style={footerRowStyle}>
          <span>{revealed ? 'Press 1–4 to grade' : 'Space to reveal'} · S to skip · U to undo · Esc to exit</span>
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <button disabled={grading} onClick={handleSkip} title="Skip this card without grading it — it stays due (S)" style={{ ...smallTextButton }}>
              ⏭ Skip
            </button>
            <button disabled={!lastGrade || grading} onClick={handleUndo} style={{ ...smallTextButton }}>
              ↩ Undo
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function CardFace({
  card,
  revealed,
  onReveal
}: {
  card: CardRecord
  revealed: boolean
  onReveal: () => void
}): JSX.Element {
  const backLines = backTextToLines(card.back)
  const imagePath = firstImageSourcePath(card)
  const [zoomed, setZoomed] = useState(false)
  const isCloze = card.cardType === 'cloze'
  // 'picture' cards can opt into hiding the image entirely until flipped (a guess-what-this-is
  // card), unlike every other image-bearing type (including image_occlusion, whose mask boxes
  // toggle but whose underlying image is always visible) — see CardRecord.revealImageOnFlip. Also
  // gates the front gallery below — a multi-image card is cardType 'picture' too (see
  // CreateFlashcardModal), so this same flag covers "hide the front images until flipped" there.
  const imageHiddenForNow = card.cardType === 'picture' && card.revealImageOnFlip && !revealed
  // A card assembled via the multi-image modal has its images explicitly tagged front/back — render
  // a gallery per face instead of the single shared-image path every other card type uses.
  const faceTagged = hasFaceTaggedImages(card)
  const frontImages = faceTagged ? imageSourcesForFace(card, 'front') : []
  const backImages = faceTagged ? imageSourcesForFace(card, 'back') : []

  return (
    <div style={cardFaceStyle} onClick={!revealed ? onReveal : undefined}>
      {isCloze ? (
        <div style={{ fontSize: 'var(--font-lg)', fontWeight: 600, textAlign: 'center', lineHeight: 1.5 }}>
          {card.front.trim() ? (
            parseCloze(card.front).map((seg, i) =>
              seg.isBlank ? (
                revealed ? (
                  <span key={i} style={clozeRevealedStyle}>
                    {seg.text}
                  </span>
                ) : (
                  <span key={i} style={clozeBlankStyle}>
                    ▢▢▢▢
                  </span>
                )
              ) : (
                <span key={i}>{seg.text}</span>
              )
            )
          ) : (
            <em style={{ fontWeight: 400, opacity: 0.5 }}>Untitled</em>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 'var(--font-lg)', fontWeight: 600, textAlign: 'center' }}>
          {card.front.trim() || <em style={{ fontWeight: 400, opacity: 0.5 }}>Untitled</em>}
        </div>
      )}

      {/* Same image throughout — only the mask boxes toggle with `revealed`, so answering doesn't
          swap in a second, previously-unmasked copy of the picture. Picture cards with
          revealImageOnFlip are the one exception: the image doesn't render at all until flipped. */}
      {!faceTagged && imagePath && !imageHiddenForNow && (
        <div
          style={{ marginTop: 'var(--space-3)', cursor: 'zoom-in' }}
          title="Click to enlarge"
          onClick={(e) => {
            // Enlarging is independent of answering — without this, clicking the image would
            // also bubble up to the card face's own onClick and flip to the answer.
            e.stopPropagation()
            setZoomed(true)
          }}
        >
          <OcclusionImage imagePath={imagePath} maskBBoxes={maskBBoxesFor(card, imagePath)} revealed={revealed} maxWidth={420} />
        </div>
      )}

      {/* Multi-image cards: a gallery per face instead of one shared image. No lightbox here —
          a click-to-enlarge that must arbitrate against N thumbnails at once isn't worth the
          complexity for a first cut; each thumbnail already renders full-size, just small. */}
      {faceTagged && frontImages.length > 0 && !imageHiddenForNow && (
        <div style={{ marginTop: 'var(--space-3)', display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
          {frontImages.map((path, i) => (
            <OcclusionImage key={`${path}-${i}`} imagePath={path} maskBBoxes={[]} revealed maxWidth={160} />
          ))}
        </div>
      )}
      {faceTagged && revealed && backImages.length > 0 && (
        <div style={{ marginTop: 'var(--space-3)', display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
          {backImages.map((path, i) => (
            <OcclusionImage key={`${path}-${i}`} imagePath={path} maskBBoxes={[]} revealed maxWidth={160} />
          ))}
        </div>
      )}

      {imagePath && !imageHiddenForNow && zoomed && (
        <ImageLightbox imagePath={imagePath} maskBBoxes={maskBBoxesFor(card, imagePath)} revealed={revealed} onClose={() => setZoomed(false)} />
      )}

      {!revealed && (
        <button onClick={onReveal} style={{ marginTop: 'var(--space-5)' }}>
          Show Answer
        </button>
      )}
      {/* A cloze card's answer already appeared inline in the passage above once revealed —
          there's no separate back content to show underneath it. */}
      {revealed && !isCloze && (
        <div style={{ marginTop: 'var(--space-4)', width: '100%', animation: 'expand-collapse 150ms ease' }}>
          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '0 0 var(--space-3)' }} />
          {backLines.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 20, textAlign: 'left' }}>
              {backLines.map((line, i) => (
                <li key={i} style={{ marginLeft: line.depth * 16, fontSize: 'var(--font-md)' }}>
                  {line.text}
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ color: 'var(--fg-faint)', fontSize: 'var(--font-sm)' }}>No answer written yet.</p>
          )}
        </div>
      )}
    </div>
  )
}

function ImageLightbox({
  imagePath,
  maskBBoxes,
  revealed,
  onClose
}: {
  imagePath: string
  maskBBoxes: BBox[]
  revealed: boolean
  onClose: () => void
}): JSX.Element {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      style={lightboxOverlayStyle}
      onClick={(e) => {
        // Despite being position:fixed, this overlay is still a DOM descendant of the card face
        // (which reveals the answer on click) — without stopping propagation here, closing the
        // lightbox via backdrop click would also bubble up and flip the card underneath it.
        e.stopPropagation()
        onClose()
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ animation: 'scale-in 150ms ease' }}>
        <OcclusionImage imagePath={imagePath} maskBBoxes={maskBBoxes} revealed={revealed} maxWidth={Math.min(window.innerWidth * 0.85, 900)} />
      </div>
    </div>
  )
}

const lightboxOverlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: '#000000a0',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 60,
  cursor: 'zoom-out',
  animation: 'fade-in 120ms ease'
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

const clozeBlankStyle: CSSProperties = {
  display: 'inline-block',
  letterSpacing: '-2px',
  color: 'var(--accent)',
  fontWeight: 700
}

const clozeRevealedStyle: CSSProperties = {
  display: 'inline-block',
  color: 'var(--accent)',
  background: 'var(--accent-soft)',
  borderRadius: 3,
  padding: '0 3px'
}

const cardFaceStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  width: '100%',
  minHeight: 220,
  padding: 'var(--space-6)',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: '0 1px 3px #0000001a, 0 8px 24px #00000014',
  cursor: 'pointer',
  animation: 'pop-in 200ms ease'
}

const gradeRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: 'var(--space-2)',
  marginTop: 'var(--space-4)'
}

const gradeButtonStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 2,
  padding: 'var(--space-2) var(--space-1)',
  border: '1px solid',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg)'
}

const footerRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginTop: 'var(--space-4)',
  fontSize: 'var(--font-xs)',
  color: 'var(--fg-faint)'
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
  fontSize: 'var(--font-xs)',
  padding: 0
}
