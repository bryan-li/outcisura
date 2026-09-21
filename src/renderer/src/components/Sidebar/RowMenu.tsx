import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'

export interface RowMenuItem {
  label: string
  onSelect: () => void
  /** Destructive actions (delete) render in the danger colour and sit last. */
  danger?: boolean
}

/** A "⋯" button that opens a small action menu — used to fold a tree row's secondary actions
 *  (new subfolder, rename, delete) into one control, so a row shows its name and at most one primary
 *  action instead of a strip of four icons. The trigger is hidden until the row is hovered or focused
 *  (see .row-menu-trigger in styles.css) and stays visible while its menu is open.
 *
 *  Rendered through a portal at fixed coordinates: the sidebar's own scroll container would clip an
 *  absolutely-positioned popover, and rows animate in with transforms that would offset a fixed one
 *  nested inside them. */
export function RowMenu({ items, title = 'More actions' }: { items: RowMenuItem[]; title?: string }): JSX.Element {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const open = position !== null

  useEffect(() => {
    if (!open) return
    function close(): void {
      setPosition(null)
    }
    function handleMouseDown(e: MouseEvent): void {
      const target = e.target as Node
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      close()
    }
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        close()
        triggerRef.current?.focus()
      }
    }
    window.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('keydown', handleKey)
    // A menu pinned to fixed coordinates would float away from its row if anything scrolls or resizes.
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('keydown', handleKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  function toggle(): void {
    if (open) {
      setPosition(null)
      return
    }
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    // Right-aligned under the trigger, nudged left if it would run off the window edge.
    const menuWidth = 160
    setPosition({ top: rect.bottom + 2, left: Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8)) })
  }

  return (
    <>
      <button
        ref={triggerRef}
        className={`row-menu-trigger${open ? ' open' : ''}`}
        onClick={toggle}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        style={triggerStyle}
      >
        ⋯
      </button>
      {open &&
        createPortal(
          <div ref={menuRef} role="menu" style={{ ...menuStyle, top: position.top, left: position.left }}>
            {items.map((item) => (
              <button
                key={item.label}
                role="menuitem"
                onClick={() => {
                  setPosition(null)
                  item.onSelect()
                }}
                style={{ ...itemStyle, color: item.danger ? 'var(--danger)' : 'inherit' }}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  )
}

const triggerStyle: CSSProperties = {
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: 1,
  padding: '2px 6px',
  color: 'var(--fg-muted)',
  borderRadius: 'var(--radius-sm)',
  flexShrink: 0
}

const menuStyle: CSSProperties = {
  position: 'fixed',
  zIndex: 1000,
  width: 160,
  display: 'flex',
  flexDirection: 'column',
  padding: 4,
  background: 'var(--modal-bg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  boxShadow: '0 4px 16px #00000030'
}

const itemStyle: CSSProperties = {
  border: 'none',
  background: 'none',
  textAlign: 'left',
  padding: '6px 8px',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  fontSize: 'var(--font-sm)',
  fontFamily: 'inherit'
}
