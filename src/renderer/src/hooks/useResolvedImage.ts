import { useEffect, useState } from 'react'

const cache = new Map<string, string>()

/** Resolves a file path (from PageRecord.backgroundImagePath / ElementRecord.imagePath) to a displayable data URL. */
export function useResolvedImage(path: string | null | undefined): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(path ? cache.get(path) ?? null : null)

  useEffect(() => {
    if (!path) {
      setDataUrl(null)
      return
    }
    const cached = cache.get(path)
    if (cached) {
      setDataUrl(cached)
      return
    }
    let cancelled = false
    window.api.documents.getImage(path).then((resolved) => {
      cache.set(path, resolved)
      if (!cancelled) setDataUrl(resolved)
    })
    return () => {
      cancelled = true
    }
  }, [path])

  return dataUrl
}
