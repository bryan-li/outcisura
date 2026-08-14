import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { formatDuration } from '../../utils/formatDuration'
import type { TimeRange } from '../../../../shared/types'

/** Smallest gap a drag is allowed to leave between the two handles — without this, dragging one
 *  handle past the other could produce a zero/negative-length range. Exported so the two-click
 *  keyframe start/end flow (VideoPlayer) rejects the same too-short ranges a drag would. */
export const MIN_RANGE_SECONDS = 0.5

export interface TimelineMarker {
  pageId: string
  timestampSeconds: number
  /** How many cards are sourced from this exact captured frame — usually 1, but a grouped-mask
   *  occlusion capture can produce several cards sharing one page. */
  cardCount: number
  /** The first/primary card's front text, or a fallback — shown in the hover tooltip. */
  label: string
  /** Set only for a marker whose page came from a transcribed range (mirrors flashedRange's own
   *  source) — hovering the marker outlines the whole span, not just its start point. */
  timestampEndSeconds: number | null
}

interface VideoTimelineProps {
  durationSeconds: number
  currentTime: number
  markers: TimelineMarker[]
  /** Briefly highlighted (matches PageView's own flash-pulse duration/animation) right after a
   *  card's "jump to source" click lands on this marker. */
  flashedPageId: string | null
  /** Set alongside flashedPageId when that marker's page came from a transcribed range — draws the
   *  whole span as a highlighted band (not just the point marker) so a transcript card's backlink
   *  shows exactly what was transcribed, not just where it started. */
  flashedRange: TimeRange | null
  onSeek: (timestampSeconds: number) => void
  /** When true, dragging on the bar marks a transcript range instead of seeking — click-to-seek and
   *  marker dots are suspended for the duration (a drag needs the whole bar as its hit target,
   *  which would otherwise fight with "click anywhere to jump there"). */
  rangeSelectMode: boolean
  /** The in-progress or finalized range, drawn as a highlighted band. Lives in the parent (not
   *  local state here) since the parent also needs it to know what to actually transcribe. */
  selectedRange: TimeRange | null
  onRangeChange: (range: TimeRange | null) => void
  /** Fired once, on mouseup, with the finalized range — distinct from onRangeChange (which fires
   *  continuously during the drag, purely to drive the live highlight band) so the parent can react
   *  exactly once to "a range was drawn" (e.g. auto-exiting range-select mode) without that logic
   *  re-running on every pixel of mouse movement. Not fired for a trivial sub-0.5s drag (an
   *  accidental click-and-release, not a real range). */
  onRangeSelected: (range: TimeRange) => void
  /** The paused instant "Set start" was clicked at, in the two-click alternative to dragging a
   *  range (see VideoPlayer) — drawn as a static point marker so it's visible on the timeline
   *  while waiting for "Set end," not just named in the side panel's text. Null the rest of the
   *  time, including once promoted to a real selectedRange. */
  draftStartSeconds: number | null
  /** Play/pause the video — wired to the spacebar while the timeline bar itself has focus (click
   *  the bar, or tab to it, to "select" it first). */
  onTogglePlay: () => void
}

const BAR_HEIGHT = 34
// Room reserved below the bar for the hover ruler's tick labels — the scroll container clips
// anything past its own box (it needs overflowY: hidden so a zoomed-in bar's edges don't spill
// out vertically), so without this the labels render but are invisibly cut off.
const TICK_LABEL_SPACE = 16
// Extra breathing room below the tick labels, past what they themselves need — at zoom > 1 the
// scroll container grows a horizontal scrollbar along its own bottom edge, and without this gap
// that scrollbar lands right on top of the tick labels rather than clear of them.
const SCROLLBAR_GAP = 12
const ZOOM_LEVELS = [1, 2, 4, 8, 16]

/** Candidate spacings (seconds) between ruler ticks, smallest first — tickIntervalSeconds picks
 *  the first one that keeps ticks from crowding at the bar's current rendered width. */
const TICK_INTERVALS_SECONDS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]
/** Ticks any closer together than this (in the bar's own pixels) start overlapping their labels. */
const MIN_TICK_SPACING_PX = 56

/** Picks the smallest tick spacing that still keeps consecutive tick labels readably apart at the
 *  bar's current pixel width — so zooming in reveals finer ticks instead of leaving big gaps. */
