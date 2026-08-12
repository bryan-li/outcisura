import type {
  AiRegenerateRequest,
  CardRecord,
  CardReorderItem,
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
} from './types'
import type { ReviewGrade } from './srs'

export const IpcChannels = {
  documentsImport: 'documents:import',
  documentsList: 'documents:list',
  documentsGetPages: 'documents:getPages',
  documentsGetElements: 'documents:getElements',
  documentsGetImage: 'documents:getImage',
  documentsConvertPptxToPdf: 'documents:convertPptxToPdf',
  documentsDelete: 'documents:delete',
  documentsSaveImage: 'documents:saveImage',
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
  aiGenerateFromSources: 'ai:generateFromSources'
} as const

/** Shape of the `window.api` bridge exposed by the preload script. */
export interface FlashcardApi {
  documents: {
    /** Persists a parsed document (produced client-side by the PDF/PPTX parsers) and its cached images. */
    import(parsed: ParsedDocument): Promise<DocumentRecord>
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
  ui: {
    /** Scales the whole interface via real browser zoom (1 = 100%). */
    setZoomFactor(factor: number): void
    getZoomFactor(): number
  }
}
