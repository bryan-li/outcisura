import { useState, type CSSProperties } from 'react'
import { formatDuration } from '../../utils/formatDuration'

export interface TimelineMarker {
  pageId: string
  timestampSeconds: number
  /** How many cards are sourced from this exact captured frame — usually 1, but a grouped-mask
   *  occlusion capture can produce several cards sharing one page. */
  cardCount: number
  /** The first/primary card's front text, or a fallback — shown in the hover tooltip. */
  label: string
}

interface VideoTimelineProps {
  durationSeconds: number
  currentTime: number
  markers: TimelineMarker[]
  /** Briefly highlighted (matches PageView's own flash-pulse duration/animation) right after a
   *  card's "jump to source" click lands on this marker. */
  flashedPageId: string | null
  onSeek: (timestampSeconds: number) => void
}

const BAR_HEIGHT = 28

/** A slim duration bar with clickable marker dots at each captured-frame-that-became-a-flashcard
 *  timestamp — a second, purpose-built scrubbing surface alongside the native <video controls> bar,
 *  since native controls can't be annotated with custom marks. Deliberately simple: no zoom, no
 *  chapter grouping — just "where are my sources, and can I jump straight to one." */
export function VideoTimeline({ durationSeconds, currentTime, markers, flashedPageId, onSeek }: VideoTimelineProps): JSX.Element {
  const [hoveredPageId, setHoveredPageId] = useState<string | null>(null)

  function percentFor(t: number): number {
    if (durationSeconds <= 0) return 0
    return Math.min(100, Math.max(0, (t / durationSeconds) * 100))
  }

  function handleBarClick(e: React.MouseEvent<HTMLDivElement>): void {
    const rect = e.currentTarget.getBoundingClientRect()
    const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    onSeek(fraction * durationSeconds)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div
        onClick={handleBarClick}
        title="Click to seek"
        style={{
          position: 'relative',
          height: BAR_HEIGHT,
          borderRadius: 'var(--radius-md)',
          background: 'var(--bg-sidebar)',
          border: '1px solid var(--border)',
          cursor: 'pointer'
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${percentFor(currentTime)}%`,
            width: 2,
            background: 'var(--accent)',
            pointerEvents: 'none'
          }}
        />

        {markers.map((marker) => (
          <button
            key={marker.pageId}
            type="button"
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

        {hoveredPageId && (
          <MarkerTooltip marker={markers.find((m) => m.pageId === hoveredPageId)!} percent={percentFor(markers.find((m) => m.pageId === hoveredPageId)!.timestampSeconds)} />
        )}
      </div>
      {markers.length > 0 && (
        <div style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)' }}>
          {markers.length} source{markers.length === 1 ? '' : 's'} on this timeline — click a mark to jump to it
        </div>
      )}
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
