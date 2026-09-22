import { dialog, ipcMain } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { IpcChannels } from '../../shared/ipc'
import type {
  AiExtractPaperTemplateRequest,
  AiGeneratePaperQuestionsRequest,
  AiJudgeFreeTextRequest,
  AiMarkPaperAnswersRequest,
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
  ImportSharedDeckInput,
  ImportVideoInput,
  NewCardInput,
  NewGeneratedPaperAttemptInput,
  NewGeneratedPaperInput,
  NewPaperTemplateInput,
  NewReviewSessionInput,
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
import { readImageAsDataUrl, saveDataUrlImage, saveImageBuffer } from '../imageStore'
import { buildAnkiPackage, parseAnkiPackage } from '../anki'
import { importParsedNotes } from '../ankiImport'
import { checkForUpdates, downloadUpdate, getUpdateStatus, installUpdate, openReleasePage, simulateUpdate } from '../updater'
import { setProxySession } from '../anthropicClient'
import { setActiveUser } from '../accountDb'
import { convertPptxToPdf } from '../pptxConverter'

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

  // Unlike the other ai.* handlers above, this one persists on the main-process side itself —
  // see AiService.summarizeDocument's own doc comment on why.
  ipcMain.handle(IpcChannels.aiSummarizeDocument, async (_event, documentId: string) => {
    const result = await ai.summarizeDocument(documentId)
    repo.updateDocumentSummary(documentId, result.summary)
    return result
  })

  ipcMain.handle(IpcChannels.aiExtractPaperTemplate, (_event, req: AiExtractPaperTemplateRequest) => ai.extractPaperTemplate(req))
  ipcMain.handle(IpcChannels.aiGeneratePaperQuestions, (_event, req: AiGeneratePaperQuestionsRequest) => ai.generatePaperQuestions(req))
  ipcMain.handle(IpcChannels.aiMarkPaperAnswers, (_event, req: AiMarkPaperAnswersRequest) => ai.markPaperAnswers(req))

  ipcMain.handle(IpcChannels.paperTemplatesCreate, (_event, input: NewPaperTemplateInput) => repo.createPaperTemplate(input))
  ipcMain.handle(IpcChannels.paperTemplatesList, () => repo.listPaperTemplates())
  ipcMain.handle(IpcChannels.paperTemplatesDelete, (_event, id: string) => repo.deletePaperTemplate(id))

  ipcMain.handle(IpcChannels.generatedPapersCreate, (_event, input: NewGeneratedPaperInput) => repo.createGeneratedPaper(input))
  ipcMain.handle(IpcChannels.generatedPapersList, () => repo.listGeneratedPapers())
  ipcMain.handle(IpcChannels.generatedPapersGet, (_event, id: string) => repo.getGeneratedPaper(id))
  ipcMain.handle(IpcChannels.generatedPapersDelete, (_event, id: string) => repo.deleteGeneratedPaper(id))

  ipcMain.handle(IpcChannels.generatedPaperAttemptsCreate, (_event, input: NewGeneratedPaperAttemptInput) => repo.createGeneratedPaperAttempt(input))
  ipcMain.handle(IpcChannels.generatedPaperAttemptsListForPaper, (_event, paperId: string) => repo.listGeneratedPaperAttempts(paperId))
  ipcMain.handle(IpcChannels.generatedPaperAttemptsGet, (_event, id: string) => repo.getGeneratedPaperAttempt(id))
  ipcMain.handle(IpcChannels.generatedPaperAttemptsDelete, (_event, id: string) => repo.deleteGeneratedPaperAttempt(id))

  ipcMain.handle(IpcChannels.reviewLogList, () => repo.listReviewLog())
  ipcMain.handle(IpcChannels.reviewSessionsLog, (_event, input: NewReviewSessionInput) => repo.logReviewSession(input))
  ipcMain.handle(IpcChannels.reviewSessionsList, () => repo.listReviewSessions())

  ipcMain.handle(IpcChannels.tagsCreate, (_event, name: string) => repo.createTag(name))
  ipcMain.handle(IpcChannels.tagsList, () => repo.listTags())
  ipcMain.handle(IpcChannels.tagsDelete, (_event, id: string) => repo.deleteTag(id))
  ipcMain.handle(IpcChannels.tagsSetCardTags, (_event, cardId: string, tagIds: string[]) => repo.setCardTags(cardId, tagIds))

  ipcMain.handle(IpcChannels.cardImagesAdd, (_event, cardId: string, imagePaths: string[]) => repo.addCardImages(cardId, imagePaths))
  ipcMain.handle(IpcChannels.cardImagesRemove, (_event, cardId: string, sourceId: string) => repo.removeCardImage(cardId, sourceId))

  ipcMain.handle(IpcChannels.authSetAiSession, (_event, session: { accessToken: string; supabaseUrl: string } | null) => {
    setProxySession(session)
  })

  ipcMain.handle(IpcChannels.authSetActiveUser, (_event, userId: string | null) => {
    setActiveUser(repo, userId)
  })

  ipcMain.handle(IpcChannels.updatesGetStatus, () => getUpdateStatus())
  ipcMain.handle(IpcChannels.updatesCheck, () => checkForUpdates())
  ipcMain.handle(IpcChannels.updatesDownload, () => downloadUpdate())
  ipcMain.handle(IpcChannels.updatesInstall, () => installUpdate())
  ipcMain.handle(IpcChannels.updatesSimulate, () => simulateUpdate())
  ipcMain.handle(IpcChannels.updatesOpenRelease, () => openReleasePage())

  ipcMain.handle(IpcChannels.ankiExportAll, async (_event, folderId?: string) => {
    const folders = repo.listFolders()
    let cards = repo.listCards()
    let deckName = 'Outcisura'
    if (folderId) {
      // The folder plus every folder nested under it.
      const inScope = new Set<string>([folderId])
      let grew = true
      while (grew) {
        grew = false
        for (const f of folders) {
          if (f.parentId && inScope.has(f.parentId) && !inScope.has(f.id)) {
            inScope.add(f.id)
            grew = true
          }
        }
      }
      cards = cards.filter((c) => c.folderId && inScope.has(c.folderId))
      deckName = folders.find((f) => f.id === folderId)?.name ?? deckName
    }
    if (cards.length === 0) return { canceled: true }
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export to Anki',
      defaultPath: `${deckName.replace(/[\\/:*?"<>|]/g, '-')}.apkg`,
      filters: [{ name: 'Anki Package', extensions: ['apkg'] }]
    })
    if (canceled || !filePath) return { canceled: true }
    const buffer = await buildAnkiPackage(cards, { folders, tags: repo.listTags(), defaultDeckName: 'Outcisura' })
    writeFileSync(filePath, buffer)
    return { canceled: false, path: filePath, count: cards.length }
  })

  ipcMain.handle(IpcChannels.ankiImport, async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Import from Anki',
      filters: [{ name: 'Anki Package', extensions: ['apkg'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return { canceled: true, imported: 0 }
    const notes = await parseAnkiPackage(readFileSync(filePaths[0]))

    const summary = importParsedNotes(repo, notes)
    return { canceled: false, ...summary }
  })

  ipcMain.handle(IpcChannels.sharedDecksImport, (_event, input: ImportSharedDeckInput) => {
    // Reuses the exact same folder-find-or-create/dedupe/import machinery Anki import uses — a
    // shared deck is just a deck from somewhere else, same as an .apkg's. No images (see
    // ImportSharedDeckInput's own doc comment), no tags or schedule (friends' own review progress
    // and personal tags aren't part of what gets shared).
    const notes = input.cards.map((c) => ({
      front: c.front,
      back: c.back,
      cardType: c.cardType,
      images: [],
      deckPath: [input.folderName],
      tags: [],
      schedule: null
    }))
    return importParsedNotes(repo, notes)
  })

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
}
