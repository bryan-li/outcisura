import { supabase } from './supabase'
import { localCardsApi } from './api/localCards'
import { localFoldersApi } from './api/localFolders'
import { localReviewLogApi } from './api/localReviewLog'
import { useConnectivityStore } from '../state/connectivityStore'
import { useDocumentsStore } from '../state/documentsStore'
import { resolveOrphanAgainstPages } from './resolveOrphanSource'
import type { BBox, CardRecord, CardSourceRecord, FolderRecord, PageRecord, ReviewLogEntry, SyncOp } from '../../../shared/types'

/** Local-first bidirectional cloud sync. Local SQLite is always the primary read/write path (see
 *  cardsStore.ts/foldersStore.ts/reviewLogStore.ts — no more cloud/local mode selection); this
 *  engine keeps Supabase in sync with it, in both directions, replacing syncWorker.ts/
 *  queueableWrite.ts/outbox.ts wholesale.
 *
 *  One cycle = push, then pull, never interleaved or run concurrently (see the module-level
 *  `cycleInFlight` guard) — sound for a single-window, single-SQLite-connection app. See the plan
 *  doc for the full reasoning; the short version of each piece:
 *  - Push replays the local operation log (sync_ops, via IPC) against Supabase in order, using
 *    `upsert` for insert/update so a retry-after-ack-loss is a no-op, not a conflict error.
 *  - Pull fetches the full remote cards/folders tables (small enough at this scale that a
 *    timestamp cursor isn't worth the complexity) and applies whichever side has the newer
 *    `updatedAt`. review_log gets a watermark cursor instead, since it's append-only and grows
 *    unboundedly.
 *  - Deletes only propagate one direction (push) — see the plan's named scope cut on why pull
 *    doesn't detect/apply remote deletions. The zombie-reference cleanup below exists specifically
 *    to bound the blast radius of that cut (a card/folder referencing a folder deleted elsewhere),
 *    not to work around it more generally.
 */

const BOOTSTRAPPED_KEY = 'bootstrapped'
const REVIEW_LOG_WATERMARK_KEY = 'reviewLogPullWatermark'
const SYNC_INTERVAL_MS = 60_000
const CARD_SELECT = '*, card_sources(*)'

// --- Postgres row shapes + hydration (duplicated from the now-retired cards.ts/folders.ts cloud
// shims, since this is the only place that still needs them) ------------------------------------

interface RemoteCardSourceRow {
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
}

interface RemoteCardRow {
  id: string
  front: string
  back: string
  card_type: CardRecord['cardType']
  ai_generated: boolean
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
  reveal_image_on_flip: boolean
  origin_backend: 'cloud' | 'local' | null
  origin_id: string | null
  card_sources: RemoteCardSourceRow[]
}

function hydrateCardRow(row: RemoteCardRow): CardRecord {
  const sources: CardSourceRecord[] = row.card_sources.map((s) => ({
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
    sourcePageIndex: s.source_page_index
  }))
  return {
    id: row.id,
    front: row.front,
    back: row.back,
    cardType: row.card_type,
    aiGenerated: row.ai_generated,
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
    revealImageOnFlip: row.reveal_image_on_flip,
    originBackend: row.origin_backend,
    originId: row.origin_id
  }
}

interface RemoteFolderRow {
  id: string
  name: string
  created_at: string
  updated_at: string
  parent_id: string | null
  sort_order: number
  collapsed: boolean
  origin_backend: 'cloud' | 'local' | null
  origin_id: string | null
}

function hydrateFolderRow(row: RemoteFolderRow): FolderRecord {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    parentId: row.parent_id,
    sortOrder: row.sort_order,
    collapsed: row.collapsed,
    originBackend: row.origin_backend,
    originId: row.origin_id
  }
}

interface RemoteReviewLogRow {
  id: string
  card_id: string
  grade: ReviewLogEntry['grade']
  reviewed_at: string
}

function hydrateReviewLogRow(row: RemoteReviewLogRow): ReviewLogEntry {
  return { id: row.id, cardId: row.card_id, grade: row.grade, reviewedAt: row.reviewed_at }
}

/** Parents before children — a pulled folder can't be applied before its own parent exists
 *  locally (folders.parent_id is a real FK). Same algorithm as the now-retired dataMigration.ts. */
