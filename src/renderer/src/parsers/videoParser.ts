import type { ImportVideoInput } from '../../../shared/types'

/** Reads a video File's metadata client-side (duration/dimensions) via a hidden <video> element,
 *  and resolves its on-disk path via the preload bridge (File.path was removed in Electron 32).
 *  Unlike parsePdf/parsePptx, nothing here reads the file's bytes — video import copies the file
 *  main-process-side from this path, never ships it across IPC. */
export async function parseVideoFile(file: File): Promise<ImportVideoInput> {
  const path = window.api.getPathForFile(file)
  const { durationSeconds, width, height } = await readVideoMetadata(file)
  return { filename: file.name, path, durationSeconds, width, height }
}

function readVideoMetadata(file: File): Promise<{ durationSeconds: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    const objectUrl = URL.createObjectURL(file)
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      const result = { durationSeconds: video.duration, width: video.videoWidth, height: video.videoHeight }
      URL.revokeObjectURL(objectUrl)
      resolve(result)
    }
    video.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Failed to read video metadata — the file may not be a valid video.'))
    }
    video.src = objectUrl
  })
}
