import type { ReviewGrade } from './srs'

export type DocumentType = 'pdf' | 'pptx' | 'video'
export type ElementKind = 'text' | 'image'
export type CardType = 'basic' | 'image_occlusion' | 'cloze' | 'picture'

export type GenerationComplexity = 'simple' | 'standard' | 'detailed'

/** User-configurable knobs applied when turning a selection into one or more AI-generated cards —
 *  shared across every creation surface (PDF/PPTX viewer, video OCR flow, combine basket) so the
 *  same settings mean the same thing regardless of where a card came from. */
export interface GenerationSettings {
  complexity: GenerationComplexity
  /** One card per source instead of combining every source into one. */
  splitIntoMultiple: boolean
  /** Replaces the default rewrite instruction entirely when set. */
  customPrompt: string | null
  /** Generate a cloze-deletion card (one passage, key term(s) wrapped in {{}}) instead of a plain
   *  front/back question. Mutually exclusive with doubleSided — a cloze card has no separate
   *  "reverse" side to swap. */
  cloze: boolean
  /** Also create a second card with front/back swapped, sharing the same sources. No-op when
   *  `cloze` is set. */
  doubleSided: boolean
}

export interface BBox {
  x: number
  y: number
  w: number
  h: number
}

export interface DocumentRecord {
  id: string
  filename: string
  type: DocumentType
  importedAt: string
  pageCount: number
  /** Video documents only — the copied source file's path under <userData>/videos/. */
  sourceVideoPath: string | null
  /** Video documents only. */
  durationSeconds: number | null
  /** pdf/pptx only — the page index to reopen on, or null to start at the beginning. */
  lastPageIndex: number | null
  /** Video only — the playback position (seconds) to resume from, or null to start at 0. */
  lastPlaybackSeconds: number | null
}

export interface DocumentPositionPatch {
  lastPageIndex?: number
  lastPlaybackSeconds?: number
}

export interface PageRecord {
  id: string
  documentId: string
  pageIndex: number
  width: number
  height: number
  /** Cached PNG render of the page (PPTX pages go through LibreOffice→PDF first, so this is always set). */
  backgroundImagePath: string | null
  /** Set only for a page created from a captured, paused video frame — which video-moment it is. */
  timestampSeconds: number | null
  /** Set only for a page captured from a transcribed [start,end) range — the range's end, so a
   *  card's backlink can highlight the whole span it came from, not just its start point. Null for
   *  an ordinary single-frame capture (OCR / region-select), where there's no range to speak of. */
  timestampEndSeconds: number | null
}

export interface ElementRecord {
  id: string
  pageId: string
  kind: ElementKind
  bbox: BBox
  text: string | null
  imagePath: string | null
}

/** Parsers produce this in-memory shape before it's persisted via IPC. */
export interface ParsedDocument {
  filename: string
  type: DocumentType
  pages: ParsedPage[]
}

export interface ParsedPage {
  pageIndex: number
  width: number
  height: number
  /** Data URL or absolute temp path for a cached PNG render (PDF only). */
  backgroundImage: string | null
  elements: ParsedElement[]
}

export interface ParsedElement {
  kind: ElementKind
  bbox: BBox
  text?: string
  /** Data URL of the extracted image (image elements only). */
  imageData?: string
}

/** Video import is a much thinner contract than ParsedDocument — no pages to pre-render, since
 *  frames are captured lazily on pause, not upfront. `path` is an already-on-disk path (read via
 *  webUtils.getPathForFile in the renderer), not file bytes — the main process copies it directly,
 *  no IPC byte transfer for what can be a multi-hundred-MB file. */
export interface ImportVideoInput {
  filename: string
  path: string
  durationSeconds: number
  width: number
  height: number
}

/** Input for capturing a paused video frame as a new page — see repository.createVideoFramePage. */
export interface CreateVideoFramePageInput {
  documentId: string
  timestampSeconds: number
  width: number
  height: number
  backgroundImagePath: string
  /** See PageRecord.timestampEndSeconds — set only when capturing for a transcribed range. */
  timestampEndSeconds?: number
}

