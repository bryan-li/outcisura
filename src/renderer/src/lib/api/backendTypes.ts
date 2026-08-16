/** Typed shape for the local IPC adapters (localCards.ts/localFolders.ts/localReviewLog.ts) — local
 *  SQLite is always the primary read/write path now (see cardsStore.ts etc.; cloud sync happens in
 *  the background via syncEngine.ts instead of through this interface). Kept as a named interface
 *  mainly for documentation/type-safety at the call sites, even with only one implementation left.
 *
 *  The `existing`/`previous` params on several methods are accepted but unused by the local
 *  adapters — a holdover from when a cloud implementation also existed and needed them to
 *  construct an offline-optimistic patch; local IPC always has authoritative state one process hop
 *  away and never needs to. */

import type { ReviewGrade } from '../../../../shared/srs'
import type {
  AiRegenerateResult,
  CardRecord,
  CardReorderItem,
  CardUpdatePatch,
  FolderRecord,
  FolderReorderItem,
  FolderUpdatePatch,
  NewCardInput,
  ReviewLogEntry,
  SrsSnapshot
} from '../../../../shared/types'

export interface CardsBackend {
  create(input: NewCardInput): Promise<CardRecord>
  get(id: string): Promise<CardRecord | null>
  list(): Promise<CardRecord[]>
  update(id: string, patch: CardUpdatePatch, existing: CardRecord): Promise<CardRecord>
  reorder(items: CardReorderItem[]): Promise<void>
  grade(id: string, grade: ReviewGrade, existing: CardRecord): Promise<CardRecord>
  setSrsState(id: string, srs: SrsSnapshot, existing: CardRecord): Promise<CardRecord>
  delete(id: string): Promise<void>
  applyAiRegeneration(id: string, previous: { front: string; back: string }, next: AiRegenerateResult): Promise<CardRecord>
}

export interface FoldersBackend {
  create(name: string, parentId?: string | null): Promise<FolderRecord>
  list(): Promise<FolderRecord[]>
  update(id: string, patch: FolderUpdatePatch, existing: FolderRecord): Promise<FolderRecord>
  reorder(items: FolderReorderItem[]): Promise<void>
  delete(id: string): Promise<void>
}

export interface ReviewLogBackend {
  list(): Promise<ReviewLogEntry[]>
}
