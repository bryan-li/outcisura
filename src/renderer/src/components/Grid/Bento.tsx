import type { CSSProperties, ReactNode } from 'react'

/**
 * Notion-ish bento: a dense auto-fill grid where the first tile is given extra span so the layout
 * reads as a composition rather than a uniform table.
 */
export function BentoGrid({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
        gridAutoRows: 150,
        gap: 'var(--space-3)'
      }}
    >
      {children}
    </div>
  )
}

interface BentoTileProps {
  onClick: () => void
  children: ReactNode
  /** Make this tile occupy two grid columns/rows where space allows. */
  wide?: boolean
  tall?: boolean
}

export function BentoTile({ onClick, children, wide, tall }: BentoTileProps): JSX.Element {
  return (
    <button
      onClick={onClick}
      style={{
        ...tileStyle,
        gridColumn: wide ? 'span 2' : undefined,
        gridRow: tall ? 'span 2' : undefined
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--accent)'
        e.currentTarget.style.background = 'var(--bg-hover)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border)'
        e.currentTarget.style.background = 'var(--bg)'
      }}
    >
      {children}
    </button>
  )
}

const tileStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  justifyContent: 'flex-start',
  gap: 'var(--space-2)',
  textAlign: 'left',
  padding: 'var(--space-3)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--bg)',
  cursor: 'pointer',
  overflow: 'hidden',
  transition:
    'border-color var(--transition-fast), background-color var(--transition-fast), transform var(--transition-fast)'
}
