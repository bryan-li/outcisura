/** One row of the slide finder's list: which slide, the text to show for it, and where inside that
 *  text the query matched (matchStart -1 when the row isn't a text match — an unfiltered listing). */
export interface SlideMatch {
  index: number
  snippet: string
  matchStart: number
  matchLength: number
}

export interface SlideMatchOptions {
  /** Raw text of each slide, indexed the same as the slide list itself. */
  slideTexts: string[]
  /** Already trimmed and lower-cased; empty means "list every slide". */
  query: string
  /** Drop slides with no flashcards sourced from them. */
  withCardsOnly?: boolean
  /** Whether slide i has any flashcards — only consulted when withCardsOnly is on. */
  hasCards?: (index: number) => boolean
}

const SNIPPET_BEFORE = 32
const SNIPPET_LENGTH = 110

/**
 * Plain case-insensitive substring search over the slide text the store already holds — a deck is
 * a few hundred slides at most, so there's nothing here worth an index. With no query it returns
 * every (unfiltered) slide, which is what makes the finder double as a slide list.
 */
export function findSlideMatches({ slideTexts, query, withCardsOnly = false, hasCards }: SlideMatchOptions): SlideMatch[] {
  const rows: SlideMatch[] = []
  for (let i = 0; i < slideTexts.length; i++) {
    if (withCardsOnly && !hasCards?.(i)) continue
    const text = slideTexts[i]
    if (!query) {
      rows.push({ index: i, snippet: text.slice(0, SNIPPET_LENGTH), matchStart: -1, matchLength: 0 })
      continue
    }
    const at = text.toLowerCase().indexOf(query)
    if (at === -1) continue
    // Window the snippet around the match so a hit deep in a wordy slide is actually visible, with
    // a leading ellipsis standing in for what was cut (and counted into matchStart, so the
    // highlight stays on the matched characters).
    const from = Math.max(0, at - SNIPPET_BEFORE)
    const ellipsis = from > 0 ? 1 : 0
    rows.push({
      index: i,
      snippet: (ellipsis ? '…' : '') + text.slice(from, from + SNIPPET_LENGTH),
      matchStart: at - from + ellipsis,
      matchLength: query.length
    })
  }
  return rows
}
