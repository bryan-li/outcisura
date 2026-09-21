import Database from 'better-sqlite3'
import { createHash } from 'crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { extname, join } from 'path'
import JSZip from 'jszip'
import { decompress as zstdDecompress } from 'fzstd'
import type { CardRecord, CardType, FolderRecord, TagRecord } from '../shared/types'

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
export interface AnkiExportOptions {
  /** Folders the cards live in — each becomes an Anki deck, nested as `Parent::Child`. */
  folders: FolderRecord[]
  tags: TagRecord[]
  /** Deck for cards that aren't in any folder. */
  defaultDeckName: string
}

/** `Parent::Child` path of a folder, walking parentId up (cycle-safe). */
function folderDeckName(folder: FolderRecord, byId: Map<string, FolderRecord>): string {
  const parts: string[] = []
  const seen = new Set<string>()
  let cursor: FolderRecord | undefined = folder
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id)
    parts.unshift(cursor.name.replace(/::/g, ':'))
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
  }
  return parts.join('::')
}

/** Anki tags are space-separated, so a tag's own spaces become underscores. */
function ankiTag(name: string): string {
  return name.trim().replace(/\s+/g, '_')
}

/** Start of the current Anki "day" (4am local) — Anki stores a review card's due date as whole days
 *  since the collection's creation time, so we anchor that at this instant. */
function ankiDayStartSeconds(now: Date): number {
  const d = new Date(now)
  d.setHours(4, 0, 0, 0)
  if (d.getTime() > now.getTime()) d.setDate(d.getDate() - 1)
  return Math.floor(d.getTime() / 1000)
}

