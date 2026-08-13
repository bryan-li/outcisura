import { create } from 'zustand'
import type { CardRecord, CardReorderItem, CardUpdatePatch, GenerationSettings, NewCardInput, SrsSnapshot } from '../../../shared/types'
import type { ReviewGrade } from '../../../shared/srs'
import type { PendingSource } from '../types/pendingSource'
import { DEFAULT_GENERATION_SETTINGS } from './uiStore'

interface CardsState {
  cards: CardRecord[]
  loadCards: () => Promise<void>
  createCard: (input: NewCardInput) => Promise<CardRecord>
  /**
   * The standard creation path: persist one or more cards seeded with the highlighted source
   * text, then let Claude rewrite each into a proper question/answer (or a cloze passage — see
   * `GenerationSettings`). `settings.splitIntoMultiple` creates one card per source instead of
   * combining every source into one; `settings.doubleSided` additionally creates a reversed
   * companion for each. Per-card generation failures are collected into `errors` rather than
   * thrown — every card is already saved with its raw source text at that point, so a failure on
   * one doesn't lose the others, and the user keeps their capture either way.
   */
  createFromSources: (sources: PendingSource[], settings?: GenerationSettings) => Promise<{ cards: CardRecord[]; errors: string[] }>
  updateCard: (id: string, patch: CardUpdatePatch) => Promise<void>
  /** Persists a batch of {id, sortOrder} moves computed client-side after a drag-drop reorder. */
  reorderCards: (items: CardReorderItem[]) => Promise<void>
  /** Advances a card's spaced-repetition schedule after a review grade; returns the updated record
   *  so the review session can requeue it (on "again") using the fresh, not stale, SRS state. */
  gradeCard: (id: string, grade: ReviewGrade) => Promise<CardRecord>
  /** Direct overwrite of a card's SRS fields — used only by review-session undo. */
  restoreCardSrs: (id: string, srs: SrsSnapshot) => Promise<void>
  deleteCard: (id: string) => Promise<void>
  regenerate: (cardId: string, instruction?: string) => Promise<void>
}

export const useCardsStore = create<CardsState>((set, get) => ({
  cards: [],

  loadCards: async () => {
    const cards = await window.api.cards.list()
    set({ cards })
  },

  createCard: async (input) => {
    const card = await window.api.cards.create(input)
    set({ cards: [card, ...get().cards] })
    return card
  },

  createFromSources: async (sources, settings = DEFAULT_GENERATION_SETTINGS) => {
    const groups = settings.splitIntoMultiple ? sources.map((s) => [s]) : [sources]
    const cards: CardRecord[] = []
    const errors: string[] = []

    for (const group of groups) {
      const seedText = group
        .map((s) => s.previewText)
        .filter((t): t is string => !!t && t.trim().length > 0)
        .join('\n')
      const sourceInputs = group.map((s) => ({
        documentId: s.documentId,
        pageId: s.pageId,
        elementId: s.elementId,
        bbox: s.bbox,
        label: s.label,
        imagePath: s.previewImagePath
      }))

      const card = await window.api.cards.create({
        front: '',
        back: seedText,
        cardType: settings.cloze ? 'cloze' : 'basic',
        sources: sourceInputs
      })
      set({ cards: [card, ...get().cards] })
      cards.push(card)

      try {
        const generated = await window.api.ai.regenerate({
          cardId: card.id,
          instruction: settings.customPrompt ?? undefined,
          complexity: settings.complexity,
          cloze: settings.cloze
        })
        set({ cards: get().cards.map((c) => (c.id === card.id ? generated : c)) })
        cards[cards.length - 1] = generated

        // A cloze card has no separate "reverse" side to swap, so doubleSided is a no-op there.
        if (settings.doubleSided && !settings.cloze) {
          const reversed = await window.api.cards.create({
            front: generated.back,
            back: generated.front,
            cardType: 'basic',
            sources: sourceInputs
          })
          set({ cards: [reversed, ...get().cards] })
          cards.push(reversed)
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err))
      }
    }

    return { cards, errors }
  },

  updateCard: async (id, patch) => {
    const updated = await window.api.cards.update(id, patch)
    set({ cards: get().cards.map((c) => (c.id === id ? updated : c)) })
  },

  reorderCards: async (items) => {
    await window.api.cards.reorder(items)
    const nextSortOrder = new Map(items.map((i) => [i.id, i.sortOrder]))
    set({ cards: get().cards.map((c) => (nextSortOrder.has(c.id) ? { ...c, sortOrder: nextSortOrder.get(c.id)! } : c)) })
  },

  gradeCard: async (id, grade) => {
    const updated = await window.api.cards.grade(id, grade)
    set({ cards: get().cards.map((c) => (c.id === id ? updated : c)) })
    return updated
  },

  restoreCardSrs: async (id, srs) => {
    const updated = await window.api.cards.setSrsState(id, srs)
    set({ cards: get().cards.map((c) => (c.id === id ? updated : c)) })
  },

  deleteCard: async (id) => {
    await window.api.cards.delete(id)
    set({ cards: get().cards.filter((c) => c.id !== id) })
  },

  regenerate: async (cardId, instruction) => {
    const updated = await window.api.ai.regenerate({ cardId, instruction })
    set({ cards: get().cards.map((c) => (c.id === cardId ? updated : c)) })
  }
}))