function tickIntervalSeconds(durationSeconds: number, barWidthPx: number): number {
  if (durationSeconds <= 0 || barWidthPx <= 0) return TICK_INTERVALS_SECONDS[0]
  for (const interval of TICK_INTERVALS_SECONDS) {
    const pxPerTick = (interval / durationSeconds) * barWidthPx
    if (pxPerTick >= MIN_TICK_SPACING_PX) return interval
  }
  return TICK_INTERVALS_SECONDS[TICK_INTERVALS_SECONDS.length - 1]
}

/** A slim duration bar with clickable/draggable marker dots at each captured-frame-that-became-a-
 *  flashcard timestamp — the video's only scrubbing surface (the native <video> element renders
 *  with no `controls` at all, since its built-in bar can't be annotated with custom marks, has no
 *  wheel-to-zoom, and can't be extended with a range-select drag mode). Zoom (below) just makes the
 *  bar itself wider inside a scroll container — every position calculation (percentFor/
 *  secondsAtClientX) already works off the bar's own actual rendered width via
 *  getBoundingClientRect, so zooming needed zero changes to that math. No chapter grouping though —
 *  just "where are my sources, and can I jump straight to one." Doubles as the
 *  drag surface for marking a transcript range (see rangeSelectMode) rather than adding a second bar
 *  — one drag target for "point in time" and "range of time" is less surface to learn than two. */
