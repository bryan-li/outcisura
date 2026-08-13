import { create } from 'zustand'
import type { BBox, GenerationSettings } from '../../../shared/types'
import type { PendingSource } from '../types/pendingSource'

export const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  complexity: 'standard',
  splitIntoMultiple: false,
  customPrompt: null,
  cloze: false,
  doubleSided: false
}

export type ReviewScope =
  | { kind: 'all' }
  | { kind: 'folder'; folderId: string }
  /** A custom multi-folder session picked from the review dashboard. `folder` (above) stays as
   *  the single-folder fast path already used by FolderCardsView's "Review this folder" button. */
  | { kind: 'folders'; folderIds: string[] }

export type MainView =
  | { type: 'home' }
  /** Grid of every imported document. */
  | { type: 'library-index' }
  /** A single document's slide viewer. */
  | { type: 'library' }
  /** Grid of every folder. */
  | { type: 'folders-index' }
  | { type: 'cards' }
  | { type: 'folder'; folderId: string }
  /** Stats, what's due next, and a folder picker for custom sessions — the landing page for review. */
  | { type: 'review-dashboard' }
  /** A spaced-repetition study session. `returnTo` is set by the caller (not inferred from scope)
   *  so Exit/Esc always lands back wherever the session was actually launched from. `force` skips
   *  the due-date filter entirely — every card in scope, regardless of schedule ("cram" mode). */
  | { type: 'review'; scope: ReviewScope; returnTo: MainView; force?: boolean }

interface FlashTarget {
  documentId: string
  pageId: string
  bbox: BBox
}

interface UiState {
  view: MainView
  flashTarget: FlashTarget | null
  /** Card the user jumped to from the sidebar — auto-expands and highlights briefly. */
  focusedCardId: string | null
  setView: (view: MainView) => void
  focusCard: (cardId: string, folderId: string | null) => void
  clearFocusedCard: () => void
  /** Switches to the Library view and asks the viewer to jump to + flash-highlight this source region. */
  goToSource: (target: FlashTarget) => void
  clearFlashTarget: () => void

  /** Cards picked out by marquee drag (in the sidebar tree or a card list), moved together. */
  selectedCardIds: string[]
  setSelectedCardIds: (ids: string[]) => void
  clearCardSelection: () => void

  /** Combine mode: lets the user gather source snippets across different pages/documents into one card. */
  combineMode: boolean
  combineBasket: PendingSource[]
  toggleCombineMode: () => void
  addToBasket: (sources: PendingSource[]) => void
  removeFromBasket: (index: number) => void
  clearBasket: () => void

  /** Shared across every creation surface (viewer, video OCR flow, combine basket) — set once,
   *  applies wherever a card next gets generated, rather than each surface keeping its own copy. */
  generationSettings: GenerationSettings
  updateGenerationSettings: (patch: Partial<GenerationSettings>) => void
}

export const useUiStore = create<UiState>((set, get) => ({
  view: { type: 'home' },
  flashTarget: null,
  focusedCardId: null,
  setView: (view) => set({ view }),
  focusCard: (cardId, folderId) =>
    set({ view: folderId ? { type: 'folder', folderId } : { type: 'cards' }, focusedCardId: cardId }),
  clearFocusedCard: () => set({ focusedCardId: null }),
  goToSource: (target) => set({ view: { type: 'library' }, flashTarget: target }),
  clearFlashTarget: () => set({ flashTarget: null }),

  selectedCardIds: [],
  setSelectedCardIds: (ids) => set({ selectedCardIds: ids }),
  clearCardSelection: () => set({ selectedCardIds: [] }),

  combineMode: false,
  combineBasket: [],
  toggleCombineMode: () => set({ combineMode: !get().combineMode }),
  addToBasket: (sources) => set({ combineBasket: [...get().combineBasket, ...sources] }),
  removeFromBasket: (index) => set({ combineBasket: get().combineBasket.filter((_, i) => i !== index) }),
  clearBasket: () => set({ combineBasket: [] }),

  generationSettings: DEFAULT_GENERATION_SETTINGS,
  updateGenerationSettings: (patch) => set({ generationSettings: { ...get().generationSettings, ...patch } })
}))
