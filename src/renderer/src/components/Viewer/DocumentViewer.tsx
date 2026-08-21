import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { BBox, CardRecord, CardType, DocumentRecord, ElementRecord, NewCardSourceInput } from '../../../../shared/types'
import { useDocumentsStore } from '../../state/documentsStore'
import { useCardsStore } from '../../state/cardsStore'
import { localCardsApi } from '../../lib/api/localCards'
import { useUiStore } from '../../state/uiStore'
import { PageView } from './PageView'
import { VideoPlayer } from './VideoPlayer'
import { OcclusionEditor } from '../CardEditor/OcclusionEditor'
import { PictureCardEditor } from '../CardEditor/PictureCardEditor'
import { CreateFlashcardModal, type StagedImage } from '../CardEditor/CreateFlashcardModal'
import { GenerationSettingsPanel } from '../CardEditor/GenerationSettingsPanel'
import type { PendingSource } from '../../types/pendingSource'
import { cropImageDataUrl } from '../../utils/cropImage'
import { unionBBox, padBBoxForCrop } from '../../utils/bbox'

interface OcclusionSource {
  imagePath: string
  bbox: BBox
}

interface DocumentViewerProps {
  document: DocumentRecord
}

const toolbarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  flexWrap: 'wrap',
  padding: '6px 8px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--bg-sidebar)'
}

const segmentButtonStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--fg-muted)',
  padding: '2px 8px'
}

const quietButtonStyle: CSSProperties = {
  border: '1px solid transparent',
  background: 'transparent',
  color: 'var(--fg-muted)'
}

const primaryButtonStyle: CSSProperties = {
  border: '1px solid var(--accent)',
  background: 'var(--accent-soft)',
  color: 'var(--accent)',
  fontWeight: 600
}

const dividerStyle: CSSProperties = {
  width: 1,
  height: 18,
  background: 'var(--border)',
  flexShrink: 0
}

const pictureMenuStyle: CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  marginTop: 4,
  width: 240,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: 6,
  background: 'var(--modal-bg)',
  color: 'var(--modal-fg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  boxShadow: '0 8px 24px #00000030',
  zIndex: 20,
  animation: 'pop-in 150ms ease'
}

const pictureMenuItemStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 1,
  width: '100%',
  border: 'none',
  background: 'none',
  textAlign: 'left',
  padding: '6px 8px',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  color: 'inherit',
  fontSize: 'var(--font-sm)'
}

const pictureMenuHintStyle: CSSProperties = {
  fontSize: 'var(--font-xs)',
  color: 'var(--fg-faint)',
  fontWeight: 400
}

const summaryPanelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)'
}

const recaptureBannerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-3)',
  border: '1px solid var(--accent)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-2) var(--space-3)',
  fontSize: 'var(--font-sm)',
  color: 'var(--accent)',
  background: 'var(--accent-soft)'
}

