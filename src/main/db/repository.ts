import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import type {
  BBox,
  CardRecord,
  CardReorderItem,
  CardSourceRecord,
  CardUpdatePatch,
  DocumentRecord,
  ElementRecord,
  FolderRecord,
  FolderReorderItem,
  FolderUpdatePatch,
  NewCardInput,
  PageRecord,
  ParsedDocument,
  ReviewLogEntry,
  SrsSnapshot
} from '../../shared/types'
import { nextSrsState, type ReviewGrade } from '../../shared/srs'
import { saveDataUrlImage } from '../imageStore'

export class Repository {
  constructor(private db: Database.Database) {}

  importDocument(parsed: ParsedDocument): DocumentRecord {
    const documentId = randomUUID()
    const importedAt = new Date().toISOString()

    const insertDoc = this.db.prepare(
      `INSERT INTO documents (id, filename, type, imported_at, page_count) VALUES (?, ?, ?, ?, ?)`
    )
    const insertPage = this.db.prepare(
      `INSERT INTO pages (id, document_id, page_index, width, height, background_image_path) VALUES (?, ?, ?, ?, ?, ?)`
    )
    const insertElement = this.db.prepare(
      `INSERT INTO elements (id, page_id, kind, x, y, w, h, text, image_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    const run = this.db.transaction(() => {
      insertDoc.run(documentId, parsed.filename, parsed.type, importedAt, parsed.pages.length)

      for (const page of parsed.pages) {
        const pageId = randomUUID()
        const backgroundImagePath = page.backgroundImage
          ? saveDataUrlImage(page.backgroundImage)
          : null
        insertPage.run(pageId, documentId, page.pageIndex, page.width, page.height, backgroundImagePath)

        for (const el of page.elements) {
          const imagePath = el.imageData ? saveDataUrlImage(el.imageData) : null
          insertElement.run(
            randomUUID(),
            pageId,
            el.kind,
            el.bbox.x,
            el.bbox.y,
            el.bbox.w,
            el.bbox.h,
            el.text ?? null,
            imagePath
          )
        }
      }
    })
    run()

    return { id: documentId, filename: parsed.filename, type: parsed.type, importedAt, pageCount: parsed.pages.length }
  }

  listDocuments(): DocumentRecord[] {
    const rows = this.db
      .prepare(`SELECT id, filename, type, imported_at, page_count FROM documents ORDER BY imported_at DESC`)
      .all() as { id: string; filename: string; type: 'pdf' | 'pptx'; imported_at: string; page_count: number }[]
    return rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      type: r.type,
      importedAt: r.imported_at,
      pageCount: r.page_count
    }))
  }

  getPages(documentId: string): PageRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, document_id, page_index, width, height, background_image_path FROM pages WHERE document_id = ? ORDER BY page_index ASC`
      )
      .all(documentId) as {
      id: string
      document_id: string
      page_index: number
      width: number
      height: number
      background_image_path: string | null
    }[]
    return rows.map((r) => ({
      id: r.id,
      documentId: r.document_id,
      pageIndex: r.page_index,
      width: r.width,
      height: r.height,
      backgroundImagePath: r.background_image_path
    }))
  }

  deleteDocument(id: string): void {
    this.db.prepare(`DELETE FROM documents WHERE id = ?`).run(id)
  }

  getElements(pageId: string): ElementRecord[] {
    const rows = this.db
      .prepare(`SELECT id, page_id, kind, x, y, w, h, text, image_path FROM elements WHERE page_id = ?`)
      .all(pageId) as {
      id: string
      page_id: string
      kind: 'text' | 'image'
      x: number
      y: number
      w: number
      h: number
      text: string | null
      image_path: string | null
    }[]
    return rows.map((r) => ({
      id: r.id,
      pageId: r.page_id,
      kind: r.kind,
      bbox: { x: r.x, y: r.y, w: r.w, h: r.h },
      text: r.text,
      imagePath: r.image_path
    }))
  }

