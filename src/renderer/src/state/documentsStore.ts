import { create } from 'zustand'
import type { DocumentRecord, ElementRecord, PageRecord } from '../../../shared/types'

interface DocumentsState {
  documents: DocumentRecord[]
  pagesByDocument: Record<string, PageRecord[]>
  elementsByPage: Record<string, ElementRecord[]>
  activeDocumentId: string | null
  activePageIndex: number

  loadDocuments: () => Promise<void>
  openDocument: (documentId: string) => Promise<void>
  deleteDocument: (documentId: string) => Promise<void>
  /** Also persists the new position (fire-and-forget) so reopening this document later resumes
   *  here — see DocumentRecord.lastPageIndex. */
  setActivePageIndex: (index: number) => void
  /** Video only — same persistence as setActivePageIndex, but for playback position. VideoPlayer
   *  calls this on pause/unmount rather than continuously (video's timeupdate event fires many
   *  times a second; writing to the DB on every tick would be needless churn for no real benefit —
   *  resuming within a second or two of where you paused is exactly as useful as resuming exactly). */
  updateLastPlaybackSeconds: (documentId: string, seconds: number) => void
  /** Video frame pages are created lazily (see VideoPlayer.captureFrame), one at a time, outside
   *  openDocument's normal fetch-on-open flow — this is how a freshly captured page becomes visible
   *  to the rest of the app (card backlinks via goToSource, the video timeline's marker list)
   *  without needing a full re-fetch. */
  registerPage: (documentId: string, page: PageRecord) => void
}

export const useDocumentsStore = create<DocumentsState>((set, get) => ({
  documents: [],
  pagesByDocument: {},
  elementsByPage: {},
  activeDocumentId: null,
  activePageIndex: 0,

  loadDocuments: async () => {
    const documents = await window.api.documents.list()
    set({ documents })
  },

  openDocument: async (documentId) => {
    let pages = get().pagesByDocument[documentId]
    if (!pages) {
      pages = await window.api.documents.getPages(documentId)
      set((state) => ({ pagesByDocument: { ...state.pagesByDocument, [documentId]: pages! } }))
    }
    await Promise.all(
      pages.map(async (page) => {
        if (get().elementsByPage[page.id]) return
        const elements = await window.api.documents.getElements(page.id)
        set((state) => ({ elementsByPage: { ...state.elementsByPage, [page.id]: elements } }))
      })
    )
    // Resume where you left off — clamped in case the stored index is stale (e.g. pages changed
    // since it was saved), rather than trusting it blindly and rendering an out-of-range page.
    const lastPageIndex = get().documents.find((d) => d.id === documentId)?.lastPageIndex
    const resumeIndex = lastPageIndex != null ? Math.min(Math.max(0, lastPageIndex), Math.max(0, pages.length - 1)) : 0
    set({ activeDocumentId: documentId, activePageIndex: resumeIndex })
  },

  deleteDocument: async (documentId) => {
    await window.api.documents.delete(documentId)
    set((state) => {
      const pagesByDocument = { ...state.pagesByDocument }
      const removedPages = pagesByDocument[documentId] ?? []
      delete pagesByDocument[documentId]

      const elementsByPage = { ...state.elementsByPage }
      for (const page of removedPages) delete elementsByPage[page.id]

      return {
        documents: state.documents.filter((d) => d.id !== documentId),
        pagesByDocument,
        elementsByPage,
        activeDocumentId: state.activeDocumentId === documentId ? null : state.activeDocumentId
      }
    })
  },

  setActivePageIndex: (index) => {
    const documentId = get().activeDocumentId
    set((state) => ({
      activePageIndex: index,
      documents: documentId
        ? state.documents.map((d) => (d.id === documentId ? { ...d, lastPageIndex: index } : d))
        : state.documents
    }))
    if (documentId) void window.api.documents.updatePosition(documentId, { lastPageIndex: index })
  },

  updateLastPlaybackSeconds: (documentId, seconds) => {
    set((state) => ({
      documents: state.documents.map((d) => (d.id === documentId ? { ...d, lastPlaybackSeconds: seconds } : d))
    }))
    void window.api.documents.updatePosition(documentId, { lastPlaybackSeconds: seconds })
  },

  registerPage: (documentId, page) =>
    set((state) => ({
      pagesByDocument: {
        ...state.pagesByDocument,
        [documentId]: [...(state.pagesByDocument[documentId] ?? []), page]
      }
    }))
}))
