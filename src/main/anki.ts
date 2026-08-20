import Database from 'better-sqlite3'
import { createHash } from 'crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { extname, join } from 'path'
import JSZip from 'jszip'
import type { CardRecord, CardType } from '../shared/types'

/** Same "• point" per-line convention as renderer/src/utils/blockCard.ts's backTextToLines —
 *  duplicated in miniature here rather than importing across the main/renderer project boundary
 *  (tsconfig.node.json's composite project only includes src/main, src/preload, src/shared). */
function parseBackLines(back: string): { depth: number; text: string }[] {
  return back
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const leading = line.match(/^(\s*)/)?.[1].length ?? 0
      return { depth: Math.floor(leading / 2), text: line.trim().replace(/^[•\-*]\s*/, '') }
    })
}

/** Builds a legacy-schema (`collection.anki2`) `.apkg` package — the SQLite-based format every
 *  version of Anki (and AnkiDroid, and every third-party tool) can still import, unlike the newer
 *  zstd+protobuf `collection.anki21b` schema recent Anki versions default to writing. Basic cards
 *  map to Anki's "Basic" note type; cloze cards map to "Cloze", converting our flat `{{text}}`
 *  blanks (all reveal together — see cloze.ts) to Anki's `{{c1::text}}` syntax, all under the SAME
 *  cloze number so Anki still generates exactly one card per note, matching our own per-card (not
 *  per-blank) scheduling model. A card's freely-attached/occlusion images (see card_sources) are
 *  embedded as <img> tags in the Back field and copied into the package's media store.
 */
