import { useEffect, useState } from 'react'

/** documentId -> first page's rendered image as a data URL (null once known to have none). */
const cache = new Map<string, string | null>()

/** Loads a document's first slide as a preview image, cached across mounts. */
export function useDocumentThumbnail(documentId: string): string | null {
  const [src, setSrc] = useState<string | null>(() => cache.get(documentId) ?? null)

  useEffect(() => {
    if (cache.has(documentId)) {
      setSrc(cache.get(documentId) ?? null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const pages = await window.api.documents.getPages(documentId)
        const path = pages[0]?.backgroundImagePath
        const resolved = path ? await window.api.documents.getImage(path) : null
        cache.set(documentId, resolved)
        if (!cancelled) setSrc(resolved)
      } catch {
        cache.set(documentId, null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [documentId])

  return src
}