function topoSortFolders(folders: FolderRecord[]): FolderRecord[] {
  const result: FolderRecord[] = []
  const placed = new Set<string>()
  const remaining = [...folders]
  while (remaining.length > 0) {
    const before = remaining.length
    for (let i = remaining.length - 1; i >= 0; i--) {
      const f = remaining[i]
      if (f.parentId === null || placed.has(f.parentId)) {
        result.push(f)
        placed.add(f.id)
        remaining.splice(i, 1)
      }
    }
    if (remaining.length === before) {
      result.push(...remaining)
      break
    }
  }
  return result
}

// --- camelCase (sync_ops payload) -> snake_case (Postgres row) mapping --------------------------
// Mirrors exactly what the now-retired cards.ts/folders.ts cloud shims used to build by hand.

function cardToRow(c: CardRecord): Record<string, unknown> {
  return {
    id: c.id,
    front: c.front,
    back: c.back,
    card_type: c.cardType,
    ai_generated: c.aiGenerated,
    prev_front: c.prevFront,
    prev_back: c.prevBack,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
    folder_id: c.folderId,
    sort_order: c.sortOrder,
    due_at: c.dueAt,
    interval_days: c.intervalDays,
    ease_factor: c.easeFactor,
    repetitions: c.repetitions,
    lapses: c.lapses,
    last_reviewed_at: c.lastReviewedAt,
    reveal_image_on_flip: c.revealImageOnFlip,
    origin_backend: c.originBackend,
    origin_id: c.originId
  }
}

function sourceToRow(s: CardSourceRecord): Record<string, unknown> {
  return {
    id: s.id,
    card_id: s.cardId,
    document_id: s.documentId,
    page_id: s.pageId,
    element_id: s.elementId,
    x: s.bbox.x,
    y: s.bbox.y,
    w: s.bbox.w,
    h: s.bbox.h,
    label: s.label,
    image_path: s.imagePath,
    mask_x: s.maskBBox?.x ?? null,
    mask_y: s.maskBBox?.y ?? null,
    mask_w: s.maskBBox?.w ?? null,
    mask_h: s.maskBBox?.h ?? null,
    image_face: s.imageFace,
    source_document_filename: s.sourceDocumentFilename,
    source_page_index: s.sourcePageIndex
  }
}

function folderToRow(f: FolderRecord): Record<string, unknown> {
  return {
    id: f.id,
    name: f.name,
    created_at: f.createdAt,
    updated_at: f.updatedAt,
    parent_id: f.parentId,
    sort_order: f.sortOrder,
    collapsed: f.collapsed,
    origin_backend: f.originBackend,
    origin_id: f.originId
  }
}

function reviewLogToRow(e: ReviewLogEntry): Record<string, unknown> {
  return { id: e.id, card_id: e.cardId, grade: e.grade, reviewed_at: e.reviewedAt }
}

function toSupabaseRow(op: SyncOp): Record<string, unknown> | Record<string, unknown>[] {
  switch (op.table) {
    case 'cards':
      return cardToRow(op.payload as CardRecord)
    case 'card_sources':
      return (op.payload as CardSourceRecord[]).map(sourceToRow)
    case 'folders':
      return folderToRow(op.payload as FolderRecord)
    case 'review_log':
      return reviewLogToRow(op.payload as ReviewLogEntry)
  }
}

/** A constraint violation (FK/not-null/check) can never succeed by retrying — the row it's
 *  pointing at is gone, or the data itself is invalid. Treated as a permanent, skip-and-continue
 *  failure so one bad op can't jam every op queued behind it forever (see the plan's write-up on
 *  why this matters specifically for cards.folder_id/review_log.card_id's live FKs). Anything else
 *  (network errors, and any Postgres error we don't specifically recognize) is treated as
 *  transient — stop this cycle's push, retry the whole remaining queue next cycle. */
function isPermanentPushError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code
  return code === '23503' || code === '23502' || code === '23514'
}

// --- Push ------------------------------------------------------------------

interface PushResult {
  deletedCardIds: Set<string>
  deletedFolderIds: Set<string>
}

/** Replays the local operation log against Supabase, strictly in order (an op can depend on an
 *  earlier one — e.g. a card_sources insert referencing a card created by an earlier op in the
 *  same batch). Stops at the first transient failure; permanent failures are dropped and skipped
 *  over instead of blocking everything behind them. */
