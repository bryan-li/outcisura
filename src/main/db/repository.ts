import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import type {
  BBox,
  CardRecord,
  CardReorderItem,
  CardSourceRecord,
  CardUpdatePatch,
  CreateVideoFramePageInput,
  DocumentPositionPatch,
  DocumentRecord,
  ElementKind,
  ElementRecord,
  DocumentFolderRecord,
  DocumentFolderReorderItem,
  DocumentFolderUpdatePatch,
  FolderRecord,
  FolderReorderItem,
  FolderUpdatePatch,
  ImportVideoInput,
  NewCardInput,
  NewReviewSessionInput,
  OrphanedSourceRecord,
  PageRecord,
  ParsedDocument,
  RecaptureOrphanedSourceInput,
  ReplaceOrphanedSourceInput,
  ReviewLogEntry,
  ReviewSessionRecord,
  SaveTranscriptSegmentInput,
  SrsSnapshot,
  SyncOp,
  TimeRange,
  TranscriptCoverageResult,
  TranscriptionEngine,
  TranscriptSegmentRecord
} from '../../shared/types'
import { nextSrsState, type ReviewGrade } from '../../shared/srs'
import { saveDataUrlImage } from '../imageStore'
import { saveVideoFile, deleteVideoFile } from '../videoStore'

