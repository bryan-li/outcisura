import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type DragEvent, type KeyboardEvent } from 'react'
import type { CardRecord } from '../../../../shared/types'
import { useCardsStore } from '../../state/cardsStore'
import { useReviewLogStore } from '../../state/reviewLogStore'
import { useTagsStore } from '../../state/tagsStore'
import { useUiStore } from '../../state/uiStore'
import { backTextToLines, blockTextToCard, cardToBlockText } from '../../utils/blockCard'
import { computeCardReorder } from '../../utils/cardOrder'
import { firstImageSourcePath, maskBBoxesFor, hasFaceTaggedImages, imageSourcesForFace } from '../../utils/occlusion'
import { parseCloze } from '../../utils/cloze'
import { OcclusionImage } from './OcclusionImage'

export const CARD_DRAG_MIME = 'application/x-card-id'

/** Shared first-line height so the gutter arrow/handle line up with the question text. */
const CARD_LINE_HEIGHT = 22

/** Card drags carry a JSON array of ids so a marquee multi-selection can move as one. */
export function writeCardDragIds(dataTransfer: DataTransfer, ids: string[]): void {
  dataTransfer.setData(CARD_DRAG_MIME, JSON.stringify(ids))
  dataTransfer.effectAllowed = 'move'
}

export function readCardDragIds(dataTransfer: DataTransfer): string[] {
  const raw = dataTransfer.getData(CARD_DRAG_MIME)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return [raw] // tolerate a bare id
  }
}

interface CardItemProps {
  card: CardRecord
  /** The current visual order of the list this card renders in (a folder's own cards, or a
   *  by-source group) — the scope within which drag-to-reorder repositions it. */
  siblingIds: string[]
  /** Shown as a small badge next to the front text — used by views (like "All Cards") that mix
   *  cards from several folders together, so a foldered card's home is still visible at a glance. */
  folderLabel?: string
  onFolderClick?: () => void
}

