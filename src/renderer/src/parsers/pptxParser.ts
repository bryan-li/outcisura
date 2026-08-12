import type { ParsedDocument } from '../../../shared/types'
import type { ImportProgressCallback } from '../types/importProgress'
import { parsePdf } from './pdfParser'

/**
 * PPTX slides are rendered via headless LibreOffice (converted to PDF in the main process) rather
 * than reconstructed from OOXML shape geometry, for pixel-accurate output. Once converted, a pptx
 * is just a pdf: reuse parsePdf for rendering + text/image bounding-box extraction.
 */
export async function parsePptx(file: File, onProgress?: ImportProgressCallback): Promise<ParsedDocument> {
  onProgress?.({ phase: 'converting' })
  const pptxBytes = await file.arrayBuffer()
  const pdfBytes = await window.api.documents.convertPptxToPdf(pptxBytes)
  const pdfLikeFile = new File([pdfBytes], file.name)

  const parsed = await parsePdf(pdfLikeFile, onProgress)
  return { ...parsed, type: 'pptx' }
}