export interface CardSourceRecord {
  id: string
  cardId: string
  /** Null for a standalone-uploaded replacement image with no real document/page context (see
   *  the missing-source recovery flow) — every other source still has a real one. */
  documentId: string | null
  pageId: string | null
  elementId: string | null
  bbox: BBox
  label: string
  /** Set when this source carries its own image independent of elementId — e.g. a screenshot
   *  crop taken for image occlusion from an arbitrary selection, not a detected page element. */
  imagePath: string | null
  /** For image-occlusion sources: the hidden region as a fraction (0-1) of the image at
   *  `imagePath`'s own natural width/height. Null for non-occlusion sources and for occlusion
   *  cards made before this field existed — both render the image unmasked. */
  maskBBox: BBox | null
  /** Which side of the card this image belongs to — only meaningful for cards assembled via the
   *  multi-image "Create Flashcard" modal, where front and back can each carry several images.
   *  Null for every other kind of source (occlusion crops, parsed-element sources, a single
   *  picture-card image) — those have no "which face" concept at all. */
  imageFace: 'front' | 'back' | null
  /** A denormalized snapshot of documents.filename/pages.pageIndex at creation time, never
   *  re-derived — documents/pages are local-only and never sync, so if this source turns out
   *  unresolvable on another device, this is the only human-readable context left to show
   *  ("this came from page 5 of Biology.pdf") in the missing-source recovery view. Null when
   *  documentId/pageId are (a standalone upload has no document to snapshot from). */
  sourceDocumentFilename: string | null
  sourcePageIndex: number | null
}

/** What's broken on THIS device about one of a card's sources — never synced (see
 *  repository.ts's applyRemoteCardUpsert/replaceOrphanedSource and the local-only orphaned_sources
 *  table). `unresolvedDocument`: documentId/pageId didn't resolve locally, so the source itself
 *  couldn't even be inserted (would violate the local FK). `missingFile`: the source WAS inserted
 *  (imagePath has no DB constraint), but the file it points at doesn't exist on this device. */
export type OrphanedSourceReason = 'unresolved_document' | 'missing_file'

export interface OrphanedSourceRecord {
  /** Shares an id with the dangling card_sources row it came from (or, for unresolved_document,
   *  the id the source WOULD have had) — re-detecting the same still-broken source on a later
   *  pull is then a harmless no-op instead of piling up duplicates. */
  id: string
  cardId: string
  reason: OrphanedSourceReason
  documentId: string | null
  pageId: string | null
  elementId: string | null
  bbox: BBox
  label: string
  imagePath: string | null
  maskBBox: BBox | null
  imageFace: 'front' | 'back' | null
  sourceDocumentFilename: string | null
  sourcePageIndex: number | null
  detectedAt: string
  /** Null while still open. Kept (not deleted) on resolve — nothing on the origin device ever
   *  edits its own dangling source, so a future pull of that same card would otherwise rediscover
   *  and re-flag an already-fixed orphan indefinitely. */
  resolvedAt: string | null
}

/** What the missing-source recovery view submits to fix one orphan via a fresh standalone upload —
 *  no document/page context, just a freshly saved local image file. */
export interface ReplaceOrphanedSourceInput {
  imagePath: string
}

/** What the missing-source recovery view submits to fix one orphan via recapture — a real
 *  document/page-linked region drag-selected on a local document (typically a re-imported copy of
 *  whatever the orphan originally came from), unlike ReplaceOrphanedSourceInput's standalone
 *  upload. sourceDocumentFilename/sourcePageIndex are the same kind of snapshot createCard already
 *  takes, captured fresh from wherever the region was actually selected this time. */
export interface RecaptureOrphanedSourceInput {
  documentId: string
  pageId: string
  bbox: BBox
  imagePath: string
  sourceDocumentFilename: string | null
  sourcePageIndex: number | null
}

/** Where a record came from, for cross-backend migration dedup (see dataMigration.ts) — null means
 *  native to whichever backend it currently lives in (never migrated). Shared by CardRecord and
 *  FolderRecord; review_log is deliberately NOT origin-tracked (see dataMigration.ts's own comment
 *  on why its dedup is content-based instead). */
export type OriginBackend = 'cloud' | 'local' | null

