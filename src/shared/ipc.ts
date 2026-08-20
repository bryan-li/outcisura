import type {
  AiJudgeFreeTextRequest,
  AiJudgeFreeTextResult,
  AiRegenerateRequest,
  AiRegenerateResult,
  AiSharePrepRequest,
  AiSharePrepResult,
  ApiKeyStatus,
  CardRecord,
  CardReorderItem,
  CardUpdatePatch,
  CreateVideoFramePageInput,
  DocumentFolderRecord,
  DocumentFolderReorderItem,
  DocumentFolderUpdatePatch,
  DocumentPositionPatch,
  DocumentRecord,
  ElementRecord,
  FolderRecord,
  FolderReorderItem,
  FolderUpdatePatch,
  ImportVideoInput,
  NewCardInput,
  NewReviewSessionInput,
  OcrRecognizePageInput,
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
  TagRecord,
  TranscribeAudioInput,
  TranscriptCoverageInput,
  TranscriptCoverageResult,
  TranscriptSegmentRecord
} from './types'
import type { ReviewGrade } from './srs'

export const IpcChannels = {
  documentsImport: 'documents:import',
  documentsImportVideo: 'documents:importVideo',
  documentsCreateVideoFramePage: 'documents:createVideoFramePage',
  documentsList: 'documents:list',
  documentsGetPages: 'documents:getPages',
  documentsGetElements: 'documents:getElements',
  documentsGetImage: 'documents:getImage',
  documentsConvertPptxToPdf: 'documents:convertPptxToPdf',
  documentsDelete: 'documents:delete',
  documentsSaveImage: 'documents:saveImage',
  documentsUpdatePosition: 'documents:updatePosition',
  documentsUpdateFolder: 'documents:updateFolder',
  documentFoldersCreate: 'documentFolders:create',
  documentFoldersList: 'documentFolders:list',
  documentFoldersUpdate: 'documentFolders:update',
  documentFoldersReorder: 'documentFolders:reorder',
  documentFoldersDelete: 'documentFolders:delete',
  cardsCreate: 'cards:create',
  cardsList: 'cards:list',
  cardsUpdate: 'cards:update',
  cardsReorder: 'cards:reorder',
  cardsGrade: 'cards:grade',
  cardsSetSrsState: 'cards:setSrsState',
  cardsDelete: 'cards:delete',
  cardsApplyAiRegeneration: 'cards:applyAiRegeneration',
  cardsGetOrphanedSources: 'cards:getOrphanedSources',
  cardsReplaceOrphanedSource: 'cards:replaceOrphanedSource',
  cardsRecaptureOrphanedSource: 'cards:recaptureOrphanedSource',
  cardsDismissOrphanedSource: 'cards:dismissOrphanedSource',
  cardsResyncAllLocalData: 'cards:resyncAllLocalData',
  foldersCreate: 'folders:create',
  foldersList: 'folders:list',
  foldersUpdate: 'folders:update',
  foldersReorder: 'folders:reorder',
  foldersDelete: 'folders:delete',
  reviewLogList: 'reviewLog:list',
  reviewSessionsLog: 'reviewSessions:log',
  reviewSessionsList: 'reviewSessions:list',
  tagsCreate: 'tags:create',
  tagsList: 'tags:list',
  tagsDelete: 'tags:delete',
  tagsSetCardTags: 'tags:setCardTags',
  cardImagesAdd: 'cardImages:add',
  cardImagesRemove: 'cardImages:remove',
  syncGetPendingOps: 'sync:getPendingOps',
  syncRemoveOps: 'sync:removeOps',
  syncGetMeta: 'sync:getMeta',
  syncSetMeta: 'sync:setMeta',
  syncGetOriginLinkedCards: 'sync:getOriginLinkedCards',
  syncGetOriginLinkedFolders: 'sync:getOriginLinkedFolders',
  syncRekeyCardId: 'sync:rekeyCardId',
  syncRekeyFolderId: 'sync:rekeyFolderId',
  syncApplyCardUpsert: 'sync:applyCardUpsert',
  syncApplyFolderUpsert: 'sync:applyFolderUpsert',
  syncApplyReviewLogInsert: 'sync:applyReviewLogInsert',
  aiRegenerate: 'ai:regenerate',
  aiGenerateFromSources: 'ai:generateFromSources',
  aiPrepareForSharing: 'ai:prepareForSharing',
  aiJudgeFreeTextAnswers: 'ai:judgeFreeTextAnswers',
  ocrRecognizePage: 'ocr:recognizePage',
  transcriptionTranscribe: 'transcription:transcribe',
  transcriptionGetCoverage: 'transcription:getCoverage',
  transcriptionSaveSegment: 'transcription:saveSegment',
  settingsGetApiKeyStatus: 'settings:getApiKeyStatus',
  settingsSetApiKey: 'settings:setApiKey',
  settingsGetOpenAiKeyStatus: 'settings:getOpenAiKeyStatus',
  settingsSetOpenAiKey: 'settings:setOpenAiKey'
} as const

