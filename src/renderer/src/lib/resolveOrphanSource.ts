import type { CardRecord, DocumentRecord, OrphanedSourceRecord, PageRecord } from '../../../shared/types'
import { cropImageDataUrl } from '../utils/cropImage'
import { captureVideoFrameAt } from './captureVideoFrame'

/** Crops the orphan's already-synced bbox/sourcePageIndex snapshot out of the given document's
 *  matching page and attaches it via recaptureOrphanedSource — the shared crop-and-attach step
 *  behind both MissingSourcesView's manual "Recapture from document" flow and syncEngine.ts's
 *  automatic resolution after a pull. Deliberately takes `pages` as a plain array rather than
 *  reading documentsStore itself, so it works identically whether the caller got them via
 *  openDocument (manual flow, already viewing the library) or a headless `documents.getPages` IPC
 *  call (automatic flow, must not touch the store's activeDocumentId while the user might be
 *  looking at something else). Returns null (no side effects beyond the page lookup) if the
 *  expected page just isn't there, so callers can try another candidate document before giving up. */
export async function resolveOrphanAgainstPages(
  orphan: OrphanedSourceRecord,
  documentId: string,
  documentLabel: string,
  pages: PageRecord[]
): Promise<CardRecord | null> {
  const idx = orphan.sourcePageIndex
  const page = idx !== null && idx >= 0 && idx < pages.length ? pages[idx] : undefined
  if (!page || !page.backgroundImagePath) return null

  const backgroundDataUrl = await window.api.documents.getImage(page.backgroundImagePath)
  const croppedDataUrl = await cropImageDataUrl(backgroundDataUrl, orphan.bbox)
  const imagePath = await window.api.documents.saveImage(croppedDataUrl)
  return window.api.cards.recaptureOrphanedSource(orphan.id, {
    documentId,
    pageId: page.id,
    bbox: orphan.bbox,
    imagePath,
    sourceDocumentFilename: documentLabel,
    sourcePageIndex: page.pageIndex,
    sourceTimestampSeconds: null
  })
}

/** Video counterpart to resolveOrphanAgainstPages — a video document has no pre-existing indexed
 *  pages to look one up in (see sourceTimestampSeconds' own doc comment on why sourcePageIndex is
 *  useless here), so this captures a brand-new frame at the orphan's saved timestamp instead of
 *  searching an existing pages array. Returns the freshly captured page alongside the updated card
 *  so the caller can register it with documentsStore — this never goes through openDocument, so the
 *  store has no way to already know about it. Null (no side effects beyond the capture itself) if
 *  the orphan has no timestamp to work from, or the document turns out not to be a video. */
export async function resolveOrphanAgainstVideo(
  orphan: OrphanedSourceRecord,
  document: DocumentRecord
): Promise<{ card: CardRecord; page: PageRecord } | null> {
  if (document.type !== 'video' || orphan.sourceTimestampSeconds === null) return null

  const { page, frameDataUrl } = await captureVideoFrameAt(document, orphan.sourceTimestampSeconds)
  const croppedDataUrl = await cropImageDataUrl(frameDataUrl, orphan.bbox)
  const imagePath = await window.api.documents.saveImage(croppedDataUrl)
  const card = await window.api.cards.recaptureOrphanedSource(orphan.id, {
    documentId: document.id,
    pageId: page.id,
    bbox: orphan.bbox,
    imagePath,
    sourceDocumentFilename: document.filename,
    sourcePageIndex: page.pageIndex,
    sourceTimestampSeconds: page.timestampSeconds
  })
  return { card, page }
}
