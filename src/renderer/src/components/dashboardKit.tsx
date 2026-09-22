import type { CSSProperties, ReactNode } from 'react'

/** Shared building blocks for the dashboard-style pages (Home, Review): the same rounded panels,
 *  eyebrow labels, big numbers, pill buttons and list rows, so the pages read as one family. */

export const panelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
  padding: 'var(--space-4) var(--space-4)',
  border: '1px solid var(--border)',
  borderRadius: 18,
  background: 'var(--bg)',
  minWidth: 0
}

export const eyebrowStyle: CSSProperties = {
  fontSize: 'var(--font-xs)',
  fontWeight: 600,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  color: 'var(--fg-faint)'
}

export const bigNumberStyle: CSSProperties = { fontSize: 44, fontWeight: 700, lineHeight: 1, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }

export const panelTitleStyle: CSSProperties = { fontSize: 'var(--font-md)', fontWeight: 600, margin: 0 }

/** The one solid-orange call to action on a page, matching the sidebar's active pill. */
export const primaryPillStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  border: 'none',
  background: 'var(--accent)',
  color: 'var(--on-accent)',
  fontWeight: 600,
  fontSize: 'var(--font-md)',
  borderRadius: 'var(--radius-pill)',
  padding: '8px 18px',
  cursor: 'pointer'
}

export const secondaryPillStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  fontSize: 'var(--font-sm)',
  borderRadius: 'var(--radius-pill)',
  padding: '7px 14px',
  cursor: 'pointer'
}

export const listStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, margin: '0 -8px' }

export const rowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 'var(--space-2)',
  border: 'none',
  textAlign: 'left',
  padding: '7px 8px',
  borderRadius: 'var(--radius-row)',
  cursor: 'pointer',
  color: 'inherit',
  fontSize: 'var(--font-sm)'
}

export const rowLabelStyle: CSSProperties = { display: 'flex', alignItems: 'center', minWidth: 0, flex: 1 }

export const rowMetaStyle: CSSProperties = {
  color: 'var(--fg-faint)',
  fontSize: 'var(--font-xs)',
  flexShrink: 0,
  maxWidth: '40%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

/** A small accent-tinted count next to a row (cards due). */
export const countPillStyle: CSSProperties = {
  minWidth: 22,
  height: 20,
  padding: '0 7px',
  borderRadius: 'var(--radius-pill)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 11,
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
  background: 'var(--accent-soft)',
  color: 'var(--accent)',
  flexShrink: 0
}

export function EmptyHint({ text }: { text: string }): JSX.Element {
  return <p style={{ color: 'var(--fg-faint)', fontSize: 'var(--font-sm)', margin: 0 }}>{text}</p>
}

/** The column every sidebar page lives in, so titles and panels line up from page to page. */
export const pageStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', width: '100%', maxWidth: 940 }

/** Page title with an optional one-line subtitle and right-aligned actions. Rises in on mount (same
 *  staggered entrance Home/Review use — see .home-rise in styles.css) so every page that starts with
 *  one gets the same settled-in feel for free; a page with more content below stages the rest in
 *  after it with a later animationDelay (see e.g. FoldersGrid, GraphPage). */
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }): JSX.Element {
  return (
    <header
      className="home-rise"
      style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}
    >
      <div style={{ minWidth: 0 }}>
        <h1 style={{ fontSize: 'var(--font-xxl)', margin: 0, letterSpacing: '-0.02em' }}>{title}</h1>
        {subtitle && <p style={{ color: 'var(--fg-muted)', margin: 'var(--space-1) 0 0', fontSize: 'var(--font-md)' }}>{subtitle}</p>}
      </div>
      {actions && <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>{actions}</div>}
    </header>
  )
}
