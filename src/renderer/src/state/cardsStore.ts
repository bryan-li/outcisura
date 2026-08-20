import { create } from 'zustand'
import type { CardRecord, CardReorderItem, CardUpdatePatch, GenerationSettings, NewCardInput, SrsSnapshot } from '../../../shared/types'
import type { ReviewGrade } from '../../../shared/srs'
import type { PendingSource } from '../types/pendingSource'
import { localCardsApi } from '../lib/api/localCards'
import { triggerSync } from '../lib/syncEngine'
import { DEFAULT_GENERATION_SETTINGS } from './uiStore'

interface CardsState {
  cards: CardRecord[]
  /** Sets cards directly — for the rare caller (currently just DocumentViewer's AI-regenerate-on-
   *  create flow) that needs to update state from outside this store's own actions. */
  setCards: (cards: CardRecord[]) => void
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
  /** Local-only, like tags themselves — no triggerSync. Replaces the card's full tag set. */
  setCardTags: (cardId: string, tagIds: string[]) => Promise<void>
}

export const useCardsStore = create<CardsState>((set, get) => {
  function persist(cards: CardRecord[]): void {
    set({ cards })
  }

  return {
    cards: [],

    setCards: persist,

    loadCards: async () => {
      set({ cards: await localCardsApi.list() })
    },

    createCard: async (input) => {
      const card = await localCardsApi.create(input)
      persist([card, ...get().cards])
      triggerSync()
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

        const card = await localCardsApi.create({
          front: '',
          back: seedText,
          cardType: settings.cloze ? 'cloze' : 'basic',
          sources: sourceInputs
        })
        persist([card, ...get().cards])
        cards.push(card)

        try {
          // AI regeneration needs a live call to Claude — there's no offline path for it, so this
          // branch simply fails with the usual network error if there's no connectivity.
          const result = await window.api.ai.regenerate({
            cardId: card.id,
            front: card.front,
            back: card.back,
            sources: card.sources,
            instruction: settings.customPrompt ?? undefined,
            complexity: settings.complexity,
            cloze: settings.cloze
          })
          const generated = await localCardsApi.applyAiRegeneration(card.id, { front: card.front, back: card.back }, result)
          persist(get().cards.map((c) => (c.id === card.id ? generated : c)))
          cards[cards.length - 1] = generated

          // A cloze card has no separate "reverse" side to swap, so doubleSided is a no-op there.
          if (settings.doubleSided && !settings.cloze) {
            const reversed = await localCardsApi.create({
              front: generated.back,
              back: generated.front,
              cardType: 'basic',
              sources: sourceInputs
            })
            persist([reversed, ...get().cards])
            cards.push(reversed)
          }
        } catch (err) {
          errors.push(err instanceof Error ? err.message : String(err))
        }
      }

      triggerSync()
      return { cards, errors }
    },

    updateCard: async (id, patch) => {
      const existing = get().cards.find((c) => c.id === id)
      if (!existing) throw new Error(`Card ${id} not found`)
      const updated = await localCardsApi.update(id, patch, existing)
      persist(get().cards.map((c) => (c.id === id ? updated : c)))
      triggerSync()
    },

    // Not synced — see repository.ts's reorderCards doc comment (manual drag order is cosmetic
    // and per-device).
    reorderCards: async (items) => {
      await localCardsApi.reorder(items)
      const nextSortOrder = new Map(items.map((i) => [i.id, i.sortOrder]))
      persist(get().cards.map((c) => (nextSortOrder.has(c.id) ? { ...c, sortOrder: nextSortOrder.get(c.id)! } : c)))
    },

    gradeCard: async (id, grade) => {
      const existing = get().cards.find((c) => c.id === id)
      if (!existing) throw new Error(`Card ${id} not found`)
      const updated = await localCardsApi.grade(id, grade, existing)
      persist(get().cards.map((c) => (c.id === id ? updated : c)))
      triggerSync()
      return updated
    },

    restoreCardSrs: async (id, srs) => {
      const existing = get().cards.find((c) => c.id === id)
      if (!existing) throw new Error(`Card ${id} not found`)
      const updated = await localCardsApi.setSrsState(id, srs, existing)
      persist(get().cards.map((c) => (c.id === id ? updated : c)))
      triggerSync()
    },

    deleteCard: async (id) => {
      await localCardsApi.delete(id)
      persist(get().cards.filter((c) => c.id !== id))
      triggerSync()
    },

    setCardTags: async (cardId, tagIds) => {
      await window.api.tags.setCardTags(cardId, tagIds)
      persist(get().cards.map((c) => (c.id === cardId ? { ...c, tagIds } : c)))
    },

    regenerate: async (cardId, instruction) => {
      const card = get().cards.find((c) => c.id === cardId)
      if (!card) throw new Error(`Card ${cardId} not found`)
      const result = await window.api.ai.regenerate({ cardId, front: card.front, back: card.back, sources: card.sources, instruction })
      const updated = await localCardsApi.applyAiRegeneration(cardId, { front: card.front, back: card.back }, result)
      persist(get().cards.map((c) => (c.id === cardId ? updated : c)))
      triggerSync()
    }
  }
})