export function DocumentViewer({ document }: DocumentViewerProps): JSX.Element {
  const pagesByDocument = useDocumentsStore((s) => s.pagesByDocument)
  const elementsByPage = useDocumentsStore((s) => s.elementsByPage)
  const activePageIndex = useDocumentsStore((s) => s.activePageIndex)
  const setActivePageIndex = useDocumentsStore((s) => s.setActivePageIndex)

  const flashTarget = useUiStore((s) => s.flashTarget)
  const clearFlashTarget = useUiStore((s) => s.clearFlashTarget)
  const recaptureTarget = useUiStore((s) => s.recaptureTarget)
  const clearRecaptureTarget = useUiStore((s) => s.clearRecaptureTarget)
  const setView = useUiStore((s) => s.setView)
  const combineMode = useUiStore((s) => s.combineMode)
  const toggleCombineMode = useUiStore((s) => s.toggleCombineMode)
  const addToBasket = useUiStore((s) => s.addToBasket)
  const generationSettings = useUiStore((s) => s.generationSettings)
  const createFromSources = useCardsStore((s) => s.createFromSources)
  const cards = useCardsStore((s) => s.cards)
  const focusCard = useUiStore((s) => s.focusCard)

  const [selectedElementIds, setSelectedElementIds] = useState<Set<string>>(new Set())
  const [flashBBox, setFlashBBox] = useState<BBox | null>(null)
  const [occlusionSource, setOcclusionSource] = useState<OcclusionSource | null>(null)
  const [pictureCardSource, setPictureCardSource] = useState<OcclusionSource | null>(null)
  // Which editor a free hand-drawn capture should feed into once the drag finishes — null means the
  // free-select overlay isn't active at all (ordinary element marquee-select is showing instead).
  // 'multi' feeds a captured region into the advanced modal's staged-images list instead of opening
  // a dedicated editor for it.
  const [freeSelectTarget, setFreeSelectTarget] = useState<'picture' | 'occlusion' | 'multi' | 'recapture' | null>(null)
  const [capturingScreenshot, setCapturingScreenshot] = useState(false)
  const [creatingCard, setCreatingCard] = useState(false)
  const [cardError, setCardError] = useState<string | null>(null)
  const [showCardSources, setShowCardSources] = useState(false)
  const [pictureMenuOpen, setPictureMenuOpen] = useState(false)
  const pictureMenuRef = useRef<HTMLDivElement>(null)

  // The advanced multi-image creation modal's whole form, lifted up here (not local state inside
  // the modal component) specifically so that "Add screenshot" can hide the modal, let a free drag
  // capture a region on the actual page underneath, and reopen it — without losing anything the
  // user already typed or arranged.
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [createFront, setCreateFront] = useState('')
  const [createBack, setCreateBack] = useState('')
  const [createHideUntilFlip, setCreateHideUntilFlip] = useState(false)
  const [stagedImages, setStagedImages] = useState<StagedImage[]>([])
  const [createSaving, setCreateSaving] = useState(false)
  const [createGenerating, setCreateGenerating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const createCard = useCardsStore((s) => s.createCard)

  useEffect(() => {
    if (!pictureMenuOpen) return
    function handleOutside(e: MouseEvent): void {
      if (pictureMenuRef.current && !pictureMenuRef.current.contains(e.target as Node)) setPictureMenuOpen(false)
    }
    window.addEventListener('mousedown', handleOutside)
    return () => window.removeEventListener('mousedown', handleOutside)
  }, [pictureMenuOpen])

  const pages = pagesByDocument[document.id] ?? []
  const page = pages[activePageIndex]
  const elements = page ? elementsByPage[page.id] ?? [] : []

  const cardSourcesOnPage = useMemo(() => {
    if (!page) return []
    const result: { card: CardRecord; source: CardRecord['sources'][number] }[] = []
    for (const card of cards) {
      for (const source of card.sources) {
        if (source.pageId === page.id) result.push({ card, source })
      }
    }
    return result
  }, [cards, page])

  useEffect(() => {
    if (!flashTarget || flashTarget.documentId !== document.id) return
    const pageIndex = pages.findIndex((p) => p.id === flashTarget.pageId)
    if (pageIndex === -1) return
    setActivePageIndex(pageIndex)
    setFlashBBox(flashTarget.bbox)
    const timer = setTimeout(() => {
      setFlashBBox(null)
      clearFlashTarget()
    }, 2400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashTarget, pages])

  // Re-armed on every document change (not just once) — switching documents while staying on the
  // 'library' view type does NOT remount DocumentViewer, so a plain init wouldn't survive the user
  // picking a different document than whatever MissingSourcesView auto-opened.
  useEffect(() => {
    if (recaptureTarget) setFreeSelectTarget('recapture')
  }, [recaptureTarget, document.id])

  // Left/right arrow keys step through slides, same as the prev/next toolbar buttons — suppressed
  // while typing anywhere (same guard as useDeleteSelectedCardsShortcut) or while an editor/modal
  // that might have its own use for arrow keys is open, so this never hijacks unrelated input.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      if (createModalOpen || freeSelectTarget !== null || occlusionSource !== null || pictureCardSource !== null) return
      const nextIndex = e.key === 'ArrowLeft' ? activePageIndex - 1 : activePageIndex + 1
      if (nextIndex < 0 || nextIndex >= pages.length) return
      e.preventDefault()
      setSelectedElementIds(new Set())
      setActivePageIndex(nextIndex)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activePageIndex, pages.length, createModalOpen, freeSelectTarget, occlusionSource, pictureCardSource, setActivePageIndex])

  const selectedElements = useMemo(
    () => elements.filter((e) => selectedElementIds.has(e.id)),
    [elements, selectedElementIds]
  )

  function toggleSelect(element: ElementRecord): void {
    setSelectedElementIds((prev) => {
      const next = new Set(prev)
      if (next.has(element.id)) next.delete(element.id)
      else next.add(element.id)
      return next
    })
  }

  function handleDragSelect(hits: ElementRecord[], additive: boolean): void {
    setSelectedElementIds((prev) => {
      const next = additive ? new Set(prev) : new Set<string>()
      for (const el of hits) next.add(el.id)
      return next
    })
  }

  /**
   * A multi-element selection on one slide normally becomes a single source: one rectangle
   * spanning everything selected, one backlink chip — not one source per word. With "split into
   * separate cards" on, each selected element becomes its own source instead, so the caller ends
   * up with one card per element rather than one combined card. Combine mode still ends up with
   * multiple sources overall either way, just one (or several) per "Add to combined card" press
   * rather than always exactly one.
   */
  function sourcesFromSelection(): PendingSource[] {
    if (!page || selectedElements.length === 0) return []
    if (generationSettings.splitIntoMultiple) {
      return selectedElements.map((el) => ({
        documentId: document.id,
        pageId: page.id,
        elementId: el.id,
        bbox: el.bbox,
        label: `${document.filename} · Slide ${page.pageIndex + 1}`,
        previewText: el.text,
        previewImagePath: el.imagePath
      }))
    }
    const bbox = unionBBox(selectedElements.map((el) => el.bbox))
    const previewText =
      selectedElements
        .map((el) => el.text)
        .filter((text): text is string => !!text)
        .join(' ') || null
    const previewImagePath = selectedElements.length === 1 ? selectedElements[0].imagePath : null

    return [
      {
        documentId: document.id,
        pageId: page.id,
        elementId: selectedElements.length === 1 ? selectedElements[0].id : null,
        bbox,
        label: `${document.filename} · Slide ${page.pageIndex + 1}`,
        previewText,
        previewImagePath
      }
    ]
  }

  async function handleCreateFlashcardClick(): Promise<void> {
    if (selectedElements.length === 0) return
    if (combineMode) {
      addToBasket(sourcesFromSelection())
      setSelectedElementIds(new Set())
      return
    }
    setCardError(null)
    setCreatingCard(true)
    try {
      const { errors } = await createFromSources(sourcesFromSelection(), generationSettings)
      if (errors.length > 0) setCardError(`Card saved, but AI generation failed: ${errors.join('; ')}`)
      setSelectedElementIds(new Set())
    } finally {
      setCreatingCard(false)
    }
  }

  const canOccludeExact = selectedElements.length === 1 && selectedElements[0].kind === 'image'

  /**
   * The actual crop+save, given an exact page-space bbox — shared by every screenshot-sourced
   * capture (occlusion, element-selection picture cards, and free-drawn picture cards below), none
   * of which are limited to elements the parser detected (a labeled diagram is usually vector
   * shapes + text, with nothing that parses as a single "image" to select).
   */
  async function cropAndSave(bbox: BBox): Promise<OcclusionSource | null> {
    if (!page || !page.backgroundImagePath) return null
    const backgroundDataUrl = await window.api.documents.getImage(page.backgroundImagePath)
    const croppedDataUrl = await cropImageDataUrl(backgroundDataUrl, bbox)
    const savedPath = await window.api.documents.saveImage(croppedDataUrl)
    return { imagePath: savedPath, bbox }
  }

  /** Crops the padded union of whatever elements are currently selected — not the pixel-tight
   *  union, since a selection that just barely clips the edge of what you meant to capture is the
   *  common case, not the exception, so the crop gets a margin instead of demanding a pixel-perfect
   *  selection. The padded box (not the tight one) is what gets recorded as the source's own bbox
   *  too — the occlusion editor converts mask coordinates back to page space relative to it. Still
   *  used by the picture-card element-selection path; occlusion now only ever comes from a free
   *  drag (see handleFreeCapture below) or canOccludeExact's direct single-image-element path. */
  async function captureScreenshotCrop(): Promise<OcclusionSource | null> {
    if (!page || selectedElements.length === 0) return null
    const bbox = padBBoxForCrop(unionBBox(selectedElements.map((el) => el.bbox)), page.width, page.height)
    return cropAndSave(bbox)
  }

  async function handleScreenshotPictureCard(): Promise<void> {
    setCapturingScreenshot(true)
    try {
      const source = await captureScreenshotCrop()
      if (source) setPictureCardSource(source)
    } finally {
      setCapturingScreenshot(false)
    }
  }

  /** The free-hand-drawn rectangle IS exactly what the user meant to capture — no padding here,
   *  unlike the element-selection path above, since there's no "just barely clipped the edge" risk
   *  when you're drawing the box yourself. Feeds into whichever editor freeSelectTarget names —
   *  'multi' appends to the advanced modal's staged images and reopens it instead of opening a
   *  dedicated editor. */
  async function handleFreeCapture(bbox: BBox): Promise<void> {
    const target = freeSelectTarget
    setCapturingScreenshot(true)
    try {
      const source = await cropAndSave(bbox)
      if (source) {
        if (target === 'recapture' && recaptureTarget && page) {
          await window.api.cards.recaptureOrphanedSource(recaptureTarget.orphanId, {
            documentId: document.id,
            pageId: page.id,
            bbox: source.bbox,
            imagePath: source.imagePath,
            sourceDocumentFilename: document.filename,
            sourcePageIndex: activePageIndex,
            sourceTimestampSeconds: null
          })
          clearRecaptureTarget()
          setView({ type: 'missing-sources' })
        } else if (target === 'occlusion') setOcclusionSource(source)
        else if (target === 'multi') {
          setStagedImages((prev) => [...prev, { id: crypto.randomUUID(), imagePath: source.imagePath, bbox: source.bbox, face: 'front' }])
          setCreateModalOpen(true)
        } else setPictureCardSource(source)
      }
      setFreeSelectTarget(null)
    } finally {
      setCapturingScreenshot(false)
    }
  }

  function handleRequestScreenshotForModal(): void {
    setCreateModalOpen(false)
    setFreeSelectTarget('multi')
  }

  function resetCreateModal(): void {
    setCreateModalOpen(false)
    setCreateFront('')
    setCreateBack('')
    setCreateHideUntilFlip(false)
    setStagedImages([])
    setCreateError(null)
  }

  function sourcesForStaged(images: StagedImage[]): NewCardSourceInput[] {
    return images.map((img) => ({
      documentId: document.id,
      pageId: page!.id,
      elementId: null,
      bbox: img.bbox,
      label: `${document.filename} · Slide ${page!.pageIndex + 1}`,
      imagePath: img.imagePath,
      imageFace: img.face
    }))
  }

  /** Shared by the plain Save and the Generate-with-AI buttons — the only difference is whether
   *  Claude gets a turn to rewrite the placeholder front/back afterward. Also handles doubleSided
   *  (from the shared generation settings): a reversed companion card, with both the text AND each
   *  image's face swapped, since "reversed" should mean the whole card flips, not just its text. */
  async function saveCreateModal(withAi: boolean): Promise<void> {
    if (withAi) setCreateGenerating(true)
    else setCreateSaving(true)
    setCreateError(null)
    try {
      // Images take precedence over the cloze setting — a cloze card is one passage with inline
      // blanks, no front/back split to hang per-face images off of.
      const cardType: CardType = stagedImages.length > 0 ? 'picture' : generationSettings.cloze ? 'cloze' : 'basic'
      const card = await createCard({
        front: createFront.trim() || 'Untitled',
        back: createBack.trim(),
        cardType,
        revealImageOnFlip: createHideUntilFlip,
        sources: sourcesForStaged(stagedImages)
      })

      let finalCard = card
      if (withAi) {
        const result = await window.api.ai.regenerate({
          cardId: card.id,
          front: card.front,
          back: card.back,
          sources: card.sources,
          instruction: generationSettings.customPrompt ?? undefined,
          complexity: generationSettings.complexity,
          cloze: cardType === 'cloze'
        })
        finalCard = await localCardsApi.applyAiRegeneration(card.id, { front: card.front, back: card.back }, result)
        useCardsStore.getState().setCards(useCardsStore.getState().cards.map((c) => (c.id === card.id ? finalCard : c)))
      }

      if (generationSettings.doubleSided && cardType !== 'cloze') {
        const swapped = stagedImages.map((img) => ({ ...img, face: img.face === 'front' ? ('back' as const) : ('front' as const) }))
        await createCard({
          front: finalCard.back,
          back: finalCard.front,
          cardType,
          revealImageOnFlip: createHideUntilFlip,
          sources: sourcesForStaged(swapped)
        })
      }

      resetCreateModal()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err))
    } finally {
      if (withAi) setCreateGenerating(false)
      else setCreateSaving(false)
    }
  }

  // Early return, before the "no pages yet" check below — a freshly-imported video legitimately
  // has zero pages until the user captures a frame, which would otherwise stick on "Loading
  // pages…" forever. Every hook above is still called unconditionally on every render either way
  // (rules of hooks); only the JSX branches here. The rest of this component (PageView, the
  // toolbar, screenshot-occlusion) is untouched and never reached for a video document.
  if (document.type === 'video') {
    return <VideoPlayer document={document} />
  }

  if (!page) {
    return <p>Loading pages…</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', flex: 1, minHeight: 0 }}>
      <header>
        <div style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>
          {document.type}
        </div>
        <h1 style={{ fontSize: 'var(--font-xxl)', margin: '2px 0 0', lineHeight: 1.2, overflowWrap: 'anywhere' }}>
          {document.filename}
        </h1>
      </header>

      <DocumentSummaryPanel document={document} />

      {recaptureTarget && (
        <div style={recaptureBannerStyle}>
          <span>
            Recapturing source for "{recaptureTarget.label}" — drag a region on this page.
          </span>
          <button
            onClick={() => {
              clearRecaptureTarget()
              setFreeSelectTarget(null)
            }}
            style={quietButtonStyle}
          >
            Cancel
          </button>
        </div>
      )}

      <div style={toolbarStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button
            disabled={activePageIndex === 0}
            onClick={() => {
              setSelectedElementIds(new Set())
              setActivePageIndex(activePageIndex - 1)
            }}
            style={segmentButtonStyle}
            title="Previous slide"
          >
            ←
          </button>
          <span style={{ fontSize: 'var(--font-sm)', color: 'var(--fg-muted)', padding: '0 6px', whiteSpace: 'nowrap' }}>
            {activePageIndex + 1} / {pages.length}
          </span>
          <button
            disabled={activePageIndex === pages.length - 1}
            onClick={() => {
              setSelectedElementIds(new Set())
              setActivePageIndex(activePageIndex + 1)
            }}
            style={segmentButtonStyle}
            title="Next slide"
          >
            →
          </button>
        </div>

        <span style={dividerStyle} />

        <button
          onClick={toggleCombineMode}
          style={{
            border: combineMode ? '1px solid var(--accent)' : '1px solid transparent',
            background: combineMode ? 'var(--accent-soft)' : 'transparent',
            color: combineMode ? 'var(--accent)' : 'var(--fg-muted)'
          }}
          title="When on, selections from any slide/document are gathered into one combined card instead of creating separate cards immediately."
        >
          🔗 Combine
        </button>

        <GenerationSettingsPanel />

        <button
          disabled={cardSourcesOnPage.length === 0}
          onClick={() => setShowCardSources((v) => !v)}
          style={{
            border: showCardSources ? '1px solid #af52de' : '1px solid transparent',
            background: showCardSources ? '#af52de1f' : 'transparent',
            color: showCardSources ? '#af52de' : 'var(--fg-muted)'
          }}
          title={
            cardSourcesOnPage.length === 0
              ? 'No flashcards sourced from this slide yet'
              : 'Outline where existing flashcards on this slide came from — hover a box for a preview, click to jump to it'
          }
        >
          🔖 {showCardSources ? 'Hide' : 'Show'} flashcards{cardSourcesOnPage.length > 0 ? ` (${cardSourcesOnPage.length})` : ''}
        </button>

        <div style={{ position: 'relative' }} ref={pictureMenuRef}>
          <button
            disabled={capturingScreenshot}
            onClick={() => {
              // Mid-drag, clicking the toggle again cancels the drag instead of reopening the menu
              // underneath it — the menu itself already closed the moment a free mode was picked.
              if (freeSelectTarget) {
                setFreeSelectTarget(null)
                return
              }
              setPictureMenuOpen((v) => !v)
            }}
            title="Create a picture card or image occlusion — free screenshot, or from the current selection"
            style={{
              border: pictureMenuOpen || freeSelectTarget ? '1px solid var(--accent)' : '1px solid transparent',
              background: pictureMenuOpen || freeSelectTarget ? 'var(--accent-soft)' : 'transparent',
              color: pictureMenuOpen || freeSelectTarget ? 'var(--accent)' : 'var(--fg-muted)'
            }}
          >
            {capturingScreenshot
              ? 'Capturing…'
              : freeSelectTarget === 'occlusion'
                ? '📸 Drag to capture…'
                : freeSelectTarget === 'picture'
                  ? '📷 Drag to capture…'
                  : '🖼️ Picture card'}
          </button>

          {pictureMenuOpen && (
            <div style={pictureMenuStyle} onClick={(e) => e.stopPropagation()}>
              <button
                style={pictureMenuItemStyle}
                onClick={() => {
                  setFreeSelectTarget('picture')
                  setSelectedElementIds(new Set())
                  setPictureMenuOpen(false)
                }}
              >
                📷 Free screenshot
                <span style={pictureMenuHintStyle}>Drag anywhere on the slide</span>
              </button>
              <button
                style={pictureMenuItemStyle}
                onClick={() => {
                  setFreeSelectTarget('occlusion')
                  setSelectedElementIds(new Set())
                  setPictureMenuOpen(false)
                }}
              >
                📸 Free occlusion
                <span style={pictureMenuHintStyle}>Drag anywhere on the slide</span>
              </button>
              <button
                disabled={selectedElements.length === 0 || capturingScreenshot}
                style={pictureMenuItemStyle}
                onClick={() => {
                  handleScreenshotPictureCard()
                  setPictureMenuOpen(false)
                }}
              >
                🖼️ Picture card from selection
                <span style={pictureMenuHintStyle}>
                  {selectedElements.length === 0 ? 'Select something on the slide first' : 'Uses the current selection'}
                </span>
              </button>
              <button
                disabled={!canOccludeExact}
                style={pictureMenuItemStyle}
                onClick={() => {
                  setOcclusionSource({ imagePath: selectedElements[0].imagePath!, bbox: selectedElements[0].bbox })
                  setPictureMenuOpen(false)
                }}
              >
                Occlude selected image
                <span style={pictureMenuHintStyle}>
                  {canOccludeExact ? 'Uses the selected image element directly' : 'Select a single detected image element first'}
                </span>
              </button>
            </div>
          )}
        </div>

        <button
          onClick={() => setCreateModalOpen(true)}
          style={quietButtonStyle}
          title="Open the full flashcard editor — front/back text, generation settings, and multiple screenshots placed on the front or back"
        >
          🗂️ Advanced Flashcard
        </button>

        <div style={{ flex: 1 }} />

        <span style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)', whiteSpace: 'nowrap' }}>
          {selectedElements.length > 0
            ? `${selectedElements.length} selected`
            : 'Drag to select · shift-drag to add'}
        </span>

        <button disabled={selectedElements.length === 0 || creatingCard} onClick={handleCreateFlashcardClick} style={primaryButtonStyle}>
          {combineMode ? 'Add to combined card' : creatingCard ? 'Generating…' : '✨ Create Flashcard'}
        </button>
      </div>

      {cardError && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', margin: 0 }}>{cardError}</p>}

      <div style={{ overflow: 'auto', flex: 1 }}>
        <PageView
          page={page}
          elements={elements}
          selectedIds={selectedElementIds}
          onToggleSelect={toggleSelect}
          onDragSelect={handleDragSelect}
          onClearSelection={() => setSelectedElementIds(new Set())}
          flashBBox={flashBBox}
          cardSources={showCardSources ? cardSourcesOnPage : []}
          onNavigateToCard={(card) => focusCard(card.id, card.folderId)}
          freeSelectMode={freeSelectTarget !== null}
          onFreeCapture={handleFreeCapture}
        />
      </div>

      {occlusionSource && page && (
        <OcclusionEditor
          documentId={document.id}
          pageId={page.id}
          documentLabel={document.filename}
          sourceLabel={`Slide ${page.pageIndex + 1}`}
          sourceImagePath={occlusionSource.imagePath}
          sourceBBox={occlusionSource.bbox}
          onClose={() => setOcclusionSource(null)}
          onSaved={() => {
            setOcclusionSource(null)
            setSelectedElementIds(new Set())
          }}
        />
      )}

      {pictureCardSource && page && (
        <PictureCardEditor
          documentId={document.id}
          pageId={page.id}
          documentLabel={document.filename}
          sourceLabel={`Slide ${page.pageIndex + 1}`}
          sourceImagePath={pictureCardSource.imagePath}
          sourceBBox={pictureCardSource.bbox}
          onClose={() => setPictureCardSource(null)}
          onSaved={() => {
            setPictureCardSource(null)
            setSelectedElementIds(new Set())
          }}
        />
      )}

      {/* Hidden (not unmounted just via a CSS toggle — genuinely not rendered) while a screenshot
          capture is in flight for it, so the free-select overlay over the actual page underneath
          isn't covered by the modal's own backdrop. All its form state lives in this component, not
          inside the modal, so hiding/reopening it this way never loses anything typed or arranged. */}
      {createModalOpen && freeSelectTarget !== 'multi' && (
        <CreateFlashcardModal
          front={createFront}
          onFrontChange={setCreateFront}
          back={createBack}
          onBackChange={setCreateBack}
          hideUntilFlip={createHideUntilFlip}
          onHideUntilFlipChange={setCreateHideUntilFlip}
          images={stagedImages}
          onImagesChange={setStagedImages}
          onRequestScreenshot={handleRequestScreenshotForModal}
          saving={createSaving}
          generating={createGenerating}
          error={createError}
          onClose={resetCreateModal}
          onSave={() => saveCreateModal(false)}
          onGenerateWithAi={() => saveCreateModal(true)}
        />
      )}
    </div>
  )
}

