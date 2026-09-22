import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

/** Plain-text extraction only — no page rendering, no image blocks, no ParsedDocument/element
 *  bounding boxes. Deliberately separate from parsers/pdfParser.ts's full import pipeline: a past
 *  exam paper uploaded for the paper generator (see lib/paperGenerator.ts) is never added to the
 *  Library as a document, it's just text fed to the AI once to infer a structure, so there's no
 *  reason to pay for rendering every page to a cached PNG the way a real import does. */
export async function extractPdfText(file: File): Promise<string> {
  const data = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data }).promise

  const pageTexts: string[] = []
  for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex++) {
    const page = await pdf.getPage(pageIndex + 1)
    const textContent = await page.getTextContent()
    const text = textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text) pageTexts.push(`--- Page ${pageIndex + 1} ---\n${text}`)
  }
  return pageTexts.join('\n\n')
}
