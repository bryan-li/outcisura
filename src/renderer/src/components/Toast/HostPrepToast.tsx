import { useEffect, type CSSProperties } from 'react'
import { useHostPrepStore } from '../../state/hostPrepStore'

/** The first toast/notification primitive in this app — everything else that signals "something
 *  happened" is either an inline banner (persists until explicit dismissal, e.g. DocumentViewer's
 *  recapture banner) or a self-clearing flash tied to a specific view (uiStore's flashTarget). A
 *  "deck finished preparing" signal needs neither: it's transient like a flash, but must fire
 *  regardless of whether the user is still looking at the folder that started it (prep can take a
 *  while, and there's no reason to make them wait around). Mounted unconditionally in App.tsx
 *  alongside ZoomControl/SearchPalette, driven purely by hostPrepStore's global state. */
export function HostPrepToast(): JSX.Element | null {
  const lastCompletion = useHostPrepStore((s) => s.lastCompletion)
  const clearCompletion = useHostPrepStore((s) => s.clearCompletion)

  // Same self-clearing shape as DocumentViewer.tsx's flashTarget effect (2400ms, cleanup clears the
  // timer on unmount/re-trigger) — a completion signal is transient, not something the user
  // dismisses manually.
  useEffect(() => {
    if (!lastCompletion) return
    const timer = setTimeout(() => clearCompletion(), 3200)
    return () => clearTimeout(timer)
  }, [lastCompletion, clearCompletion])

  if (!lastCompletion) return null

  const { folderName, preparedCount, failedCount } = lastCompletion
  const message =
    failedCount === 0
      ? `"${folderName}" is ready to host — ${preparedCount} card${preparedCount === 1 ? '' : 's'} prepared.`
      : `"${folderName}" prepared with ${failedCount} card${failedCount === 1 ? '' : 's'} that couldn't be processed.`

  return (
    <div style={toastStyle}>
      <span style={{ fontSize: 16 }}>{failedCount === 0 ? '✅' : '⚠️'}</span>
      <span>{message}</span>
    </div>
  )
}

const toastStyle: CSSProperties = {
  position: 'fixed',
  left: 16,
  bottom: 16,
  zIndex: 60,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  maxWidth: 360,
  padding: '10px 14px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
  background: 'var(--modal-bg)',
  boxShadow: '0 2px 10px #00000020',
  fontSize: 'var(--font-sm)',
  animation: 'fade-in 180ms ease'
}
