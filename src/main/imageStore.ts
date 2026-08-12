import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { extname, join } from 'path'
import { randomUUID } from 'crypto'

let imagesDir: string | null = null

function getImagesDir(): string {
  if (!imagesDir) {
    imagesDir = join(app.getPath('userData'), 'images')
    mkdirSync(imagesDir, { recursive: true })
  }
  return imagesDir
}

/** Persists a `data:image/...;base64,...` URL to disk and returns the absolute file path. */
export function saveDataUrlImage(dataUrl: string): string {
  const match = /^data:image\/(\w+);base64,(.+)$/.exec(dataUrl)
  if (!match) {
    throw new Error('Expected a base64 data URL image')
  }
  const [, ext, base64] = match
  const filePath = join(getImagesDir(), `${randomUUID()}.${ext}`)
  writeFileSync(filePath, Buffer.from(base64, 'base64'))
  return filePath
}

/** Reads back a file saved by saveDataUrlImage as a `data:` URL, for display in the renderer. */
export function readImageAsDataUrl(filePath: string): string {
  const ext = extname(filePath).slice(1).toLowerCase()
  const mime = ext === 'jpg' ? 'jpeg' : ext
  const base64 = readFileSync(filePath).toString('base64')
  return `data:image/${mime};base64,${base64}`
}
