import { useEffect, type CSSProperties } from 'react'
import { useUpdatesStore } from '../../state/updatesStore'
import { useZoomFactor } from '../../hooks/useZoomFactor'
import { Icon } from '../Icon'
import { primaryPillStyle } from '../dashboardKit'

/** A small glass pill at the bottom centre that appears when a newer version exists: offers the
 *  update, shows download progress, then restarts into it. Where the app can't replace itself
 *  (unpackaged, read-only location) it links to the release page instead. */
export function UpdateBanner(): JSX.Element | null {
  const status = useUpdatesStore((s) => s.status)
  const dismissedVersion = useUpdatesStore((s) => s.dismissedVersion)
  const init = useUpdatesStore((s) => s.init)
  const download = useUpdatesStore((s) => s.download)
  const install = useUpdatesStore((s) => s.install)
  const dismiss = useUpdatesStore((s) => s.dismiss)
  const [zoom] = useZoomFactor()

  useEffect(() => {
    init()
  }, [init])

  if (!status) return null
  const visible =
    (status.state === 'available' && status.version !== dismissedVersion) || status.state === 'downloading' || status.state === 'ready'
  if (!visible) return null

  return (
    <div role="status" style={{ ...wrapStyle, bottom: 16 / zoom, transform: `translateX(-50%) scale(${1 / zoom})` }} className="update-banner">
      <span style={{ display: 'inline-flex', color: 'var(--accent)' }}>
        <Icon name="sparkles" bare size={16} />
      </span>
      {status.state === 'available' && (
        <>
          <span style={{ fontSize: 'var(--font-sm)' }}>
            Outcisura <strong>{status.version}</strong> is available
          </span>
          {status.canAutoInstall ? (
            <button onClick={() => void download()} style={buttonStyle}>
              Update
            </button>
          ) : (
            <button onClick={() => window.api.auth.openOAuthUrl(status.releaseUrl ?? 'https://github.com/bryan-li/outcisura/releases/latest')} style={buttonStyle}>
              Get update
            </button>
          )}
          <button onClick={dismiss} title="Not now" style={dismissStyle}>
            <Icon name="x" bare size={12} />
          </button>
        </>
      )}
      {status.state === 'downloading' && (
        <>
          <span style={{ fontSize: 'var(--font-sm)' }}>Downloading {status.version}…</span>
          <span style={trackStyle}>
            <span style={{ ...fillStyle, width: `${Math.round((status.progress ?? 0) * 100)}%` }} />
          </span>
          <span style={{ fontSize: 'var(--font-xs)', color: 'var(--fg-faint)', fontVariantNumeric: 'tabular-nums', width: 30 }}>
            {Math.round((status.progress ?? 0) * 100)}%
          </span>
        </>
      )}
      {status.state === 'ready' && (
        <>
          <span style={{ fontSize: 'var(--font-sm)' }}>Ready to install {status.version}</span>
          <button onClick={() => void install()} style={buttonStyle}>
            Restart to update
          </button>
        </>
      )}
    </div>
  )
}

const wrapStyle: CSSProperties = {
  position: 'fixed',
  left: '50%',
  transformOrigin: 'bottom center',
  zIndex: 70,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '7px 8px 7px 14px',
  borderRadius: 999,
  border: '1.5px solid transparent',
  background: 'linear-gradient(var(--modal-bg), var(--modal-bg)) padding-box, var(--glass-rim) border-box',
  boxShadow: '0 0 0 1px var(--glass-ring), 0 10px 28px #00000026'
}

const buttonStyle: CSSProperties = { ...primaryPillStyle, padding: '5px 14px', fontSize: 'var(--font-sm)' }

const dismissStyle: CSSProperties = { border: 'none', background: 'none', color: 'var(--fg-faint)', padding: 4, display: 'inline-flex' }

const trackStyle: CSSProperties = { width: 110, height: 5, borderRadius: 999, background: 'var(--border)', overflow: 'hidden', display: 'inline-block' }

const fillStyle: CSSProperties = { display: 'block', height: '100%', borderRadius: 999, background: 'var(--accent)', transition: 'width 160ms ease' }
