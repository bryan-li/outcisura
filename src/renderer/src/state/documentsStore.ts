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
  setActivePageIndex: (index: number) => void
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
    set({ activeDocumentId: documentId, activePageIndex: 0 })
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

  setActivePageIndex: (index) => set({ activePageIndex: index })
}))