async function pushPhase(pendingOps: SyncOp[]): Promise<PushResult> {
  const deletedCardIds = new Set(pendingOps.filter((o) => o.table === 'cards' && o.op === 'delete').map((o) => o.recordId))
  const deletedFolderIds = new Set(pendingOps.filter((o) => o.table === 'folders' && o.op === 'delete').map((o) => o.recordId))

  for (const op of pendingOps) {
    try {
      const query = supabase.from(op.table)
      const { error } =
        op.op === 'delete' ? await query.delete().eq('id', op.recordId) : await query.upsert(toSupabaseRow(op), { onConflict: 'id' })
      if (error) throw error
      await window.api.sync.removeOps([op.id])
    } catch (err) {
      if (isPermanentPushError(err)) {
        console.warn('Sync: dropping permanently-failing op', op, err)
        await window.api.sync.removeOps([op.id])
        continue
      }
      console.warn('Sync: push stopped, will retry next cycle', err)
      break
    }
  }

  return { deletedCardIds, deletedFolderIds }
}

// --- Pull ------------------------------------------------------------------

async function pullPhase(pendingOps: SyncOp[], deletedCardIds: Set<string>, deletedFolderIds: Set<string>): Promise<void> {
  // Explicit user_id filter, not just relying on RLS — folders_select/cards_select (see
  // 0013_public_folders.sql) now also permit reading OTHER users' public folders/cards, for the
  // Hostable Decks browse feature. Without this filter, this same unfiltered pull would start
  // pulling every other user's public decks into local SQLite via applyFolderUpsert/applyCardUpsert
  // — silently merging strangers' decks into "my" sidebar as if owned (and locally editable, since
  // local SQLite has no RLS at all). Local-first sync stays exactly what it always was — pulling
  // *my* data only; browsing someone else's public deck goes through a separate, direct-Supabase
  // read path (hostableDecks.ts) that never touches local SQLite.
  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Sync: no authenticated user')

  // Folders first, parent-before-child — cards' folder_id and folders' own parent_id are both
  // real local FKs, so every folder needs to exist locally before anything references it.
  const { data: remoteFolderRows, error: foldersErr } = await supabase.from('folders').select('*').eq('user_id', user.id)
  if (foldersErr) throw new Error(foldersErr.message)
  const remoteFolders = (remoteFolderRows as RemoteFolderRow[]).map(hydrateFolderRow)
  const remoteFolderIds = new Set(remoteFolders.map((f) => f.id))
  const localFolderById = new Map((await localFoldersApi.list()).map((f) => [f.id, f]))

  for (const rf of topoSortFolders(remoteFolders)) {
    if (deletedFolderIds.has(rf.id)) continue // local-delete resurrection race, see pushPhase
    const local = localFolderById.get(rf.id)
    if (!local || new Date(rf.updatedAt).getTime() > new Date(local.updatedAt).getTime()) {
      await window.api.sync.applyFolderUpsert(rf)
    }
  }

  // Cards (+ their sources, embedded in the same query).
  const { data: remoteCardRows, error: cardsErr } = await supabase.from('cards').select(CARD_SELECT).eq('user_id', user.id)
  if (cardsErr) throw new Error(cardsErr.message)
  const remoteCards = (remoteCardRows as unknown as RemoteCardRow[]).map(hydrateCardRow)
  const localCardById = new Map((await localCardsApi.list()).map((c) => [c.id, c]))

  for (const rc of remoteCards) {
    if (deletedCardIds.has(rc.id)) continue
    const local = localCardById.get(rc.id)
    if (!local || new Date(rc.updatedAt).getTime() > new Date(local.updatedAt).getTime()) {
      await window.api.sync.applyCardUpsert(rc)
    }
  }

  // Zombie-reference cleanup: a folder deleted on another device (pull never propagates that
  // deletion — see the module doc comment) can leave a local card/folder pointing at an id that no
  // longer exists remotely. Left alone, editing that card would fail its next push with a foreign
  // key violation and jam the queue behind it. Excludes any folder id with a pending local insert
  // — a brand-new local folder not yet pushed must not be mistaken for a zombie just because it
  // doesn't exist remotely yet.
  const pendingFolderInsertIds = new Set(pendingOps.filter((o) => o.table === 'folders' && o.op === 'insert').map((o) => o.recordId))
  const isZombie = (folderId: string): boolean => !remoteFolderIds.has(folderId) && !pendingFolderInsertIds.has(folderId)

  for (const lf of await localFoldersApi.list()) {
    if (lf.parentId && isZombie(lf.parentId)) {
      await localFoldersApi.update(lf.id, { parentId: null }, lf)
    }
  }
  for (const lc of await localCardsApi.list()) {
    if (lc.folderId && isZombie(lc.folderId)) {
      await localCardsApi.update(lc.id, { folderId: null }, lc)
    }
  }

  // review_log: append-only and grows unboundedly (unlike cards/folders), so a full-table diff
  // every cycle isn't worth it — a watermark cursor on reviewed_at is sufficient and cheap, since
  // log rows are never edited or deleted.
  const watermark = (await window.api.sync.getMeta(REVIEW_LOG_WATERMARK_KEY)) ?? '1970-01-01T00:00:00.000Z'
  const { data: remoteLogRows, error: logErr } = await supabase
    .from('review_log')
    .select('*')
    .gt('reviewed_at', watermark)
    .order('reviewed_at', { ascending: true })
  if (logErr) throw new Error(logErr.message)
  const localLogIds = new Set((await localReviewLogApi.list()).map((e) => e.id))

  let newWatermark = watermark
  for (const row of remoteLogRows as RemoteReviewLogRow[]) {
    const entry = hydrateReviewLogRow(row)
    if (!localLogIds.has(entry.id)) await window.api.sync.applyReviewLogInsert(entry)
    if (entry.reviewedAt > newWatermark) newWatermark = entry.reviewedAt
  }
  if (newWatermark !== watermark) await window.api.sync.setMeta(REVIEW_LOG_WATERMARK_KEY, newWatermark)
}

