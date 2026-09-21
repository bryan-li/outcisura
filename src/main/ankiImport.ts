import type { ParsedAnkiNote } from './anki'
import type { Repository } from './db/repository'
import { saveImageBuffer } from './imageStore'

/** Turns parsed Anki notes into real cards: decks become folders (nested by "::", reusing a folder
 *  that already sits at that spot), tags and review progress carry over, images are saved and
 *  attached. A note whose type, front and back match a card that's already here is skipped, so
 *  importing the same package twice doesn't duplicate everything. */
export function importParsedNotes(
  repo: Repository,
  notes: ParsedAnkiNote[],
  saveImage: (data: Buffer, filename: string) => string = saveImageBuffer
): { imported: number; skipped: number; foldersCreated: number } {
  const folderByPath = new Map<string, string>()
  let foldersCreated = 0
  const existingFolders = repo.listFolders()

  function folderFor(path: string[]): string {
    let parentId: string | null = null
    for (let i = 0; i < path.length; i++) {
      const key = path.slice(0, i + 1).join('\u0000')
      let id = folderByPath.get(key)
      if (!id) {
        const match = existingFolders.find((f) => f.parentId === parentId && f.name === path[i])
        if (match) id = match.id
        else {
          id = repo.createFolder(path[i], parentId).id
          foldersCreated++
        }
        folderByPath.set(key, id)
      }
      parentId = id
    }
    return parentId as string
  }

  const known = new Set(repo.listCards().map((c) => `${c.cardType}\u0000${c.front}\u0000${c.back}`))
  let imported = 0
  let skipped = 0
  for (const note of notes) {
    const signature = `${note.cardType}\u0000${note.front}\u0000${note.back}`
    if (known.has(signature)) {
      skipped++
      continue
    }
    known.add(signature)
    const card = repo.createCard({ front: note.front, back: note.back, cardType: note.cardType, sources: [] })
    if (note.images.length > 0) {
      repo.addCardImages(card.id, note.images.map((img) => saveImage(img.data, img.filename)))
    }
    if (note.deckPath) repo.updateCard(card.id, { folderId: folderFor(note.deckPath) })
    if (note.tags.length > 0) repo.setCardTags(card.id, note.tags.map((t) => repo.createTag(t).id))
    if (note.schedule) repo.setCardSrsState(card.id, { ...note.schedule, lastReviewedAt: null })
    imported++
  }
  return { imported, skipped, foldersCreated }
}
