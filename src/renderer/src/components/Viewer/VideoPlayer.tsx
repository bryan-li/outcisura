import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { BBox, DocumentRecord, ElementRecord, OcrEngine, PageRecord } from '../../../../shared/types'
import { videoSrc } from '../../utils/videoSrc'
import { formatDuration } from '../../utils/formatDuration'
import { unionBBox } from '../../utils/bbox'
import { VideoFrameSelector } from './VideoFrameSelector'
import { SelectableElementsOverlay } from './SelectableElementsOverlay'
import { VideoTimeline, type TimelineMarker } from './VideoTimeline'
import { OcclusionEditor } from '../CardEditor/OcclusionEditor'
import { GenerationSettingsPanel } from '../CardEditor/GenerationSettingsPanel'
import { cropImageDataUrl } from '../../utils/cropImage'
import { useCardsStore } from '../../state/cardsStore'
import { useDocumentsStore } from '../../state/documentsStore'
import { useUiStore } from '../../state/uiStore'

interface VideoPlayerProps {
  document: DocumentRecord
}

interface OcclusionSource {
  pageId: string
  imagePath: string
  bbox: BBox
  sourceLabel: string
}

// Same bare-localStorage pattern as ZoomControl.tsx — the only settings precedent in this app, not
// worth a new abstraction for a second instance of the same one-value pattern.
const OCR_ENGINE_KEY = 'ocr-engine'
const DEFAULT_OCR_ENGINE: OcrEngine = 'tesseract'

function readStoredEngine(): OcrEngine {
  const stored = window.localStorage.getItem(OCR_ENGINE_KEY)
  return stored === 'tesseract' || stored === 'claude-vision' ? stored : DEFAULT_OCR_ENGINE
}

