import { extname } from 'path'

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

/** Shared by aiService.ts and ocrService.ts — both attach on-disk images to Claude API calls and
 *  need the same extension-to-media-type mapping. */
export function imageMediaType(path: string): ImageMediaType {
  const ext = extname(path).slice(1).toLowerCase()
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'webp') return 'image/webp'
  return 'image/png'
}