export function VideoTimeline({
  durationSeconds,
  currentTime,
  markers,
  flashedPageId,
  flashedRange,
  onSeek,
  rangeSelectMode,
  selectedRange,
  onRangeChange,
  onRangeSelected,
  draftStartSeconds,
  onTogglePlay
}: VideoTimelineProps): JSX.Element {
  const [hoveredPageId, setHoveredPageId] = useState<string | null>(null)
  const [barHovered, setBarHovered] = useState(false)
  const [barWidthPx, setBarWidthPx] = useState(0)
  const [dragStartSeconds, setDragStartSeconds] = useState<number | null>(null)
  const [draggingHandle, setDraggingHandle] = useState<'start' | 'end' | null>(null)
  // True while the playhead itself is mid-drag (mousedown-and-move anywhere on the bar, outside
  // range-select mode) — tracked separately from draggingHandle/dragStartSeconds since it drives a
  // plain onSeek call rather than a range boundary.
  const [scrubbing, setScrubbing] = useState(false)
  // The playhead's position while actively scrubbing — updated on every raw mousemove for a smooth
  // line, independent of `currentTime` (which only advances once the video has actually finished
  // seeking there). Without this split, the line's motion is at the mercy of how fast real seeks
  // resolve, which is jittery; with it, the line always tracks the cursor 1:1 and the actual seek
  // just does its best to keep up underneath.
  const [scrubPreviewSeconds, setScrubPreviewSeconds] = useState<number | null>(null)
  // Coalesces onSeek (and thus the real video.currentTime write) to once per animation frame during
  // a scrub — mousemove can fire far faster than the video element can actually seek, and issuing a
  // seek per event backs them up into a visibly laggy queue.
  const pendingSeekSecondsRef = useRef<number | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  // The bar itself gets wider than its scroll container at zoom > 1 (see the `width` on barRef's
  // own style below) — percentFor/secondsAtClientX don't need to know about zoom at all, since both
  // already work off the bar's own *actual rendered* width/position (getBoundingClientRect), not a
  // fixed constant. Zooming is "make the bar bigger," not "change the math."
  const [zoom, setZoom] = useState(1)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Set by the wheel handler right before a scroll-triggered zoom change, consumed (and cleared) by
  // the zoom-change effect below — see that handler for why.
  const zoomAnchorRef = useRef<{ seconds: number; viewportOffsetPx: number } | null>(null)

  // Handle drags track the mouse via window listeners (not just this element's own onMouseMove),
  // since a real drag routinely leaves the 28px-tall bar's bounds — an element-local listener would
  // silently stop updating the moment the cursor drifts a few pixels above or below it. Reading
  // selectedRange out of a ref (not the prop directly) in the mouseup handler sidesteps a stale
  // closure: the effect's listeners are set up once when the drag starts, but selectedRange keeps
  // changing (via onRangeChange) throughout the drag itself.
  const selectedRangeRef = useRef(selectedRange)
  useEffect(() => {
    selectedRangeRef.current = selectedRange
  }, [selectedRange])

  useEffect(() => {
    if (!draggingHandle) return
    function handleWindowMouseMove(e: MouseEvent): void {
      const seconds = secondsAtClientX(e.clientX)
      const current = selectedRangeRef.current
      if (!current) return
      if (draggingHandle === 'start') {
        onRangeChange({ startSeconds: Math.min(seconds, current.endSeconds - MIN_RANGE_SECONDS), endSeconds: current.endSeconds })
      } else {
        onRangeChange({ startSeconds: current.startSeconds, endSeconds: Math.max(seconds, current.startSeconds + MIN_RANGE_SECONDS) })
      }
    }
    function handleWindowMouseUp(): void {
      const current = selectedRangeRef.current
      if (current && current.endSeconds - current.startSeconds >= MIN_RANGE_SECONDS) onRangeSelected(current)
      setDraggingHandle(null)
    }
    window.addEventListener('mousemove', handleWindowMouseMove)
    window.addEventListener('mouseup', handleWindowMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove)
      window.removeEventListener('mouseup', handleWindowMouseUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggingHandle])

  // Tracks the bar's actual rendered width (which changes with zoom and window resizing) so tick
  // spacing can be recomputed to match — a stale width would either crowd labels together or leave
  // needlessly sparse ticks after a zoom change.
  useEffect(() => {
    const bar = barRef.current
    if (!bar) return
    const observer = new ResizeObserver(([entry]) => setBarWidthPx(entry.contentRect.width))
    observer.observe(bar)
    return () => observer.disconnect()
  }, [])

  // Window-level (not bar-local) listeners for the same reason the range-handle drag above uses
  // them: a real scrub drag routinely leaves the 28px-tall bar's bounds.
  useEffect(() => {
    if (!scrubbing) return
    function handleWindowMouseMove(e: MouseEvent): void {
      const seconds = secondsAtClientX(e.clientX)
      setScrubPreviewSeconds(seconds)
      pendingSeekSecondsRef.current = seconds
    }
    function handleWindowMouseUp(): void {
      // Flush whatever the last rAF tick hasn't gotten to yet, so the video ends up exactly where
      // the playhead line visually stopped rather than one frame behind it.
      if (pendingSeekSecondsRef.current !== null) {
        onSeek(pendingSeekSecondsRef.current)
        pendingSeekSecondsRef.current = null
      }
      setScrubbing(false)
      setScrubPreviewSeconds(null)
    }
    window.addEventListener('mousemove', handleWindowMouseMove)
    window.addEventListener('mouseup', handleWindowMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove)
      window.removeEventListener('mouseup', handleWindowMouseUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrubbing])

  useEffect(() => {
    if (!scrubbing) return
    function tick(): void {
      if (pendingSeekSecondsRef.current !== null) {
        onSeek(pendingSeekSecondsRef.current)
        pendingSeekSecondsRef.current = null
      }
      rafIdRef.current = requestAnimationFrame(tick)
    }
    rafIdRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrubbing])

  // A native (non-passive) listener, not React's onWheel — React attaches wheel listeners as
  // passive by default, which silently no-ops preventDefault and lets the gesture fall through to
  // scrolling the page instead of zooming the timeline. Predominantly-vertical movement (mouse
  // wheel, or a trackpad pinch/scroll reported as deltaY) zooms; predominantly-horizontal movement
  // is left alone so a trackpad's two-finger swipe still pans the zoomed-in bar via native scroll.
  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    function handleWheel(e: WheelEvent): void {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      e.preventDefault()
      // Record what's under the cursor right now (in both timeline-seconds and on-screen pixels)
      // so the zoom-change effect below can keep that exact point fixed under the cursor — an
      // editing-timeline convention, and the reason this doesn't just reuse zoomIn/zoomOut's
      // recenter-on-playhead behavior (that's for the +/- buttons, which have no cursor position to
      // anchor to).
      const rect = scrollRef.current?.getBoundingClientRect()
      if (rect) zoomAnchorRef.current = { seconds: secondsAtClientX(e.clientX), viewportOffsetPx: e.clientX - rect.left }
      if (e.deltaY < 0) zoomIn()
      else zoomOut()
    }
    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function percentFor(t: number): number {
    if (durationSeconds <= 0) return 0
    return Math.min(100, Math.max(0, (t / durationSeconds) * 100))
  }

  function secondsAtClientX(clientX: number): number {
    const rect = barRef.current?.getBoundingClientRect()
    if (!rect) return 0
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return fraction * durationSeconds
  }

  function zoomIn(): void {
    setZoom((z) => ZOOM_LEVELS[Math.min(ZOOM_LEVELS.indexOf(z) + 1, ZOOM_LEVELS.length - 1)])
  }

  function zoomOut(): void {
    setZoom((z) => ZOOM_LEVELS[Math.max(ZOOM_LEVELS.indexOf(z) - 1, 0)])
  }

  // Keep the same point fixed in view every time zoom changes: whatever was under the cursor for a
  // scroll/pinch zoom (zoomAnchorRef), or the playhead for a +/- button zoom (which has no cursor
  // position to anchor to) — otherwise zooming in routinely scrolls the one thing you're looking at
  // right out of view.
  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const anchor = zoomAnchorRef.current
    zoomAnchorRef.current = null
    const target = anchor
      ? (percentFor(anchor.seconds) / 100) * container.scrollWidth - anchor.viewportOffsetPx
      : (percentFor(currentTime) / 100) * container.scrollWidth - container.clientWidth / 2
    container.scrollLeft = Math.max(0, target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom])

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    if (rangeSelectMode) {
      setDragStartSeconds(secondsAtClientX(e.clientX))
      onRangeChange(null)
      return
    }
    // Seek immediately (so a plain click, with no movement, still jumps there) and keep tracking
    // the mouse via the window-listener effect above for as long as the button stays down.
    const seconds = secondsAtClientX(e.clientX)
    onSeek(seconds)
    setScrubPreviewSeconds(seconds)
    setScrubbing(true)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.code !== 'Space') return
    e.preventDefault() // otherwise the page scrolls, since the bar now holds keyboard focus
    onTogglePlay()
  }

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>): void {
    if (dragStartSeconds === null) return
    const current = secondsAtClientX(e.clientX)
    onRangeChange({ startSeconds: Math.min(dragStartSeconds, current), endSeconds: Math.max(dragStartSeconds, current) })
  }

  function handleMouseUp(): void {
    if (dragStartSeconds !== null && selectedRange && selectedRange.endSeconds - selectedRange.startSeconds >= MIN_RANGE_SECONDS) {
      onRangeSelected(selectedRange)
    }
    setDragStartSeconds(null)
  }

  function handleGripMouseDown(handle: 'start' | 'end', e: React.MouseEvent): void {
    if (e.button !== 0) return
    e.stopPropagation() // don't also let the bar's own handleMouseDown start a brand-new range drag
    setDraggingHandle(handle)
  }

  const tickSeconds: number[] = []
  if (barHovered && durationSeconds > 0) {
    const interval = tickIntervalSeconds(durationSeconds, barWidthPx)
    for (let t = 0; t <= durationSeconds; t += interval) tickSeconds.push(t)
  }

  const hoveredMarker = hoveredPageId ? markers.find((m) => m.pageId === hoveredPageId) : undefined

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button onClick={zoomOut} disabled={zoom === ZOOM_LEVELS[0]} title="Zoom out" style={zoomButtonStyle}>
          −
        </button>
        <span style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)', minWidth: 24, textAlign: 'center' }}>{zoom}×</span>
        <button onClick={zoomIn} disabled={zoom === ZOOM_LEVELS[ZOOM_LEVELS.length - 1]} title="Zoom in" style={zoomButtonStyle}>
          +
        </button>
        {zoom > 1 && (
          <button onClick={() => setZoom(1)} title="Reset zoom" style={{ ...zoomButtonStyle, width: 'auto', padding: '0 6px' }}>
            Reset
          </button>
        )}
      </div>
      <div
        ref={scrollRef}
        style={{ overflowX: zoom > 1 ? 'auto' : 'hidden', overflowY: 'hidden', height: BAR_HEIGHT + TICK_LABEL_SPACE + SCROLLBAR_GAP }}
      >
      <div
        ref={barRef}
        tabIndex={0}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseEnter={() => setBarHovered(true)}
        onMouseLeave={() => {
          handleMouseUp()
          setBarHovered(false)
        }}
        onKeyDown={handleKeyDown}
        title={rangeSelectMode ? 'Drag to mark a transcript range' : 'Click or drag to seek — space to play/pause'}
        style={{
          position: 'relative',
          height: BAR_HEIGHT,
          width: `${zoom * 100}%`,
          minWidth: '100%',
          borderRadius: 'var(--radius-md)',
          background: 'var(--bg-sidebar)',
          border: '1px solid var(--border)',
          cursor: rangeSelectMode ? 'text' : 'pointer',
          outline: 'none', // no default focus ring — tabIndex is here only so spacebar reaches handleKeyDown
          userSelect: 'none' // dragging across the ruler-tick labels shouldn't select their text
        }}
      >
        {tickSeconds.map((t) => (
          <div
            key={t}
            style={{
              position: 'absolute',
              left: `${percentFor(t)}%`,
              top: 0,
              bottom: 0,
              pointerEvents: 'none'
            }}
          >
            <div style={{ position: 'absolute', top: 0, bottom: 0, width: 1, background: 'var(--border)' }} />
            <div
              style={{
                position: 'absolute',
                top: '100%',
                marginTop: 2,
                left: 0,
                transform: t === 0 ? undefined : 'translateX(-50%)',
                fontSize: 10,
                color: 'var(--fg-faint)',
                whiteSpace: 'nowrap'
              }}
            >
              {formatDuration(t)}
            </div>
          </div>
        ))}

        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${percentFor(scrubPreviewSeconds ?? currentTime)}%`,
            width: 2,
            background: 'var(--accent)',
            pointerEvents: 'none'
          }}
        />

        {selectedRange && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${percentFor(selectedRange.startSeconds)}%`,
              width: `${percentFor(selectedRange.endSeconds) - percentFor(selectedRange.startSeconds)}%`,
              background: '#af52de3d',
              border: '1px solid #af52de',
              borderTop: 'none',
              borderBottom: 'none',
              pointerEvents: 'none'
            }}
          />
        )}

        {/* Distinct from selectedRange (the purple "what I'm marking right now" band, above) —
            accent-colored and pulsing, for "here's the range a backlinked card actually came
            from." The two are never both present: selectedRange only exists mid-mark, flashedRange
            only right after a backlink jump. */}
        {flashedRange && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${percentFor(flashedRange.startSeconds)}%`,
              width: `${Math.max(percentFor(flashedRange.endSeconds) - percentFor(flashedRange.startSeconds), 0.5)}%`,
              background: 'var(--accent-soft)',
              border: '1px solid var(--accent)',
              pointerEvents: 'none',
              animation: 'flash-pulse 1.2s ease-out 2'
            }}
          />
        )}

        {selectedRange && (
          <>
            <RangeHandle percent={percentFor(selectedRange.startSeconds)} onMouseDown={(e) => handleGripMouseDown('start', e)} />
            <RangeHandle percent={percentFor(selectedRange.endSeconds)} onMouseDown={(e) => handleGripMouseDown('end', e)} />
          </>
        )}

        {/* The two-click "Set start"/"Set end" alternative to dragging (see VideoPlayer) — same
            purple as the drag handles above, since it's marking the same kind of boundary, but
            static (no onMouseDown/cursor) since nothing here is draggable until "Set end" promotes
            it to a real selectedRange. */}
        {draftStartSeconds !== null && <StaticHandle percent={percentFor(draftStartSeconds)} />}

        {/* Hovering a marker that came from a transcribed range (not a single captured frame)
            previews that whole range — same band + start/end handle shape as selectedRange, but in
            the marker dot's own accent/orange (not selectedRange's purple, since this isn't an
            in-progress mark) and fading in rather than popping in instantly. */}
        {hoveredMarker?.timestampEndSeconds != null && (
          <>
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${percentFor(hoveredMarker.timestampSeconds)}%`,
                width: `${Math.max(percentFor(hoveredMarker.timestampEndSeconds) - percentFor(hoveredMarker.timestampSeconds), 0.5)}%`,
                background: 'var(--accent-soft)',
                border: '1px solid var(--accent)',
                borderTop: 'none',
                borderBottom: 'none',
                pointerEvents: 'none',
                animation: 'fade-in 0.15s ease-out'
              }}
            />
            <StaticHandle percent={percentFor(hoveredMarker.timestampSeconds)} color="var(--accent)" animate />
            <StaticHandle percent={percentFor(hoveredMarker.timestampEndSeconds)} color="var(--accent)" animate />
          </>
        )}

        {!rangeSelectMode &&
          markers.map((marker) => (
          <button
            key={marker.pageId}
            type="button"
            onMouseDown={(e) => e.stopPropagation()} // don't also let the bar's own handleMouseDown start a scrub from here
            onClick={(e) => {
              e.stopPropagation() // don't also trigger the bar's own seek-to-click-position
              onSeek(marker.timestampSeconds)
            }}
            onMouseEnter={() => setHoveredPageId(marker.pageId)}
            onMouseLeave={() => setHoveredPageId(null)}
            style={{
              ...markerDotStyle,
              left: `${percentFor(marker.timestampSeconds)}%`,
              animation: marker.pageId === flashedPageId ? 'flash-pulse 1.2s ease-out 2' : undefined
            }}
          />
        ))}

        {hoveredMarker && <MarkerTooltip marker={hoveredMarker} percent={percentFor(hoveredMarker.timestampSeconds)} />}
      </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-xs)', color: 'var(--fg-faint)' }}>
        <span>{formatDuration(0)}</span>
        <span>{formatDuration(durationSeconds)}</span>
      </div>
      {markers.length > 0 && (
        <div style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)' }}>
          {markers.length} source{markers.length === 1 ? '' : 's'} on this timeline — click a mark to jump to it
        </div>
      )}
    </div>
  )
}