/** Any 'unresolved_document' orphan whose source document is unambiguously present on this device
 *  — exactly one local document sharing its filename snapshot — gets resolved transparently here,
 *  the same crop-and-attach MissingSourcesView's manual "Recapture from document" button does, just
 *  without the user ever seeing the flag. Ambiguous (zero, or two-plus same-named documents) is left
 *  as a visible orphan exactly as before — this only ever resolves the cases with nothing to guess.
 *  Deliberately reads pages via a headless `documents.getPages` IPC call rather than
 *  documentsStore's openDocument, since that also drives activeDocumentId/activePageIndex — the
 *  wrong thing to change silently in the background while the user might be looking at something
 *  else entirely. A resolve failure here (e.g. the snapshotted page index doesn't actually exist in
 *  this copy of the document) just leaves the orphan as-is for the user to handle manually, same as
 *  today. */
async function autoResolveOrphans(): Promise<void> {
  const orphans = await window.api.cards.getOrphanedSources()
  const unresolved = orphans.filter((o) => o.resolvedAt === null && o.reason === 'unresolved_document' && o.sourceDocumentFilename !== null)
  if (unresolved.length === 0) return

  const documents = useDocumentsStore.getState().documents
  const pagesByDocument = new Map<string, PageRecord[]>()

  for (const orphan of unresolved) {
    const candidates = documents.filter((d) => d.filename === orphan.sourceDocumentFilename)
    if (candidates.length !== 1) continue
    const doc = candidates[0]
    try {
      let pages = pagesByDocument.get(doc.id)
      if (!pages) {
        pages = await window.api.documents.getPages(doc.id)
        pagesByDocument.set(doc.id, pages)
      }
      await resolveOrphanAgainstPages(orphan, doc.id, doc.filename, pages)
    } catch (err) {
      console.warn('Sync: auto-resolve failed for orphan', orphan.id, err)
    }
  }
}

// --- One-time bootstrap ------------------------------------------------------------------------

/** Runs once, ever, before the very first ordinary cycle. Local rows still linked to a cloud
 *  origin via origin_backend/origin_id (left over from the retired migrate-and-dedup toggle
 *  feature) get re-keyed to share their cloud counterpart's id instead of being pushed as a brand
 *  new row — without this, every previously-migrated row would become a duplicate pair on both
 *  backends the moment continuous sync started (push creates a new row since the ids don't match;
 *  pull then fetches the original back down as yet another "unknown locally" row). */
