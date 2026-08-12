/** Progress through the client-side stages of importing a PDF/PPTX, before the final save-to-DB step. */
export type ImportProgress =
  | { phase: 'converting' }
  | { phase: 'parsing'; current: number; total: number }
  | { phase: 'saving' }

export type ImportProgressCallback = (progress: ImportProgress) => void
