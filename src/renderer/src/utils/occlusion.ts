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
