import { useEffect, useState, type CSSProperties } from 'react'
import type { LibreOfficeStatus } from '../../../../shared/types'
import { Icon } from '../Icon'

/**
 * Shown when someone imports a .pptx on a machine with no LibreOffice. PPTX slides are rendered
 * through headless LibreOffice for pixel accuracy (see main/pptxConverter.ts), and it's too big to
 * ship in the app download — so it's offered here, once, at the only moment it's actually needed.
 *
 * Resolves to true once LibreOffice is ready and the import should carry on, false if the user
 * backs out. The download runs in the main process, so closing this modal mid-download would
 * orphan it — hence cancel explicitly aborts rather than just hiding.
 */
export function LibreOfficePrompt({ onDone }: { onDone: (ready: boolean) => void }): JSX.Element {
  const [status, setStatus] = useState<LibreOfficeStatus | null>(null)

  useEffect(() => {
    void window.api.libreOffice.getStatus().then(setStatus)
    return window.api.libreOffice.onStatus(setStatus)
  }, [])

  // The install resolves with its own final status, but the subscription above is what drives the
  // progress bar — this only needs to know when to hand control back to the import.
  async function handleInstall(): Promise<void> {
    const result = await window.api.libreOffice.install()
    if (result.state === 'installed') onDone(true)
  }

  async function handleCancel(): Promise<void> {
    await window.api.libreOffice.cancelInstall()
    onDone(false)
  }

  const busy = status?.state === 'downloading' || status?.state === 'extracting'
  const megabytes = status?.downloadBytes ? Math.round(status.downloadBytes / 1_000_000) : null
  const percent = Math.round((status?.progress ?? 0) * 100)

  return (
    <div style={overlayStyle}>
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="presentation" size="1.4em" bare style={{ color: 'var(--accent)' }} />
          <h2 style={{ fontSize: 'var(--font-lg)', margin: 0 }}>PPTX import needs LibreOffice</h2>
        </div>

        {status?.canAutoInstall === false ? (
          <>
            <p style={bodyStyle}>
              Slides are rendered through LibreOffice so the images on your cards match the original
              exactly. There&apos;s no automatic install for this platform yet — install it yourself and
              the import will work from then on.
            </p>
            <p style={{ ...bodyStyle, color: 'var(--fg-faint)' }}>libreoffice.org/download</p>
          </>
        ) : (
          <p style={bodyStyle}>
            Slides are rendered through LibreOffice so the images on your cards match the original
            exactly. It&apos;s a {megabytes ? `${megabytes} MB ` : ''}one-time download, kept with this
            app&apos;s data — your system stays untouched, and PDF import never needs it.
          </p>
        )}

        {busy && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={trackStyle}>
              <div style={{ ...fillStyle, width: status?.state === 'extracting' ? '100%' : `${percent}%` }} />
            </div>
            <span style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)' }}>
              {status?.state === 'extracting' ? 'Installing…' : `Downloading… ${percent}%`}
            </span>
          </div>
        )}

        {status?.state === 'error' && (
          <p style={{ ...bodyStyle, color: 'var(--danger)' }}>{status.error}</p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={() => void handleCancel()} style={quietPillStyle}>
            {busy ? 'Cancel' : 'Not now'}
          </button>
          {status?.canAutoInstall !== false && (
            <button type="button" disabled={busy} onClick={() => void handleInstall()} style={primaryPillStyle}>
              {status?.state === 'error' ? 'Try again' : 'Download'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: '#00000055',
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 80,
  animation: 'fade-in 120ms ease'
}

const cardStyle: CSSProperties = {
  width: 420,
  maxWidth: '90vw',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-4)',
  padding: 'var(--space-5)',
  background: 'var(--modal-bg)',
  color: 'var(--modal-fg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-panel)',
  boxShadow: '0 10px 40px #00000040',
  animation: 'scale-in 150ms ease'
}

const bodyStyle: CSSProperties = {
  margin: 0,
  fontSize: 'var(--font-sm)',
  color: 'var(--fg-muted)',
  lineHeight: 1.5
}

const trackStyle: CSSProperties = {
  height: 6,
  borderRadius: 'var(--radius-pill)',
  background: 'var(--border)',
  overflow: 'hidden'
}

const fillStyle: CSSProperties = {
  height: '100%',
  background: 'var(--accent)',
  borderRadius: 'var(--radius-pill)',
  transition: 'width 200ms ease'
}

const primaryPillStyle: CSSProperties = {
  border: 'none',
  background: 'var(--accent)',
  color: 'var(--on-accent)',
  fontWeight: 600,
  fontSize: 'var(--font-sm)',
  borderRadius: 'var(--radius-pill)',
  padding: '8px 18px',
  cursor: 'pointer'
}

const quietPillStyle: CSSProperties = {
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--fg-muted)',
  fontSize: 'var(--font-sm)',
  borderRadius: 'var(--radius-pill)',
  padding: '8px 16px',
  cursor: 'pointer'
}
