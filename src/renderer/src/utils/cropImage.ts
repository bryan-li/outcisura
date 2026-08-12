import type { BBox } from '../../../shared/types'

/** Crops a rectangular region out of an image data URL, returning a new (smaller) data URL. */
export async function cropImageDataUrl(dataUrl: string, bbox: BBox): Promise<string> {
  const img = await loadImage(dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bbox.w))
  canvas.height = Math.max(1, Math.round(bbox.h))
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, bbox.x, bbox.y, bbox.w, bbox.h, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image for cropping'))
    img.src = src
  })
}