/** A grab handle at one edge of the selected range — a thin vertical line plus a small circular
 *  grip that pokes above the bar, giving a bigger, easier-to-hit target than the 1-2px line alone
 *  would be. Dragging fine-tunes just this one boundary (see handleGripMouseDown) without needing
 *  to redraw the whole range from scratch. */
function RangeHandle({ percent, onMouseDown }: { percent: number; onMouseDown: (e: React.MouseEvent) => void }): JSX.Element {
  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        position: 'absolute',
        top: -6,
        bottom: 0,
        left: `${percent}%`,
        width: 12,
        transform: 'translateX(-50%)',
        cursor: 'ew-resize',
        zIndex: 5
      }}
    >
      <div
        style={{
          width: 10,
          height: 10,
          margin: '0 auto',
          borderRadius: '50%',
          background: '#af52de',
          border: '2px solid var(--bg)'
        }}
      />
      <div style={{ width: 2, height: BAR_HEIGHT - 4, margin: '0 auto', background: '#af52de' }} />
    </div>
  )
}

/** Same look as RangeHandle's grip + line, minus the drag affordance — used for points that aren't
 *  (yet, or ever) draggable: the two-click draft-start marker before "Set end" promotes it to a
 *  real selectedRange, and the start/end preview when hovering a marker's transcribed range. */
