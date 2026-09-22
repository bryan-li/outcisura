import { create } from 'zustand'
import type { GeneratedPaperSummary, PaperTemplateRecord } from '../../../shared/types'

interface ExamPapersState {
  templates: PaperTemplateRecord[]
  papers: GeneratedPaperSummary[]
  loaded: boolean
  load: () => Promise<void>
  deleteTemplate: (id: string) => Promise<void>
  deletePaper: (id: string) => Promise<void>
}

/** Templates (a past paper's inferred structure) and generated papers (fresh questions written to
 *  fit one) — both local-only, see schema.ts's own migration comment. Creation is multi-step (parse
 *  PDF text client-side, one or two AI calls, then a save) and lives directly in the modal
 *  components that drive it (UploadTemplateModal/GeneratePaperModal), which call `load()` again on
 *  success rather than this store owning that whole flow. */
export const useExamPapersStore = create<ExamPapersState>((set, get) => ({
  templates: [],
  papers: [],
  loaded: false,

  load: async () => {
    const [templates, papers] = await Promise.all([window.api.paperTemplates.list(), window.api.generatedPapers.list()])
    set({ templates, papers, loaded: true })
  },

  deleteTemplate: async (id) => {
    await window.api.paperTemplates.delete(id)
    await get().load()
  },

  deletePaper: async (id) => {
    await window.api.generatedPapers.delete(id)
    await get().load()
  }
}))