export interface FolderRecord {
  id: string
  name: string
  createdAt: string
  /** Bumped on create/update only, not reorder (manual drag order is cosmetic/per-device, doesn't
   *  need cross-device consistency) — the sync engine's last-write-wins signal for pull conflicts. */
  updatedAt: string
  parentId: string | null
  sortOrder: number
  collapsed: boolean
  originBackend: OriginBackend
  originId: string | null
}

export type FolderUpdatePatch = Partial<
  Pick<FolderRecord, 'name' | 'parentId' | 'sortOrder' | 'collapsed' | 'originBackend' | 'originId'>
>

/** One folder's new position, as computed client-side after a drag-drop move. */
export interface FolderReorderItem {
  id: string
  parentId: string | null
  sortOrder: number
}

export interface CardRecord {
  id: string
  front: string
  back: string
  cardType: CardType
  aiGenerated: boolean
  prevFront: string | null
  prevBack: string | null
  createdAt: string
  updatedAt: string
  /** User-assigned folder, or null to fall back to the default by-source grouping. */
  folderId: string | null
  /** Manual drag position within whatever list currently renders it (see CardReorderItem). */
  sortOrder: number
  /** Spaced-repetition scheduling state (SM-2 style, see shared/srs.ts). Due when dueAt <= now. */
  dueAt: string
  intervalDays: number
  easeFactor: number
  repetitions: number
  lapses: number
  lastReviewedAt: string | null
  sources: CardSourceRecord[]
  /** 'picture' cards only — when true, the card's image stays hidden on the front (question-only)
   *  and only appears once flipped, instead of showing on both faces like every other image-bearing
   *  card type. Always false for non-picture cards. */
  revealImageOnFlip: boolean
  originBackend: OriginBackend
  originId: string | null
}

export type CardUpdatePatch = Partial<
  Pick<CardRecord, 'front' | 'back' | 'folderId' | 'originBackend' | 'originId'>
>

/** A card's full SRS state, for the direct-overwrite restore path used by review-session undo. */
export type SrsSnapshot = Pick<
  CardRecord,
  'dueAt' | 'intervalDays' | 'easeFactor' | 'repetitions' | 'lapses' | 'lastReviewedAt'
>

/** One card's new position, as computed client-side after a drag-drop reorder within a single list. */
export interface CardReorderItem {
  id: string
  sortOrder: number
}

/** One review grade event, logged purely for dashboard stats (reviewed-today, streak) — see the
 *  review_log table's own comment for why cards' SRS fields alone can't answer that. */
export interface ReviewLogEntry {
  id: string
  cardId: string
  grade: ReviewGrade
  reviewedAt: string
}

export interface NewCardSourceInput {
  documentId: string
  pageId: string
  elementId: string | null
  bbox: BBox
  label: string
  imagePath?: string | null
  maskBBox?: BBox | null
  /** See CardSourceRecord.imageFace. */
  imageFace?: 'front' | 'back' | null
}

export interface NewCardInput {
  front: string
  back: string
  cardType: CardType
  sources: NewCardSourceInput[]
  /** See CardRecord.revealImageOnFlip. Defaults to false when omitted. */
  revealImageOnFlip?: boolean
}

/** Carries the card's own content rather than just its id — main no longer looks the card up
 *  itself (see aiService.ts), since cards live in Supabase now while this IPC call stays local
 *  (bring-your-own-key, nothing here needs to move). The caller (cardsStore) already has the
 *  card in its own state and is the one that persists the result afterward via cardsApi. */
export interface AiRegenerateRequest {
  cardId: string
  front: string
  back: string
  sources: CardSourceRecord[]
  instruction?: string
  complexity?: GenerationComplexity
  /** Ask for cloze-deletion output (`CLOZE: <text with {{blanks}}>`) instead of FRONT/BACK. */
  cloze?: boolean
}

export interface AiRegenerateResult {
  front: string
  back: string
}

/** A card's live-session ("Kahoot-style") question format — see aiService.ts's prepareForSharing.
 *  Cached on the Postgres `cards` row only (share_format et al.); no local-SQLite counterpart, since
 *  a live session reads decks via Supabase directly, same as syncEngine.ts already does. */
export type ShareFormat = 'mcq' | 'free_text'

export interface AiSharePrepRequest {
  front: string
  back: string
}

