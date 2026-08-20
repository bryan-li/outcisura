import { useEffect, useState } from 'react'
import { usePomodoroStore } from '../state/pomodoroStore'
import { useZoomFactor } from '../hooks/useZoomFactor'

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** Mounted once at the App root (like ZoomControl/HostPrepToast) so it keeps ticking and stays
 *  visible across every view, including mid-review-session, without blocking anything underneath
 *  it — a floating pill, not a modal. Top-right, since ZoomControl already owns bottom-right and
 *  HostPrepToast owns bottom-left. */
export function PomodoroTimer(): JSX.Element {
  const mode = usePomodoroStore((s) => s.mode)
  const secondsRemaining = usePomodoroStore((s) => s.secondsRemaining)
  const running = usePomodoroStore((s) => s.running)
  const start = usePomodoroStore((s) => s.start)
  const pause = usePomodoroStore((s) => s.pause)
  const reset = usePomodoroStore((s) => s.reset)
  const tick = usePomodoroStore((s) => s.tick)
  const [zoom] = useZoomFactor()
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!running) return
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [running, tick])

  return (
    <div
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      style={{
        position: 'fixed',
        top: 12 / zoom,
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
        opacity: expanded || running ? 1 : 0.55,
        transform: `scale(${1 / zoom})`,
        transformOrigin: 'top right'
      }}
      title="Pomodoro timer"
    >
      <span style={{ fontSize: 11, color: mode === 'work' ? 'var(--accent)' : 'var(--fg-muted)' }}>
        {mode === 'work' ? '🍅 Work' : '☕ Break'}
      </span>
      <span
        style={{
          fontSize: 12,
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 600,
          width: 34,
          textAlign: 'right',
          flexShrink: 0
        }}
      >
        {formatClock(secondsRemaining)}
      </span>
      {expanded && (
        <>
          <button
            onClick={() => (running ? pause() : start())}
            title={running ? 'Pause' : 'Start'}
            style={{ border: 'none', background: 'none', padding: 0, fontSize: 12, cursor: 'pointer', color: 'inherit' }}
          >
            {running ? '⏸' : '▶'}
          </button>
          <button
            onClick={reset}
            title="Reset"
            style={{ border: 'none', background: 'none', padding: 0, fontSize: 11, cursor: 'pointer', color: 'inherit' }}
          >
            ↺
          </button>
        </>
      )}
    </div>
  )
}
