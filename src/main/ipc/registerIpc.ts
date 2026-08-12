import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipc'
import type {
  AiRegenerateRequest,
  CardReorderItem,
  FolderReorderItem,
  FolderUpdatePatch,
  NewCardInput,
  ParsedDocument,
  SrsSnapshot
} from '../../shared/types'
import type { ReviewGrade } from '../../shared/srs'
import type { AiService } from '../aiService'
import type { Repository } from '../db/repository'
import { readImageAsDataUrl, saveDataUrlImage } from '../imageStore'
import { convertPptxToPdf } from '../pptxConverter'

export function registerIpc(repo: Repository, ai: AiService | null): void {
  ipcMain.handle(IpcChannels.documentsImport, (_event, parsed: ParsedDocument) => repo.importDocument(parsed))
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
    if (!ai) throw new Error('AI service unavailable: set ANTHROPIC_API_KEY')
    const result = await ai.regenerate(req)
    return repo.applyAiRegeneration(req.cardId, result)
  })

  ipcMain.handle(IpcChannels.reviewLogList, () => repo.listReviewLog())
}
