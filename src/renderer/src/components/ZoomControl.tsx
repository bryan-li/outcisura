import { useState } from 'react'
import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, useZoomFactor } from '../hooks/useZoomFactor'

export function ZoomControl(): JSX.Element {
  const [zoom, setZoom] = useZoomFactor()
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      style={{
        position: 'fixed',
        // Offsets are in CSS px, which webFrame zoom also scales — dividing by zoom keeps the
        // *physical* inset constant, so the widget stays pinned instead of creeping (and the
        // slider thumb stays under the cursor) while dragging.
        bottom: 12 / zoom,
        right: 12 / zoom,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        borderRadius: 999,
        border: '1px solid var(--border)',
        background: 'var(--modal-bg)',
        boxShadow: '0 2px 10px #00000020',
        transition: 'opacity var(--transition-fast)',
        opacity: expanded ? 1 : 0.55,
        // webFrame zoom scales the whole page including this control, so counter-scale by 1/zoom
        // to keep the widget itself a constant physical size at any zoom level.
        transform: `scale(${1 / zoom})`,
        transformOrigin: 'bottom right'
      }}
      title="Interface scale"
    >
      {expanded && (
        <>
          <button onClick={() => setZoom(DEFAULT_ZOOM)} style={{ border: 'none', background: 'none', padding: 0, fontSize: 11 }}>
            Reset
          </button>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            style={{ width: 110, padding: 0, border: 'none', background: 'none' }}
          />
        </>
      )}
      {/* Fixed width + tabular figures: "95%" and "120%" must occupy the same space, or the pill
          resizes on every slider step and appears to shudder. */}
      <span
        style={{
          fontSize: 11,
          color: 'var(--fg-muted)',
          width: 32,
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
          flexShrink: 0
        }}
      >
        {Math.round(zoom * 100)}%
      </span>
    </div>
  )
}
