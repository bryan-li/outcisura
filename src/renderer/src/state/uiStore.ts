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
  /** The Obsidian-style force-directed graph of cards/folders/documents. */
  | { type: 'graph' }
  /** Sources the sync engine's pull couldn't resolve locally, awaiting a fix. */
  | { type: 'missing-sources' }
  /** Decks ready to host (your own prepped folders + public premade decks). Always shown in the
   *  sidebar, unlike missing-sources' count-gated visibility — see HostableDecksView.tsx. */
  | { type: 'hostable-decks' }
  /** The host's lobby for a just-created live session — join code + live participant list, before
   *  starting. See HostLobbyView.tsx/hostSessionStore.ts. */
  | { type: 'host-lobby'; sessionId: string }
  /** The host's live control panel once a session is running — current question, countdown,
   *  answered-count ticker, reveal/next/end controls. See HostControlView.tsx. */
  | { type: 'host-control'; sessionId: string }
  /** A signed-in user joining a live session as themselves (not as an anonymous guest) — the
   *  join-code entry form. See JoinLiveSessionView.tsx. */
  | { type: 'live-session-join' }
  /** A signed-in user's live-session play loop, once joined — shares LiveSessionPlayer.tsx with
   *  the anonymous guest path. See PlayLiveSessionView.tsx. */
  | { type: 'live-session-play'; sessionId: string }
  /** A spaced-repetition study session. `returnTo` is set by the caller (not inferred from scope)
   *  so Exit/Esc always lands back wherever the session was actually launched from. `force` skips
   *  the due-date filter entirely — every card in scope, regardless of schedule ("cram" mode). */
  | { type: 'review'; scope: ReviewScope; returnTo: MainView; force?: boolean }
  /** Same `returnTo`-not-inferred-from-scope reasoning as review above — the settings button can be
   *  reached from anywhere, so Back needs to know explicitly where "anywhere" was. */
  | { type: 'settings'; returnTo: MainView }

export type Theme = 'light' | 'dark' | 'system'

const THEME_STORAGE_KEY = 'ui-theme'

function readStoredTheme(): Theme {
  const raw = window.localStorage.getItem(THEME_STORAGE_KEY)
  return raw === 'light' || raw === 'dark' ? raw : 'system'
}

/** 'system' means "no override" — just remove the attribute and let styles.css's own
 *  prefers-color-scheme media query decide, same as before this toggle existed. */
function applyTheme(theme: Theme): void {
  if (theme === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
}

// Applied once at module load (before the store or any component exists) so the very first paint
// already matches a previously saved override, instead of flashing system-default then correcting.
applyTheme(readStoredTheme())

interface FlashTarget {
  documentId: string
  pageId: string
  bbox: BBox
}

/** A pending "recapture a region for this orphaned source" intent (see MissingSourcesView.tsx and
 *  DocumentViewer.tsx's free-select 'recapture' mode) — deliberately NOT built on FlashTarget
 *  above, which assumes the target document is already open and self-clears 2.4s after applying
 *  (the wrong lifecycle here: this needs to survive the user navigating missing-sources → the
 *  library index → a document → possibly several pages, until they finish or explicitly cancel). */
interface RecaptureTarget {
  orphanId: string
  cardId: string
  /** Shown in the persistent banner while this is active, so the user remembers what they're
   *  recapturing partway through picking a document/page. */
  label: string
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

  recaptureTarget: RecaptureTarget | null
  /** Switches to the library index (letting the user pick any document) — MissingSourcesView
   *  calls this, or bypasses it entirely with a direct openDocument() when it finds exactly one
   *  local document matching the orphan's filename snapshot. */
  startRecapture: (target: RecaptureTarget) => void
  /** Explicit Cancel only — never auto-clears. */
  clearRecaptureTarget: () => void

  /** The global search palette (Cmd/Ctrl+K, or the sidebar's Search item) — a single boolean since
   *  it's a modal overlay, not a view; opening it doesn't disturb whatever view is underneath. */
  searchOpen: boolean
  openSearch: () => void
  closeSearch: () => void

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

  theme: Theme
  setTheme: (theme: Theme) => void
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

  recaptureTarget: null,
  startRecapture: (target) => set({ view: { type: 'library-index' }, recaptureTarget: target }),
  clearRecaptureTarget: () => set({ recaptureTarget: null }),

  searchOpen: false,
  openSearch: () => set({ searchOpen: true }),
  closeSearch: () => set({ searchOpen: false }),

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
  updateGenerationSettings: (patch) => set({ generationSettings: { ...get().generationSettings, ...patch } }),

  theme: readStoredTheme(),
  setTheme: (theme) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
    applyTheme(theme)
    set({ theme })
  }
}))
