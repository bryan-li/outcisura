import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipc'
import type {
  AiJudgeFreeTextRequest,
  AiRegenerateRequest,
  AiRegenerateResult,
  AiSharePrepRequest,
  CardRecord,
  CardReorderItem,
  CreateVideoFramePageInput,
  DocumentFolderReorderItem,
  DocumentFolderUpdatePatch,
  DocumentPositionPatch,
  FolderRecord,
  FolderReorderItem,
  FolderUpdatePatch,
  ImportVideoInput,
  NewCardInput,
  OcrRecognizePageInput,
  ParsedDocument,
  RecaptureOrphanedSourceInput,
  ReplaceOrphanedSourceInput,
  ReviewLogEntry,
  SaveTranscriptSegmentInput,
  SrsSnapshot,
  TranscribeAudioInput,
  TranscriptCoverageInput
} from '../../shared/types'
import type { ReviewGrade } from '../../shared/srs'
import type { AiService } from '../aiService'
import type { OcrService } from '../ocrService'
import type { TranscriptionService } from '../transcriptionService'
import type { Repository } from '../db/repository'
import { readImageAsDataUrl, saveDataUrlImage } from '../imageStore'
import { convertPptxToPdf } from '../pptxConverter'
import { getApiKeyStatus, setApiKey, getOpenAiApiKeyStatus, setOpenAiApiKey } from '../settingsStore'