export async function buildAnkiPackage(cards: CardRecord[], deckName: string): Promise<Buffer> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'outcisura-anki-'))
  const dbPath = join(tmpDir, 'collection.anki2')
  try {
    const db = new Database(dbPath)
    try {
      const now = Date.now()
      const nowSeconds = Math.floor(now / 1000)
      const basicModelId = now + 1
      const clozeModelId = now + 2
      const deckId = now + 3
      const defaultConfId = 1

      db.exec(`
        CREATE TABLE col (
          id integer PRIMARY KEY, crt integer NOT NULL, mod integer NOT NULL, scm integer NOT NULL,
          ver integer NOT NULL, dty integer NOT NULL, usn integer NOT NULL, ls integer NOT NULL,
          conf text NOT NULL, models text NOT NULL, decks text NOT NULL, dconf text NOT NULL, tags text NOT NULL
        );
        CREATE TABLE notes (
          id integer PRIMARY KEY, guid text NOT NULL, mid integer NOT NULL, mod integer NOT NULL,
          usn integer NOT NULL, tags text NOT NULL, flds text NOT NULL, sfld text NOT NULL,
          csum integer NOT NULL, flags integer NOT NULL, data text NOT NULL
        );
        CREATE TABLE cards (
          id integer PRIMARY KEY, nid integer NOT NULL, did integer NOT NULL, ord integer NOT NULL,
          mod integer NOT NULL, usn integer NOT NULL, type integer NOT NULL, queue integer NOT NULL,
          due integer NOT NULL, ivl integer NOT NULL, factor integer NOT NULL, reps integer NOT NULL,
          lapses integer NOT NULL, left integer NOT NULL, odue integer NOT NULL, odid integer NOT NULL,
          flags integer NOT NULL, data text NOT NULL
        );
        CREATE TABLE revlog (
          id integer PRIMARY KEY, cid integer NOT NULL, usn integer NOT NULL, ease integer NOT NULL,
          ivl integer NOT NULL, lastIvl integer NOT NULL, factor integer NOT NULL, time integer NOT NULL,
          type integer NOT NULL
        );
        CREATE TABLE graves (usn integer NOT NULL, oid integer NOT NULL, type integer NOT NULL);
        CREATE INDEX ix_notes_usn ON notes (usn);
        CREATE INDEX ix_cards_usn ON cards (usn);
        CREATE INDEX ix_revlog_usn ON revlog (usn);
        CREATE INDEX ix_cards_nid ON cards (nid);
        CREATE INDEX ix_cards_sched ON cards (did, queue, due);
        CREATE INDEX ix_revlog_cid ON revlog (cid);
        CREATE INDEX ix_notes_csum ON notes (csum);
      `)

      const basicModel = {
        id: basicModelId,
        name: 'Basic (Outcisura)',
        type: 0,
        mod: nowSeconds,
        usn: -1,
        sortf: 0,
        did: deckId,
        tmpls: [
          { name: 'Card 1', ord: 0, qfmt: '{{Front}}', afmt: '{{FrontSide}}\n\n<hr id="answer">\n\n{{Back}}', did: null, bqfmt: '', bafmt: '', bfont: '', bsize: 0 }
        ],
        flds: [
          { name: 'Front', ord: 0, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] },
          { name: 'Back', ord: 1, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] }
        ],
        css: '.card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }',
        latexPre: '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n',
        latexPost: '\\end{document}',
        latexsvg: false,
        req: [[0, 'any', [0]]],
        tags: [],
        vers: []
      }

      const clozeModel = {
        id: clozeModelId,
        name: 'Cloze (Outcisura)',
        type: 1,
        mod: nowSeconds,
        usn: -1,
        sortf: 0,
        did: deckId,
        tmpls: [{ name: 'Cloze', ord: 0, qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}<br>{{Back Extra}}', did: null, bqfmt: '', bafmt: '', bfont: '', bsize: 0 }],
        flds: [
          { name: 'Text', ord: 0, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] },
          { name: 'Back Extra', ord: 1, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] }
        ],
        css: '.card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }\n.cloze { font-weight: bold; color: blue; }',
        latexPre: '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n',
        latexPost: '\\end{document}',
        latexsvg: false,
        req: [[0, 'any', [0]]],
        tags: [],
        vers: []
      }

      const models = { [basicModelId]: basicModel, [clozeModelId]: clozeModel }
      const decks = {
        '1': { id: 1, name: 'Default', extendRev: 50, usn: -1, collapsed: false, newToday: [0, 0], revToday: [0, 0], lrnToday: [0, 0], timeToday: [0, 0], conf: defaultConfId, desc: '', dyn: 0, extendNew: 10 },
        [deckId]: { id: deckId, name: deckName, extendRev: 50, usn: -1, collapsed: false, newToday: [0, 0], revToday: [0, 0], lrnToday: [0, 0], timeToday: [0, 0], conf: defaultConfId, desc: '', dyn: 0, extendNew: 10 }
      }
      const dconf = {
        '1': {
          id: 1, name: 'Default', replayq: true, lapse: { leechFails: 8, minInt: 1, delays: [10], leechAction: 0, mult: 0 },
          rev: { perDay: 200, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, ease4: 1.3, bury: false, minSpace: 1 },
          timer: 0, maxTaken: 60, usn: -1, new: { perDay: 20, delays: [1, 10], separate: true, ints: [1, 4, 7], initialFactor: 2500, bury: false, order: 1 },
          mod: nowSeconds, autoplay: true
        }
      }
      const conf = { curDeck: deckId, activeDecks: [deckId], newSpread: 0, collapseTime: 1200, timeLim: 0, estTimes: true, dueCounts: true, curModel: String(basicModelId), nextPos: 1, sortType: 'noteFld', sortBackwards: false, addToCur: true, dayLearnFirst: false, schedVer: 2 }

      db.prepare(
        `INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags) VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, '{}')`
      ).run(nowSeconds, now, now, JSON.stringify(conf), JSON.stringify(models), JSON.stringify(decks), JSON.stringify(dconf))

      const insertNote = db.prepare(`INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data) VALUES (?, ?, ?, ?, -1, '', ?, ?, ?, 0, '')`)
      const insertCard = db.prepare(
        `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data) VALUES (?, ?, ?, 0, ?, -1, 0, 0, ?, 0, 2500, 0, 0, 0, 0, 0, 0, '')`
      )

      const zip = new JSZip()
      const mediaManifest: Record<string, string> = {}
      let mediaIndex = 0
      let noteId = now + 1000
      let cardId = now + 2000
      let duePosition = 1

      for (const card of cards) {
        const isCloze = card.cardType === 'cloze'
        const imageHtml = card.sources
          .filter((s): s is typeof s & { imagePath: string } => !!s.imagePath && existsSync(s.imagePath))
          .map((s) => {
            const mediaKey = String(mediaIndex++)
            const filename = `${mediaKey}${extname(s.imagePath)}`
            mediaManifest[mediaKey] = filename
            zip.file(mediaKey, readFileSync(s.imagePath))
            return `<img src="${escapeHtml(filename)}">`
          })
          .join('')

        const front = isCloze ? textToClozeHtml(card.front) : escapeHtml(card.front)
        const back = `${backLinesToHtml(card.back)}${imageHtml}`
        const flds = isCloze ? `${front}\x1f${imageHtml}` : `${front}\x1f${back}`
        const sortField = front

        noteId++
        const guid = createHash('sha1').update(`${card.id}`).digest('base64').slice(0, 10)
        const csum = parseInt(createHash('sha1').update(sortField).digest('hex').slice(0, 8), 16)
        insertNote.run(noteId, guid, isCloze ? clozeModelId : basicModelId, nowSeconds, flds, sortField, csum)

        cardId++
        insertCard.run(cardId, noteId, deckId, nowSeconds, duePosition++)
      }

      zip.file('media', JSON.stringify(mediaManifest))
      db.close()
      zip.file('collection.anki2', readFileSync(dbPath))

      return await zip.generateAsync({ type: 'nodebuffer' })
    } finally {
      try {
        db.close()
      } catch {
        // already closed
      }
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Every `{{blank}}` in our flat cloze format becomes Anki's `{{c1::blank}}` — the SAME cloze
 *  number for every blank in a card, so Anki generates exactly one card per note (matching our own
 *  per-card, not per-blank, scheduling — see cloze.ts's own doc comment on why we don't track
 *  numbered cloze groups). */
function textToClozeHtml(text: string): string {
  return escapeHtml(text).replace(/\{\{(.+?)\}\}/g, '{{c1::$1}}')
}

function backLinesToHtml(back: string): string {
  return parseBackLines(back)
    .map((l) => `${'&nbsp;'.repeat(l.depth * 4)}• ${escapeHtml(l.text)}`)
    .join('<br>')
}

/** One note parsed out of an imported `.apkg` — the caller (registerIpc.ts) turns each of these
 *  into a real card via repository.createCard + addCardImages, keeping this module a pure
 *  parser/builder with no DB coupling, same as ai.ts's "pure compute, caller persists" shape. */
export interface ParsedAnkiNote {
  front: string
  back: string
  cardType: CardType
  /** Raw image bytes pulled from the package's media store, keyed by the filename referenced in
   *  the note's fields — the caller saves these to disk and attaches them via addCardImages. */
  images: { filename: string; data: Buffer }[]
}

interface AnkiModel {
  type: number
  flds: { name: string }[]
}

/** Parses a `.apkg` (legacy `collection.anki2` schema only — see buildAnkiPackage's own doc
 *  comment on why recent Anki's newer collection.anki21b protobuf format isn't supported). Throws
 *  a clear error if only that newer format is present, rather than silently importing nothing. */
export async function parseAnkiPackage(buffer: Buffer): Promise<ParsedAnkiNote[]> {
  const zip = await JSZip.loadAsync(buffer)
  const collectionEntry = zip.file('collection.anki2')
  if (!collectionEntry) {
    const hasNewFormat = !!zip.file('collection.anki21b') || !!zip.file('collection.anki21')
    throw new Error(
      hasNewFormat
        ? 'This .apkg only contains the newer Anki collection format — re-export from Anki with "Support older Anki versions" enabled.'
        : 'No collection.anki2 found in this .apkg — is it a valid Anki export?'
    )
  }
  const dbBytes = await collectionEntry.async('nodebuffer')

  const mediaEntry = zip.file('media')
  const mediaManifest: Record<string, string> = mediaEntry ? JSON.parse(await mediaEntry.async('string')) : {}
  const filenameToKey = new Map(Object.entries(mediaManifest).map(([key, filename]) => [filename, key]))

  const tmpDir = mkdtempSync(join(tmpdir(), 'outcisura-anki-import-'))
  const dbPath = join(tmpDir, 'collection.anki2')
  writeFileSync(dbPath, dbBytes)

  try {
    const db = new Database(dbPath, { readonly: true })
    try {
      const colRow = db.prepare(`SELECT models FROM col LIMIT 1`).get() as { models: string }
      const models: Record<string, AnkiModel> = JSON.parse(colRow.models)
      const noteRows = db.prepare(`SELECT mid, flds FROM notes`).all() as { mid: number; flds: string }[]

      const notes: ParsedAnkiNote[] = []
      for (const row of noteRows) {
        const model = models[String(row.mid)]
        if (!model) continue
        const fields = row.flds.split('\x1f')
        const isCloze = model.type === 1

        const rawFront = fields[0] ?? ''
        const rawBack = fields[1] ?? ''
        const combinedForMedia = `${rawFront}${rawBack}`
        const images: { filename: string; data: Buffer }[] = []
        for (const match of combinedForMedia.matchAll(/<img[^>]+src=["']([^"'>]+)["']/gi)) {
          const filename = match[1]
          const key = filenameToKey.get(filename)
          const entry = key !== undefined ? zip.file(key) : null
          if (entry) images.push({ filename, data: await entry.async('nodebuffer') })
        }

        const front = isCloze ? clozeHtmlToText(stripHtml(rawFront)) : stripHtml(rawFront)
        const back = isCloze ? '' : htmlToBackLines(rawBack)
        notes.push({ front, back, cardType: isCloze ? 'cloze' : 'basic', images })
      }
      return notes
    } finally {
      db.close()
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<img[^>]*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
}

/** Anki's numbered `{{cN::text::hint}}` collapses to our flat `{{text}}` — every blank in the note
 *  reveals together here regardless of its original cloze number (see cloze.ts). */
function clozeHtmlToText(text: string): string {
  return text.replace(/\{\{c\d+::(.+?)(?:::.*?)?\}\}/g, '{{$1}}')
}

function htmlToBackLines(html: string): string {
  const plain = stripHtml(html)
  return plain
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => `• ${l.trim().replace(/^[•\-*]\s*/, '')}`)
    .join('\n')
}