/** Same page/region, tolerant of float round-trip through JSON/SQLite rather than exact equality. */
function bboxEquals(a: BBox, b: BBox): boolean {
  const EPSILON = 0.5
  return Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON && Math.abs(a.w - b.w) < EPSILON && Math.abs(a.h - b.h) < EPSILON
}

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

    return {
      id: documentId,
      filename: parsed.filename,
      type: parsed.type,
      importedAt,
      pageCount: parsed.pages.length,
      sourceVideoPath: null,
      durationSeconds: null,
      lastPageIndex: null,
      lastPlaybackSeconds: null,
      folderId: null
    }
  }

  /** No pages/elements inserted here, unlike importDocument — a video has nothing to pre-render;
   *  frames are created lazily via createVideoFramePage, only when the user actually captures one. */
  importVideoDocument(input: ImportVideoInput): DocumentRecord {
    const documentId = randomUUID()
    const importedAt = new Date().toISOString()
    const sourceVideoPath = saveVideoFile(input.path)
    this.db
      .prepare(
        `INSERT INTO documents (id, filename, type, imported_at, page_count, source_video_path, duration_seconds)
         VALUES (?, ?, 'video', ?, 0, ?, ?)`
      )
      .run(documentId, input.filename, importedAt, sourceVideoPath, input.durationSeconds)
    return {
      id: documentId,
      filename: input.filename,
      type: 'video',
      importedAt,
      pageCount: 0,
      sourceVideoPath,
      durationSeconds: input.durationSeconds,
      lastPageIndex: null,
      lastPlaybackSeconds: null,
      folderId: null
    }
  }

  /** A paused video frame, captured on-demand — becomes an ordinary page (zero elements) so the
   *  entire existing occlusion/crop/card-creation pipeline works on it unchanged. page_index is
   *  ordering-only here (matches getPages' ORDER BY), not semantically meaningful for video. */
  createVideoFramePage(input: CreateVideoFramePageInput): PageRecord {
    const pageIndex = (
      this.db.prepare(`SELECT COUNT(*) as c FROM pages WHERE document_id = ?`).get(input.documentId) as { c: number }
    ).c
    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO pages (id, document_id, page_index, width, height, background_image_path, timestamp_seconds, timestamp_end_seconds)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.documentId,
        pageIndex,
        input.width,
        input.height,
        input.backgroundImagePath,
        input.timestampSeconds,
        input.timestampEndSeconds ?? null
      )
    return {
      id,
      documentId: input.documentId,
      pageIndex,
      width: input.width,
      height: input.height,
      backgroundImagePath: input.backgroundImagePath,
      timestampSeconds: input.timestampSeconds,
      timestampEndSeconds: input.timestampEndSeconds ?? null
    }
  }

  listDocuments(): DocumentRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, filename, type, imported_at, page_count, source_video_path, duration_seconds, last_page_index, last_playback_seconds, folder_id FROM documents ORDER BY imported_at DESC`
      )
      .all() as {
      id: string
      filename: string
      type: 'pdf' | 'pptx' | 'video'
      imported_at: string
      page_count: number
      source_video_path: string | null
      duration_seconds: number | null
      last_page_index: number | null
      last_playback_seconds: number | null
      folder_id: string | null
    }[]
    return rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      type: r.type,
      importedAt: r.imported_at,
      pageCount: r.page_count,
      sourceVideoPath: r.source_video_path,
      durationSeconds: r.duration_seconds,
      lastPageIndex: r.last_page_index,
      lastPlaybackSeconds: r.last_playback_seconds,
      folderId: r.folder_id
    }))
  }

  /** Assigns (or clears, via null) which document_folders row a document belongs to — a narrow
   *  single-purpose patch, same shape as updateDocumentPosition, rather than a general updateDocument
   *  covering fields nothing else needs to change together. */
  updateDocumentFolderAssignment(documentId: string, folderId: string | null): void {
    this.db.prepare(`UPDATE documents SET folder_id = ? WHERE id = ?`).run(folderId, documentId)
  }

  createDocumentFolder(name: string, parentId: string | null = null): DocumentFolderRecord {
    const id = randomUUID()
    const createdAt = new Date().toISOString()
    const siblingCount = (
      this.db.prepare(`SELECT COUNT(*) as c FROM document_folders WHERE parent_id IS ?`).get(parentId) as { c: number }
    ).c
    this.db
      .prepare(`INSERT INTO document_folders (id, name, created_at, parent_id, sort_order, collapsed) VALUES (?, ?, ?, ?, ?, 0)`)
      .run(id, name, createdAt, parentId, siblingCount)
    return { id, name, createdAt, parentId, sortOrder: siblingCount, collapsed: false }
  }

  listDocumentFolders(): DocumentFolderRecord[] {
    const rows = this.db.prepare(`SELECT * FROM document_folders ORDER BY parent_id, sort_order ASC`).all() as DocumentFolderRow[]
    return rows.map(hydrateDocumentFolder)
  }

  updateDocumentFolder(id: string, patch: DocumentFolderUpdatePatch): DocumentFolderRecord {
    const existing = this.db.prepare(`SELECT * FROM document_folders WHERE id = ?`).get(id) as DocumentFolderRow | undefined
    if (!existing) throw new Error(`Document folder ${id} not found`)
    const name = patch.name ?? existing.name
    const parentId = 'parentId' in patch ? (patch.parentId ?? null) : existing.parent_id
    const sortOrder = patch.sortOrder ?? existing.sort_order
    const collapsed = patch.collapsed ?? !!existing.collapsed
    this.db
      .prepare(`UPDATE document_folders SET name = ?, parent_id = ?, sort_order = ?, collapsed = ? WHERE id = ?`)
      .run(name, parentId, sortOrder, collapsed ? 1 : 0, id)
    return hydrateDocumentFolder(this.db.prepare(`SELECT * FROM document_folders WHERE id = ?`).get(id) as DocumentFolderRow)
  }

  /** Applies a batch of drag-drop position updates in one transaction — same "cosmetic, per-device,
   *  not synced" reasoning as reorderFolders, doubly true here since document_folders never syncs
   *  at all. */
  reorderDocumentFolders(items: DocumentFolderReorderItem[]): void {
    const stmt = this.db.prepare(`UPDATE document_folders SET parent_id = ?, sort_order = ? WHERE id = ?`)
    const run = this.db.transaction((rows: DocumentFolderReorderItem[]) => {
      for (const row of rows) stmt.run(row.parentId, row.sortOrder, row.id)
    })
    run(items)
  }

  /** Subfolders cascade-delete (FK ON DELETE CASCADE); documents inside fall back to unfiled via
   *  documents.folder_id's own ON DELETE SET NULL — same pattern deleteFolder already established
   *  for cards. */
  deleteDocumentFolder(id: string): void {
    this.db.prepare(`DELETE FROM document_folders WHERE id = ?`).run(id)
  }

  /** Only ever called with the one field that applies to this document's type (page index for
   *  pdf/pptx, playback seconds for video) — a plain patch rather than two separate methods since
   *  the caller (documentsStore) already knows which one it has. */
  updateDocumentPosition(id: string, patch: DocumentPositionPatch): void {
    if (patch.lastPageIndex !== undefined) {
      this.db.prepare(`UPDATE documents SET last_page_index = ? WHERE id = ?`).run(patch.lastPageIndex, id)
    }
    if (patch.lastPlaybackSeconds !== undefined) {
      this.db.prepare(`UPDATE documents SET last_playback_seconds = ? WHERE id = ?`).run(patch.lastPlaybackSeconds, id)
    }
  }

  getPages(documentId: string): PageRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, document_id, page_index, width, height, background_image_path, timestamp_seconds, timestamp_end_seconds FROM pages WHERE document_id = ? ORDER BY page_index ASC`
      )
      .all(documentId) as {
      id: string
      document_id: string
      page_index: number
      width: number
      height: number
      background_image_path: string | null
      timestamp_seconds: number | null
      timestamp_end_seconds: number | null
    }[]
    return rows.map((r) => ({
      id: r.id,
      documentId: r.document_id,
      pageIndex: r.page_index,
      width: r.width,
      height: r.height,
      backgroundImagePath: r.background_image_path,
      timestampSeconds: r.timestamp_seconds,
      timestampEndSeconds: r.timestamp_end_seconds
    }))
  }

  deleteDocument(id: string): void {
    const row = this.db.prepare(`SELECT source_video_path FROM documents WHERE id = ?`).get(id) as
      | { source_video_path: string | null }
      | undefined
    this.db.prepare(`DELETE FROM documents WHERE id = ?`).run(id)
    if (row?.source_video_path) deleteVideoFile(row.source_video_path)
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

  /** Standalone counterpart to importDocument's inline element insert — that one only ever runs as
   *  part of a fresh import; this is for adding elements to a page that already exists (OCR results
   *  on a captured video frame today). Builds return records from known inputs rather than
   *  re-querying, matching createVideoFramePage's own style. */
  insertElements(
    pageId: string,
    elements: { kind: ElementKind; bbox: BBox; text: string | null; imagePath: string | null }[]
  ): ElementRecord[] {
    const insertElement = this.db.prepare(
      `INSERT INTO elements (id, page_id, kind, x, y, w, h, text, image_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const ids = elements.map(() => randomUUID())
    const run = this.db.transaction(() => {
      elements.forEach((el, i) =>
        insertElement.run(ids[i], pageId, el.kind, el.bbox.x, el.bbox.y, el.bbox.w, el.bbox.h, el.text, el.imagePath)
      )
    })
    run()
    return elements.map((el, i) => ({ id: ids[i], pageId, kind: el.kind, bbox: el.bbox, text: el.text, imagePath: el.imagePath }))
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
         due_at, interval_days, ease_factor, repetitions, lapses, last_reviewed_at, created_at, updated_at,
         reveal_image_on_flip, origin_backend, origin_id
       )
       VALUES (?, ?, ?, ?, 0, NULL, NULL, NULL, ?, ?, 0, 2.5, 0, 0, NULL, ?, ?, ?, NULL, NULL)`
    )
    const insertSource = this.db.prepare(
      `INSERT INTO card_sources (
         id, card_id, document_id, page_id, element_id, x, y, w, h, label, image_path,
         mask_x, mask_y, mask_w, mask_h, image_face, source_document_filename, source_page_index,
         source_timestamp_seconds
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const documentFilename = this.db.prepare(`SELECT filename FROM documents WHERE id = ?`)
    const pageIndex = this.db.prepare(`SELECT page_index FROM pages WHERE id = ?`)
    const pageTimestamp = this.db.prepare(`SELECT timestamp_seconds FROM pages WHERE id = ?`)

    const sourceRows: CardSourceRecord[] = []
    const run = this.db.transaction(() => {
      // due_at = now: brand-new cards are immediately due, so they show up in the queue right away.
      insertCard.run(cardId, input.front, input.back, input.cardType, sortOrder, now, now, now, input.revealImageOnFlip ? 1 : 0)
      for (const src of input.sources) {
        const sourceId = randomUUID()
        // Snapshotted once here, never re-derived — see card_sources' own migration comment on why
        // (documents/pages never sync, so this is the only breadcrumb a source orphaned on another
        // device carries).
        const sourceDocumentFilename = (documentFilename.get(src.documentId) as { filename: string } | undefined)?.filename ?? null
        const sourcePageIndex = (pageIndex.get(src.pageId) as { page_index: number } | undefined)?.page_index ?? null
        const sourceTimestampSeconds = (pageTimestamp.get(src.pageId) as { timestamp_seconds: number | null } | undefined)?.timestamp_seconds ?? null
        insertSource.run(
          sourceId,
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
          src.maskBBox?.h ?? null,
          src.imageFace ?? null,
          sourceDocumentFilename,
          sourcePageIndex,
          sourceTimestampSeconds
        )
        sourceRows.push({
          id: sourceId,
          cardId,
          documentId: src.documentId,
          pageId: src.pageId,
          elementId: src.elementId,
          bbox: src.bbox,
          label: src.label,
          imagePath: src.imagePath ?? null,
          maskBBox: src.maskBBox ?? null,
          imageFace: src.imageFace ?? null,
          sourceDocumentFilename,
          sourcePageIndex,
          sourceTimestampSeconds
        })
      }

      const cardRecord: CardRecord = {
        id: cardId,
        front: input.front,
        back: input.back,
        cardType: input.cardType,
        aiGenerated: false,
        prevFront: null,
        prevBack: null,
        createdAt: now,
        updatedAt: now,
        folderId: null,
        sortOrder,
        dueAt: now,
        intervalDays: 0,
        easeFactor: 2.5,
        repetitions: 0,
        lapses: 0,
        lastReviewedAt: null,
        sources: sourceRows,
        revealImageOnFlip: input.revealImageOnFlip ?? false,
        originBackend: null,
        originId: null
      }
      this.logSyncOp('cards', 'insert', cardId, cardRecord)
      if (sourceRows.length > 0) this.logSyncOp('card_sources', 'insert', cardId, sourceRows)
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
    const originBackend = 'originBackend' in patch ? (patch.originBackend ?? null) : existing.originBackend
    const originId = 'originId' in patch ? (patch.originId ?? null) : existing.originId
    const updatedAt = new Date().toISOString()
    const run = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE cards SET front = ?, back = ?, folder_id = ?, origin_backend = ?, origin_id = ?, updated_at = ? WHERE id = ?`
        )
        .run(front, back, folderId, originBackend, originId, updatedAt, id)
      this.logSyncOp('cards', 'update', id, { ...existing, front, back, folderId, originBackend, originId, updatedAt })
    })
    run()
    return this.getCard(id)!
  }

  /** Overwrites front/back with an AI suggestion, stashing the previous pair for one-step undo. */
  applyAiRegeneration(id: string, next: { front: string; back: string }): CardRecord {
    const existing = this.getCard(id)
    if (!existing) throw new Error(`Card ${id} not found`)
    const updatedAt = new Date().toISOString()
    const run = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE cards SET front = ?, back = ?, ai_generated = 1, prev_front = ?, prev_back = ?, updated_at = ? WHERE id = ?`
        )
        .run(next.front, next.back, existing.front, existing.back, updatedAt, id)
      this.logSyncOp('cards', 'update', id, {
        ...existing,
        front: next.front,
        back: next.back,
        aiGenerated: true,
        prevFront: existing.front,
        prevBack: existing.back,
        updatedAt
      })
    })
    run()
    return this.getCard(id)!
  }

  /** Advances a card's spaced-repetition schedule (see shared/srs.ts) after a review grade, and
   *  logs the event — this is the only place review_log gets a row, since it's meant to capture
   *  real review activity (undo below deliberately does not log; it's reversing one, not doing one).
   *  Bumps updated_at (unlike before the sync engine existed) — pull's last-write-wins comparison
   *  needs to see a grade as a real change, not just front/back/folder edits. */
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
    const nowIso = now.toISOString()
    const logId = randomUUID()
    const updateCard = this.db.prepare(
      `UPDATE cards SET due_at = ?, interval_days = ?, ease_factor = ?, repetitions = ?, lapses = ?, last_reviewed_at = ?, updated_at = ? WHERE id = ?`
    )
    const insertLog = this.db.prepare(`INSERT INTO review_log (id, card_id, grade, reviewed_at) VALUES (?, ?, ?, ?)`)
    const run = this.db.transaction(() => {
      updateCard.run(next.dueAt, next.intervalDays, next.easeFactor, next.repetitions, next.lapses, nowIso, nowIso, id)
      insertLog.run(logId, id, grade, nowIso)
      this.logSyncOp('cards', 'update', id, {
        ...existing,
        dueAt: next.dueAt,
        intervalDays: next.intervalDays,
        easeFactor: next.easeFactor,
        repetitions: next.repetitions,
        lapses: next.lapses,
        lastReviewedAt: nowIso,
        updatedAt: nowIso
      })
      this.logSyncOp('review_log', 'insert', logId, { id: logId, cardId: id, grade, reviewedAt: nowIso })
    })
    run()
    return this.getCard(id)!
  }

  /** Direct overwrite of a card's SRS fields — used only by review-session undo, never normal
   *  grading. Also bumps updated_at now, for the same reason gradeCard does. */
  setCardSrsState(id: string, srs: SrsSnapshot): CardRecord {
    const existing = this.getCard(id)
    if (!existing) throw new Error(`Card ${id} not found`)
    const updatedAt = new Date().toISOString()
    const run = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE cards SET due_at = ?, interval_days = ?, ease_factor = ?, repetitions = ?, lapses = ?, last_reviewed_at = ?, updated_at = ? WHERE id = ?`
        )
        .run(srs.dueAt, srs.intervalDays, srs.easeFactor, srs.repetitions, srs.lapses, srs.lastReviewedAt, updatedAt, id)
      this.logSyncOp('cards', 'update', id, { ...existing, ...srs, updatedAt })
    })
    run()
    return this.getCard(id)!
  }

  deleteCard(id: string): void {
    const run = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM cards WHERE id = ?`).run(id)
      this.logSyncOp('cards', 'delete', id, null)
    })
    run()
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

  logReviewSession(input: NewReviewSessionInput): ReviewSessionRecord {
    const id = randomUUID()
    this.db
      .prepare(`INSERT INTO review_sessions (id, started_at, ended_at, duration_seconds, cards_reviewed) VALUES (?, ?, ?, ?, ?)`)
      .run(id, input.startedAt, input.endedAt, input.durationSeconds, input.cardsReviewed)
    return { id, ...input }
  }

  /** For dashboard stats only (avg session length) — same "whole table, compute in the renderer"
   *  reasoning as listReviewLog, and this table only ever grows by one row per review session. */
  listReviewSessions(): ReviewSessionRecord[] {
    const rows = this.db.prepare(`SELECT * FROM review_sessions ORDER BY started_at DESC`).all() as {
      id: string
      started_at: string
      ended_at: string
      duration_seconds: number
      cards_reviewed: number
    }[]
    return rows.map((r) => ({
      id: r.id,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      durationSeconds: r.duration_seconds,
      cardsReviewed: r.cards_reviewed
    }))
  }

  /** Applies a batch of drag-drop position updates (within one rendered list) in one transaction.
   *  Deliberately not logged to sync_ops (see syncEngine.ts) — manual drag order is cosmetic and
   *  per-device, same scope cut already established for the old offline-write outbox. */
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
    const run = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO folders (id, name, created_at, updated_at, parent_id, sort_order, collapsed) VALUES (?, ?, ?, ?, ?, ?, 0)`
        )
        .run(id, name, createdAt, createdAt, parentId, siblingCount)
      this.logSyncOp('folders', 'insert', id, {
        id,
        name,
        createdAt,
        updatedAt: createdAt,
        parentId,
        sortOrder: siblingCount,
        collapsed: false,
        originBackend: null,
        originId: null
      })
    })
    run()
    return { id, name, createdAt, updatedAt: createdAt, parentId, sortOrder: siblingCount, collapsed: false, originBackend: null, originId: null }
  }

  listFolders(): FolderRecord[] {
    const rows = this.db.prepare(`SELECT * FROM folders ORDER BY parent_id, sort_order ASC`).all() as FolderRow[]
    return rows.map(hydrateFolder)
  }

  /** Bumps updated_at — unlike reorderFolders below, this is a real content change the sync
   *  engine's last-write-wins comparison needs to see. */
  updateFolder(id: string, patch: FolderUpdatePatch): FolderRecord {
    const existing = this.db.prepare(`SELECT * FROM folders WHERE id = ?`).get(id) as FolderRow | undefined
    if (!existing) throw new Error(`Folder ${id} not found`)
    const name = patch.name ?? existing.name
    const parentId = 'parentId' in patch ? (patch.parentId ?? null) : existing.parent_id
    const sortOrder = patch.sortOrder ?? existing.sort_order
    const collapsed = patch.collapsed ?? !!existing.collapsed
    const originBackend = 'originBackend' in patch ? (patch.originBackend ?? null) : existing.origin_backend
    const originId = 'originId' in patch ? (patch.originId ?? null) : existing.origin_id
    const updatedAt = new Date().toISOString()
    const run = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE folders SET name = ?, parent_id = ?, sort_order = ?, collapsed = ?, origin_backend = ?, origin_id = ?, updated_at = ? WHERE id = ?`
        )
        .run(name, parentId, sortOrder, collapsed ? 1 : 0, originBackend, originId, updatedAt, id)
      this.logSyncOp('folders', 'update', id, {
        id,
        name,
        createdAt: existing.created_at,
        updatedAt,
        parentId,
        sortOrder,
        collapsed,
        originBackend,
        originId
      })
    })
    run()
    return hydrateFolder(this.db.prepare(`SELECT * FROM folders WHERE id = ?`).get(id) as FolderRow)
  }

  /** Applies a batch of drag-drop position updates in one transaction. Deliberately not logged to
   *  sync_ops (see syncEngine.ts) — manual drag order is cosmetic and per-device, same scope cut
   *  already established for the old offline-write outbox. */
  reorderFolders(items: FolderReorderItem[]): void {
    const stmt = this.db.prepare(`UPDATE folders SET parent_id = ?, sort_order = ? WHERE id = ?`)
    const run = this.db.transaction((rows: FolderReorderItem[]) => {
      for (const row of rows) stmt.run(row.parentId, row.sortOrder, row.id)
    })
    run(items)
  }

  deleteFolder(id: string): void {
    const run = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM folders WHERE id = ?`).run(id)
      this.logSyncOp('folders', 'delete', id, null)
    })
    run()
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
      maskBBox: s.mask_x !== null ? ({ x: s.mask_x, y: s.mask_y!, w: s.mask_w!, h: s.mask_h! } satisfies BBox) : null,
      imageFace: s.image_face,
      sourceDocumentFilename: s.source_document_filename,
      sourcePageIndex: s.source_page_index,
      sourceTimestampSeconds: s.source_timestamp_seconds
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
      sources,
      revealImageOnFlip: !!row.reveal_image_on_flip,
      originBackend: row.origin_backend,
      originId: row.origin_id
    }
  }

  listTranscriptSegments(documentId: string, engine: TranscriptionEngine): TranscriptSegmentRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM transcript_segments WHERE document_id = ? AND engine = ? ORDER BY start_seconds`)
      .all(documentId, engine) as TranscriptSegmentRow[]
    return rows.map(hydrateTranscriptSegment)
  }

  insertTranscriptSegment(input: SaveTranscriptSegmentInput): TranscriptSegmentRecord {
    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO transcript_segments (id, document_id, engine, start_seconds, end_seconds, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.documentId, input.engine, input.range.startSeconds, input.range.endSeconds, input.text, new Date().toISOString())
    return {
      id,
      documentId: input.documentId,
      engine: input.engine,
      startSeconds: input.range.startSeconds,
      endSeconds: input.range.endSeconds,
      text: input.text
    }
  }

  /** Diffs a requested [start,end) range against what's already been transcribed for this
   *  document+engine — `existingSegments` can be reused verbatim, `gaps` are the sub-ranges the
   *  caller still needs to actually transcribe. Pure read, no writes; the caller transcribes each
   *  gap and persists it via insertTranscriptSegment afterward. */
  getTranscriptCoverage(documentId: string, engine: TranscriptionEngine, range: TimeRange): TranscriptCoverageResult {
    const all = this.listTranscriptSegments(documentId, engine)
    const existingSegments = all
      .filter((s) => s.endSeconds > range.startSeconds && s.startSeconds < range.endSeconds)
      .sort((a, b) => a.startSeconds - b.startSeconds)

    const gaps: TimeRange[] = []
    let cursor = range.startSeconds
    for (const seg of existingSegments) {
      const segStart = Math.max(seg.startSeconds, range.startSeconds)
      if (segStart > cursor) gaps.push({ startSeconds: cursor, endSeconds: segStart })
      cursor = Math.max(cursor, Math.min(seg.endSeconds, range.endSeconds))
    }
    if (cursor < range.endSeconds) gaps.push({ startSeconds: cursor, endSeconds: range.endSeconds })

    return { existingSegments, gaps }
  }

  // --- Local-first bidirectional sync (see renderer/src/lib/syncEngine.ts) -----------------------

  /** Appends one row to the operation log — always called from inside the same transaction as the
   *  mutation it's tracking (see createCard/updateCard/gradeCard/etc. above), so the log can never
   *  drift from what actually happened. payload is JSON-encoded; null for deletes. */
  private logSyncOp(tableName: SyncOp['table'], op: SyncOp['op'], recordId: string, payload: unknown): void {
    this.db
      .prepare(`INSERT INTO sync_ops (table_name, op, record_id, payload, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(tableName, op, recordId, payload === null ? null : JSON.stringify(payload), new Date().toISOString())
  }

  /** All pending sync operations, oldest first (see the sync_ops table's own migration comment for
   *  why `id`, not `created_at`, is the ordering key). */
  getPendingSyncOps(): SyncOp[] {
    const rows = this.db.prepare(`SELECT * FROM sync_ops ORDER BY id ASC`).all() as SyncOpRow[]
    return rows.map((r) => ({
      id: r.id,
      table: r.table_name as SyncOp['table'],
      op: r.op as SyncOp['op'],
      recordId: r.record_id,
      payload: r.payload ? JSON.parse(r.payload) : null,
      createdAt: r.created_at
    }))
  }

  /** Drops the given ops from the queue — used both for ops that pushed successfully and ones the
   *  sync engine has classified as a permanent (non-retryable) failure. Which case it was is a
   *  renderer-side logging concern only; either way the op is done being tracked. */
  removeSyncOps(ids: number[]): void {
    const stmt = this.db.prepare(`DELETE FROM sync_ops WHERE id = ?`)
    const run = this.db.transaction((idList: number[]) => {
      for (const id of idList) stmt.run(id)
    })
    run(ids)
  }

  getSyncMeta(key: string): string | null {
    const row = this.db.prepare(`SELECT value FROM sync_meta WHERE key = ?`).get(key) as { value: string } | undefined
    return row?.value ?? null
  }

  setSyncMeta(key: string, value: string): void {
    this.db
      .prepare(`INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(key, value)
  }

  /** Local cards/folders still linked to a cloud origin via the origin_backend/origin_id columns
   *  left over from the retired migrate-and-dedup toggle feature — used only by the sync engine's
   *  one-time bootstrap re-key pass (see rekeyCardId/rekeyFolderId below). */
  getOriginLinkedCards(): { id: string; originId: string }[] {
    return this.db
      .prepare(`SELECT id, origin_id as originId FROM cards WHERE origin_backend = 'cloud' AND origin_id IS NOT NULL`)
      .all() as { id: string; originId: string }[]
  }

  getOriginLinkedFolders(): { id: string; originId: string }[] {
    return this.db
      .prepare(`SELECT id, origin_id as originId FROM folders WHERE origin_backend = 'cloud' AND origin_id IS NOT NULL`)
      .all() as { id: string; originId: string }[]
  }

  private withForeignKeysOff<T>(fn: () => T): T {
    this.db.pragma('foreign_keys = OFF')
    try {
      const run = this.db.transaction(() => {
        const result = fn()
        const violations = this.db.pragma('foreign_key_check') as unknown[]
        if (violations.length > 0) {
          throw new Error(`Foreign key violations after id rekey: ${JSON.stringify(violations)}`)
        }
        return result
      })
      return run()
    } finally {
      this.db.pragma('foreign_keys = ON')
    }
  }

  /** One-time bootstrap only (see syncEngine.ts) — re-keys a local card's id to match its
   *  already-existing cloud counterpart, collapsing what would otherwise become a duplicate pair
   *  once continuous sync starts. Cascades to card_sources.card_id/review_log.card_id, which
   *  reference cards.id but have no ON UPDATE CASCADE (SQLite doesn't auto-cascade an id change) —
   *  done with foreign_keys off, the same safety-checked pattern schema.ts's own table-rebuild
   *  migrations use. */
  rekeyCardId(oldId: string, newId: string): void {
    this.withForeignKeysOff(() => {
      this.db.prepare(`UPDATE cards SET id = ? WHERE id = ?`).run(newId, oldId)
      this.db.prepare(`UPDATE card_sources SET card_id = ? WHERE card_id = ?`).run(newId, oldId)
      this.db.prepare(`UPDATE review_log SET card_id = ? WHERE card_id = ?`).run(newId, oldId)
    })
  }

  /** Same idea as rekeyCardId, for folders — cascades to child folders' parent_id and member
   *  cards' folder_id. */
  rekeyFolderId(oldId: string, newId: string): void {
    this.withForeignKeysOff(() => {
      this.db.prepare(`UPDATE folders SET id = ? WHERE id = ?`).run(newId, oldId)
      this.db.prepare(`UPDATE folders SET parent_id = ? WHERE parent_id = ?`).run(newId, oldId)
      this.db.prepare(`UPDATE cards SET folder_id = ? WHERE folder_id = ?`).run(newId, oldId)
    })
  }

  /** Writes a pulled remote card into local SQLite as-is — used only by the sync engine's pull
   *  phase. Deliberately does NOT call logSyncOp (that would create an infinite push/pull loop) and
   *  does NOT go through createCard/updateCard (those mint a fresh sort_order / assume a
   *  user-initiated edit). Replaces this card's sources wholesale (delete-then-reinsert) rather
   *  than diffing them — sources are cheap and never independently edited after creation, so this
   *  is simpler and just as correct as a smarter diff. Caller is responsible for applying folders
   *  before cards in a pull cycle, so folder_id's FK is always satisfiable here.
   *
   *  card_sources.document_id/page_id are real NOT NULL foreign keys locally (documents/pages are
   *  local-only, never synced — see Phase 0's own scope note) — a card pulled from a device that
   *  imported different source documents can carry a document_id/page_id this machine has never
   *  seen. Inserting that source verbatim would throw an FK violation and abort this card (and,
   *  since the caller loops over every card in one pull, everything queued after it that cycle
   *  too). The card's own content/SRS state above still applies regardless of what happens to its
   *  sources below.
   *
   *  Two independent failure modes get detected and recorded in orphaned_sources (see the missing-
   *  source recovery view) instead of silently dropped:
   *  - documentId/pageId don't resolve locally (`reason: 'unresolved_document'`) — the source can't
   *    be inserted at all (would violate the FK), so it's skipped from card_sources entirely.
   *  - imagePath is set but the file doesn't exist on this device (`reason: 'missing_file'`) — the
   *    source IS still inserted (nothing in the schema stops it), since this is otherwise today's
   *    existing silently-renders-nothing failure mode; it's additionally flagged so there's a
   *    recovery path. This matters most for a standalone-uploaded replacement source (documentId
   *    null, so it always passes the first check) pulled onto a third device — its image file is
   *    exactly as local-only as everything else images touch, so without this check the "fix"
   *    mechanism would quietly reintroduce the same class of bug it exists to solve. */
  applyRemoteCardUpsert(card: CardRecord): void {
    const run = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO cards (
             id, front, back, card_type, ai_generated, prev_front, prev_back, folder_id, sort_order,
             due_at, interval_days, ease_factor, repetitions, lapses, last_reviewed_at, created_at,
             updated_at, reveal_image_on_flip, origin_backend, origin_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             front = excluded.front, back = excluded.back, card_type = excluded.card_type,
             ai_generated = excluded.ai_generated, prev_front = excluded.prev_front, prev_back = excluded.prev_back,
             folder_id = excluded.folder_id, sort_order = excluded.sort_order, due_at = excluded.due_at,
             interval_days = excluded.interval_days, ease_factor = excluded.ease_factor,
             repetitions = excluded.repetitions, lapses = excluded.lapses, last_reviewed_at = excluded.last_reviewed_at,
             updated_at = excluded.updated_at, reveal_image_on_flip = excluded.reveal_image_on_flip,
             origin_backend = excluded.origin_backend, origin_id = excluded.origin_id`
        )
        .run(
          card.id,
          card.front,
          card.back,
          card.cardType,
          card.aiGenerated ? 1 : 0,
          card.prevFront,
          card.prevBack,
          card.folderId,
          card.sortOrder,
          card.dueAt,
          card.intervalDays,
          card.easeFactor,
          card.repetitions,
          card.lapses,
          card.lastReviewedAt,
          card.createdAt,
          card.updatedAt,
          card.revealImageOnFlip ? 1 : 0,
          card.originBackend,
          card.originId
        )
      this.db.prepare(`DELETE FROM card_sources WHERE card_id = ?`).run(card.id)
      const insertSource = this.db.prepare(
        `INSERT INTO card_sources (
           id, card_id, document_id, page_id, element_id, x, y, w, h, label, image_path,
           mask_x, mask_y, mask_w, mask_h, image_face, source_document_filename, source_page_index,
           source_timestamp_seconds
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      const documentExists = this.db.prepare(`SELECT 1 FROM documents WHERE id = ?`)
      const pageExists = this.db.prepare(`SELECT 1 FROM pages WHERE id = ?`)
      const elementExists = this.db.prepare(`SELECT 1 FROM elements WHERE id = ?`)
      const insertOrphan = this.db.prepare(
        `INSERT OR IGNORE INTO orphaned_sources (
           id, card_id, reason, document_id, page_id, element_id, x, y, w, h, label, image_path,
           mask_x, mask_y, mask_w, mask_h, image_face, source_document_filename, source_page_index,
           source_timestamp_seconds, detected_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      const detectedAt = new Date().toISOString()
      const resolvesLocally = (s: CardSourceRecord): boolean =>
        (s.documentId === null || !!documentExists.get(s.documentId)) && (s.pageId === null || !!pageExists.get(s.pageId))
      // Prefer a source that resolves locally with a real image on disk over one that resolves but
      // has no image, over one that doesn't resolve at all — used only to pick a representative
      // among content-identical duplicates below, not to change insert/orphan behavior otherwise.
      const sourceScore = (s: CardSourceRecord): number => (!resolvesLocally(s) ? 0 : s.imagePath && existsSync(s.imagePath) ? 2 : 1)

      // Recapturing on one device always mints a brand-new source tied to that device's own local
      // document, since documents/images never sync — a card can end up carrying several sources
      // that all describe the identical page/region, one per device that ever recaptured it.
      // Without collapsing these, every recapture round-trip would pile up a fresh duplicate (or,
      // for whichever device can't resolve it, a fresh orphan) forever instead of ever converging.
      // Reduce each same-content group down to its single best-scoring representative; if nothing
      // in a group resolves locally, every member of it still falls through to the orphan path
      // below exactly as before this existed (score is uniformly 0, so nothing gets marked redundant).
      const redundant = new Set<number>()
      const grouped = new Set<number>()
      for (let i = 0; i < card.sources.length; i++) {
        if (grouped.has(i) || card.sources[i].sourceDocumentFilename === null) continue
        const group = [i]
        grouped.add(i)
        for (let j = i + 1; j < card.sources.length; j++) {
          if (grouped.has(j)) continue
          const a = card.sources[i]
          const b = card.sources[j]
          if (b.sourceDocumentFilename === a.sourceDocumentFilename && b.sourcePageIndex === a.sourcePageIndex && bboxEquals(a.bbox, b.bbox)) {
            group.push(j)
            grouped.add(j)
          }
        }
        if (group.length < 2) continue
        let winner = group[0]
        for (const idx of group) {
          if (sourceScore(card.sources[idx]) > sourceScore(card.sources[winner])) winner = idx
        }
        if (sourceScore(card.sources[winner]) === 0) continue
        for (const idx of group) {
          if (idx !== winner) redundant.add(idx)
        }
      }

      // A redundant source may already carry an *open* orphan row from before this device ever saw
      // the now-winning duplicate (e.g. from a pull that ran before this dedup logic existed, or
      // simply an earlier cycle that happened to apply before the covering source arrived) — that
      // orphan is stale as of this apply, so resolve it now rather than leaving a "missing source"
      // flag up for a card that's actually fully covered.
      const resolveOrphan = this.db.prepare(`UPDATE orphaned_sources SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL`)
      for (const idx of redundant) {
        resolveOrphan.run(detectedAt, card.sources[idx].id)
      }

      card.sources.forEach((src, index) => {
        if (redundant.has(index)) return
        const docOk = src.documentId === null || !!documentExists.get(src.documentId)
        const pageOk = src.pageId === null || !!pageExists.get(src.pageId)
        if (!docOk || !pageOk) {
          insertOrphan.run(
            src.id,
            card.id,
            'unresolved_document',
            src.documentId,
            src.pageId,
            src.elementId,
            src.bbox.x,
            src.bbox.y,
            src.bbox.w,
            src.bbox.h,
            src.label,
            src.imagePath,
            src.maskBBox?.x ?? null,
            src.maskBBox?.y ?? null,
            src.maskBBox?.w ?? null,
            src.maskBBox?.h ?? null,
            src.imageFace,
            src.sourceDocumentFilename,
            src.sourcePageIndex,
            src.sourceTimestampSeconds,
            detectedAt
          )
          return
        }
        const elementId = src.elementId && elementExists.get(src.elementId) ? src.elementId : null
        insertSource.run(
          src.id,
          card.id,
          src.documentId,
          src.pageId,
          elementId,
          src.bbox.x,
          src.bbox.y,
          src.bbox.w,
          src.bbox.h,
          src.label,
          src.imagePath,
          src.maskBBox?.x ?? null,
          src.maskBBox?.y ?? null,
          src.maskBBox?.w ?? null,
          src.maskBBox?.h ?? null,
          src.imageFace,
          src.sourceDocumentFilename,
          src.sourcePageIndex,
          src.sourceTimestampSeconds
        )
        if (src.imagePath && !existsSync(src.imagePath)) {
          insertOrphan.run(
            src.id,
            card.id,
            'missing_file',
            src.documentId,
            src.pageId,
            src.elementId,
            src.bbox.x,
            src.bbox.y,
            src.bbox.w,
            src.bbox.h,
            src.label,
            src.imagePath,
            src.maskBBox?.x ?? null,
            src.maskBBox?.y ?? null,
            src.maskBBox?.w ?? null,
            src.maskBBox?.h ?? null,
            src.imageFace,
            src.sourceDocumentFilename,
            src.sourcePageIndex,
            src.sourceTimestampSeconds,
            detectedAt
          )
        }
      })
    })
    run()
  }

  /** Folder counterpart to applyRemoteCardUpsert. Caller must apply folders in parent-before-child
   *  order across one pull batch, since parent_id is a real local FK. */
  applyRemoteFolderUpsert(folder: FolderRecord): void {
    this.db
      .prepare(
        `INSERT INTO folders (id, name, created_at, updated_at, parent_id, sort_order, collapsed, origin_backend, origin_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, updated_at = excluded.updated_at, parent_id = excluded.parent_id,
           sort_order = excluded.sort_order, collapsed = excluded.collapsed,
           origin_backend = excluded.origin_backend, origin_id = excluded.origin_id`
      )
      .run(
        folder.id,
        folder.name,
        folder.createdAt,
        folder.updatedAt,
        folder.parentId,
        folder.sortOrder,
        folder.collapsed ? 1 : 0,
        folder.originBackend,
        folder.originId
      )
  }

  /** review_log is append-only/immutable — a pulled entry either doesn't exist locally yet (insert
   *  it) or already does (no-op), never a conflict to resolve. */
  applyRemoteReviewLogInsert(entry: ReviewLogEntry): void {
    this.db
      .prepare(`INSERT OR IGNORE INTO review_log (id, card_id, grade, reviewed_at) VALUES (?, ?, ?, ?)`)
      .run(entry.id, entry.cardId, entry.grade, entry.reviewedAt)
  }

  /** One-time maintenance primitive. Covers two distinct gaps, both handled *safely*:
   *  - Folders/cards created before the local-first sync engine's create methods existed at all
   *    (e.g. a folder made back when this was still a plain local SQLite app) have no queued push
   *    and never will on their own — confirmed directly: a pre-existing folder with zero pending
   *    sync_ops that never reached Supabase. Fixed by pushing only the ones genuinely missing
   *    remotely (`existingRemoteFolderIds`/`existingRemoteCardIds`, fetched by the caller — only
   *    the renderer talks to Supabase directly).
   *  - card_sources rows whose data predates a column being added (source_document_filename/
   *    source_page_index) — the local SQLite migration that adds such a column backfills it via a
   *    LEFT JOIN against local data, but a local-only backfill has no way to also push itself.
   *
   *  Deliberately does NOT blindly re-push every folder/card's current local state, unlike an
   *  earlier version of this method — that's actively unsafe: Postgres `upsert` has no
   *  timestamp-aware conflict resolution, it just applies whatever the client sends, so
   *  re-pushing a card this device hasn't pulled the latest edit for would silently clobber a
   *  more recent edit made on another device with this device's own stale copy. Confirmed as a
   *  real regression during testing, not a hypothetical — a device's own stale front-text edit
   *  overwrote a different device's newer, already-pushed fix. Only pushing rows that don't exist
   *  remotely *at all* can't have this problem, since there's nothing there yet to clobber.
   *  card_sources resyncing is comparatively lower-risk (rows are only ever touched by creation or
   *  the rare, deliberate missing-source recovery flows, not continuous editing the way card
   *  front/back text is), so it stays a plain per-card resync. */
  resyncMissingLocalData(existingRemoteFolderIds: string[], existingRemoteCardIds: string[]): void {
    const remoteFolderIdSet = new Set(existingRemoteFolderIds)
    for (const folder of this.listFolders()) {
      if (!remoteFolderIdSet.has(folder.id)) this.logSyncOp('folders', 'update', folder.id, folder)
    }
    const remoteCardIdSet = new Set(existingRemoteCardIds)
    for (const card of this.listCards()) {
      if (!remoteCardIdSet.has(card.id)) this.logSyncOp('cards', 'update', card.id, card)
      if (card.sources.length > 0) this.logSyncOp('card_sources', 'update', card.id, card.sources)
    }
  }

  /** Still-open orphans only — a resolved one stays resolved even if re-detected (see the
   *  orphaned_sources migration comment on why deletion-on-resolve would be wrong here). */
  getOrphanedSources(): OrphanedSourceRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM orphaned_sources WHERE resolved_at IS NULL ORDER BY detected_at ASC`)
      .all() as OrphanedSourceRow[]
    return rows.map(hydrateOrphanedSource)
  }

  /** Fixes one orphaned source by attaching a freshly saved local image (see the missing-source
   *  recovery view's upload flow) in place of whatever couldn't be resolved. Branches on the
   *  orphan's own `reason`: `missing_file` updates the card_sources row that's already there in
   *  place; `unresolved_document` inserts a brand new one (the original was never inserted at
   *  all, to avoid the FK violation). Either way, also bumps and pushes cards.updated_at — without
   *  this, other devices' pull (which only re-fetches a card when its own updated_at is newer)
   *  would never learn the fix happened, since a card_sources-only change is otherwise invisible
   *  to it (a real bug caught in review before this shipped). */
  replaceOrphanedSource(orphanId: string, input: ReplaceOrphanedSourceInput): CardRecord {
    const orphan = this.db.prepare(`SELECT * FROM orphaned_sources WHERE id = ?`).get(orphanId) as OrphanedSourceRow | undefined
    if (!orphan) throw new Error(`Orphaned source ${orphanId} not found`)
    const card = this.getCard(orphan.card_id)
    if (!card) throw new Error(`Card ${orphan.card_id} not found`)
    const now = new Date().toISOString()

    const run = this.db.transaction(() => {
      if (orphan.reason === 'missing_file') {
        this.db.prepare(`UPDATE card_sources SET image_path = ? WHERE id = ?`).run(input.imagePath, orphanId)
        this.logSyncOp('card_sources', 'update', orphanId, [orphanToCardSourceRecord(orphan, input.imagePath)])
      } else {
        const newId = randomUUID()
        this.db
          .prepare(
            `INSERT INTO card_sources (
               id, card_id, document_id, page_id, element_id, x, y, w, h, label, image_path,
               mask_x, mask_y, mask_w, mask_h, image_face, source_document_filename, source_page_index
             ) VALUES (?, ?, NULL, NULL, NULL, 0, 0, 1, 1, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
          )
          .run(newId, orphan.card_id, orphan.label, input.imagePath, orphan.mask_x, orphan.mask_y, orphan.mask_w, orphan.mask_h, orphan.image_face)
        this.logSyncOp('card_sources', 'insert', orphan.card_id, [
          orphanToCardSourceRecord({ ...orphan, id: newId, document_id: null, page_id: null, element_id: null, x: 0, y: 0, w: 1, h: 1 }, input.imagePath)
        ])
      }
      this.db.prepare(`UPDATE orphaned_sources SET resolved_at = ? WHERE id = ?`).run(now, orphanId)
      this.db.prepare(`UPDATE cards SET updated_at = ? WHERE id = ?`).run(now, orphan.card_id)
      this.logSyncOp('cards', 'update', orphan.card_id, { ...card, updatedAt: now })
    })
    run()
    return this.getCard(orphan.card_id)!
  }

  /** Recapture counterpart to replaceOrphanedSource — same branch structure (missing_file updates
   *  the existing card_sources row in place, unresolved_document inserts a fresh one, since the
   *  original was never inserted at all), but produces a real document/page-linked source instead
   *  of a standalone null-document one. Same cards.updated_at bump + sync_op logging for the same
   *  reason: other devices' pull only re-fetches a card when its own updated_at is newer, so
   *  without this the fix would never actually reach anywhere else. */
  recaptureOrphanedSource(orphanId: string, input: RecaptureOrphanedSourceInput): CardRecord {
    const orphan = this.db.prepare(`SELECT * FROM orphaned_sources WHERE id = ?`).get(orphanId) as OrphanedSourceRow | undefined
    if (!orphan) throw new Error(`Orphaned source ${orphanId} not found`)
    const card = this.getCard(orphan.card_id)
    if (!card) throw new Error(`Card ${orphan.card_id} not found`)
    const now = new Date().toISOString()

    const recapturedSource: CardSourceRecord = {
      id: orphanId,
      cardId: orphan.card_id,
      documentId: input.documentId,
      pageId: input.pageId,
      elementId: null,
      bbox: input.bbox,
      label: orphan.label,
      imagePath: input.imagePath,
      maskBBox: null,
      imageFace: orphan.image_face as 'front' | 'back' | null,
      sourceDocumentFilename: input.sourceDocumentFilename,
      sourcePageIndex: input.sourcePageIndex,
      sourceTimestampSeconds: input.sourceTimestampSeconds
    }

    const run = this.db.transaction(() => {
      if (orphan.reason === 'missing_file') {
        this.db
          .prepare(
            `UPDATE card_sources SET
               document_id = ?, page_id = ?, element_id = NULL, x = ?, y = ?, w = ?, h = ?,
               image_path = ?, mask_x = NULL, mask_y = NULL, mask_w = NULL, mask_h = NULL,
               source_document_filename = ?, source_page_index = ?, source_timestamp_seconds = ?
             WHERE id = ?`
          )
          .run(
            input.documentId,
            input.pageId,
            input.bbox.x,
            input.bbox.y,
            input.bbox.w,
            input.bbox.h,
            input.imagePath,
            input.sourceDocumentFilename,
            input.sourcePageIndex,
            input.sourceTimestampSeconds,
            orphanId
          )
        this.logSyncOp('card_sources', 'update', orphanId, [recapturedSource])
      } else {
        // This card may already carry another source covering the identical page/region —
        // typically because it was created natively on this device and only orphaned on some
        // *other* device (that device's own recapture would independently mint its own new source
        // pointing at its own document, which can never resolve here). Inserting another row for
        // the same content would just be a redundant duplicate; resolving the orphan is enough.
        // sourcePageIndex alone identifies "same page" for pdf/pptx, but is a meaningless per-device
        // capture-order counter for video — matching on sourceTimestampSeconds too (when set) covers
        // the same-video-moment case pageIndex alone would miss.
        const alreadyCovered = card.sources.some(
          (existing) =>
            existing.sourceDocumentFilename !== null &&
            existing.sourceDocumentFilename === input.sourceDocumentFilename &&
            bboxEquals(existing.bbox, input.bbox) &&
            (existing.sourcePageIndex === input.sourcePageIndex ||
              (existing.sourceTimestampSeconds !== null && existing.sourceTimestampSeconds === input.sourceTimestampSeconds))
        )
        if (!alreadyCovered) {
          const newId = randomUUID()
          this.db
            .prepare(
              `INSERT INTO card_sources (
                 id, card_id, document_id, page_id, element_id, x, y, w, h, label, image_path,
                 mask_x, mask_y, mask_w, mask_h, image_face, source_document_filename, source_page_index,
                 source_timestamp_seconds
               ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?)`
            )
            .run(
              newId,
              orphan.card_id,
              input.documentId,
              input.pageId,
              input.bbox.x,
              input.bbox.y,
              input.bbox.w,
              input.bbox.h,
              orphan.label,
              input.imagePath,
              orphan.image_face,
              input.sourceDocumentFilename,
              input.sourcePageIndex,
              input.sourceTimestampSeconds
            )
          this.logSyncOp('card_sources', 'insert', orphan.card_id, [{ ...recapturedSource, id: newId }])
        }
      }
      this.db.prepare(`UPDATE orphaned_sources SET resolved_at = ? WHERE id = ?`).run(now, orphanId)
      this.db.prepare(`UPDATE cards SET updated_at = ? WHERE id = ?`).run(now, orphan.card_id)
      this.logSyncOp('cards', 'update', orphan.card_id, { ...card, updatedAt: now })
    })
    run()
    return this.getCard(orphan.card_id)!
  }

  /** Accepts a card as-is on this device with one fewer source, rather than replacing it — for
   *  when the source genuinely doesn't matter here (a highlighted-text source with no image at
   *  all, or an image the user just doesn't have a replacement for). `unresolved_document` never
   *  had a card_sources row to begin with (it was skipped to avoid the FK violation), so there's
   *  nothing to remove — just mark it resolved. `missing_file` DOES have a row already (with a
   *  permanently dangling image_path) — removed here so the card doesn't keep carrying a slot that
   *  can only ever render nothing, rather than left in place to silently fail forever.
   *
   *  Deliberately NOT logged as a sync_op and does NOT bump cards.updated_at, unlike
   *  replaceOrphanedSource — this is a purely local "I don't need this on THIS device" choice, not
   *  new information worth telling other devices about. The same source may be perfectly valid on
   *  whichever device actually has the file; propagating its removal would break that device for
   *  no reason. */
  dismissOrphanedSource(orphanId: string): CardRecord {
    const orphan = this.db.prepare(`SELECT * FROM orphaned_sources WHERE id = ?`).get(orphanId) as OrphanedSourceRow | undefined
    if (!orphan) throw new Error(`Orphaned source ${orphanId} not found`)
    const now = new Date().toISOString()
    const run = this.db.transaction(() => {
      if (orphan.reason === 'missing_file') {
        this.db.prepare(`DELETE FROM card_sources WHERE id = ?`).run(orphanId)
      }
      this.db.prepare(`UPDATE orphaned_sources SET resolved_at = ? WHERE id = ?`).run(now, orphanId)
    })
    run()
    return this.getCard(orphan.card_id)!
  }
}