/** Shape of the `window.api` bridge exposed by the preload script. */
export interface FlashcardApi {
  /** Resolves a renderer File object (from an <input type=file>) to its absolute path on disk, via
   *  Electron's webUtils — File.path was removed in Electron 32. Synchronous, no IPC round-trip:
   *  webUtils is directly callable from the preload script's own context. Used for video import,
   *  where the file itself is far too large to ship across IPC as bytes — only the path is needed. */
  getPathForFile(file: File): string
  documents: {
    /** Persists a parsed document (produced client-side by the PDF/PPTX parsers) and its cached images. */
    import(parsed: ParsedDocument): Promise<DocumentRecord>
    /** Copies an already-on-disk video file into storage and creates its document row. No pages
     *  are created here — frames are captured lazily, only when the user pauses and selects. */
    importVideo(input: ImportVideoInput): Promise<DocumentRecord>
    /** Captures a paused video frame as a new page, so the existing occlusion pipeline can run on it. */
    createVideoFramePage(input: CreateVideoFramePageInput): Promise<PageRecord>
    list(): Promise<DocumentRecord[]>
    getPages(documentId: string): Promise<PageRecord[]>
    getElements(pageId: string): Promise<ElementRecord[]>
    /** Reads an image file (a page render or extracted element image) and returns it as a data URL. */
    getImage(path: string): Promise<string>
    /** Converts a .pptx file's raw bytes to .pdf bytes via headless LibreOffice, for pixel-accurate rendering. */
    convertPptxToPdf(pptxBytes: ArrayBuffer): Promise<ArrayBuffer>
    /** Deletes a document and its pages/elements. Cards made from it survive but lose that backlink. */
    delete(id: string): Promise<void>
    /** Saves an arbitrary `data:` URL (e.g. a screenshot crop for image occlusion) and returns its file path. */
    saveImage(dataUrl: string): Promise<string>
    /** Persists where the user left off, so reopening the document resumes there. Fire-and-forget
     *  from the caller's side — see documentsStore for when this actually gets called. */
    updatePosition(id: string, patch: DocumentPositionPatch): Promise<void>
    /** Assigns (or clears, via null) which document_folders row a document belongs to. */
    updateFolder(id: string, folderId: string | null): Promise<void>
  }
  documentFolders: {
    create(name: string, parentId?: string | null): Promise<DocumentFolderRecord>
    list(): Promise<DocumentFolderRecord[]>
    update(id: string, patch: DocumentFolderUpdatePatch): Promise<DocumentFolderRecord>
    /** Persists a batch of {id, parentId, sortOrder} moves computed client-side after a drag-drop. */
    reorder(items: DocumentFolderReorderItem[]): Promise<void>
    /** Deletes the folder and its subfolders; documents inside are not deleted, they fall back to unfiled. */
    delete(id: string): Promise<void>
  }
  cards: {
    create(input: NewCardInput): Promise<CardRecord>
    list(): Promise<CardRecord[]>
    update(id: string, patch: CardUpdatePatch): Promise<CardRecord>
    /** Persists a batch of {id, sortOrder} moves computed client-side after a drag-drop, within one rendered list. */
    reorder(items: CardReorderItem[]): Promise<void>
    /** Advances a card's spaced-repetition schedule (see shared/srs.ts) after a review grade. */
    grade(id: string, grade: ReviewGrade): Promise<CardRecord>
    /** Direct overwrite of a card's SRS fields — used only by review-session undo, never normal grading. */
    setSrsState(id: string, srs: SrsSnapshot): Promise<CardRecord>
    delete(id: string): Promise<void>
    /** Overwrites front/back with an AI suggestion, stashing the previous pair for undo — the
     *  local-IPC equivalent of cardsApi's own applyAiRegeneration. Re-fetches the existing card
     *  itself server-side for the prev_front/prev_back stash, so unlike the cloud version this
     *  doesn't need the caller to pass the current front/back in. */
    applyAiRegeneration(id: string, next: AiRegenerateResult): Promise<CardRecord>
    /** Sources the sync engine's pull couldn't resolve locally, still awaiting a fix — see the
     *  missing-source recovery view. */
    getOrphanedSources(): Promise<OrphanedSourceRecord[]>
    /** Attaches a freshly saved local image in place of whatever couldn't be resolved. */
    replaceOrphanedSource(orphanId: string, input: ReplaceOrphanedSourceInput): Promise<CardRecord>
    /** Attaches a region drag-selected on a real local document/page — see
     *  RecaptureOrphanedSourceInput's own doc comment for how this differs from a plain upload. */
    recaptureOrphanedSource(orphanId: string, input: RecaptureOrphanedSourceInput): Promise<CardRecord>
    /** Accepts the card as-is on this device with one fewer source, instead of replacing it. */
    dismissOrphanedSource(orphanId: string): Promise<CardRecord>
    /** One-time maintenance: pushes folders/cards that don't exist on Supabase at all yet
     *  (caller supplies what already does, via a direct Supabase query — see repository.ts's own
     *  doc comment on why this must never blindly re-push a row that's already there). Also
     *  refreshes every card's sources, to backfill columns added after some rows already existed. */
    resyncMissingLocalData(existingRemoteFolderIds: string[], existingRemoteCardIds: string[]): Promise<void>
  }
  folders: {
    create(name: string, parentId?: string | null): Promise<FolderRecord>
    list(): Promise<FolderRecord[]>
    update(id: string, patch: FolderUpdatePatch): Promise<FolderRecord>
    /** Persists a batch of {id, parentId, sortOrder} moves computed client-side after a drag-drop. */
    reorder(items: FolderReorderItem[]): Promise<void>
    /** Deletes the folder and its subfolders; their cards are not deleted, they fall back to being grouped by source. */
    delete(id: string): Promise<void>
  }
  ai: {
    /** Computes a card's regenerated front/back via Claude — pure compute, doesn't persist.
     *  Cards live in Supabase now, not here, so the caller (cardsStore, via cardsApi) applies
     *  the result itself once this resolves. */
    regenerate(req: AiRegenerateRequest): Promise<AiRegenerateResult>
    /** Live-session ("Kahoot-style") question prep — pure compute, doesn't persist. The caller
     *  (sharePrep.ts) writes the result to the card's Supabase-only share_* columns itself. */
    prepareForSharing(req: AiSharePrepRequest): Promise<AiSharePrepResult>
    /** Batched free-text grading for one live-session question — pure compute. Called only from
     *  the host's own machine (hostSessionStore's revealResults), which persists the results
     *  itself via Supabase. */
    judgeFreeTextAnswers(req: AiJudgeFreeTextRequest): Promise<AiJudgeFreeTextResult>
  }
  reviewLog: {
    /** Every review grade ever logged — small enough for a personal deck to fetch whole and
     *  compute stats (reviewed-today, streak) from client-side. */
    list(): Promise<ReviewLogEntry[]>
  }
  reviewSessions: {
    /** Records one completed review session (start to finish) for the "avg session length" stat. */
    log(input: NewReviewSessionInput): Promise<ReviewSessionRecord>
    list(): Promise<ReviewSessionRecord[]>
  }
  tags: {
    /** Case-insensitive find-or-create — reuses an existing tag if the name (any casing) matches. */
    create(name: string): Promise<TagRecord>
    list(): Promise<TagRecord[]>
    /** Cascades: every card carrying this tag just loses it. */
    delete(id: string): Promise<void>
    /** Replaces a card's full tag set in one call. */
    setCardTags(cardId: string, tagIds: string[]): Promise<void>
  }
  /** Freely-attached images on a card (paste-from-clipboard, drag-drop) — independent of the
   *  structured slide/video source-selection flow. Each path should already be a saved local file
   *  (see documents.saveImage for turning a pasted/dropped image into one). */
  cardImages: {
    add(cardId: string, imagePaths: string[]): Promise<CardRecord>
    remove(cardId: string, sourceId: string): Promise<CardRecord>
  }
  /** The local-first bidirectional sync engine's primitives (see renderer/src/lib/syncEngine.ts) —
   *  read/drain the local operation log and apply pulled remote rows, without moving the actual
   *  Supabase calls into the main process (those stay in the renderer, per the existing "renderer
   *  talks to Supabase directly" decision from Phase 0). */
  sync: {
    /** All pending local operations not yet pushed, oldest first. */
    getPendingOps(): Promise<SyncOp[]>
    /** Drops ops from the queue — for ones that pushed successfully, or ones classified as a
     *  permanent (non-retryable) failure; either way they're done being tracked. */
    removeOps(ids: number[]): Promise<void>
    getMeta(key: string): Promise<string | null>
    setMeta(key: string, value: string): Promise<void>
    /** Local rows still linked to a cloud origin via the now-otherwise-unused origin_backend/
     *  origin_id columns — used only by the one-time bootstrap re-key pass. */
    getOriginLinkedCards(): Promise<{ id: string; originId: string }[]>
    getOriginLinkedFolders(): Promise<{ id: string; originId: string }[]>
    /** One-time bootstrap only — re-keys a local row's id to match its already-existing cloud
     *  counterpart, collapsing what would otherwise become a duplicate pair. */
    rekeyCardId(oldId: string, newId: string): Promise<void>
    rekeyFolderId(oldId: string, newId: string): Promise<void>
    /** Writes a pulled remote row into local SQLite directly — does not log a new outgoing sync
     *  op (that would create an infinite push/pull loop) and does not go through the normal
     *  create/update methods. */
    applyCardUpsert(card: CardRecord): Promise<void>
    applyFolderUpsert(folder: FolderRecord): Promise<void>
    applyReviewLogInsert(entry: ReviewLogEntry): Promise<void>
  }
  ocr: {
    /** Runs OCR on an already-captured page image and persists the detected regions as elements on
     *  it, returning them ready to render as selectable overlays — mirrors how parsed PDF/PPTX
     *  text elements already work. */
    recognizePage(input: OcrRecognizePageInput): Promise<ElementRecord[]>
  }
  transcription: {
    /** Transcribes an already-sliced, already-resampled audio clip (see utils/audioSlice.ts) and
     *  returns the raw text. Pure compute, no persistence — callers doing range-based transcription
     *  use this per-gap (see getCoverage/saveSegment below) rather than for a whole requested range. */
    transcribe(input: TranscribeAudioInput): Promise<string>
    /** Diffs a requested range against what's already been transcribed for this document+engine.
     *  Reuse existingSegments verbatim; call transcribe() + saveSegment() for each gap. */
    getCoverage(input: TranscriptCoverageInput): Promise<TranscriptCoverageResult>
    /** Persists one newly-transcribed gap so a future overlapping range can reuse it instead of
     *  re-transcribing the same audio. */
    saveSegment(input: SaveTranscriptSegmentInput): Promise<TranscriptSegmentRecord>
  }
  ui: {
    /** Scales the whole interface via real browser zoom (1 = 100%). */
    setZoomFactor(factor: number): void
    getZoomFactor(): number
  }
  settings: {
    /** Never returns the raw key — just whether one is set and its last 4 characters, enough to
     *  confirm which key without re-exposing the secret to the renderer after it's been saved. */
    getApiKeyStatus(): Promise<ApiKeyStatus>
    /** Pass null to clear. Takes effect immediately in the running app (AiService/OcrService both
     *  update live) — no restart needed. */
    setApiKey(apiKey: string | null): Promise<ApiKeyStatus>
    /** Same shape as the Anthropic key above, for the OpenAI Whisper transcription engine. */
    getOpenAiKeyStatus(): Promise<ApiKeyStatus>
    /** Pass null to clear. Takes effect immediately (TranscriptionService.setApiKey) — no restart needed. */
    setOpenAiKey(apiKey: string | null): Promise<ApiKeyStatus>
  }
}
