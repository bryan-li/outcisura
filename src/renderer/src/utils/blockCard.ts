/**
 * RemNote-style block syntax for a flashcard: `Question :> first answer point`, with further lines
 * becoming additional answer points. Leading whitespace (2 spaces per level) marks hierarchy depth.
 * This is purely a UI-layer convenience — CardRecord.front/back stay plain strings in the DB; `back`
 * keeps using the existing "• point" per-line convention (the same one AI regenerate already writes).
 */

export const CARD_DELIMITER = ':>'

export interface BackLine {
  depth: number
  text: string
}

export function backTextToLines(back: string): BackLine[] {
  return back
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const leading = line.match(/^(\s*)/)?.[1].length ?? 0
      return { depth: Math.floor(leading / 2), text: line.trim().replace(/^[•\-*]\s*/, '') }
    })
}

export function backLinesToText(lines: BackLine[]): string {
  return lines.map((l) => `${'  '.repeat(l.depth)}• ${l.text}`).join('\n')
}

/** Renders a card's stored front/back as one editable block of `:>` syntax. */
export function cardToBlockText(front: string, back: string): string {
  const lines = backTextToLines(back)
  const [first, ...rest] = lines
  const parts = [`${front} ${CARD_DELIMITER}${first ? ' ' + first.text : ''}`]
  for (const line of rest) parts.push(`${'  '.repeat(line.depth)}${line.text}`)
  return parts.join('\n')
}

/** Parses an edited block back into plain front/back for storage. */
export function blockTextToCard(raw: string): { front: string; back: string } {
  const lines = raw.split('\n')
  const delimiterIndex = lines.findIndex((l) => l.includes(CARD_DELIMITER))
  if (delimiterIndex === -1) return { front: raw.trim(), back: '' }

  const delimiterLine = lines[delimiterIndex]
  const splitAt = delimiterLine.indexOf(CARD_DELIMITER)
  const front = delimiterLine.slice(0, splitAt).trim()
  const firstBackText = delimiterLine.slice(splitAt + CARD_DELIMITER.length).trim()

  const backLines: BackLine[] = []
  if (firstBackText) backLines.push({ depth: 0, text: firstBackText })
  for (let i = delimiterIndex + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    const leading = line.match(/^(\s*)/)?.[1].length ?? 0
    backLines.push({ depth: Math.floor(leading / 2), text: line.trim() })
  }

  return { front, back: backLinesToText(backLines) }
}
