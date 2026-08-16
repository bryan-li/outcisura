import type { CardsBackend } from './backendTypes'

/** Local-mode counterpart to cards.ts — thin wrappers around the still-intact
 *  window.api.cards.* IPC bridge (untouched since before Phase 0's cloud migration).
 *  `existing`/`previous` params exist only to satisfy CardsBackend's shared interface — local
 *  IPC already has authoritative state one process hop away and never needs them. */
export const localCardsApi: CardsBackend = {
  create: (input) => window.api.cards.create(input),

  // window.api.cards has no direct get(id) — list() is already cheap enough (small personal
  // deck, same rationale as everywhere else this session) that a client-side find avoids adding
  // an IPC channel for a method nothing outside this file actually calls.
  async get(id) {
    const cards = await window.api.cards.list()
    return cards.find((c) => c.id === id) ?? null
  },

  list: () => window.api.cards.list(),
  update: (id, patch) => window.api.cards.update(id, patch),
  reorder: (items) => window.api.cards.reorder(items),
  grade: (id, grade) => window.api.cards.grade(id, grade),
  setSrsState: (id, srs) => window.api.cards.setSrsState(id, srs),
  delete: (id) => window.api.cards.delete(id),
  applyAiRegeneration: (id, _previous, next) => window.api.cards.applyAiRegeneration(id, next)
}