/** AI summary of the whole document (see aiService.summarizeDocument) — distinct from per-card
 *  generation, which works on one highlighted selection at a time. Collapsed by default once a
 *  summary exists, so it doesn't push the actual page content down every time the document opens. */
function DocumentSummaryPanel({ document }: { document: DocumentRecord }): JSX.Element {
  const summarizeDocument = useDocumentsStore((s) => s.summarizeDocument)
  const [expanded, setExpanded] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleGenerate(): Promise<void> {
    setGenerating(true)
    setError(null)
    try {
      await summarizeDocument(document.id)
      setExpanded(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate summary')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div style={summaryPanelStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        {document.summary && (
          <button onClick={() => setExpanded((v) => !v)} style={quietButtonStyle} title={expanded ? 'Collapse summary' : 'Expand summary'}>
            {expanded ? '▼' : '▶'} Summary
          </button>
        )}
        <button disabled={generating} onClick={handleGenerate} style={document.summary ? quietButtonStyle : primaryButtonStyle}>
          {generating ? 'Summarizing…' : document.summary ? '🔄 Regenerate summary' : '✨ Summarize document'}
        </button>
      </div>
      {error && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', margin: 0 }}>{error}</p>}
      {document.summary && expanded && (
        <p style={{ fontSize: 'var(--font-sm)', color: 'var(--fg-muted)', whiteSpace: 'pre-wrap', margin: 0, maxWidth: 720 }}>
          {document.summary}
        </p>
      )}
    </div>
  )
}
