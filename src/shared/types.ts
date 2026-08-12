import type { ReviewGrade } from './srs'

export type DocumentType = 'pdf' | 'pptx'
export type ElementKind = 'text' | 'image'
export type CardType = 'basic' | 'image_occlusion'

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
}

export interface PageRecord {
  id: string
  documentId: string
  pageIndex: number
  width: number
  height: number
  /** Cached PNG render of the page (PPTX pages go through LibreOffice→PDF first, so this is always set). */
  backgroundImagePath: string | null
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

export interface CardSourceRecord {
  id: string
  cardId: string
  documentId: string
  pageId: string
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
}

export interface FolderRecord {
  id: string
  name: string
  createdAt: string
  parentId: string | null
  sortOrder: number
  collapsed: boolean
}

export type FolderUpdatePatch = Partial<Pick<FolderRecord, 'name' | 'parentId' | 'sortOrder' | 'collapsed'>>

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
}

export type CardUpdatePatch = Partial<Pick<CardRecord, 'front' | 'back' | 'folderId'>>

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
}

export interface NewCardInput {
  front: string
  back: string
  cardType: CardType
  sources: NewCardSourceInput[]
}

export interface AiRegenerateRequest {
  cardId: string
  instruction?: string
}

export interface AiRegenerateResult {
  front: string
  back: string
}