export async function buildAnkiPackage(cards: CardRecord[], options: AnkiExportOptions): Promise<Buffer> {
  const { folders, tags, defaultDeckName } = options
  const folderById = new Map(folders.map((f) => [f.id, f]))
  const tagById = new Map(tags.map((t) => [t.id, t]))
  const tmpDir = mkdtempSync(join(tmpdir(), 'outcisura-anki-'))
  const dbPath = join(tmpDir, 'collection.anki2')
  try {
    const db = new Database(dbPath)
    try {
      const now = Date.now()
      const nowSeconds = Math.floor(now / 1000)
      const basicModelId = now + 1
      const clozeModelId = now + 2
      const crt = ankiDayStartSeconds(new Date(now))
      const usedFolderIds = [...new Set(cards.map((c) => c.folderId).filter((id): id is string => !!id && folderById.has(id)))]
      // Anki decks for every ancestor too, so nested names show up as a tree instead of orphans.
      const deckIdByName = new Map<string, number>()
      let nextDeckId = now + 10
      const deckNames = new Set<string>([defaultDeckName])
      for (const id of usedFolderIds) {
        const parts = folderDeckName(folderById.get(id)!, folderById).split('::')
        for (let i = 1; i <= parts.length; i++) deckNames.add(parts.slice(0, i).join('::'))
      }
      for (const name of deckNames) deckIdByName.set(name, nextDeckId++)
      const deckId = deckIdByName.get(defaultDeckName)!
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
      const deckEntry = (id: number, name: string): Record<string, unknown> => ({
        id, name, extendRev: 50, usn: -1, collapsed: false, newToday: [0, 0], revToday: [0, 0], lrnToday: [0, 0], timeToday: [0, 0],
        conf: defaultConfId, desc: '', dyn: 0, extendNew: 10
      })
      const decks: Record<string, unknown> = { '1': deckEntry(1, 'Default') }
      for (const [name, id] of deckIdByName) decks[String(id)] = deckEntry(id, name)
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
      ).run(crt, now, now, JSON.stringify(conf), JSON.stringify(models), JSON.stringify(decks), JSON.stringify(dconf))

      const insertNote = db.prepare(`INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data) VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, '')`)
      const insertCard = db.prepare(
        `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data) VALUES (?, ?, ?, 0, ?, -1, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, '')`
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
        const flds = `${front}\x1f${back}`
        const sortField = front

        noteId++
        const guid = createHash('sha1').update(`${card.id}`).digest('base64').slice(0, 10)
        const csum = parseInt(createHash('sha1').update(sortField).digest('hex').slice(0, 8), 16)
        const noteTags = card.tagIds.map((id) => tagById.get(id)).filter((t): t is TagRecord => !!t).map((t) => ankiTag(t.name))
        insertNote.run(noteId, guid, isCloze ? clozeModelId : basicModelId, nowSeconds, noteTags.length ? ` ${noteTags.join(' ')} ` : '', flds, sortField, csum)

        cardId++
        const folder = card.folderId ? folderById.get(card.folderId) : undefined
        const cardDeckId = folder ? deckIdByName.get(folderDeckName(folder, folderById)) ?? deckId : deckId
        // A card that's been through at least one graduated review keeps its schedule; anything still
        // in our sub-day "again" loop (interval < 1 day) or never reviewed goes over as a new card.
        const learned = card.repetitions > 0 && card.intervalDays >= 1
        if (learned) {
          const dueDays = Math.max(0, Math.floor((new Date(card.dueAt).getTime() / 1000 - crt) / 86400))
          insertCard.run(cardId, noteId, cardDeckId, nowSeconds, 2, 2, dueDays, Math.round(card.intervalDays), Math.round(card.easeFactor * 1000), card.repetitions, card.lapses)
        } else {
          insertCard.run(cardId, noteId, cardDeckId, nowSeconds, 0, 0, duePosition++, 0, 2500, 0, card.lapses)
        }
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
  /** The deck the note's first card lives in, as a folder path (`['Bio', 'Renal']`), or null for
   *  Anki's built-in "Default" deck. */
  deckPath: string[] | null
  tags: string[]
  /** Review progress carried over from Anki, or null for a card that's still new there. */
  schedule: { dueAt: string; intervalDays: number; easeFactor: number; repetitions: number; lapses: number } | null
}

interface AnkiCollection {
  models: Map<number, { isCloze: boolean }>
  decks: Map<number, string>
  crt: number
  notes: { id: number; mid: number; flds: string; tags: string }[]
  cards: { nid: number; did: number; ord: number; type: number; queue: number; due: number; ivl: number; factor: number; reps: number; lapses: number }[]
}

/** Minimal protobuf reader — just enough for the two tiny messages modern Anki packages wrap
 *  (notetype config, media list), so no protobuf dependency is needed. */
function readVarint(buf: Uint8Array, pos: number): [number, number] {
  let result = 0
  let shift = 0
  for (;;) {
    const byte = buf[pos++]
    result += (byte & 0x7f) * 2 ** shift
    if ((byte & 0x80) === 0) return [result, pos]
    shift += 7
  }
}

function readFields(buf: Uint8Array): { field: number; wire: number; value: number | Uint8Array }[] {
  const out: { field: number; wire: number; value: number | Uint8Array }[] = []
  let pos = 0
  while (pos < buf.length) {
    let tag: number
    ;[tag, pos] = readVarint(buf, pos)
    const field = Math.floor(tag / 8)
    const wire = tag % 8
    if (wire === 0) {
      let v: number
      ;[v, pos] = readVarint(buf, pos)
      out.push({ field, wire, value: v })
    } else if (wire === 2) {
      let len: number
      ;[len, pos] = readVarint(buf, pos)
      out.push({ field, wire, value: buf.subarray(pos, pos + len) })
      pos += len
    } else if (wire === 1) {
      pos += 8
    } else if (wire === 5) {
      pos += 4
    } else {
      break
    }
  }
  return out
}

/** Parses a `.apkg`. Three layouts exist in the wild, tried newest first: `collection.anki21b`
 *  (zstd-compressed database, protobuf media list — what current Anki writes by default),
 *  `collection.anki21` (legacy schema; what "support older Anki versions" writes, alongside a
 *  placeholder `collection.anki2` that only holds a "please update" note — so that one must lose),
 *  and a plain `collection.anki2` from older exporters. */
export async function parseAnkiPackage(buffer: Buffer): Promise<ParsedAnkiNote[]> {
  const zip = await JSZip.loadAsync(buffer)
  const modernEntry = zip.file('collection.anki21b')
  const legacyEntry = zip.file('collection.anki21') ?? zip.file('collection.anki2')
  if (!modernEntry && !legacyEntry) throw new Error('No Anki collection found in this .apkg — is it a valid Anki export?')
  const modern = !!modernEntry

  const dbBytes = modern
    ? Buffer.from(zstdDecompress(await modernEntry!.async('uint8array')))
    : await legacyEntry!.async('nodebuffer')

  // filename -> zip entry name, plus how to turn that entry's bytes into the file's real bytes.
  const mediaEntryNames = new Map<string, string>()
  const mediaEntry = zip.file('media')
  if (mediaEntry) {
    if (modern) {
      const entries = readFields(zstdDecompress(await mediaEntry.async('uint8array')))
      let index = 0
      for (const e of entries) {
        if (e.field !== 1 || typeof e.value === 'number') continue
        const name = readFields(e.value).find((f) => f.field === 1)?.value
        if (name instanceof Uint8Array) mediaEntryNames.set(Buffer.from(name).toString('utf8'), String(index))
        index++
      }
    } else {
      const manifest: Record<string, string> = JSON.parse(await mediaEntry.async('string'))
      for (const [key, filename] of Object.entries(manifest)) mediaEntryNames.set(filename, key)
    }
  }
  async function readMedia(filename: string): Promise<Buffer | null> {
    const key = mediaEntryNames.get(filename)
    const entry = key !== undefined ? zip.file(key) : null
    if (!entry) return null
    const raw = await entry.async('uint8array')
    return Buffer.from(modern ? zstdDecompress(raw) : raw)
  }

  const collection = readCollection(dbBytes, modern)
  const firstCardByNote = new Map<number, AnkiCollection['cards'][number]>()
  for (const card of collection.cards) {
    const existing = firstCardByNote.get(card.nid)
    if (!existing || card.ord < existing.ord) firstCardByNote.set(card.nid, card)
  }

  const notes: ParsedAnkiNote[] = []
  for (const row of collection.notes) {
    const model = collection.models.get(row.mid)
    if (!model) continue
    const fields = row.flds.split('\x1f')
    const isCloze = model.isCloze
    const rawFront = fields[0] ?? ''
    const rawBack = fields[1] ?? ''

    const images: { filename: string; data: Buffer }[] = []
    const seen = new Set<string>()
    for (const match of `${rawFront}${rawBack}`.matchAll(/<img[^>]+src=["']([^"'>]+)["']/gi)) {
      const filename = decodeURIComponent(match[1])
      if (seen.has(filename)) continue
      seen.add(filename)
      const data = await readMedia(filename)
      if (data) images.push({ filename, data })
    }

    const front = isCloze ? clozeHtmlToText(stripHtml(rawFront)) : stripHtml(rawFront)
    // Cloze notes' second field is "Back Extra" — context shown with the answer, worth keeping.
    const back = htmlToBackLines(rawBack)

    const card = firstCardByNote.get(row.id)
    const deckName = card ? collection.decks.get(card.did) : undefined
    // "Default" is Anki's built-in catch-all and "Outcisura" is where our own export puts unfiled cards.
    const deckPath = deckName && deckName !== 'Default' && deckName !== 'Outcisura' ? deckName.split('::').filter(Boolean) : null
    const tags = row.tags.split(/\s+/).filter(Boolean).map((t) => t.replace(/_/g, ' '))

    // Only graduated review cards carry a meaningful schedule; new/learning ones start fresh here.
    let schedule: ParsedAnkiNote['schedule'] = null
    if (card && card.type === 2 && card.ivl > 0) {
      const dueMs = (collection.crt + card.due * 86400) * 1000
      schedule = {
        dueAt: new Date(dueMs).toISOString(),
        intervalDays: card.ivl,
        easeFactor: Math.max(1.3, card.factor / 1000 || 2.5),
        repetitions: Math.max(1, card.reps),
        lapses: card.lapses
      }
    }

    notes.push({ front, back, cardType: isCloze ? 'cloze' : 'basic', images, deckPath: deckPath && deckPath.length ? deckPath : null, tags, schedule })
  }
  return notes
}

function readCollection(dbBytes: Buffer, modern: boolean): AnkiCollection {
  const tmpDir = mkdtempSync(join(tmpdir(), 'outcisura-anki-import-'))
  const dbPath = join(tmpDir, 'collection.db')
  writeFileSync(dbPath, dbBytes)
  try {
    const db = new Database(dbPath, { readonly: true })
    try {
      const col = db.prepare(`SELECT crt${modern ? '' : ', models, decks'} FROM col LIMIT 1`).get() as { crt: number; models?: string; decks?: string }
      const models = new Map<number, { isCloze: boolean }>()
      const decks = new Map<number, string>()
      if (modern) {
        for (const r of db.prepare(`SELECT id, config FROM notetypes`).all() as { id: number; config: Buffer }[]) {
          const kind = readFields(r.config).find((f) => f.field === 1 && f.wire === 0)?.value
          models.set(r.id, { isCloze: kind === 1 })
        }
        for (const r of db.prepare(`SELECT id, name FROM decks`).all() as { id: number; name: string }[]) decks.set(r.id, r.name.replace(/\x1f/g, '::'))
      } else {
        const parsedModels: Record<string, { type: number }> = JSON.parse(col.models ?? '{}')
        for (const [id, m] of Object.entries(parsedModels)) models.set(Number(id), { isCloze: m.type === 1 })
        const parsedDecks: Record<string, { name: string }> = JSON.parse(col.decks ?? '{}')
        for (const [id, d] of Object.entries(parsedDecks)) decks.set(Number(id), d.name)
      }
      return {
        models,
        decks,
        crt: col.crt,
        notes: db.prepare(`SELECT id, mid, flds, tags FROM notes ORDER BY id`).all() as AnkiCollection['notes'],
        cards: db.prepare(`SELECT nid, did, ord, type, queue, due, ivl, factor, reps, lapses FROM cards`).all() as AnkiCollection['cards']
      }
    } finally {
      db.close()
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

const NAMED_ENTITIES: Record<string, string> = { nbsp: ' ', lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole
  })
}

function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/\[sound:[^\]]*\]/g, '')
      .replace(/<img[^>]*>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(div|p|li|tr|h[1-6])>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<\/?[^>]+>/g, '')
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Anki's numbered `{{cN::text::hint}}` collapses to our flat `{{text}}` — every blank in the note
 *  reveals together here regardless of its original cloze number (see cloze.ts). */
function clozeHtmlToText(text: string): string {
  return text.replace(/\{\{c\d+::(.+?)(?:::.*?)?\}\}/gs, '{{$1}}')
}

function htmlToBackLines(html: string): string {
  // Indentation survives as leading &nbsp;/spaces (our own export writes four per nesting level),
  // so measure it per line before the tags are stripped.
  return html
    .split(/<br\s*\/?>|<\/(?:div|p|li)>/i)
    .map((line) => {
      const lead = line.replace(/^(?:<[^>]+>)*/, '').match(/^(?:&nbsp;|\s)*/)?.[0] ?? ''
      const columns = (lead.match(/&nbsp;/g)?.length ?? 0) + lead.replace(/&nbsp;/g, '').length
      const text = stripHtml(line)
      return { depth: Math.min(4, Math.floor(columns / 4)), text: text.replace(/^[•\-*]\s*/, '') }
    })
    .filter((l) => l.text.length > 0)
    .map((l) => `${'  '.repeat(l.depth)}• ${l.text}`)
    .join('\n')
}