function StaticHandle({
  percent,
  color = '#af52de',
  animate = false
}: {
  percent: number
  color?: string
  animate?: boolean
}): JSX.Element {
  return (
    <div
      style={{
        position: 'absolute',
        top: -6,
        bottom: 0,
        left: `${percent}%`,
        width: 12,
        transform: 'translateX(-50%)',
        pointerEvents: 'none',
        zIndex: 5,
        animation: animate ? 'fade-in 0.15s ease-out' : undefined
      }}
    >
      <div
        style={{
          width: 10,
          height: 10,
          margin: '0 auto',
          borderRadius: '50%',
          background: color,
          border: '2px solid var(--bg)'
        }}
      />
      <div style={{ width: 2, height: BAR_HEIGHT - 4, margin: '0 auto', background: color }} />
    </div>
  )
}

function MarkerTooltip({ marker, percent }: { marker: TimelineMarker; percent: number }): JSX.Element {
  return (
    <div
      style={{
        position: 'absolute',
        left: `${percent}%`,
        bottom: '100%',
        marginBottom: 6,
        transform: 'translateX(-50%)',
        pointerEvents: 'none',
        zIndex: 10
      }}
    >
      <div style={tooltipStyle}>
        <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{marker.label}</div>
        <div style={{ color: 'var(--fg-muted)', marginTop: 2 }}>
          {formatDuration(marker.timestampSeconds)}
          {marker.cardCount > 1 ? ` · ${marker.cardCount} cards` : ''}
        </div>
      </div>
    </div>
  )
}

const zoomButtonStyle: CSSProperties = {
  width: 20,
  height: 20,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  fontSize: 'var(--font-sm)',
  lineHeight: 1,
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg)',
  color: 'var(--fg-muted)',
  cursor: 'pointer'
}

const markerDotStyle: CSSProperties = {
  position: 'absolute',
  top: '50%',
  width: 12,
  height: 12,
  margin: 0,
  padding: 0,
  borderRadius: '50%',
  border: '2px solid var(--bg)',
  background: 'var(--accent)',
  transform: 'translate(-50%, -50%)',
  cursor: 'pointer'
}

const tooltipStyle: CSSProperties = {
  maxWidth: 220,
  padding: '6px 8px',
  fontSize: 12,
  lineHeight: 1.3,
  background: 'var(--modal-bg)',
  color: 'var(--modal-fg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  boxShadow: '0 4px 16px #00000030'
}
