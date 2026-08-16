import { useEffect } from 'react'
import { useUiStore } from '../state/uiStore'

/**
 * Cmd+K (or Ctrl+K off-Mac) opens the global search palette from anywhere — same
 * mount-once-at-App-level shape as useDeleteSelectedCardsShortcut. Works even while focused in a
 * text field (unlike Delete/Backspace, "search everything" is a reasonable thing to reach for
 * mid-typing elsewhere), so there's no input/textarea guard here.
 */
export function useSearchShortcut(): void {
  const openSearch = useUiStore((s) => s.openSearch)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key.toLowerCase() !== 'k' || !(e.metaKey || e.ctrlKey)) return
      e.preventDefault()
      openSearch()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [openSearch])
}
