import { useEffect, useState } from 'react'

const STORAGE_KEY = 'ui-zoom-factor'
/** Roomier than browser default — this app is read-heavy and the old 100% felt cramped. */
export const DEFAULT_ZOOM = 1.2
export const MIN_ZOOM = 0.8
export const MAX_ZOOM = 2

function readStoredZoom(): number {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  const parsed = raw ? Number(raw) : NaN
  if (!Number.isFinite(parsed) || parsed < MIN_ZOOM || parsed > MAX_ZOOM) return DEFAULT_ZOOM
  return parsed
}

/** Extracted from ZoomControl.tsx once a second consumer (SettingsView) needed the same live
 *  value — both now read/write the same state instead of each keeping an independent copy that
 *  could drift out of sync with the other. */
export function useZoomFactor(): [number, (zoom: number) => void] {
  const [zoom, setZoom] = useState(readStoredZoom)

  useEffect(() => {
    // Guarded: zoom is a nice-to-have, and a missing bridge must never take down the whole app.
    window.api?.ui?.setZoomFactor?.(zoom)
    window.localStorage.setItem(STORAGE_KEY, String(zoom))
  }, [zoom])

  return [zoom, setZoom]
}
