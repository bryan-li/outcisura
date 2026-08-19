import type { DocumentRecord, PageRecord } from '../../../shared/types'
import { videoSrc } from '../utils/videoSrc'

/** Headless counterpart to VideoPlayer's own captureFrame — no rendered <video> element or user
 *  interaction, just "open this video, jump to this moment, grab the frame." Used by the
 *  missing-source recovery view to recapture a video-sourced orphan by its saved timestamp, where
 *  there's no player on screen to pause. Never attached to the DOM — Chromium decodes and seeks a
 *  detached <video> element fine, and canvas capture from it works identically to VideoPlayer's
 *  attached one (same ocvideo:// source, not a cross-origin/tainted-canvas concern either way). */
export async function captureVideoFrameAt(document: DocumentRecord, timestampSeconds: number): Promise<{ page: PageRecord; frameDataUrl: string }> {
  if (!document.sourceVideoPath) throw new Error(`"${document.filename}" has no video file on this device`)

  const video = window.document.createElement('video')
  video.muted = true
  video.src = videoSrc(document.sourceVideoPath)

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve()
    video.onerror = () => reject(new Error(`Couldn't load "${document.filename}"`))
  })

  const clampedSeconds = Math.min(Math.max(timestampSeconds, 0), video.duration || timestampSeconds)
  await new Promise<void>((resolve, reject) => {
    video.onseeked = () => resolve()
    video.onerror = () => reject(new Error(`Couldn't seek "${document.filename}"`))
    video.currentTime = clampedSeconds
  })

  const canvas = window.document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  const frameDataUrl = canvas.toDataURL('image/png')

  const backgroundImagePath = await window.api.documents.saveImage(frameDataUrl)
  const page = await window.api.documents.createVideoFramePage({
    documentId: document.id,
    timestampSeconds: clampedSeconds,
    width: canvas.width,
    height: canvas.height,
    backgroundImagePath
  })
  return { page, frameDataUrl }
}
