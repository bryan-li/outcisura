/** A cloze card's `front` field holds one passage with the hidden term(s) wrapped in `{{}}` — e.g.
 *  "The mitochondria is the {{powerhouse}} of the cell." `back` is unused (kept empty) for cloze
 *  cards; both the masked and revealed states are derived from this one field. All `{{}}` regions
 *  in a card are revealed together — there's no per-blank scheduling like Anki's numbered `{{c1::}}`
 *  syntax, which would need a separate SRS schedule per blank rather than per card. */
export interface ClozeSegment {
  text: string
  isBlank: boolean
}

const CLOZE_PATTERN = /\{\{(.+?)\}\}/g
// A separate, non-global instance for the boolean check below — reusing CLOZE_PATTERN there would
// be a real bug: .test() on a `g`-flagged regex advances its own lastIndex as a side effect, so
// alternating calls against different strings would silently start mid-string and give wrong
// answers. matchAll() below doesn't have this problem — it clones the regex internally.
const HAS_CLOZE_PATTERN = /\{\{(.+?)\}\}/

export function parseCloze(text: string): ClozeSegment[] {
  const segments: ClozeSegment[] = []
  let lastIndex = 0
  for (const match of text.matchAll(CLOZE_PATTERN)) {
    const index = match.index ?? 0
    if (index > lastIndex) segments.push({ text: text.slice(lastIndex, index), isBlank: false })
    segments.push({ text: match[1], isBlank: true })
    lastIndex = index + match[0].length
  }
  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex), isBlank: false })
  return segments
}

/** True once a passage actually has at least one `{{}}` region — a cloze card with none (e.g. the
 *  AI failed to mark anything, or the user cleared it while editing) has nothing to hide. */
export function hasClozeBlank(text: string): boolean {
  return HAS_CLOZE_PATTERN.test(text)
}