export function registerIpc(repo: Repository, ai: AiService, ocr: OcrService, transcription: TranscriptionService): void {
  ipcMain.handle(IpcChannels.documentsImport, (_event, parsed: ParsedDocument) => repo.importDocument(parsed))
  ipcMain.handle(IpcChannels.documentsImportVideo, (_event, input: ImportVideoInput) => repo.importVideoDocument(input))
  ipcMain.handle(IpcChannels.documentsCreateVideoFramePage, (_event, input: CreateVideoFramePageInput) =>
    repo.createVideoFramePage(input)
  )
  ipcMain.handle(IpcChannels.documentsList, () => repo.listDocuments())
  ipcMain.handle(IpcChannels.documentsGetPages, (_event, documentId: string) => repo.getPages(documentId))
  ipcMain.handle(IpcChannels.documentsGetElements, (_event, pageId: string) => repo.getElements(pageId))
  ipcMain.handle(IpcChannels.documentsGetImage, (_event, path: string) => readImageAsDataUrl(path))
  ipcMain.handle(IpcChannels.documentsConvertPptxToPdf, async (_event, pptxBytes: ArrayBuffer) => {
    const pdfBuffer = await convertPptxToPdf(Buffer.from(pptxBytes))
    return pdfBuffer.buffer.slice(pdfBuffer.byteOffset, pdfBuffer.byteOffset + pdfBuffer.byteLength)
  })
  ipcMain.handle(IpcChannels.documentsDelete, (_event, id: string) => {
    repo.deleteDocument(id)
  })
  ipcMain.handle(IpcChannels.documentsSaveImage, (_event, dataUrl: string) => saveDataUrlImage(dataUrl))
  ipcMain.handle(IpcChannels.documentsUpdatePosition, (_event, id: string, patch: DocumentPositionPatch) => {
    repo.updateDocumentPosition(id, patch)
  })
  ipcMain.handle(IpcChannels.documentsUpdateFolder, (_event, id: string, folderId: string | null) => {
    repo.updateDocumentFolderAssignment(id, folderId)
  })

  ipcMain.handle(IpcChannels.documentFoldersCreate, (_event, name: string, parentId?: string | null) =>
    repo.createDocumentFolder(name, parentId ?? null)
  )
  ipcMain.handle(IpcChannels.documentFoldersList, () => repo.listDocumentFolders())
  ipcMain.handle(IpcChannels.documentFoldersUpdate, (_event, id: string, patch: DocumentFolderUpdatePatch) =>
    repo.updateDocumentFolder(id, patch)
  )
  ipcMain.handle(IpcChannels.documentFoldersReorder, (_event, items: DocumentFolderReorderItem[]) => {
    repo.reorderDocumentFolders(items)
  })
  ipcMain.handle(IpcChannels.documentFoldersDelete, (_event, id: string) => {
    repo.deleteDocumentFolder(id)
  })

  ipcMain.handle(IpcChannels.cardsCreate, (_event, input: NewCardInput) => repo.createCard(input))
  ipcMain.handle(IpcChannels.cardsList, () => repo.listCards())
  ipcMain.handle(IpcChannels.cardsUpdate, (_event, id: string, patch) => repo.updateCard(id, patch))
  ipcMain.handle(IpcChannels.cardsReorder, (_event, items: CardReorderItem[]) => {
    repo.reorderCards(items)
  })
  ipcMain.handle(IpcChannels.cardsGrade, (_event, id: string, grade: ReviewGrade) => repo.gradeCard(id, grade))
  ipcMain.handle(IpcChannels.cardsSetSrsState, (_event, id: string, srs: SrsSnapshot) => repo.setCardSrsState(id, srs))
  ipcMain.handle(IpcChannels.cardsDelete, (_event, id: string) => {
    repo.deleteCard(id)
  })
  ipcMain.handle(IpcChannels.cardsApplyAiRegeneration, (_event, id: string, next: AiRegenerateResult) => repo.applyAiRegeneration(id, next))
  ipcMain.handle(IpcChannels.cardsGetOrphanedSources, () => repo.getOrphanedSources())
  ipcMain.handle(IpcChannels.cardsReplaceOrphanedSource, (_event, orphanId: string, input: ReplaceOrphanedSourceInput) =>
    repo.replaceOrphanedSource(orphanId, input)
  )
  ipcMain.handle(IpcChannels.cardsRecaptureOrphanedSource, (_event, orphanId: string, input: RecaptureOrphanedSourceInput) =>
    repo.recaptureOrphanedSource(orphanId, input)
  )
  ipcMain.handle(IpcChannels.cardsDismissOrphanedSource, (_event, orphanId: string) => repo.dismissOrphanedSource(orphanId))
  ipcMain.handle(IpcChannels.cardsResyncAllLocalData, (_event, existingRemoteFolderIds: string[], existingRemoteCardIds: string[]) =>
    repo.resyncMissingLocalData(existingRemoteFolderIds, existingRemoteCardIds)
  )

  ipcMain.handle(IpcChannels.foldersCreate, (_event, name: string, parentId?: string | null) =>
    repo.createFolder(name, parentId ?? null)
  )
  ipcMain.handle(IpcChannels.foldersList, () => repo.listFolders())
  ipcMain.handle(IpcChannels.foldersUpdate, (_event, id: string, patch: FolderUpdatePatch) => repo.updateFolder(id, patch))
  ipcMain.handle(IpcChannels.foldersReorder, (_event, items: FolderReorderItem[]) => {
    repo.reorderFolders(items)
  })
  ipcMain.handle(IpcChannels.foldersDelete, (_event, id: string) => {
    repo.deleteFolder(id)
  })

  // Purely a compute call now, not compute-and-persist — cards live in Supabase, not here, so
  // main can't apply the result itself. cardsStore does that via cardsApi once this resolves.
  ipcMain.handle(IpcChannels.aiRegenerate, async (_event, req: AiRegenerateRequest) => {
    return ai.regenerate(req)
  })

  // Same "pure compute, caller persists" shape as aiRegenerate above — sharePrep.ts writes the
  // result to the card's Supabase-only share_* columns itself.
  ipcMain.handle(IpcChannels.aiPrepareForSharing, async (_event, req: AiSharePrepRequest) => {
    return ai.prepareForSharing(req)
  })

  // Same "pure compute, caller persists" shape — hostSessionStore writes the judgments to
  // live_session_answers itself once this resolves.
  ipcMain.handle(IpcChannels.aiJudgeFreeTextAnswers, async (_event, req: AiJudgeFreeTextRequest) => {
    return ai.judgeFreeTextAnswers(req)
  })

  ipcMain.handle(IpcChannels.reviewLogList, () => repo.listReviewLog())

  ipcMain.handle(IpcChannels.syncGetPendingOps, () => repo.getPendingSyncOps())
  ipcMain.handle(IpcChannels.syncRemoveOps, (_event, ids: number[]) => repo.removeSyncOps(ids))
  ipcMain.handle(IpcChannels.syncGetMeta, (_event, key: string) => repo.getSyncMeta(key))
  ipcMain.handle(IpcChannels.syncSetMeta, (_event, key: string, value: string) => repo.setSyncMeta(key, value))
  ipcMain.handle(IpcChannels.syncGetOriginLinkedCards, () => repo.getOriginLinkedCards())
  ipcMain.handle(IpcChannels.syncGetOriginLinkedFolders, () => repo.getOriginLinkedFolders())
  ipcMain.handle(IpcChannels.syncRekeyCardId, (_event, oldId: string, newId: string) => repo.rekeyCardId(oldId, newId))
  ipcMain.handle(IpcChannels.syncRekeyFolderId, (_event, oldId: string, newId: string) => repo.rekeyFolderId(oldId, newId))
  ipcMain.handle(IpcChannels.syncApplyCardUpsert, (_event, card: CardRecord) => repo.applyRemoteCardUpsert(card))
  ipcMain.handle(IpcChannels.syncApplyFolderUpsert, (_event, folder: FolderRecord) => repo.applyRemoteFolderUpsert(folder))
  ipcMain.handle(IpcChannels.syncApplyReviewLogInsert, (_event, entry: ReviewLogEntry) => repo.applyRemoteReviewLogInsert(entry))

  ipcMain.handle(IpcChannels.ocrRecognizePage, async (_event, input: OcrRecognizePageInput) => {
    const detections = await ocr.recognize(input.imagePath, input.engine, { width: input.width, height: input.height })
    return repo.insertElements(
      input.pageId,
      detections.map((d) => ({ kind: 'text' as const, bbox: d.bbox, text: d.text, imagePath: null }))
    )
  })

  ipcMain.handle(IpcChannels.transcriptionTranscribe, async (_event, input: TranscribeAudioInput) => {
    return transcription.transcribe(new Float32Array(input.audioData), input.engine)
  })
  ipcMain.handle(IpcChannels.transcriptionGetCoverage, (_event, input: TranscriptCoverageInput) =>
    repo.getTranscriptCoverage(input.documentId, input.engine, input.range)
  )
  ipcMain.handle(IpcChannels.transcriptionSaveSegment, (_event, input: SaveTranscriptSegmentInput) =>
    repo.insertTranscriptSegment(input)
  )

  ipcMain.handle(IpcChannels.settingsGetApiKeyStatus, () => getApiKeyStatus())
  ipcMain.handle(IpcChannels.settingsSetApiKey, (_event, apiKey: string | null) => {
    setApiKey(apiKey)
    ai.setApiKey(apiKey)
    ocr.setApiKey(apiKey)
    return getApiKeyStatus()
  })

  ipcMain.handle(IpcChannels.settingsGetOpenAiKeyStatus, () => getOpenAiApiKeyStatus())
  ipcMain.handle(IpcChannels.settingsSetOpenAiKey, (_event, apiKey: string | null) => {
    setOpenAiApiKey(apiKey)
    transcription.setApiKey(apiKey)
    return getOpenAiApiKeyStatus()
  })
}
