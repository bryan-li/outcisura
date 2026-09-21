/** The Outcisura mark: an orange rounded square with a pillar (capital, shaft, base) cut into it —
 *  the same artwork as the app icon (build/icon.svg) and the website. Colours follow the theme's
 *  accent so it matches the rest of the UI in light and dark. */
export function Logo({ size = 20 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0, display: 'block' }}>
      <rect width="24" height="24" rx="6" fill="var(--accent)" />
      <rect x="5" y="5" width="14" height="3" rx="0.8" fill="var(--on-accent)" />
      <rect x="5" y="16" width="14" height="3" rx="0.8" fill="var(--on-accent)" />
      <rect x="8" y="8.6" width="8" height="6.8" fill="var(--on-accent)" />
    </svg>
  )
}