interface TranscriptSegmentRow {
  id: string
  document_id: string
  engine: TranscriptionEngine
  start_seconds: number
  end_seconds: number
  text: string
}

function hydrateTranscriptSegment(row: TranscriptSegmentRow): TranscriptSegmentRecord {
  return {
    id: row.id,
    documentId: row.document_id,
    engine: row.engine,
    startSeconds: row.start_seconds,
    endSeconds: row.end_seconds,
    text: row.text
  }
}

interface CardRow {
  id: string
  front: string
  back: string
  card_type: 'basic' | 'image_occlusion' | 'cloze' | 'picture'
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
  reveal_image_on_flip: number
  origin_backend: 'cloud' | 'local' | null
  origin_id: string | null
}

interface CardSourceRow {
  id: string
  card_id: string
  document_id: string | null
  page_id: string | null
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
  image_face: 'front' | 'back' | null
  source_document_filename: string | null
  source_page_index: number | null
  source_timestamp_seconds: number | null
}

interface FolderRow {
  id: string
  name: string
  created_at: string
  updated_at: string
  parent_id: string | null
  sort_order: number
  collapsed: number
  origin_backend: 'cloud' | 'local' | null
  origin_id: string | null
}

function hydrateFolder(row: FolderRow): FolderRecord {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    parentId: row.parent_id,
    sortOrder: row.sort_order,
    collapsed: !!row.collapsed,
    originBackend: row.origin_backend,
    originId: row.origin_id
  }
}