  createCard(input: NewCardInput): CardRecord {
    const cardId = randomUUID()
    const now = new Date().toISOString()
    // A global counter is enough: it only needs to exceed every card in whichever folder/group
    // this one eventually lands in, so it renders last there — see the sort_order migration note.
    const sortOrder = (
      this.db.prepare(`SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM cards`).get() as { next: number }
    ).next

    const insertCard = this.db.prepare(
      `INSERT INTO cards (
         id, front, back, card_type, ai_generated, prev_front, prev_back, folder_id, sort_order,
         due_at, interval_days, ease_factor, repetitions, lapses, last_reviewed_at, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, 0, NULL, NULL, NULL, ?, ?, 0, 2.5, 0, 0, NULL, ?, ?)`
    )
    const insertSource = this.db.prepare(
      `INSERT INTO card_sources (id, card_id, document_id, page_id, element_id, x, y, w, h, label, image_path, mask_x, mask_y, mask_w, mask_h)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    const run = this.db.transaction(() => {
      // due_at = now: brand-new cards are immediately due, so they show up in the queue right away.
      insertCard.run(cardId, input.front, input.back, input.cardType, sortOrder, now, now, now)
      for (const src of input.sources) {
        insertSource.run(
          randomUUID(),
          cardId,
          src.documentId,
          src.pageId,
          src.elementId,
          src.bbox.x,
          src.bbox.y,
          src.bbox.w,
          src.bbox.h,
          src.label,
          src.imagePath ?? null,
          src.maskBBox?.x ?? null,
          src.maskBBox?.y ?? null,
          src.maskBBox?.w ?? null,
          src.maskBBox?.h ?? null
        )
      }
    })
    run()

    return this.getCard(cardId)!
  }

  getCard(cardId: string): CardRecord | null {
    const row = this.db.prepare(`SELECT * FROM cards WHERE id = ?`).get(cardId) as
      | CardRow
      | undefined
    if (!row) return null
    return this.hydrateCard(row)
  }

  listCards(): CardRecord[] {
    const rows = this.db.prepare(`SELECT * FROM cards ORDER BY created_at DESC`).all() as CardRow[]
    return rows.map((r) => this.hydrateCard(r))
  }

  updateCard(id: string, patch: CardUpdatePatch): CardRecord {
    const existing = this.getCard(id)
    if (!existing) throw new Error(`Card ${id} not found`)
    const front = patch.front ?? existing.front
    const back = patch.back ?? existing.back
    // folderId may be explicitly set to null (move out of a folder), so check presence, not truthiness.
    const folderId = 'folderId' in patch ? (patch.folderId ?? null) : existing.folderId
    this.db
      .prepare(`UPDATE cards SET front = ?, back = ?, folder_id = ?, updated_at = ? WHERE id = ?`)
      .run(front, back, folderId, new Date().toISOString(), id)
    return this.getCard(id)!
  }

  /** Overwrites front/back with an AI suggestion, stashing the previous pair for one-step undo. */
  applyAiRegeneration(id: string, next: { front: string; back: string }): CardRecord {
    const existing = this.getCard(id)
    if (!existing) throw new Error(`Card ${id} not found`)
    this.db
      .prepare(
        `UPDATE cards SET front = ?, back = ?, ai_generated = 1, prev_front = ?, prev_back = ?, updated_at = ? WHERE id = ?`
      )
      .run(next.front, next.back, existing.front, existing.back, new Date().toISOString(), id)
    return this.getCard(id)!
  }

  /** Advances a card's spaced-repetition schedule (see shared/srs.ts) after a review grade, and
   *  logs the event — this is the only place review_log gets a row, since it's meant to capture
   *  real review activity (undo below deliberately does not log; it's reversing one, not doing one). */
  gradeCard(id: string, grade: ReviewGrade): CardRecord {
    const existing = this.getCard(id)
    if (!existing) throw new Error(`Card ${id} not found`)
    const now = new Date()
    const next = nextSrsState(
      {
        intervalDays: existing.intervalDays,
        easeFactor: existing.easeFactor,
        repetitions: existing.repetitions,
        lapses: existing.lapses
      },
      grade,
      now
    )
    const updateCard = this.db.prepare(
      `UPDATE cards SET due_at = ?, interval_days = ?, ease_factor = ?, repetitions = ?, lapses = ?, last_reviewed_at = ? WHERE id = ?`
    )
    const insertLog = this.db.prepare(`INSERT INTO review_log (id, card_id, grade, reviewed_at) VALUES (?, ?, ?, ?)`)
    const run = this.db.transaction(() => {
      updateCard.run(next.dueAt, next.intervalDays, next.easeFactor, next.repetitions, next.lapses, now.toISOString(), id)
      insertLog.run(randomUUID(), id, grade, now.toISOString())
    })
    run()
    return this.getCard(id)!
  }

  /** Direct overwrite of a card's SRS fields — used only by review-session undo, never normal grading. */
  setCardSrsState(id: string, srs: SrsSnapshot): CardRecord {
    this.db
      .prepare(
        `UPDATE cards SET due_at = ?, interval_days = ?, ease_factor = ?, repetitions = ?, lapses = ?, last_reviewed_at = ? WHERE id = ?`
      )
      .run(srs.dueAt, srs.intervalDays, srs.easeFactor, srs.repetitions, srs.lapses, srs.lastReviewedAt, id)
    return this.getCard(id)!
  }

  deleteCard(id: string): void {
    this.db.prepare(`DELETE FROM cards WHERE id = ?`).run(id)
  }

  /** For dashboard stats only (reviewed-today, streak) — a personal deck's log stays small enough
   *  that fetching it whole and computing in the renderer is simpler than pushing that math into SQL. */
  listReviewLog(): ReviewLogEntry[] {
    const rows = this.db.prepare(`SELECT * FROM review_log`).all() as {
      id: string
      card_id: string
      grade: string
      reviewed_at: string
    }[]
    return rows.map((r) => ({
      id: r.id,
      cardId: r.card_id,
      grade: r.grade as ReviewGrade,
      reviewedAt: r.reviewed_at
    }))
  }

  /** Applies a batch of drag-drop position updates (within one rendered list) in one transaction. */
  reorderCards(items: CardReorderItem[]): void {
    const stmt = this.db.prepare(`UPDATE cards SET sort_order = ? WHERE id = ?`)
    const run = this.db.transaction((rows: CardReorderItem[]) => {
      for (const row of rows) stmt.run(row.sortOrder, row.id)
    })
    run(items)
  }

  createFolder(name: string, parentId: string | null = null): FolderRecord {
    const id = randomUUID()
    const createdAt = new Date().toISOString()
    const siblingCount = (
      this.db.prepare(`SELECT COUNT(*) as c FROM folders WHERE parent_id IS ?`).get(parentId) as { c: number }
    ).c
    this.db
      .prepare(`INSERT INTO folders (id, name, created_at, parent_id, sort_order, collapsed) VALUES (?, ?, ?, ?, ?, 0)`)
      .run(id, name, createdAt, parentId, siblingCount)
    return { id, name, createdAt, parentId, sortOrder: siblingCount, collapsed: false }
  }

  listFolders(): FolderRecord[] {
    const rows = this.db.prepare(`SELECT * FROM folders ORDER BY parent_id, sort_order ASC`).all() as FolderRow[]
    return rows.map(hydrateFolder)
  }

  updateFolder(id: string, patch: FolderUpdatePatch): FolderRecord {
    const existing = this.db.prepare(`SELECT * FROM folders WHERE id = ?`).get(id) as FolderRow | undefined
    if (!existing) throw new Error(`Folder ${id} not found`)
    const name = patch.name ?? existing.name
    const parentId = 'parentId' in patch ? (patch.parentId ?? null) : existing.parent_id
    const sortOrder = patch.sortOrder ?? existing.sort_order
    const collapsed = patch.collapsed ?? !!existing.collapsed
    this.db
      .prepare(`UPDATE folders SET name = ?, parent_id = ?, sort_order = ?, collapsed = ? WHERE id = ?`)
      .run(name, parentId, sortOrder, collapsed ? 1 : 0, id)
    return hydrateFolder(this.db.prepare(`SELECT * FROM folders WHERE id = ?`).get(id) as FolderRow)
  }

  /** Applies a batch of drag-drop position updates in one transaction. */
  reorderFolders(items: FolderReorderItem[]): void {
    const stmt = this.db.prepare(`UPDATE folders SET parent_id = ?, sort_order = ? WHERE id = ?`)
    const run = this.db.transaction((rows: FolderReorderItem[]) => {
      for (const row of rows) stmt.run(row.parentId, row.sortOrder, row.id)
    })
    run(items)
  }

  deleteFolder(id: string): void {
    this.db.prepare(`DELETE FROM folders WHERE id = ?`).run(id)
  }

  private hydrateCard(row: CardRow): CardRecord {
    const sourceRows = this.db
      .prepare(`SELECT * FROM card_sources WHERE card_id = ?`)
      .all(row.id) as CardSourceRow[]
    const sources: CardSourceRecord[] = sourceRows.map((s) => ({
      id: s.id,
      cardId: s.card_id,
      documentId: s.document_id,
      pageId: s.page_id,
      elementId: s.element_id,
      bbox: { x: s.x, y: s.y, w: s.w, h: s.h } satisfies BBox,
      label: s.label,
      imagePath: s.image_path,
      maskBBox: s.mask_x !== null ? ({ x: s.mask_x, y: s.mask_y!, w: s.mask_w!, h: s.mask_h! } satisfies BBox) : null
    }))
    return {
      id: row.id,
      front: row.front,
      back: row.back,
      cardType: row.card_type,
      aiGenerated: !!row.ai_generated,
      prevFront: row.prev_front,
      prevBack: row.prev_back,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      folderId: row.folder_id,
      sortOrder: row.sort_order,
      dueAt: row.due_at,
      intervalDays: row.interval_days,
      easeFactor: row.ease_factor,
      repetitions: row.repetitions,
      lapses: row.lapses,
      lastReviewedAt: row.last_reviewed_at,
      sources
    }
  }
}

interface CardRow {
  id: string
  front: string
  back: string
  card_type: 'basic' | 'image_occlusion'
  ai_generated: number
  prev_front: string | null
  prev_back: string | null
  created_at: string
  updated_at: string
  folder_id: string | null
  sort_order: number
  due_at: string
  interval_days: number
  ease_factor: number
  repetitions: number
  lapses: number
  last_reviewed_at: string | null
}

interface CardSourceRow {
  id: string
  card_id: string
  document_id: string
  page_id: string
  element_id: string | null
  x: number
  y: number
  w: number
  h: number
  label: string
  image_path: string | null
  mask_x: number | null
  mask_y: number | null
  mask_w: number | null
  mask_h: number | null
}

interface FolderRow {
  id: string
  name: string
  created_at: string
  parent_id: string | null
  sort_order: number
  collapsed: number
}

function hydrateFolder(row: FolderRow): FolderRecord {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    parentId: row.parent_id,
    sortOrder: row.sort_order,
    collapsed: !!row.collapsed
  }
}
