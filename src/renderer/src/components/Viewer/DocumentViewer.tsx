import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { BBox, CardRecord, DocumentRecord, ElementRecord } from '../../../../shared/types'
import { useDocumentsStore } from '../../state/documentsStore'
import { useCardsStore } from '../../state/cardsStore'
import { useUiStore } from '../../state/uiStore'
import { PageView } from './PageView'
import { VideoPlayer } from './VideoPlayer'
import { OcclusionEditor } from '../CardEditor/OcclusionEditor'
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

export function DocumentViewer({ document }: DocumentViewerProps): JSX.Element {
  const pagesByDocument = useDocumentsStore((s) => s.pagesByDocument)
  const elementsByPage = useDocumentsStore((s) => s.elementsByPage)
  const activePageIndex = useDocumentsStore((s) => s.activePageIndex)
  const setActivePageIndex = useDocumentsStore((s) => s.setActivePageIndex)

  const flashTarget = useUiStore((s) => s.flashTarget)
  const clearFlashTarget = useUiStore((s) => s.clearFlashTarget)
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
  const [capturingScreenshot, setCapturingScreenshot] = useState(false)
  const [creatingCard, setCreatingCard] = useState(false)
  const [cardError, setCardError] = useState<string | null>(null)
  const [showCardSources, setShowCardSources] = useState(false)

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
   * Occlusion isn't limited to elements the parser detected as images — a labeled diagram is
   * usually vector shapes + text, with nothing that parses as a single "image" to select. Instead,
   * crop a screenshot of whatever region is selected (any kind, any count) straight off the
   * page's own render and use that as the occlusion source.
   */
  async function handleScreenshotOcclusion(): Promise<void> {
    if (!page || !page.backgroundImagePath || selectedElements.length === 0) return
    setCapturingScreenshot(true)
    try {
      // Padded, not the pixel-tight union — a selection that just barely clips the edge of what
      // you meant to capture is the common case, not the exception, so the crop gets a margin
      // instead of demanding a pixel-perfect selection. The padded box (not the tight one) is what
      // gets recorded as the source's own bbox too, since that's what was actually captured — the
      // occlusion editor converts mask coordinates back to page space relative to this rectangle.
      const bbox = padBBoxForCrop(unionBBox(selectedElements.map((el) => el.bbox)), page.width, page.height)
      const backgroundDataUrl = await window.api.documents.getImage(page.backgroundImagePath)
      const croppedDataUrl = await cropImageDataUrl(backgroundDataUrl, bbox)
      const savedPath = await window.api.documents.saveImage(croppedDataUrl)
      setOcclusionSource({ imagePath: savedPath, bbox })
    } finally {
      setCapturingScreenshot(false)
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

        {canOccludeExact && (
          <button
            style={quietButtonStyle}
            onClick={() =>
              setOcclusionSource({ imagePath: selectedElements[0].imagePath!, bbox: selectedElements[0].bbox })
            }
          >
            Occlude image
          </button>
        )}
        {selectedElements.length > 0 && (
          <button disabled={capturingScreenshot} onClick={handleScreenshotOcclusion} style={quietButtonStyle}>
            {capturingScreenshot ? 'Capturing…' : '📸 Occlude region'}
          </button>
        )}

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
    </div>
  )
}
