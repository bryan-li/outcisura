import { contextBridge, ipcRenderer, shell, webFrame, webUtils } from 'electron'
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
    updatePosition: (id, patch) => ipcRenderer.invoke(IpcChannels.documentsUpdatePosition, id, patch),
    updateFolder: (id, folderId) => ipcRenderer.invoke(IpcChannels.documentsUpdateFolder, id, folderId)
  },
  documentFolders: {
    create: (name, parentId) => ipcRenderer.invoke(IpcChannels.documentFoldersCreate, name, parentId),
    list: () => ipcRenderer.invoke(IpcChannels.documentFoldersList),
    update: (id, patch) => ipcRenderer.invoke(IpcChannels.documentFoldersUpdate, id, patch),
    reorder: (items) => ipcRenderer.invoke(IpcChannels.documentFoldersReorder, items),
    delete: (id) => ipcRenderer.invoke(IpcChannels.documentFoldersDelete, id)
  },
  cards: {
    create: (input) => ipcRenderer.invoke(IpcChannels.cardsCreate, input),
    list: () => ipcRenderer.invoke(IpcChannels.cardsList),
    update: (id, patch) => ipcRenderer.invoke(IpcChannels.cardsUpdate, id, patch),
    reorder: (items) => ipcRenderer.invoke(IpcChannels.cardsReorder, items),
    grade: (id, grade) => ipcRenderer.invoke(IpcChannels.cardsGrade, id, grade),
    setSrsState: (id, srs) => ipcRenderer.invoke(IpcChannels.cardsSetSrsState, id, srs),
    delete: (id) => ipcRenderer.invoke(IpcChannels.cardsDelete, id),
    applyAiRegeneration: (id, next) => ipcRenderer.invoke(IpcChannels.cardsApplyAiRegeneration, id, next),
    getOrphanedSources: () => ipcRenderer.invoke(IpcChannels.cardsGetOrphanedSources),
    replaceOrphanedSource: (orphanId, input) => ipcRenderer.invoke(IpcChannels.cardsReplaceOrphanedSource, orphanId, input),
    recaptureOrphanedSource: (orphanId, input) => ipcRenderer.invoke(IpcChannels.cardsRecaptureOrphanedSource, orphanId, input),
    dismissOrphanedSource: (orphanId) => ipcRenderer.invoke(IpcChannels.cardsDismissOrphanedSource, orphanId),
    resyncMissingLocalData: (existingRemoteFolderIds, existingRemoteCardIds) =>
      ipcRenderer.invoke(IpcChannels.cardsResyncAllLocalData, existingRemoteFolderIds, existingRemoteCardIds)
  },
  folders: {
    create: (name, parentId) => ipcRenderer.invoke(IpcChannels.foldersCreate, name, parentId),
    list: () => ipcRenderer.invoke(IpcChannels.foldersList),
    update: (id, patch) => ipcRenderer.invoke(IpcChannels.foldersUpdate, id, patch),
    reorder: (items) => ipcRenderer.invoke(IpcChannels.foldersReorder, items),
    delete: (id) => ipcRenderer.invoke(IpcChannels.foldersDelete, id)
  },
  ai: {
    regenerate: (req) => ipcRenderer.invoke(IpcChannels.aiRegenerate, req),
    prepareForSharing: (req) => ipcRenderer.invoke(IpcChannels.aiPrepareForSharing, req),
    judgeFreeTextAnswers: (req) => ipcRenderer.invoke(IpcChannels.aiJudgeFreeTextAnswers, req)
  },
  reviewLog: {
    list: () => ipcRenderer.invoke(IpcChannels.reviewLogList)
  },
  reviewSessions: {
    log: (input) => ipcRenderer.invoke(IpcChannels.reviewSessionsLog, input),
    list: () => ipcRenderer.invoke(IpcChannels.reviewSessionsList)
  },
  tags: {
    create: (name) => ipcRenderer.invoke(IpcChannels.tagsCreate, name),
    list: () => ipcRenderer.invoke(IpcChannels.tagsList),
    delete: (id) => ipcRenderer.invoke(IpcChannels.tagsDelete, id),
    setCardTags: (cardId, tagIds) => ipcRenderer.invoke(IpcChannels.tagsSetCardTags, cardId, tagIds)
  },
  cardImages: {
    add: (cardId, imagePaths) => ipcRenderer.invoke(IpcChannels.cardImagesAdd, cardId, imagePaths),
    remove: (cardId, sourceId) => ipcRenderer.invoke(IpcChannels.cardImagesRemove, cardId, sourceId)
  },
  anki: {
    exportAll: () => ipcRenderer.invoke(IpcChannels.ankiExportAll),
    import: () => ipcRenderer.invoke(IpcChannels.ankiImport)
  },
  auth: {
    openOAuthUrl: (url) => {
      shell.openExternal(url)
    },
    onDeepLink: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, url: string): void => callback(url)
      ipcRenderer.on(IpcChannels.authDeepLink, listener)
      return () => ipcRenderer.removeListener(IpcChannels.authDeepLink, listener)
    }
  },
  sync: {
    getPendingOps: () => ipcRenderer.invoke(IpcChannels.syncGetPendingOps),
    removeOps: (ids) => ipcRenderer.invoke(IpcChannels.syncRemoveOps, ids),
    getMeta: (key) => ipcRenderer.invoke(IpcChannels.syncGetMeta, key),
    setMeta: (key, value) => ipcRenderer.invoke(IpcChannels.syncSetMeta, key, value),
    getOriginLinkedCards: () => ipcRenderer.invoke(IpcChannels.syncGetOriginLinkedCards),
    getOriginLinkedFolders: () => ipcRenderer.invoke(IpcChannels.syncGetOriginLinkedFolders),
    rekeyCardId: (oldId, newId) => ipcRenderer.invoke(IpcChannels.syncRekeyCardId, oldId, newId),
    rekeyFolderId: (oldId, newId) => ipcRenderer.invoke(IpcChannels.syncRekeyFolderId, oldId, newId),
    applyCardUpsert: (card) => ipcRenderer.invoke(IpcChannels.syncApplyCardUpsert, card),
    applyFolderUpsert: (folder) => ipcRenderer.invoke(IpcChannels.syncApplyFolderUpsert, folder),
    applyReviewLogInsert: (entry) => ipcRenderer.invoke(IpcChannels.syncApplyReviewLogInsert, entry)
  },
  ocr: {
    recognizePage: (input) => ipcRenderer.invoke(IpcChannels.ocrRecognizePage, input)
  },
  transcription: {
    transcribe: (input) => ipcRenderer.invoke(IpcChannels.transcriptionTranscribe, input),
    getCoverage: (input) => ipcRenderer.invoke(IpcChannels.transcriptionGetCoverage, input),
    saveSegment: (input) => ipcRenderer.invoke(IpcChannels.transcriptionSaveSegment, input)
  },
  ui: {
    // Real browser zoom rather than a CSS transform: layout stays in CSS pixels, so pointer
    // coordinates (drag-select on slides, Konva mask drawing) keep working unscaled.
    setZoomFactor: (factor) => webFrame.setZoomFactor(factor),
    getZoomFactor: () => webFrame.getZoomFactor()
  },
  settings: {
    getApiKeyStatus: () => ipcRenderer.invoke(IpcChannels.settingsGetApiKeyStatus),
    setApiKey: (apiKey) => ipcRenderer.invoke(IpcChannels.settingsSetApiKey, apiKey),
    getOpenAiKeyStatus: () => ipcRenderer.invoke(IpcChannels.settingsGetOpenAiKeyStatus),
    setOpenAiKey: (apiKey) => ipcRenderer.invoke(IpcChannels.settingsSetOpenAiKey, apiKey)
  }
}

contextBridge.exposeInMainWorld('api', api)