export function CardItem({ card, siblingIds, folderLabel, onFolderClick }: CardItemProps): JSX.Element {
  const updateCard = useCardsStore((s) => s.updateCard)
  const deleteCard = useCardsStore((s) => s.deleteCard)
  const regenerate = useCardsStore((s) => s.regenerate)
  const reorderCards = useCardsStore((s) => s.reorderCards)
  const removeCardImage = useCardsStore((s) => s.removeCardImage)
  const goToSource = useUiStore((s) => s.goToSource)

  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftText, setDraftText] = useState('')
  const [hovered, setHovered] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false)
  const [dropPosition, setDropPosition] = useState<'before' | 'after' | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const focusedCardId = useUiStore((s) => s.focusedCardId)
  const clearFocusedCard = useUiStore((s) => s.clearFocusedCard)
  const selectedCardIds = useUiStore((s) => s.selectedCardIds)
  const focused = focusedCardId === card.id
  const selected = selectedCardIds.includes(card.id)

  /** Dragging a card that's part of a marquee selection moves the whole selection. */
  function dragIds(): string[] {
    return selected ? selectedCardIds : [card.id]
  }

  const backLines = backTextToLines(card.back)
  const imagePath = firstImageSourcePath(card)
  // Same "don't spoil the quiz while browsing" reasoning as occlusion's masks/cloze's blanks below
  // — for a picture card with revealImageOnFlip, the whole image IS the thing being tested, so it
  // stays hidden here regardless of expanded state (there's no flip gesture in browse view to
  // reveal it through). Applies the same way to a multi-image card's front images, since those are
  // also cardType 'picture' (see CreateFlashcardModal).
  const imageHiddenInBrowse = card.cardType === 'picture' && card.revealImageOnFlip
  // A card assembled via the multi-image modal has explicit front/back image tagging — gallery
  // rendering below instead of the single shared-image path every other card type uses. Back images
  // are shown whenever expanded (not spoiler-hidden), same precedent as plain back TEXT below —
  // only revealImageOnFlip (checked above) actually hides anything from browsing.
  const faceTagged = hasFaceTaggedImages(card)
  const frontImages = faceTagged ? imageSourcesForFace(card, 'front') : []
  const backImages = faceTagged ? imageSourcesForFace(card, 'back') : []
  const smallPreviewPath = faceTagged ? (frontImages[0] ?? backImages[0] ?? null) : imagePath
  // Same data as frontImages/backImages but keeping each source's id — needed for the per-image
  // remove button (freely-attached images via ImageAttachControl land here with imageFace: 'back',
  // reusing this same gallery rather than a separate one).
  const frontImageSources = faceTagged ? card.sources.filter((s) => s.imageFace === 'front' && s.imagePath) : []
  const backImageSources = faceTagged ? card.sources.filter((s) => s.imageFace === 'back' && s.imagePath) : []

  // Total grade events, not just the successful-streak `card.repetitions` — every time this card
  // was shown in review, regardless of how it was graded. reviewLogStore already loads the whole
  // log (small enough for a personal deck), so this is a client-side derive, no new IPC/query.
  const reviewLogEntries = useReviewLogStore((s) => s.entries)
  const reviewCount = useMemo(
    () => reviewLogEntries.reduce((n, e) => (e.cardId === card.id ? n + 1 : n), 0),
    [reviewLogEntries, card.id]
  )

  useEffect(() => {
    if (!focused) return
    setExpanded(true)
    rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const timer = setTimeout(clearFocusedCard, 1600)
    return () => clearTimeout(timer)
  }, [focused, clearFocusedCard])

  useEffect(() => {
    if (!sourceMenuOpen) return
    function handleOutside(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setSourceMenuOpen(false)
    }
    window.addEventListener('mousedown', handleOutside)
    return () => window.removeEventListener('mousedown', handleOutside)
  }, [sourceMenuOpen])

  const isCloze = card.cardType === 'cloze'

  function startEditing(): void {
    // A cloze card is one plain-text passage, not a front/back pair — the `:>` block convention
    // doesn't apply (and back stays empty for cloze cards), so it's edited as-is instead.
    setDraftText(isCloze ? card.front : cardToBlockText(card.front, card.back))
    setEditing(true)
    setExpanded(true)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  function commitEdit(): void {
    const { front, back } = isCloze ? { front: draftText.trim(), back: '' } : blockTextToCard(draftText)
    setEditing(false)
    if (front !== card.front || back !== card.back) updateCard(card.id, { front, back })
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key !== 'Tab') return
    e.preventDefault()
    const el = e.currentTarget
    const { selectionStart, selectionEnd, value } = el
    if (!e.shiftKey) {
      const next = value.slice(0, selectionStart) + '  ' + value.slice(selectionEnd)
      setDraftText(next)
      requestAnimationFrame(() => el.setSelectionRange(selectionStart + 2, selectionStart + 2))
    } else {
      const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1
      const removeCount = value.slice(lineStart, lineStart + 2) === '  ' ? 2 : value[lineStart] === ' ' ? 1 : 0
      if (removeCount > 0) {
        const next = value.slice(0, lineStart) + value.slice(lineStart + removeCount)
        setDraftText(next)
        requestAnimationFrame(() => el.setSelectionRange(selectionStart - removeCount, selectionStart - removeCount))
      }
    }
  }

  async function handleRegenerate(): Promise<void> {
    setRegenerating(true)
    try {
      await regenerate(card.id)
    } finally {
      setRegenerating(false)
    }
  }

  function handleDelete(): void {
    if (window.confirm('Delete this flashcard? This can\'t be undone.')) deleteCard(card.id)
  }

  function dropPositionOf(e: DragEvent<HTMLDivElement>): 'before' | 'after' {
    const rect = e.currentTarget.getBoundingClientRect()
    const relY = (e.clientY - rect.top) / rect.height
    return relY < 0.5 ? 'before' : 'after'
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>): void {
    if (!e.dataTransfer.types.includes(CARD_DRAG_MIME)) return
    e.preventDefault()
    setDropPosition(dropPositionOf(e))
  }

  function handleReorderDrop(e: DragEvent<HTMLDivElement>): void {
    const draggedIds = readCardDragIds(e.dataTransfer)
    const position = dropPositionOf(e)
    setDropPosition(null)
    if (draggedIds.length === 0 || draggedIds.includes(card.id)) return
    e.preventDefault()
    e.stopPropagation()
    const items = computeCardReorder(siblingIds, draggedIds, card.id, position)
    if (items.length > 0) void reorderCards(items)
  }

  // Standalone-uploaded replacement sources (see the missing-source recovery flow) have no
  // document/page to jump to — filtered out here rather than in every render site downstream.
  const jumpableSources = card.sources.filter(
    (s): s is typeof s & { documentId: string; pageId: string } => s.documentId !== null && s.pageId !== null
  )

  function handleLinkClick(): void {
    if (jumpableSources.length === 0) return
    if (jumpableSources.length === 1) {
      const s = jumpableSources[0]
      goToSource({ documentId: s.documentId, pageId: s.pageId, bbox: s.bbox })
      return
    }
    setSourceMenuOpen((v) => !v)
  }

  const showToolbar = hovered || editing || sourceMenuOpen

  return (
    <div
      ref={rootRef}
      data-card-id={card.id}
      style={{
        position: 'relative',
        padding: '3px 6px',
        borderTop: dropPosition === 'before' ? '2px solid var(--accent)' : '2px solid transparent',
        borderBottom: dropPosition === 'after' ? '2px solid var(--accent)' : '2px solid transparent',
        borderRadius: dropPosition ? 0 : 'var(--radius-md)',
        background: focused || selected ? 'var(--accent-soft)' : hovered ? 'var(--bg-hover)' : 'transparent',
        boxShadow: selected ? 'inset 0 0 0 1px var(--accent)' : undefined,
        transition: 'background-color 150ms ease',
        // Plays once on mount only (browsers don't replay an unchanged animation-name on
        // re-render) — new cards, and a fresh list after switching folders, ease in instead of
        // just appearing.
        animation: 'fade-in 200ms ease'
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDragOver={handleDragOver}
      onDragLeave={() => setDropPosition(null)}
      onDrop={handleReorderDrop}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
        <span
          draggable
          onDragStart={(e) => writeCardDragIds(e.dataTransfer, dragIds())}
          title={selected && selectedCardIds.length > 1 ? `Drag ${selectedCardIds.length} cards to reorder or file into a folder` : 'Drag to reorder or file into a folder'}
          style={{ ...gutterButtonStyle, cursor: 'grab', opacity: hovered || selected ? 0.5 : 0 }}
        >
          ⠿
        </span>
        <button onClick={() => setExpanded((v) => !v)} style={{ ...gutterButtonStyle, visibility: backLines.length > 0 ? 'visible' : 'hidden' }}>
          {expanded ? '▼' : '▶'}
        </button>

        {/* Always-on preview, not just when expanded — glancing down a folder page should show
            what each card is about without opening every one. Never revealed here (masked stays
            masked): browsing a folder shouldn't spoil an occlusion card's answer. Hidden once
            expanded so it isn't shown twice alongside the larger copy below. */}
        {smallPreviewPath && !expanded && !imageHiddenInBrowse && (
          <span style={{ flexShrink: 0, marginTop: 1 }}>
            <OcclusionImage
              imagePath={smallPreviewPath}
              maskBBoxes={faceTagged ? [] : maskBBoxesFor(card, smallPreviewPath)}
              revealed={false}
              maxWidth={32}
            />
          </span>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          {editing ? (
            <textarea
              ref={textareaRef}
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={handleKeyDown}
              rows={Math.max(2, draftText.split('\n').length)}
              style={editTextareaStyle}
            />
          ) : (
            // Click flips (same as the ▶/▼ arrow button — toggling here too just gives a bigger,
            // more obvious hit target); double-click edits, matching the fast "click to edit"
            // precedent the textarea itself sets on blur. The single-click handler still fires
            // during a double-click (browsers dispatch click, click, then dblclick), so the card
            // flips and un-flips before landing in edit mode — a minor, harmless flicker, not
            // worth a click-timer to avoid.
            <div onClick={() => setExpanded((v) => !v)} onDoubleClick={startEditing} style={{ cursor: 'pointer' }}>
              {isCloze ? (
                <span style={{ fontSize: 'var(--font-md)', lineHeight: `${CARD_LINE_HEIGHT}px` }}>
                  {card.front.trim() ? (
                    // Always masked here — browsing a card list shouldn't spoil a cloze answer any
                    // more than it does for an occlusion card's thumbnail.
                    parseCloze(card.front).map((seg, i) =>
                      seg.isBlank ? (
                        <span key={i} style={clozeBlankStyle} title={seg.text}>
                          ▢▢▢▢
                        </span>
                      ) : (
                        <span key={i}>{seg.text}</span>
                      )
                    )
                  ) : (
                    <em style={{ fontWeight: 400, opacity: 0.5 }}>Untitled cloze — click to edit</em>
                  )}
                </span>
              ) : (
                <strong style={{ fontSize: 'var(--font-md)', lineHeight: `${CARD_LINE_HEIGHT}px`, display: 'inline-block' }}>
                  {card.front.trim() || <em style={{ fontWeight: 400, opacity: 0.5 }}>Untitled — click to edit</em>}
                </strong>
              )}
              {folderLabel && (
                <span
                  onClick={(e) => {
                    e.stopPropagation()
                    onFolderClick?.()
                  }}
                  style={folderBadgeStyle}
                >
                  📁 {folderLabel}
                </span>
              )}
              {!isCloze && expanded && backLines.length > 0 && (
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {backLines.map((line, i) => (
                    <li key={i} style={{ marginLeft: line.depth * 16, fontSize: 'var(--font-md)' }}>
                      {line.text}
                    </li>
                  ))}
                </ul>
              )}
              {!isCloze && expanded && backLines.length === 0 && (
                <p style={{ margin: '4px 0 0', fontSize: 'var(--font-sm)', color: 'var(--fg-faint)' }}>
                  No answer yet — click to add one after "{`:>`}"
                </p>
              )}
              {isCloze && expanded && (
                <p style={{ margin: '4px 0 0', fontSize: 'var(--font-xs)', color: 'var(--fg-faint)' }}>
                  Wrap the hidden answer in {'{{double braces}}'} — everything wrapped is hidden together.
                </p>
              )}
              {expanded && !faceTagged && imagePath && !imageHiddenInBrowse && (
                <div style={{ marginTop: 6 }}>
                  <OcclusionImage imagePath={imagePath} maskBBoxes={maskBBoxesFor(card, imagePath)} revealed={false} maxWidth={260} />
                </div>
              )}
              {expanded && faceTagged && !imageHiddenInBrowse && frontImageSources.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <p style={imageGalleryLabelStyle}>Front</p>
                  <div style={imageGalleryRowStyle}>
                    {frontImageSources.map((s) => (
                      <div key={s.id} style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
                        <OcclusionImage imagePath={s.imagePath!} maskBBoxes={[]} revealed maxWidth={90} />
                        <button onClick={() => removeCardImage(card.id, s.id)} title="Remove image" style={imageRemoveButtonStyle}>
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {expanded && faceTagged && !imageHiddenInBrowse && backImageSources.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <p style={imageGalleryLabelStyle}>Back</p>
                  <div style={imageGalleryRowStyle}>
                    {backImageSources.map((s) => (
                      <div key={s.id} style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
                        <OcclusionImage imagePath={s.imagePath!} maskBBoxes={[]} revealed maxWidth={90} />
                        <button onClick={() => removeCardImage(card.id, s.id)} title="Remove image" style={imageRemoveButtonStyle}>
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {expanded && imageHiddenInBrowse && (frontImages.length > 0 || backImages.length > 0 || imagePath) && (
                <p style={{ margin: '6px 0 0', fontSize: 'var(--font-xs)', color: 'var(--fg-faint)' }}>
                  🖼 Image{faceTagged && frontImages.length + backImages.length > 1 ? 's' : ''} hidden until flipped in review
                </p>
              )}
              {expanded && (
                <p style={{ margin: '4px 0 0', fontSize: 'var(--font-xs)', color: 'var(--fg-faint)' }}>
                  {reviewCount > 0 ? `Reviewed ${reviewCount} time${reviewCount === 1 ? '' : 's'}` : 'Not reviewed yet'}
                </p>
              )}
              {expanded && <TagRow cardId={card.id} tagIds={card.tagIds} />}
              {expanded && <ImageAttachControl cardId={card.id} />}
            </div>
          )}
        </div>
      </div>

      {showToolbar && (
        <div style={toolbarStyle}>
          <IconButton title="Regenerate with AI" onClick={handleRegenerate} disabled={regenerating}>
            {regenerating ? '…' : '✨'}
          </IconButton>
          <IconButton title="Jump to source" onClick={handleLinkClick} disabled={jumpableSources.length === 0}>
            🔗
          </IconButton>
          <IconButton title="Delete" onClick={handleDelete}>
            🗑
          </IconButton>
        </div>
      )}

      {sourceMenuOpen && (
        <div ref={menuRef} style={sourceMenuStyle}>
          {jumpableSources.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                goToSource({ documentId: s.documentId, pageId: s.pageId, bbox: s.bbox })
                setSourceMenuOpen(false)
              }}
              style={sourceMenuItemStyle}
            >
              🔗 {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function TagRow({ cardId, tagIds }: { cardId: string; tagIds: string[] }): JSX.Element {
  const allTags = useTagsStore((s) => s.tags)
  const createTag = useTagsStore((s) => s.createTag)
  const setCardTags = useCardsStore((s) => s.setCardTags)

  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const cardTags = tagIds.map((id) => allTags.find((t) => t.id === id)).filter((t): t is NonNullable<typeof t> => !!t)
  const suggestions =
    draft.trim().length > 0
      ? allTags.filter((t) => !tagIds.includes(t.id) && t.name.toLowerCase().includes(draft.trim().toLowerCase())).slice(0, 6)
      : []

  function removeTag(tagId: string): void {
    void setCardTags(cardId, tagIds.filter((id) => id !== tagId))
  }

  async function addTag(name: string): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) {
      setAdding(false)
      setDraft('')
      return
    }
    const tag = await createTag(trimmed)
    if (!tagIds.includes(tag.id)) void setCardTags(cardId, [...tagIds, tag.id])
    setDraft('')
    setAdding(false)
  }

  return (
    <div onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} style={tagRowStyle}>
      {cardTags.map((tag) => (
        <span key={tag.id} style={tagChipStyle}>
          {tag.name}
          <button onClick={() => removeTag(tag.id)} title={`Remove tag "${tag.name}"`} style={tagChipRemoveStyle}>
            ×
          </button>
        </span>
      ))}
      {adding ? (
        <span style={{ position: 'relative' }}>
          <input
            ref={inputRef}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => addTag(draft)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void addTag(draft)
              } else if (e.key === 'Escape') {
                setAdding(false)
                setDraft('')
              }
            }}
            placeholder="Tag name…"
            style={tagInputStyle}
          />
          {suggestions.length > 0 && (
            <div style={tagSuggestionsStyle}>
              {suggestions.map((s) => (
                <button
                  key={s.id}
                  // Fires before the input's onBlur commits the typed draft as a new tag.
                  onMouseDown={(e) => {
                    e.preventDefault()
                    void addTag(s.name)
                  }}
                  style={tagSuggestionItemStyle}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </span>
      ) : (
        <button onClick={() => setAdding(true)} style={tagAddButtonStyle}>
          + tag
        </button>
      )}
    </div>
  )
}

/** Reads a File as a `data:` URL, then persists it to disk via the same saveImage path every
 *  other locally-captured image already uses (see main/imageStore.ts). */
async function fileToImagePath(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
  return window.api.documents.saveImage(dataUrl)
}

/** Paste-from-clipboard or drag-drop entry point for freely attaching images to a card,
 *  independent of the structured slide/video source-selection flow — see
 *  repository.ts's addCardImages for how these land as imageFace: 'back' sources, rendered by the
 *  same gallery as any other multi-image card's back face. */
function ImageAttachControl({ cardId }: { cardId: string }): JSX.Element {
  const addCardImages = useCardsStore((s) => s.addCardImages)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)

  async function attachFiles(files: File[]): Promise<void> {
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (images.length === 0) return
    setBusy(true)
    try {
      const paths = await Promise.all(images.map(fileToImagePath))
      await addCardImages(cardId, paths)
    } finally {
      setBusy(false)
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLDivElement>): void {
    const files = Array.from(e.clipboardData.items)
      .map((item) => item.getAsFile())
      .filter((f): f is File => !!f && f.type.startsWith('image/'))
    if (files.length > 0) {
      e.preventDefault()
      void attachFiles(files)
    }
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>): void {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return
    e.preventDefault()
    setDragOver(true)
  }

  function handleDrop(e: DragEvent<HTMLDivElement>): void {
    if (e.dataTransfer.files.length === 0) return
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    void attachFiles(Array.from(e.dataTransfer.files))
  }

  return (
    <div
      tabIndex={0}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onPaste={handlePaste}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      style={{ ...imageDropZoneStyle, borderColor: dragOver ? 'var(--accent)' : 'var(--border)' }}
    >
      {busy ? 'Attaching image…' : '🖼 Click, then ⌘V to paste an image — or drop one here'}
    </div>
  )
}

function IconButton({
  children,
  onClick,
  title,
  disabled
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  disabled?: boolean
}): JSX.Element {
  return (
    <button onClick={onClick} title={title} disabled={disabled} style={iconButtonStyle}>
      {children}
    </button>
  )
}

/** Sized to CARD_LINE_HEIGHT so gutter icons sit centered on the question's first line. */
const clozeBlankStyle: CSSProperties = {
  display: 'inline-block',
  letterSpacing: '-2px',
  color: 'var(--accent)',
  fontWeight: 700,
  cursor: 'default'
}

const imageGalleryLabelStyle: CSSProperties = {
  margin: '0 0 3px',
  fontSize: 'var(--font-xs)',
  color: 'var(--fg-faint)',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.03em'
}

const imageGalleryRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4
}

const folderBadgeStyle: CSSProperties = {
  marginLeft: 8,
  padding: '1px 7px',
  borderRadius: 999,
  fontSize: 'var(--font-xs)',
  color: 'var(--fg-muted)',
  background: 'var(--bg-hover)',
  cursor: 'pointer',
  whiteSpace: 'nowrap'
}

const gutterButtonStyle: CSSProperties = {
  height: CARD_LINE_HEIGHT,
  width: 16,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  fontSize: 10,
  padding: 0,
  color: 'var(--fg-faint)',
  flexShrink: 0,
  transition: 'opacity var(--transition-fast)'
}

const editTextareaStyle: CSSProperties = {
  width: '100%',
  fontFamily: 'inherit',
  fontSize: 'var(--font-md)',
  padding: '2px 4px',
  border: '1px solid var(--accent)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg)',
  color: 'inherit',
  resize: 'vertical'
}

const toolbarStyle: CSSProperties = {
  position: 'absolute',
  top: 2,
  right: 4,
  display: 'flex',
  gap: 2,
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  padding: 1
}

const iconButtonStyle: CSSProperties = {
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  fontSize: 13,
  padding: '3px 6px',
  borderRadius: 'var(--radius-sm)',
  color: 'inherit'
}

const sourceMenuStyle: CSSProperties = {
  position: 'absolute',
  top: 26,
  right: 4,
  background: 'var(--modal-bg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  padding: 4,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 180,
  zIndex: 20,
  boxShadow: '0 4px 16px #00000030'
}

const sourceMenuItemStyle: CSSProperties = {
  border: 'none',
  background: 'none',
  textAlign: 'left',
  padding: '4px 6px',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  fontSize: 'var(--font-sm)',
  color: 'inherit'
}

const imageDropZoneStyle: CSSProperties = {
  marginTop: 6,
  padding: '5px 8px',
  border: '1px dashed var(--border)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--font-xs)',
  color: 'var(--fg-faint)',
  cursor: 'text',
  outline: 'none',
  transition: 'border-color 100ms ease'
}

const imageRemoveButtonStyle: CSSProperties = {
  position: 'absolute',
  top: -4,
  right: -4,
  width: 16,
  height: 16,
  lineHeight: '14px',
  textAlign: 'center',
  border: '1px solid var(--border)',
  borderRadius: '50%',
  background: 'var(--bg)',
  color: 'var(--fg-muted)',
  cursor: 'pointer',
  fontSize: 11,
  padding: 0
}

const tagRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 4,
  marginTop: 6
}

const tagChipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  padding: '1px 4px 1px 8px',
  borderRadius: 999,
  fontSize: 'var(--font-xs)',
  color: 'var(--accent)',
  background: 'var(--accent-soft)',
  whiteSpace: 'nowrap'
}

const tagChipRemoveStyle: CSSProperties = {
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  color: 'inherit',
  fontSize: 12,
  lineHeight: 1,
  padding: '0 3px',
  opacity: 0.7
}

const tagAddButtonStyle: CSSProperties = {
  border: '1px dashed var(--border)',
  background: 'none',
  cursor: 'pointer',
  color: 'var(--fg-faint)',
  fontSize: 'var(--font-xs)',
  padding: '1px 7px',
  borderRadius: 999
}

const tagInputStyle: CSSProperties = {
  border: '1px solid var(--accent)',
  borderRadius: 999,
  padding: '1px 8px',
  fontSize: 'var(--font-xs)',
  background: 'var(--bg)',
  color: 'inherit',
  width: 100
}

const tagSuggestionsStyle: CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  marginTop: 2,
  background: 'var(--modal-bg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  padding: 2,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 120,
  zIndex: 20,
  boxShadow: '0 4px 16px #00000030'
}

const tagSuggestionItemStyle: CSSProperties = {
  border: 'none',
  background: 'none',
  textAlign: 'left',
  padding: '3px 6px',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  fontSize: 'var(--font-xs)',
  color: 'inherit'
}