export interface AiSharePrepResult {
  recommendedFormat: ShareFormat
  /** Always exactly 3, generated regardless of recommendedFormat so a host's per-card override
   *  never needs a fresh AI call. */
  mcqDistractors: string[]
  freeTextRubric: string
}

/** Batched free-text grading for one live-session question — every submitted answer judged against
 *  the same cached rubric in a single AI call, not one call per answer (see aiService.ts's own
 *  docblock on judgeFreeTextAnswers). Runs only on the host's machine, host-only per RLS. */
export interface AiJudgeFreeTextRequest {
  rubric: string
  answers: { answerId: string; text: string }[]
}

export interface AiJudgeFreeTextResult {
  judgments: { answerId: string; isCorrect: boolean }[]
}

export type OcrEngine = 'tesseract' | 'claude-vision'

/** One detected text region, before it's persisted as an element. */
export interface OcrDetection {
  text: string
  bbox: BBox
}

export interface OcrRecognizePageInput {
  pageId: string
  imagePath: string
  width: number
  height: number
  engine: OcrEngine
}

/** 'whisper-local' runs entirely on-device via @xenova/transformers (no key needed); 'openai-whisper'
 *  calls OpenAI's hosted API — same local-vs-cloud shape as OcrEngine above. */
export type TranscriptionEngine = 'whisper-local' | 'openai-whisper'

export interface TranscribeAudioInput {
  /** Raw mono PCM samples at TRANSCRIPTION_SAMPLE_RATE (see shared/audio.ts), already sliced to the
   *  desired window and resampled client-side — the main process only ever sees ready-to-transcribe
   *  audio, never touches the source video file. */
  audioData: ArrayBuffer
  engine: TranscriptionEngine
}

/** Never carries the raw key back to the renderer after it's been saved once — Settings only ever
 *  needs to know whether one is set and enough of a hint (last 4 chars) to confirm which one. */
export interface ApiKeyStatus {
  hasKey: boolean
  last4: string | null
}

/** A already-transcribed [startSeconds, endSeconds) range on one video, from one engine — the unit
 *  of reuse for range-based transcription (see getTranscriptCoverage). Segments from different
 *  engines never overlap-check against each other, by design: switching engines is a deliberate
 *  "redo this with a different model" choice, not something that should silently reuse the other
 *  model's output. */
export interface TranscriptSegmentRecord {
  id: string
  documentId: string
  engine: TranscriptionEngine
  startSeconds: number
  endSeconds: number
  text: string
}

export interface TimeRange {
  startSeconds: number
  endSeconds: number
}

export interface TranscriptCoverageInput {
  documentId: string
  engine: TranscriptionEngine
  range: TimeRange
}

/** `existingSegments` overlap the requested range and can be reused as-is; `gaps` are the
 *  sub-ranges within the request that still need actual transcription — the caller transcribes
 *  each gap, saves it via saveTranscriptSegment, then stitches existingSegments + the new ones
 *  (sorted by startSeconds) into the full displayed transcript. */
export interface TranscriptCoverageResult {
  existingSegments: TranscriptSegmentRecord[]
  gaps: TimeRange[]
}

export interface SaveTranscriptSegmentInput {
  documentId: string
  engine: TranscriptionEngine
  range: TimeRange
  text: string
}

/** The local-first bidirectional sync engine's operation log (see syncEngine.ts and repository.ts's
 *  sync_ops table) — every mutating repository.ts method appends one of these, in the same
 *  transaction as the mutation itself, so the log can never drift from what actually happened
 *  locally. `payload` carries the full post-mutation record (a hydrated CardRecord/FolderRecord/
 *  ReviewLogEntry, or a CardSourceRecord[] for a card's sources) for insert/update — both push as a
 *  single Postgres `upsert`, so there's no need to distinguish a partial patch from a full row.
 *  `payload` is null for delete (record_id alone is enough). `id` (not `created_at`) is the replay-
 *  order key — a card and its sources can be created in the same millisecond. */
export interface SyncOp {
  id: number
  table: 'cards' | 'card_sources' | 'folders' | 'review_log'
  op: 'insert' | 'update' | 'delete'
  recordId: string
  payload: unknown
  createdAt: string
}
