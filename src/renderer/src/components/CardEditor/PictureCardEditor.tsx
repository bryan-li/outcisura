import { useState, type CSSProperties } from 'react'
import type { BBox } from '../../../../shared/types'
import { useResolvedImage } from '../../hooks/useResolvedImage'
import { useCardsStore } from '../../state/cardsStore'

const MAX_WIDTH = 500

// Not a rewrite instruction on top of existing front/back (like AiRegenerateRequest.instruction
// normally is) — this is the FIRST generation for a card whose front/back start as placeholders, so
// it's written as a complete, standalone brief rather than "make this better."
const DEFAULT_AI_INSTRUCTION = [
  'Look at the attached image and write a flashcard that tests recognition of what it shows.',
  'The front should be a short question asking what the picture depicts — e.g. "What is this mechanism?",',
  '"What structure is shown here?", or "What process does this diagram illustrate?" — phrase it naturally',
  'for whatever the image actually is, not necessarily "mechanism" specifically.',
  'The back should name/identify it and give a concise, accurate explanation.'
].join(' ')

interface PictureCardEditorProps {
  documentId: string
  pageId: string
  documentLabel: string
  /** How to describe this source in generated card copy — "Slide 3" for a pdf/pptx page, "at 0:42"
   *  for a captured video frame. Mirrors OcclusionEditor's own sourceLabel. */
  sourceLabel: string
  sourceImagePath: string
  sourceBBox: BBox
  onClose: () => void
  onSaved: () => void
}

export function PictureCardEditor({
  documentId,
  pageId,
  documentLabel,
  sourceLabel,
  sourceImagePath,
  sourceBBox,
  onClose,
  onSaved
}: PictureCardEditorProps): JSX.Element {
  const imageSrc = useResolvedImage(sourceImagePath)
  const createCard = useCardsStore((s) => s.createCard)
  const regenerate = useCardsStore((s) => s.regenerate)

  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const [hideUntilFlip, setHideUntilFlip] = useState(false)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function buildSource() {
    return [
      {
        documentId,
        pageId,
        elementId: null,
        bbox: sourceBBox,
        label: `${documentLabel} · ${sourceLabel}`,
        imagePath: sourceImagePath
      }
    ]
  }

  async function handleCreate(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      await createCard({
        front: front.trim() || 'What is this?',
        back: back.trim(),
        cardType: 'picture',
        revealImageOnFlip: hideUntilFlip,
        sources: buildSource()
      })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleGenerateWithAi(): Promise<void> {
    setGenerating(true)
    setError(null)
    try {
      // Same two-step shape as createFromSources elsewhere: persist a real card first (so there's
      // something to point the regenerate request at and something saved even if generation then
      // fails), then let Claude vision rewrite it in place.
      const card = await createCard({
        front: front.trim() || 'What is this?',
        back: back.trim(),
        cardType: 'picture',
        revealImageOnFlip: hideUntilFlip,
        sources: buildSource()
      })
      await regenerate(card.id, DEFAULT_AI_INSTRUCTION)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setGenerating(false)
    }
  }

  const busy = saving || generating

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Picture Card</h2>
        <p style={{ fontSize: 13, opacity: 0.7 }}>
          Front shows this image plus your question; back reveals the answer. Turn on "Hide image until flipped"
          for a guess-what-this-is style card instead of showing the picture right away.
        </p>

        {imageSrc && (
          <img
            src={imageSrc}
            alt="Card source"
            style={{ display: 'block', maxWidth: MAX_WIDTH, width: '100%', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}
          />
        )}

        <label style={fieldLabelStyle}>
          Front (question)
          <input
            type="text"
            value={front}
            onChange={(e) => setFront(e.target.value)}
            placeholder="What is this?"
            style={inputStyle}
          />
        </label>

        <label style={fieldLabelStyle}>
          Back (answer)
          <textarea
            value={back}
            onChange={(e) => setBack(e.target.value)}
            rows={3}
            placeholder="Leave blank and use “Generate with AI” below, or write your own answer here."
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginTop: 4 }}>
          <input type="checkbox" checked={hideUntilFlip} onChange={(e) => setHideUntilFlip(e.target.checked)} />
          Hide image until flipped
        </label>

        {error && <p style={{ color: 'var(--danger)', fontSize: 13, margin: '8px 0 0' }}>{error}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button onClick={handleGenerateWithAi} disabled={busy}>
            {generating ? 'Generating…' : '✨ Generate with AI'}
          </button>
          <button onClick={handleCreate} disabled={busy}>
            {saving ? 'Creating…' : 'Create Flashcard'}
          </button>
        </div>
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: '#00000066',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 50,
  animation: 'fade-in 150ms ease'
}

const modalStyle: CSSProperties = {
  background: 'var(--modal-bg)',
  color: 'var(--modal-fg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  padding: 'var(--space-5)',
  maxWidth: '90vw',
  maxHeight: '90vh',
  overflow: 'auto',
  boxShadow: '0 10px 40px #00000040',
  animation: 'scale-in 180ms ease',
  display: 'flex',
  flexDirection: 'column',
  gap: 10
}

const fieldLabelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--fg-muted)'
}

const inputStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 400,
  color: 'var(--fg)',
  padding: '6px 8px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg)',
  fontFamily: 'inherit'
}
