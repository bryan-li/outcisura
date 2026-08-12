import { useEffect } from 'react'
import { useCardsStore } from '../state/cardsStore'
import { useUiStore } from '../state/uiStore'

/**
 * Delete/Backspace deletes whatever cards are currently marquee-selected, anywhere in the app.
 * Mounted once at the App level rather than per MarqueeSelect instance — several can be mounted
 * at once (sidebar tree, newly-created, main content list), and a single shared listener avoids
 * them all firing redundantly for the same keypress.
 */
export function useDeleteSelectedCardsShortcut(): void {
  const deleteCard = useCardsStore((s) => s.deleteCard)
  const clearCardSelection = useUiStore((s) => s.clearCardSelection)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      // Don't hijack normal text editing — only act when the key wasn't typed into a field.
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return

      const ids = useUiStore.getState().selectedCardIds
      if (ids.length === 0) return
      e.preventDefault()
      if (!window.confirm(`Delete ${ids.length} flashcard${ids.length === 1 ? '' : 's'}? This can't be undone.`)) return
      for (const id of ids) deleteCard(id)
      clearCardSelection()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [deleteCard, clearCardSelection])
}
