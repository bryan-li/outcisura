import type {
  AiRegenerateRequest,
  ApiKeyStatus,
  CardRecord,
  CardReorderItem,
  CardUpdatePatch,
  CreateVideoFramePageInput,
  DocumentPositionPatch,
  DocumentRecord,
  ElementRecord,
  FolderRecord,
  FolderReorderItem,
  FolderUpdatePatch,
  ImportVideoInput,
  NewCardInput,
  OcrRecognizePageInput,
  PageRecord,
  ParsedDocument,
  ReviewLogEntry,
  SaveTranscriptSegmentInput,
  SrsSnapshot,
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
  cardsCreate: 'cards:create',
  cardsList: 'cards:list',
  cardsUpdate: 'cards:update',
  cardsReorder: 'cards:reorder',
  cardsGrade: 'cards:grade',
  cardsSetSrsState: 'cards:setSrsState',
  cardsDelete: 'cards:delete',
  foldersCreate: 'folders:create',
  foldersList: 'folders:list',
  foldersUpdate: 'folders:update',
  foldersReorder: 'folders:reorder',
  foldersDelete: 'folders:delete',
  reviewLogList: 'reviewLog:list',
  aiRegenerate: 'ai:regenerate',
  aiGenerateFromSources: 'ai:generateFromSources',
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
    /** Regenerates a card's front/back via Claude and persists the result (previous pair kept for undo). */
    regenerate(req: AiRegenerateRequest): Promise<CardRecord>
  }
  reviewLog: {
    /** Every review grade ever logged — small enough for a personal deck to fetch whole and
     *  compute stats (reviewed-today, streak) from client-side. */
    list(): Promise<ReviewLogEntry[]>
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
