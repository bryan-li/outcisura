import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron'
import { IpcChannels } from '../shared/ipc'
import type { FlashcardApi } from '../shared/ipc'

const api: FlashcardApi = {
  getPathForFile: (file) => webUtils.getPathForFile(file),
  documents: {
    import: (parsed) => ipcRenderer.invoke(IpcChannels.documentsImport, parsed),
    importVideo: (input) => ipcRenderer.invoke(IpcChannels.documentsImportVideo, input),
    createVideoFramePage: (input) => ipcRenderer.invoke(IpcChannels.documentsCreateVideoFramePage, input),
    list: () => ipcRenderer.invoke(IpcChannels.documentsList),
    getPages: (documentId) => ipcRenderer.invoke(IpcChannels.documentsGetPages, documentId),
    getElements: (pageId) => ipcRenderer.invoke(IpcChannels.documentsGetElements, pageId),
    getImage: (path) => ipcRenderer.invoke(IpcChannels.documentsGetImage, path),
    convertPptxToPdf: (pptxBytes) => ipcRenderer.invoke(IpcChannels.documentsConvertPptxToPdf, pptxBytes),
    delete: (id) => ipcRenderer.invoke(IpcChannels.documentsDelete, id),
    saveImage: (dataUrl) => ipcRenderer.invoke(IpcChannels.documentsSaveImage, dataUrl),
    updatePosition: (id, patch) => ipcRenderer.invoke(IpcChannels.documentsUpdatePosition, id, patch)
  },
  cards: {
    create: (input) => ipcRenderer.invoke(IpcChannels.cardsCreate, input),
    list: () => ipcRenderer.invoke(IpcChannels.cardsList),
    update: (id, patch) => ipcRenderer.invoke(IpcChannels.cardsUpdate, id, patch),
    reorder: (items) => ipcRenderer.invoke(IpcChannels.cardsReorder, items),
    grade: (id, grade) => ipcRenderer.invoke(IpcChannels.cardsGrade, id, grade),
    setSrsState: (id, srs) => ipcRenderer.invoke(IpcChannels.cardsSetSrsState, id, srs),
    delete: (id) => ipcRenderer.invoke(IpcChannels.cardsDelete, id)
  },
  folders: {
    create: (name, parentId) => ipcRenderer.invoke(IpcChannels.foldersCreate, name, parentId),
    list: () => ipcRenderer.invoke(IpcChannels.foldersList),
    update: (id, patch) => ipcRenderer.invoke(IpcChannels.foldersUpdate, id, patch),
    reorder: (items) => ipcRenderer.invoke(IpcChannels.foldersReorder, items),
    delete: (id) => ipcRenderer.invoke(IpcChannels.foldersDelete, id)
  },
  ai: {
    regenerate: (req) => ipcRenderer.invoke(IpcChannels.aiRegenerate, req)
  },
  reviewLog: {
    list: () => ipcRenderer.invoke(IpcChannels.reviewLogList)
  },
  ocr: {
    recognizePage: (input) => ipcRenderer.invoke(IpcChannels.ocrRecognizePage, input)
  },
  ui: {
    // Real browser zoom rather than a CSS transform: layout stays in CSS pixels, so pointer
    // coordinates (drag-select on slides, Konva mask drawing) keep working unscaled.
    setZoomFactor: (factor) => webFrame.setZoomFactor(factor),
    getZoomFactor: () => webFrame.getZoomFactor()
  }
}

contextBridge.exposeInMainWorld('api', api)
