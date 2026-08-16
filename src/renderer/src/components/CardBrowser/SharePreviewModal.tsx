import { useEffect, useState, type CSSProperties } from 'react'
import { getCardSharePreviews, type CardSharePreview } from '../../lib/liveSession/sharePreview'
import { supabase } from '../../lib/supabase'

interface SharePreviewModalProps {
  folderId: string
  folderName: string
  onClose: () => void
}

/** What "Prepare for hosting" generated per card — recommended format, all 3 MCQ distractors
 *  (generated regardless of format, so a host can override per-card later), and the free-text
 *  judging rubric. Distractors/rubric are editable directly here: a host correcting a wrong or
 *  awkward AI suggestion is a deliberate override, not evidence the prep is stale, so editing here
 *  deliberately does NOT touch share_prep_source_front/back — the card stays "ready" exactly as
 *  ensureSharePrepped left it, it just carries the host's own wording now instead of (or on top of)
 *  the AI's. Auto-saves per field on blur, same low-friction pattern as CardItem's own inline
 *  front/back editing (commitEdit) — no separate edit-mode toggle or explicit Save button. */
export function SharePreviewModal({ folderId, folderName, onClose }: SharePreviewModalProps): JSX.Element {
  const [previews, setPreviews] = useState<CardSharePreview[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getCardSharePreviews(folderId)
      .then((result) => {
        if (!cancelled) setPreviews(result)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load prep preview')
      })
    return () => {
      cancelled = true
    }
  }, [folderId])

  async function saveDistractors(cardId: string, distractors: string[]): Promise<void> {
    const { error: saveError } = await supabase.from('cards').update({ share_mcq_distractors: distractors }).eq('id', cardId)
    if (saveError) setError(saveError.message)
  }

  async function saveRubric(cardId: string, rubric: string): Promise<void> {
    const { error: saveError } = await supabase.from('cards').update({ share_free_text_rubric: rubric }).eq('id', cardId)
    if (saveError) setError(saveError.message)
  }

  function updateDistractorLocally(cardId: string, index: number, value: string): void {
    setPreviews((prev) =>
      prev?.map((c) =>
        c.cardId === cardId && c.mcqDistractors
          ? { ...c, mcqDistractors: c.mcqDistractors.map((d, i) => (i === index ? value : d)) }
          : c
      ) ?? null
    )
  }

  function updateRubricLocally(cardId: string, value: string): void {
    setPreviews((prev) => prev?.map((c) => (c.cardId === cardId ? { ...c, freeTextRubric: value } : c)) ?? null)
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 'var(--font-lg)', margin: 0 }}>👁 Prep preview — {folderName}</h2>
          <button onClick={onClose} style={closeButtonStyle} title="Close">
            ✕
          </button>
        </div>

        {error && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', margin: 0 }}>{error}</p>}
        {previews === null && !error && <p style={{ color: 'var(--fg-muted)', fontSize: 'var(--font-sm)' }}>Loading…</p>}
        {previews !== null && previews.length === 0 && (
          <p style={{ color: 'var(--fg-muted)', fontSize: 'var(--font-sm)' }}>No cards in this folder yet.</p>
        )}

        {previews?.map((card) => (
          <div key={card.cardId} style={cardBlockStyle}>
            <p style={{ fontSize: 'var(--font-md)', fontWeight: 600, margin: 0 }}>{card.front || 'Untitled'}</p>

            {!card.isPrepped ? (
              <p style={{ fontSize: 'var(--font-sm)', color: 'var(--fg-faint)', margin: 0, fontStyle: 'italic' }}>
                Not prepared yet
              </p>
            ) : (
              <>
                <div style={badgeRowStyle}>
                  <span style={formatBadgeStyle}>{card.recommendedFormat === 'mcq' ? 'Multiple choice' : 'Free text'}</span>
                </div>

                <div>
                  <p style={sectionLabelStyle}>Correct answer</p>
                  <p style={{ fontSize: 'var(--font-sm)', margin: 0 }}>{card.back}</p>
                </div>

                {card.mcqDistractors && (
                  <div>
                    <p style={sectionLabelStyle}>MCQ distractors</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {card.mcqDistractors.map((d, i) => (
                        <input
                          key={i}
                          value={d}
                          onChange={(e) => updateDistractorLocally(card.cardId, i, e.target.value)}
                          onBlur={() => void saveDistractors(card.cardId, card.mcqDistractors!)}
                          style={editFieldStyle}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {card.freeTextRubric !== null && (
                  <div>
                    <p style={sectionLabelStyle}>Free-text rubric</p>
                    <textarea
                      value={card.freeTextRubric}
                      onChange={(e) => updateRubricLocally(card.cardId, e.target.value)}
                      onBlur={() => void saveRubric(card.cardId, card.freeTextRubric!)}
                      rows={Math.max(2, card.freeTextRubric.split('\n').length)}
                      style={{ ...editFieldStyle, resize: 'vertical' }}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: '#00000066',
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 60,
  animation: 'fade-in 150ms ease'
}

const modalStyle: CSSProperties = {
  background: 'var(--modal-bg)',
  color: 'var(--modal-fg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  padding: 'var(--space-5)',
  width: 560,
  maxWidth: '90vw',
  maxHeight: '85vh',
  overflow: 'auto',
  boxShadow: '0 10px 40px #00000040',
  animation: 'scale-in 180ms ease',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-4)'
}

const closeButtonStyle: CSSProperties = {
  border: 'none',
  background: 'none',
  color: 'var(--fg-muted)',
  cursor: 'pointer',
  fontSize: 16,
  padding: 4
}

const cardBlockStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
  padding: 'var(--space-3)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)'
}

const badgeRowStyle: CSSProperties = { display: 'flex', gap: 6 }

const formatBadgeStyle: CSSProperties = {
  fontSize: 'var(--font-xs)',
  fontWeight: 600,
  color: 'var(--accent)',
  background: 'var(--accent-soft)',
  border: '1px solid var(--accent)',
  borderRadius: 999,
  padding: '2px 8px'
}

const sectionLabelStyle: CSSProperties = {
  fontSize: 'var(--font-xs)',
  fontWeight: 600,
  color: 'var(--fg-faint)',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  margin: '0 0 2px'
}

const editFieldStyle: CSSProperties = {
  width: '100%',
  fontFamily: 'inherit',
  fontSize: 'var(--font-sm)',
  padding: '6px 8px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg)',
  color: 'inherit'
}
