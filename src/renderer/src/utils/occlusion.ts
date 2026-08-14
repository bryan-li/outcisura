import type { BBox, CardRecord } from '../../../shared/types'

/** The first image any of this card's sources carries — works for occlusion cards (always has
 *  one) and for regular cards whose source happened to be a single image element. */
export function firstImageSourcePath(card: CardRecord): string | null {
  return card.sources.find((s) => s.imagePath)?.imagePath ?? null
}

/**
 * All of a card's own mask boxes for one specific image. A grouped-mask occlusion card has
 * multiple card_sources rows sharing one imagePath, each with its own maskBBox — all must be
 * blacked out together, not just the first. Returns [] for legacy occlusion cards (made before
 * maskBBox existed) and for non-occlusion sources — both cases should render unmasked.
 */
export function maskBBoxesFor(card: CardRecord, imagePath: string): BBox[] {
  return card.sources.filter((s) => s.imagePath === imagePath && s.maskBBox).map((s) => s.maskBBox!)
}

/** Every image path explicitly tagged for one face of the card, in source order — only ever
 *  populated for cards assembled via the multi-image "Create Flashcard" modal (see
 *  CreateFlashcardModal). Empty for every other card, including single-image picture cards and
 *  occlusion cards, which have no imageFace tagging at all — callers should fall back to
 *  firstImageSourcePath's single-image behavior when this returns []. */
export function imageSourcesForFace(card: CardRecord, face: 'front' | 'back'): string[] {
  return card.sources.filter((s) => s.imageFace === face && s.imagePath).map((s) => s.imagePath!)
}

/** True for any card with at least one face-tagged image source — the signal callers use to
 *  switch from the single-image rendering path to the multi-image gallery path. */
export function hasFaceTaggedImages(card: CardRecord): boolean {
  return card.sources.some((s) => s.imageFace !== null)
}
