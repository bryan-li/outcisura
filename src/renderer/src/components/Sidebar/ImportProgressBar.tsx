import type { ImportProgress } from '../../types/importProgress'

const LABELS: Record<ImportProgress['phase'], string> = {
  converting: 'Converting PPTX…',
  parsing: 'Parsing slides…',
  saving: 'Saving to library…'
}

export function ImportProgressBar({ progress }: { progress: ImportProgress }): JSX.Element {
  const determinate = progress.phase === 'parsing' && progress.total > 0
  const percent = progress.phase === 'parsing' ? Math.round((progress.current / progress.total) * 100) : 0

  return (
    <div style={{ padding: '2px var(--space-2) 6px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-xs)', color: 'var(--fg-muted)', marginBottom: 3 }}>
        <span>{LABELS[progress.phase]}</span>
        {progress.phase === 'parsing' && (
          <span>
            {progress.current}/{progress.total}
          </span>
        )}
      </div>
      <div style={{ height: 4, borderRadius: 999, background: 'var(--border)', overflow: 'hidden', position: 'relative' }}>
        {determinate ? (
          <div
            style={{
              height: '100%',
              width: `${percent}%`,
              background: 'var(--accent)',
              borderRadius: 999,
              transition: 'width 150ms ease'
            }}
          />
        ) : (
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: '-40%',
              width: '40%',
              background: 'var(--accent)',
              borderRadius: 999,
              animation: 'progress-indeterminate 1.1s ease-in-out infinite'
            }}
          />
        )}
      </div>
    </div>
  )
}
