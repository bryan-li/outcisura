import type { CSSProperties } from 'react'

/** Indeterminate progress bar for an in-flight AI call whose real progress we have no visibility
 *  into (a single non-streaming request) — reuses the same `progress-indeterminate` keyframe as
 *  Sidebar/ImportProgressBar.tsx so long-running AI work reads consistently with local import
 *  work elsewhere in the app. Shown inside a still-open modal, but the modal itself stays
 *  dismissible while this is up (see UploadTemplateModal/GeneratePaperModal) — closing it doesn't
 *  cancel the underlying request, it just stops watching for the result. */
export function GenerationProgressBar({ label }: { label: string }): JSX.Element {
  return (
    <div>
      <div style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-muted)', marginBottom: 4 }}>{label}</div>
      <div style={trackStyle}>
        <div style={fillStyle} />
      </div>
    </div>
  )
}

const trackStyle: CSSProperties = {
  height: 4,
  borderRadius: 999,
  background: 'var(--border)',
  overflow: 'hidden',
  position: 'relative'
}

const fillStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  bottom: 0,
  left: '-40%',
  width: '40%',
  background: 'var(--accent)',
  borderRadius: 999,
  animation: 'progress-indeterminate 1.1s ease-in-out infinite'
}
