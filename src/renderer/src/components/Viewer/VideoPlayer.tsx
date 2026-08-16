import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { BBox, DocumentRecord, ElementRecord, OcrEngine, PageRecord, TimeRange, TranscriptionEngine } from '../../../../shared/types'
import { videoSrc } from '../../utils/videoSrc'
import { formatDuration } from '../../utils/formatDuration'
import { unionBBox } from '../../utils/bbox'
import { decodeVideoAudio, sliceForTranscription } from '../../utils/audioSlice'
import { VideoFrameSelector } from './VideoFrameSelector'
import { SelectableElementsOverlay } from './SelectableElementsOverlay'
import { VideoTimeline, type TimelineMarker, MIN_RANGE_SECONDS } from './VideoTimeline'
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

const TRANSCRIPTION_ENGINE_KEY = 'transcription-engine'
const DEFAULT_TRANSCRIPTION_ENGINE: TranscriptionEngine = 'whisper-local'

function readStoredTranscriptionEngine(): TranscriptionEngine {
  const stored = window.localStorage.getItem(TRANSCRIPTION_ENGINE_KEY)
  return stored === 'whisper-local' || stored === 'openai-whisper' ? stored : DEFAULT_TRANSCRIPTION_ENGINE
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
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
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

  const [transcriptionEngine, setTranscriptionEngine] = useState<TranscriptionEngine>(readStoredTranscriptionEngine)
  const [rangeSelectMode, setRangeSelectMode] = useState(false)
  const [selectedRange, setSelectedRange] = useState<TimeRange | null>(null)
  // The paused instant "Set start" was clicked at — an alternative to dragging on the timeline for
  // marking a range, one frame-accurate pause+click at a time rather than a mouse drag. Promoted to
  // a real selectedRange once "Set end" lands on a second paused instant at least MIN_RANGE_SECONDS
  // later; cleared either way (promoted, or cancelled by hand).
  const [draftStartSeconds, setDraftStartSeconds] = useState<number | null>(null)
  const [transcribing, setTranscribing] = useState(false)
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null)
  const [transcriptPage, setTranscriptPage] = useState<PageRecord | null>(null)
  const [transcript, setTranscript] = useState<string | null>(null)
  // Decoding a video's whole audio track is the expensive part (not the transcription call itself)
  // — cached per document so hitting "Transcribe" repeatedly on the same video doesn't redo it.
  // Invalidated below whenever the document itself changes, since VideoPlayer doesn't remount just
  // because the active document switched (App.tsx's viewKey is 'library' for every video).
  const audioBufferRef = useRef<AudioBuffer | null>(null)
  useEffect(() => {
    audioBufferRef.current = null
  }, [document.id])

  const [currentTime, setCurrentTime] = useState(0)
  const [flashedPageId, setFlashedPageId] = useState<string | null>(null)
  // Set alongside flashedPageId when the backlinked page came from a transcribed range (has a
  // timestampEndSeconds) — lets the timeline highlight the whole span the card came from, not
  // just flash a point at its start.
  const [flashedRange, setFlashedRange] = useState<TimeRange | null>(null)

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
        if (source.documentId !== document.id || source.pageId === null) continue
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
        label,
        timestampEndSeconds: byPageId.get(pageId)!.timestampEndSeconds
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
    setFlashedRange(page.timestampEndSeconds !== null ? { startSeconds: page.timestampSeconds, endSeconds: page.timestampEndSeconds } : null)
    const timer = setTimeout(() => {
      setFlashedPageId(null)
      setFlashedRange(null)
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

  /** Frame-accurate skip, clamped to the video's own bounds — no-ops silently if the video/duration
   *  isn't loaded yet (matches the toolbar's other buttons, which are just inert until then). */
  function skip(deltaSeconds: number): void {
    const v = videoRef.current
    if (!v || !Number.isFinite(v.duration)) return
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + deltaSeconds))
  }

  function updateVolume(next: number): void {
    setVolume(next)
    setMuted(false)
    const v = videoRef.current
    if (v) {
      v.volume = next
      v.muted = false
    }
  }

  function toggleMute(): void {
    const next = !muted
    setMuted(next)
    const v = videoRef.current
    if (v) v.muted = next
  }

  function updatePlaybackRate(rate: number): void {
    setPlaybackRate(rate)
    const v = videoRef.current
    if (v) v.playbackRate = rate
  }

  function updateOcrEngine(engine: OcrEngine): void {
    setOcrEngine(engine)
    window.localStorage.setItem(OCR_ENGINE_KEY, engine)
  }

  /** Shared prefix of both the occlusion flow and the OCR flow: draw the paused frame to an
   *  offscreen canvas at native resolution, save it, and create the page row it becomes.
   *  `timestampEndSeconds` is set only by the transcript-range flow — see PageRecord's own field. */
  async function captureFrame(timestampEndSeconds?: number): Promise<{ page: PageRecord; frameDataUrl: string }> {
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
      backgroundImagePath,
      timestampEndSeconds
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

  function updateTranscriptionEngine(engine: TranscriptionEngine): void {
    setTranscriptionEngine(engine)
    window.localStorage.setItem(TRANSCRIPTION_ENGINE_KEY, engine)
  }

  /** Transcribes one already-decoded audio slice and ships it over IPC — a defensive byte-range
   *  slice first, same as documentsConvertPptxToPdf's return: getChannelData's view could in
   *  principle have a nonzero byteOffset, and IPC should ship exactly these bytes, not whatever else
   *  happens to share the same underlying buffer. */
  async function transcribeSlice(range: TimeRange): Promise<string> {
    const audioData = await sliceForTranscription(audioBufferRef.current!, range.startSeconds, range.endSeconds)
    return window.api.transcription.transcribe({
      audioData: audioData.buffer.slice(audioData.byteOffset, audioData.byteOffset + audioData.byteLength) as ArrayBuffer,
      engine: transcriptionEngine
    })
  }

  /** Transcribes a user-marked [start,end) range, reusing whatever's already been transcribed for
   *  this document+engine instead of re-running Whisper over audio it's already seen — see
   *  repository.getTranscriptCoverage. Only the still-uncovered gaps actually get transcribed; the
   *  final text is existing + new segments stitched back together in time order. Switching engines
   *  gets no free reuse: coverage is looked up per-engine on purpose, since it's a deliberate
   *  "redo this with a different model" choice. */
  async function handleTranscribeRange(range: TimeRange): Promise<void> {
    setTranscriptionError(null)
    setTranscribing(true)
    try {
      if (!audioBufferRef.current) {
        audioBufferRef.current = await decodeVideoAudio(videoSrc(document.sourceVideoPath!))
      }

      const coverage = await window.api.transcription.getCoverage({ documentId: document.id, engine: transcriptionEngine, range })
      const newSegments: { startSeconds: number; text: string }[] = []
      for (const gap of coverage.gaps) {
        const text = await transcribeSlice(gap)
        await window.api.transcription.saveSegment({ documentId: document.id, engine: transcriptionEngine, range: gap, text })
        newSegments.push({ startSeconds: gap.startSeconds, text })
      }

      const stitched = [...coverage.existingSegments, ...newSegments]
        .sort((a, b) => a.startSeconds - b.startSeconds)
        .map((s) => s.text)
        .filter((t) => t.trim() !== '')
        .join(' ')

      // Seek to the range's start before capturing, so the source thumbnail attached to the
      // resulting card shows something meaningful — the video could otherwise be paused anywhere
      // when a range gets marked (it's drawn on the timeline, not tied to the current playhead the
      // way OCR/select-region are). For a range built via "Set start"/"Set end" this is already
      // the exact frame the user deliberately paused on; a dragged range just uses wherever it starts.
      const video = videoRef.current
      if (video) video.currentTime = range.startSeconds
      const { page } = await captureFrame(range.endSeconds)
      setTranscriptPage(page)
      setTranscript(stitched)
      setSelectedRange(null)
    } catch (err) {
      setTranscriptionError(err instanceof Error ? err.message : String(err))
    } finally {
      setTranscribing(false)
    }
  }

  /** The two-click alternative to dragging on the timeline: pause at the desired start and click
   *  "Set start," then pause at the desired end and click "Set end." Rejects an end that lands too
   *  close to (or before) the start, same threshold a drag enforces, so this can't produce a range
   *  the transcribe flow wouldn't already accept from a drag. */
  function handleSetStart(): void {
    const t = videoRef.current?.currentTime
    if (t === undefined) return
    setDraftStartSeconds(t)
  }

  function handleSetEnd(): void {
    const t = videoRef.current?.currentTime
    if (t === undefined || draftStartSeconds === null) return
    const startSeconds = Math.min(draftStartSeconds, t)
    const endSeconds = Math.max(draftStartSeconds, t)
    if (endSeconds - startSeconds < MIN_RANGE_SECONDS) return
    setSelectedRange({ startSeconds, endSeconds })
    setDraftStartSeconds(null)
  }

  async function handleCreateTranscriptFlashcard(): Promise<void> {
    if (!transcriptPage || !transcript) return
    setCreatingCard(true)
    setCaptureError(null)
    try {
      const label = `${document.filename} · at ${formatDuration(transcriptPage.timestampSeconds!)}`
      const sources = [
        {
          documentId: document.id,
          pageId: transcriptPage.id,
          elementId: null,
          bbox: { x: 0, y: 0, w: transcriptPage.width, h: transcriptPage.height },
          label,
          previewText: transcript,
          previewImagePath: null
        }
      ]
      const { errors } = await createFromSources(sources, generationSettings)
      if (errors.length > 0) setCaptureError(`Card saved, but AI generation failed: ${errors.join('; ')}`)
      setTranscript(null)
      setTranscriptPage(null)
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

        <button
          disabled={!paused || transcribing}
          onClick={() => {
            setRangeSelectMode((v) => !v)
            setSelectedRange(null)
            setDraftStartSeconds(null)
          }}
          title={paused ? 'Drag on the timeline below to mark a range to transcribe' : 'Pause the video to mark a transcript range'}
          style={{
            border: rangeSelectMode ? '1px solid var(--accent)' : '1px solid transparent',
            background: rangeSelectMode ? 'var(--accent-soft)' : 'transparent',
            color: rangeSelectMode ? 'var(--accent)' : 'var(--fg-muted)'
          }}
        >
          🎙️ {rangeSelectMode ? 'Cancel range' : 'Mark transcript range'}
        </button>
        <select
          value={transcriptionEngine}
          onChange={(e) => updateTranscriptionEngine(e.target.value as TranscriptionEngine)}
          title="Which engine transcribes the audio"
          style={selectStyle}
        >
          <option value="whisper-local">Whisper-tiny (local)</option>
          <option value="openai-whisper">OpenAI Whisper</option>
        </select>

        <span style={dividerStyle} />

        <GenerationSettingsPanel />
      </div>

      {captureError && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', margin: 0 }}>{captureError}</p>}
      {ocrError && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', margin: 0 }}>{ocrError}</p>}
      {transcriptionError && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-sm)', margin: 0 }}>{transcriptionError}</p>}

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

      {/* Video + the transcript-range side panel share one row with a fixed-width right column —
          reserved whether or not a range is currently marked, so marking one only changes the
          column's *content*, never the video's own available width. A panel that only appears on
          demand (the old layout) would still resize/shift the video the moment it showed up. */}
      <div style={{ display: 'flex', gap: 'var(--space-3)', flex: 1, minHeight: 0 }}>
        <div ref={wrapperRef} style={{ width: '100%', overflow: 'auto', flex: 1, minWidth: 0 }}>
        <div style={{ position: 'relative', width: dims ? dims.width * scale : '100%' }}>
          <video
            ref={videoRef}
            src={videoSrc(document.sourceVideoPath!)}
            onClick={() => {
              if (selectMode || ocrElements) return // let the capture overlay handle the click instead
              const v = videoRef.current
              if (!v) return
              if (v.paused) v.play()
              else v.pause()
            }}
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
              setTranscript(null)
              setTranscriptPage(null)
              // Deliberately NOT clearing rangeSelectMode/selectedRange here — pressing play to
              // scrub through (or double-check) a marked range you're about to transcribe used to
              // wipe it, which meant using playback at all cost you your marker. The range-marking
              // toolbar buttons already stay disabled while playing (see `disabled={!paused}`
              // below), so nothing lets you START a new drag mid-playback anyway — this only stops
              // an *existing* mark/mode from being thrown away.
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

        <div style={rangeSidePanelStyle}>
          {transcript !== null ? (
            transcript.trim() === '' ? (
              <>
                <div style={{ fontSize: 'var(--font-sm)', fontWeight: 600 }}>No speech detected</div>
                <div style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)' }}>
                  Try the other engine, or a range with clearer audio.
                </div>
                <button
                  onClick={() => {
                    setTranscript(null)
                    setTranscriptPage(null)
                  }}
                  style={{ ...quietButtonStyle, marginTop: 'auto' }}
                >
                  Done
                </button>
              </>
            ) : (
              <>
                <div style={{ fontSize: 'var(--font-sm)', fontWeight: 600 }}>Transcript</div>
                <div style={{ fontSize: 'var(--font-sm)', overflowY: 'auto', flex: 1 }}>{transcript}</div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'auto' }}>
                  <button
                    onClick={() => {
                      setTranscript(null)
                      setTranscriptPage(null)
                    }}
                    style={quietButtonStyle}
                  >
                    Done
                  </button>
                  <button disabled={creatingCard} onClick={handleCreateTranscriptFlashcard} style={primaryButtonStyle}>
                    {creatingCard ? 'Creating…' : '✨ Create Flashcard'}
                  </button>
                </div>
              </>
            )
          ) : selectedRange ? (
            <>
              <div style={{ fontSize: 'var(--font-sm)', fontWeight: 600 }}>Transcript range</div>
              <div style={{ fontSize: 'var(--font-sm)', color: 'var(--fg-muted)' }}>
                {formatDuration(selectedRange.startSeconds)} – {formatDuration(selectedRange.endSeconds)} (
                {formatDuration(selectedRange.endSeconds - selectedRange.startSeconds)})
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'auto' }}>
                <button disabled={transcribing} onClick={() => setSelectedRange(null)} style={quietButtonStyle}>
                  Cancel
                </button>
                <button disabled={transcribing} onClick={() => handleTranscribeRange(selectedRange)} style={primaryButtonStyle}>
                  {transcribing ? 'Transcribing…' : '🎙️ Transcribe'}
                </button>
              </div>
            </>
          ) : draftStartSeconds !== null ? (
            <>
              <div style={{ fontSize: 'var(--font-sm)', fontWeight: 600 }}>Transcript range</div>
              <div style={{ fontSize: 'var(--font-sm)', color: 'var(--fg-muted)' }}>
                Start set at {formatDuration(draftStartSeconds)} — pause where you want it to end, then set the end.
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'auto' }}>
                <button onClick={() => setDraftStartSeconds(null)} style={quietButtonStyle}>
                  Cancel
                </button>
                <button disabled={!paused} onClick={handleSetEnd} title={paused ? undefined : 'Pause the video to set the end'} style={primaryButtonStyle}>
                  🏁 Set end here
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)' }}>
                Drag on the timeline below, or pause here and set a start, to mark a range to transcribe.
              </div>
              <button
                disabled={!paused}
                onClick={handleSetStart}
                title={paused ? undefined : 'Pause the video to set a start'}
                style={{ ...quietButtonStyle, marginTop: 'auto' }}
              >
                📍 Set start here
              </button>
            </>
          )}
        </div>
      </div>

      <div style={toolbarStyle}>
        <button onClick={() => skip(-10)} title="Back 10 seconds" style={quietButtonStyle}>
          ⏪ 10s
        </button>
        <button
          onClick={() => {
            const v = videoRef.current
            if (!v) return
            if (v.paused) v.play()
            else v.pause()
          }}
          title={paused ? 'Play (or press space with the timeline below selected)' : 'Pause'}
          style={{ ...quietButtonStyle, width: 76, textAlign: 'center' }}
        >
          {paused ? '▶️ Play' : '⏸️ Pause'}
        </button>
        <button onClick={() => skip(10)} title="Forward 10 seconds" style={quietButtonStyle}>
          10s ⏩
        </button>

        <span style={dividerStyle} />

        <button onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'} style={quietButtonStyle}>
          {muted || volume === 0 ? '🔇' : volume < 0.5 ? '🔉' : '🔊'}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={(e) => updateVolume(Number(e.target.value))}
          title="Volume"
          style={{ width: 70 }}
        />
        <select
          value={playbackRate}
          onChange={(e) => updatePlaybackRate(Number(e.target.value))}
          title="Playback speed"
          style={selectStyle}
        >
          {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
            <option key={rate} value={rate}>
              {rate}×
            </option>
          ))}
        </select>

        {!paused && <span style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)' }}>Pause to select, OCR, or mark a transcript range</span>}
        {capturing && <span style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)' }}>Capturing…</span>}
      </div>

      {document.durationSeconds !== null && (
        <VideoTimeline
          durationSeconds={document.durationSeconds}
          currentTime={currentTime}
          markers={markers}
          flashedPageId={flashedPageId}
          flashedRange={flashedRange}
          onSeek={(t) => {
            const video = videoRef.current
            if (!video) return
            video.currentTime = t
            video.pause()
          }}
          rangeSelectMode={rangeSelectMode}
          selectedRange={selectedRange}
          onRangeChange={setSelectedRange}
          onRangeSelected={(range) => {
            setSelectedRange(range)
            setRangeSelectMode(false)
            setDraftStartSeconds(null)
          }}
          draftStartSeconds={draftStartSeconds}
          onTogglePlay={() => {
            const v = videoRef.current
            if (!v) return
            if (v.paused) v.play()
            else v.pause()
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

const rangeSidePanelStyle: CSSProperties = {
  width: 220,
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
  padding: 'var(--space-3)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--bg-sidebar)'
}

const toolbarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  flexWrap: 'wrap',
  padding: '6px 8px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--bg-sidebar)',
  // Now that this sits between the video and the timeline (not flush against other bars), a
  // floating look reads better than a flat inline strip.
  boxShadow: '0 4px 16px #00000020'
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
