import { app } from 'electron'
import { copyFileSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

let videosDir: string | null = null

export function getVideosDir(): string {
  if (!videosDir) {
    videosDir = join(app.getPath('userData'), 'videos')
    mkdirSync(videosDir, { recursive: true })
  }
  return videosDir
}

/** Copies an imported video into storage and returns the absolute destination path. Deliberately
 *  a straight file copy, not a base64 round-trip like saveDataUrlImage — video files are too large
 *  for that, and the source path is already on disk (see ImportVideoInput), so there's nothing to
 *  decode. */
export function saveVideoFile(sourcePath: string): string {
  const destPath = join(getVideosDir(), `${randomUUID()}.mp4`)
  copyFileSync(sourcePath, destPath)
  return destPath
}

/** Best-effort cleanup on document delete — unlike page-crop images (small, already leak silently
 *  on delete), a stranded 100s-of-MB video file is worth actually removing. Non-throwing: a
 *  missing file shouldn't block the DB delete it's cleaning up after. */
export function deleteVideoFile(filePath: string): void {
  try {
    unlinkSync(filePath)
  } catch {
    // already gone, or never existed — fine either way
  }
}
