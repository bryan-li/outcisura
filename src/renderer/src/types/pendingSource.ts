import type { BBox } from '../../../shared/types'

/** A source snippet the user has picked (from a page element) but not yet turned into a saved card. */
export interface PendingSource {
  documentId: string
  pageId: string
  elementId: string | null
  bbox: BBox
  label: string
  previewText: string | null
  previewImagePath: string | null
}