export function VideoPlayer({ document }: VideoPlayerProps): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const createFromSources = useCardsStore((s) => s.createFromSources)
  const cards = useCardsStore((s) => s.cards)
  const generationSettings = useUiStore((s) => s.generationSettings)
  const registerPage = useDocumentsStore((s) => s.registerPage)
  const pagesByDocument = useDocumentsStore((s) => s.pagesByDocument)
  const updateLastPlaybackSeconds = useDocumentsStore((s) => s.updateLastPlaybackSeconds)
  const resumedRef = useRef(false)
  const currentTimeRef = useRef(0)
  const flashTarget = useUiStore((s) => s.flashTarget)
  const clearFlashTarget = useUiStore((s) => s.clearFlashTarget)

  // Mirrors PageView's own scale-to-fit-container approach exactly, so the video's rendered box
  // always matches its content with no CSS object-fit letterboxing to account for in the drag
  // coordinate math (see VideoFrameSelector / SelectableElementsOverlay).
  const [availableWidth, setAvailableWidth] = useState(900)
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null)
  const [paused, setPaused] = useState(true)
  const [selectMode, setSelectMode] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [occlusionSource, setOcclusionSource] = useState<OcclusionSource | null>(null)

  const [ocrEngine, setOcrEngine] = useState<OcrEngine>(readStoredEngine)
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrError, setOcrError] = useState<string | null>(null)
  const [ocrPage, setOcrPage] = useState<PageRecord | null>(null)
  const [ocrElements, setOcrElements] = useState<ElementRecord[] | null>(null)
  const [selectedElementIds, setSelectedElementIds] = useState<Set<string>>(new Set())
  const [creatingCard, setCreatingCard] = useState(false)

  const [currentTime, setCurrentTime] = useState(0)
  const [flashedPageId, setFlashedPageId] = useState<string | null>(null)

  // Persist on unmount too, not just onPause — switching to a different document/view while this
  // one is still playing doesn't fire a pause event, so without this the position would only ever
  // save if you happened to pause first. Reads currentTimeRef (kept in sync by onTimeUpdate) rather
  // than the `currentTime` state directly so this cleanup doesn't need to depend on—and thus rerun
  // on—every single timeupdate tick.
  useEffect(() => {
    return () => {
      if (currentTimeRef.current > 0) updateLastPlaybackSeconds(document.id, currentTimeRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document.id])

  // Every captured page belonging to this document that at least one card actually sources from —
  // "used as a source," not just "captured" (an OCR capture the user abandoned without creating a
  // card shouldn't clutter the timeline with a mark nothing points to).
  const markers = useMemo<TimelineMarker[]>(() => {
    const pages = pagesByDocument[document.id] ?? []
    const byPageId = new Map<string, PageRecord>(pages.map((p) => [p.id, p]))
    const grouped = new Map<string, { count: number; label: string }>()
    for (const card of cards) {
      for (const source of card.sources) {
        if (source.documentId !== document.id) continue
        const page = byPageId.get(source.pageId)
        if (!page || page.timestampSeconds === null) continue
        const existing = grouped.get(source.pageId)
        if (existing) existing.count += 1
        else grouped.set(source.pageId, { count: 1, label: card.front.trim() || 'Untitled' })
      }
    }
    return [...grouped.entries()]
      .map(([pageId, { count, label }]) => ({
        pageId,
        timestampSeconds: byPageId.get(pageId)!.timestampSeconds!,
        cardCount: count,
        label
      }))
      .sort((a, b) => a.timestampSeconds - b.timestampSeconds)
  }, [cards, pagesByDocument, document.id])

  // "Jump to source" (CardItem's 🔗 button) lands here exactly as it already does for PDF/PPTX —
  // goToSource is generic over {documentId, pageId, bbox}, so nothing upstream needed to change.
  // The one thing PDF/PPTX didn't need: resolving *this* page's timestamp requires it already being
  // in pagesByDocument, which is why captureFrame registers every page it creates (see below).
  useEffect(() => {
    if (!flashTarget || flashTarget.documentId !== document.id) return
    const page = (pagesByDocument[document.id] ?? []).find((p) => p.id === flashTarget.pageId)
    if (!page || page.timestampSeconds === null) return
    const video = videoRef.current
    if (video) {
      video.currentTime = page.timestampSeconds
      video.pause()
    }
    setFlashedPageId(page.id)
    const timer = setTimeout(() => {
      setFlashedPageId(null)
      clearFlashTarget()
    }, 2400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashTarget, pagesByDocument])

  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width) setAvailableWidth(width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const scale = dims ? Math.min(1, Math.min(900, availableWidth) / dims.width) : 1

  function updateOcrEngine(engine: OcrEngine): void {
    setOcrEngine(engine)
    window.localStorage.setItem(OCR_ENGINE_KEY, engine)
  }

  /** Shared prefix of both the occlusion flow and the OCR flow: draw the paused frame to an
   *  offscreen canvas at native resolution, save it, and create the page row it becomes. */
  async function captureFrame(): Promise<{ page: PageRecord; frameDataUrl: string }> {
    const video = videoRef.current
    if (!video || !dims) throw new Error('Video not ready')
    const canvas = window.document.createElement('canvas')
    canvas.width = dims.width
    canvas.height = dims.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(video, 0, 0, dims.width, dims.height)
    const frameDataUrl = canvas.toDataURL('image/png')

    const timestampSeconds = video.currentTime
    const backgroundImagePath = await window.api.documents.saveImage(frameDataUrl)
    const page = await window.api.documents.createVideoFramePage({
      documentId: document.id,
      timestampSeconds,
      width: dims.width,
      height: dims.height,
      backgroundImagePath
    })
    // Video frame pages don't go through documentsStore's normal openDocument fetch (they're
    // created one at a time, lazily) — without this, the page stays invisible to the rest of the
    // app: a card sourced from it couldn't resolve a timestamp to jump back to, and it would never
    // show up as a timeline marker.
    registerPage(document.id, page)
    return { page, frameDataUrl }
  }

  async function handleCapture(bbox: BBox): Promise<void> {
    setCaptureError(null)
    setCapturing(true)
    try {
      const { page, frameDataUrl } = await captureFrame()
      const croppedDataUrl = await cropImageDataUrl(frameDataUrl, bbox)
      const croppedPath = await window.api.documents.saveImage(croppedDataUrl)
      setOcclusionSource({
        pageId: page.id,
        imagePath: croppedPath,
        bbox,
        sourceLabel: `at ${formatDuration(page.timestampSeconds!)}`
      })
    } catch (err) {
      setCaptureError(err instanceof Error ? err.message : String(err))
    } finally {
      setCapturing(false)
    }
  }

  async function handleOcrCapture(): Promise<void> {
    setOcrError(null)
    setOcrLoading(true)
    try {
      const { page } = await captureFrame()
      const elements = await window.api.ocr.recognizePage({
        pageId: page.id,
        imagePath: page.backgroundImagePath!,
        width: page.width,
        height: page.height,
        engine: ocrEngine
      })
      setOcrPage(page)
      setOcrElements(elements)
      setSelectedElementIds(new Set())
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : String(err))
    } finally {
      setOcrLoading(false)
    }
  }

  const selectedElements = (ocrElements ?? []).filter((el) => selectedElementIds.has(el.id))

  async function handleCreateOcrFlashcard(): Promise<void> {
    if (!ocrPage || selectedElements.length === 0) return
    setCreatingCard(true)
    setCaptureError(null)
    try {
      const label = `${document.filename} · at ${formatDuration(ocrPage.timestampSeconds!)}`
      // Same split-into-separate-cards behavior as the PDF/PPTX viewer: normally every selected
      // bit of OCR'd text becomes one combined source, but with the setting on each one becomes
      // its own source (and so its own card) instead.
      const sources = generationSettings.splitIntoMultiple
        ? selectedElements.map((el) => ({
            documentId: document.id,
            pageId: ocrPage.id,
            elementId: el.id,
            bbox: el.bbox,
            label,
            previewText: el.text,
            previewImagePath: null
          }))
        : [
            {
              documentId: document.id,
              pageId: ocrPage.id,
              elementId: selectedElements.length === 1 ? selectedElements[0].id : null,
              bbox: unionBBox(selectedElements.map((el) => el.bbox)),
              label,
              previewText: selectedElements.map((el) => el.text).filter((t): t is string => !!t).join(' ') || null,
              previewImagePath: null
            }
          ]
      const { errors } = await createFromSources(sources, generationSettings)
      if (errors.length > 0) setCaptureError(`Card saved, but AI generation failed: ${errors.join('; ')}`)
      setSelectedElementIds(new Set())
    } finally {
      setCreatingCard(false)
    }
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
        <button
          disabled={!paused}
          onClick={() => setSelectMode((v) => !v)}
          title={paused ? 'Drag a region on the paused frame to make a flashcard from it' : 'Pause the video to select a region'}
          style={{
            border: selectMode ? '1px solid var(--accent)' : '1px solid transparent',
            background: selectMode ? 'var(--accent-soft)' : 'transparent',
            color: selectMode ? 'var(--accent)' : 'var(--fg-muted)'
          }}
        >
          ✂️ {selectMode ? 'Cancel select' : 'Select region'}
        </button>

        <span style={dividerStyle} />

        <button
          disabled={!paused || ocrLoading}
          onClick={handleOcrCapture}
          title={paused ? 'Read the text in this frame, then pick which words become a flashcard' : 'Pause the video to OCR this frame'}
          style={quietButtonStyle}
        >
          {ocrLoading ? 'Reading…' : '🔍 OCR this frame'}
        </button>
        <select
          value={ocrEngine}
          onChange={(e) => updateOcrEngine(e.target.value as OcrEngine)}
          title="Which engine reads text out of the frame"
          style={selectStyle}
        >
          <option value="tesseract">Tesseract (local)</option>
          <option value="claude-vision">Claude Vision (Sonnet 5)</option>
        </select>

        <span style={dividerStyle} />

        <GenerationSettingsPanel />

        {!paused && <span style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)' }}>Pause to select or OCR a frame</span>}
        {capturing && <span style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)' }}>Capturing…</span>}
      </div>

      {captureError && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', margin: 0 }}>{captureError}</p>}
      {ocrError && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', margin: 0 }}>{ocrError}</p>}
      {ocrElements && ocrElements.length === 0 && (
        <p style={{ color: 'var(--fg-muted)', fontSize: 'var(--font-sm)', margin: 0 }}>
          No text detected in this frame — try the other engine, or a moment with clearer on-screen text.
        </p>
      )}

      {ocrElements && (
        <div style={toolbarStyle}>
          <span style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)' }}>
            {selectedElements.length > 0 ? `${selectedElements.length} selected` : 'Drag to select detected text · shift-drag to add'}
          </span>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => {
              setOcrElements(null)
              setOcrPage(null)
              setSelectedElementIds(new Set())
            }}
            style={quietButtonStyle}
          >
            Done
          </button>
          <button disabled={selectedElements.length === 0 || creatingCard} onClick={handleCreateOcrFlashcard} style={primaryButtonStyle}>
            {creatingCard ? 'Creating…' : '✨ Create Flashcard'}
          </button>
        </div>
      )}

      <div ref={wrapperRef} style={{ width: '100%', overflow: 'auto', flex: 1 }}>
        <div style={{ position: 'relative', width: dims ? dims.width * scale : '100%' }}>
          <video
            ref={videoRef}
            src={videoSrc(document.sourceVideoPath!)}
            controls
            onLoadedMetadata={(e) => {
              const v = e.currentTarget
              setDims({ width: v.videoWidth, height: v.videoHeight })
              // Once per mount (resumedRef), not on every metadata event — resume where the last
              // session left off. document.lastPlaybackSeconds only ever comes from this same
              // document's own prior playback, so no bounds-checking against duration needed here
              // the way the page-index resume needs clamping (a document's own duration doesn't
              // shrink between sessions the way its page count could change).
              if (!resumedRef.current) {
                resumedRef.current = true
                if (document.lastPlaybackSeconds) v.currentTime = document.lastPlaybackSeconds
              }
            }}
            onPause={() => {
              setPaused(true)
              updateLastPlaybackSeconds(document.id, currentTimeRef.current)
            }}
            onPlay={() => {
              setPaused(false)
              setSelectMode(false)
              setOcrElements(null)
              setOcrPage(null)
            }}
            onTimeUpdate={(e) => {
              currentTimeRef.current = e.currentTarget.currentTime
              setCurrentTime(e.currentTarget.currentTime)
            }}
            style={{
              display: 'block',
              width: dims ? dims.width * scale : '100%',
              height: dims ? dims.height * scale : undefined,
              borderRadius: 'var(--radius-lg)',
              background: '#000'
            }}
          />
          {selectMode && paused && dims && (
            <VideoFrameSelector nativeWidth={dims.width} nativeHeight={dims.height} onCapture={handleCapture} />
          )}
          {ocrElements && dims && (
            <SelectableElementsOverlay
              width={dims.width}
              height={dims.height}
              elements={ocrElements}
              selectedIds={selectedElementIds}
              onToggleSelect={(el) =>
                setSelectedElementIds((prev) => {
                  const next = new Set(prev)
                  if (next.has(el.id)) next.delete(el.id)
                  else next.add(el.id)
                  return next
                })
              }
              onDragSelect={(hits, additive) =>
                setSelectedElementIds((prev) => {
                  const next = additive ? new Set(prev) : new Set<string>()
                  for (const el of hits) next.add(el.id)
                  return next
                })
              }
              onClearSelection={() => setSelectedElementIds(new Set())}
            />
          )}
        </div>
      </div>

      {document.durationSeconds !== null && (
        <VideoTimeline
          durationSeconds={document.durationSeconds}
          currentTime={currentTime}
          markers={markers}
          flashedPageId={flashedPageId}
          onSeek={(t) => {
            const video = videoRef.current
            if (!video) return
            video.currentTime = t
            video.pause()
          }}
        />
      )}

      {occlusionSource && (
        <OcclusionEditor
          documentId={document.id}
          pageId={occlusionSource.pageId}
          documentLabel={document.filename}
          sourceLabel={occlusionSource.sourceLabel}
          sourceImagePath={occlusionSource.imagePath}
          sourceBBox={occlusionSource.bbox}
          onClose={() => setOcclusionSource(null)}
          onSaved={() => {
            setOcclusionSource(null)
            setSelectMode(false)
          }}
        />
      )}
    </div>
  )
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

const dividerStyle: CSSProperties = {
  width: 1,
  height: 18,
  background: 'var(--border)',
  flexShrink: 0
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

const selectStyle: CSSProperties = {
  fontSize: 'var(--font-sm)',
  padding: '4px 6px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg)',
  color: 'inherit'
}