async function ensureBootstrapped(): Promise<void> {
  const flag = await window.api.sync.getMeta(BOOTSTRAPPED_KEY)
  if (flag === 'true') return

  const [{ data: remoteFolders }, { data: remoteCards }] = await Promise.all([
    supabase.from('folders').select('id'),
    supabase.from('cards').select('id')
  ])
  const remoteFolderIds = new Set((remoteFolders ?? []).map((f: { id: string }) => f.id))
  const remoteCardIds = new Set((remoteCards ?? []).map((c: { id: string }) => c.id))

  for (const f of await window.api.sync.getOriginLinkedFolders()) {
    if (f.id !== f.originId && remoteFolderIds.has(f.originId)) {
      await window.api.sync.rekeyFolderId(f.id, f.originId)
    }
  }
  for (const c of await window.api.sync.getOriginLinkedCards()) {
    if (c.id !== c.originId && remoteCardIds.has(c.originId)) {
      await window.api.sync.rekeyCardId(c.id, c.originId)
    }
  }

  await window.api.sync.setMeta(BOOTSTRAPPED_KEY, 'true')
}

const LOCAL_DATA_RESYNCED_KEY = 'localDataResynced'

/** Runs once, ever. Covers two distinct gaps (see repository.ts's own doc comment for the full
 *  reasoning): folders/cards created before the sync engine's create methods existed at all
 *  (confirmed directly — a pre-existing folder sitting with zero pending sync_ops, never on
 *  Supabase), and card_sources rows whose data predates a column being added
 *  (source_document_filename/source_page_index). Fetches what already exists on Supabase first —
 *  only the renderer talks to Supabase directly — so the main-process side can push exclusively
 *  what's actually missing there, never blindly re-push a row that already exists (which would
 *  risk clobbering a more recent edit made on another device with this device's own stale copy;
 *  a real regression caught in testing, not a hypothetical — see repository.ts). */
async function ensureLocalDataResynced(): Promise<void> {
  const flag = await window.api.sync.getMeta(LOCAL_DATA_RESYNCED_KEY)
  if (flag === 'true') return
  const [{ data: remoteFolders }, { data: remoteCards }] = await Promise.all([
    supabase.from('folders').select('id'),
    supabase.from('cards').select('id')
  ])
  await window.api.cards.resyncMissingLocalData(
    (remoteFolders ?? []).map((f: { id: string }) => f.id),
    (remoteCards ?? []).map((c: { id: string }) => c.id)
  )
  await window.api.sync.setMeta(LOCAL_DATA_RESYNCED_KEY, 'true')
}

// --- Orchestration -----------------------------------------------------------------------------

let cycleInFlight = false

/** Runs one full push-then-pull cycle. Safe to call as often as triggers below fire — overlapping
 *  calls just no-op rather than queue up, since the next periodic/mutation trigger will cover
 *  whatever a skipped call would have. */
export async function runSyncCycle(): Promise<void> {
  if (cycleInFlight) return
  cycleInFlight = true
  useConnectivityStore.getState().setSyncing()
  try {
    await ensureBootstrapped()
    await ensureLocalDataResynced()
    const pendingOps = await window.api.sync.getPendingOps()
    useConnectivityStore.getState().setPendingCount(pendingOps.length)
    const { deletedCardIds, deletedFolderIds } = await pushPhase(pendingOps)
    const remainingOps = await window.api.sync.getPendingOps()
    useConnectivityStore.getState().setPendingCount(remainingOps.length)
    await pullPhase(pendingOps, deletedCardIds, deletedFolderIds)
    await autoResolveOrphans()
    useConnectivityStore.getState().setSynced()
  } catch (err) {
    console.warn('Sync cycle failed:', err)
    useConnectivityStore.getState().setSyncError(err instanceof Error ? err.message : String(err))
  } finally {
    cycleInFlight = false
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null

/** Starts the sync engine's triggers: an immediate cycle, a periodic interval, and the browser
 *  `online` event. Idempotent — calling this while already running is a no-op. Gated on the
 *  Settings "Cloud sync" toggle (see syncEnabledStore.ts); when off, this is simply never called. */
export function startSyncEngine(): void {
  if (intervalHandle) return
  void runSyncCycle()
  intervalHandle = setInterval(() => void runSyncCycle(), SYNC_INTERVAL_MS)
  window.addEventListener('online', runSyncCycle)
}

export function stopSyncEngine(): void {
  if (intervalHandle) clearInterval(intervalHandle)
  intervalHandle = null
  window.removeEventListener('online', runSyncCycle)
}

/** Fire-and-forget trigger for stores to call right after a local mutation, so a change propagates
 *  promptly without making the mutation's own caller wait on a network round trip. Errors are
 *  already handled/logged inside runSyncCycle itself. */
export function triggerSync(): void {
  void runSyncCycle()
}
