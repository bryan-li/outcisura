import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipc'
import type {
  AiRegenerateRequest,
  CardReorderItem,
  CreateVideoFramePageInput,
  DocumentPositionPatch,
  FolderReorderItem,
  FolderUpdatePatch,
  ImportVideoInput,
  NewCardInput,
  OcrRecognizePageInput,
  ParsedDocument,
  SrsSnapshot,
  TranscribeAudioInput
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

  ipcMain.handle(IpcChannels.aiRegenerate, async (_event, req: AiRegenerateRequest) => {
    const result = await ai.regenerate(req)
    return repo.applyAiRegeneration(req.cardId, result)
  })

  ipcMain.handle(IpcChannels.reviewLogList, () => repo.listReviewLog())

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