interface DocumentFolderRow {
  id: string
  name: string
  created_at: string
  parent_id: string | null
  sort_order: number
  collapsed: number
}

function hydrateDocumentFolder(row: DocumentFolderRow): DocumentFolderRecord {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    parentId: row.parent_id,
    sortOrder: row.sort_order,
    collapsed: !!row.collapsed
  }
}

interface SyncOpRow {
  id: number
  table_name: string
  op: string
  record_id: string
  payload: string | null
  created_at: string
}

interface OrphanedSourceRow {
  id: string
  card_id: string
  reason: string
  document_id: string | null
  page_id: string | null
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
  image_face: string | null
  source_document_filename: string | null
  source_page_index: number | null
  source_timestamp_seconds: number | null
  detected_at: string
  resolved_at: string | null
}

function hydrateOrphanedSource(row: OrphanedSourceRow): OrphanedSourceRecord {
  return {
    id: row.id,
    cardId: row.card_id,
    reason: row.reason as OrphanedSourceRecord['reason'],
    documentId: row.document_id,
    pageId: row.page_id,
    elementId: row.element_id,
    bbox: { x: row.x, y: row.y, w: row.w, h: row.h },
    label: row.label,
    imagePath: row.image_path,
    maskBBox: row.mask_x !== null ? { x: row.mask_x, y: row.mask_y!, w: row.mask_w!, h: row.mask_h! } : null,
    imageFace: row.image_face as 'front' | 'back' | null,
    sourceDocumentFilename: row.source_document_filename,
    sourcePageIndex: row.source_page_index,
    sourceTimestampSeconds: row.source_timestamp_seconds,
    detectedAt: row.detected_at,
    resolvedAt: row.resolved_at
  }
}

/** Builds the CardSourceRecord shape needed for a sync_op payload (see replaceOrphanedSource) out
 *  of an orphan's own snapshot, with the freshly saved image path substituted in. */
function orphanToCardSourceRecord(orphan: OrphanedSourceRow, imagePath: string): CardSourceRecord {
  return {
    id: orphan.id,
    cardId: orphan.card_id,
    documentId: orphan.document_id,
    pageId: orphan.page_id,
    elementId: orphan.element_id,
    bbox: { x: orphan.x, y: orphan.y, w: orphan.w, h: orphan.h },
    label: orphan.label,
    imagePath,
    maskBBox: orphan.mask_x !== null ? { x: orphan.mask_x, y: orphan.mask_y!, w: orphan.mask_w!, h: orphan.mask_h! } : null,
    imageFace: orphan.image_face as 'front' | 'back' | null,
    sourceDocumentFilename: orphan.source_document_filename,
    sourcePageIndex: orphan.source_page_index,
    sourceTimestampSeconds: orphan.source_timestamp_seconds
  }
}
