import { protocol } from 'electron'
import { createReadStream, statSync } from 'fs'
import { isAbsolute, relative } from 'path'
import { getVideosDir } from './videoStore'

/** Must run before app.whenReady() — Electron requires privileged scheme registration at module
 *  load time, before the app is ready. */
export function registerVideoProtocolPrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'ocvideo', privileges: { standard: true, stream: true, supportFetchAPI: true } }
  ])
}

/** Streams a local MP4 to <video> with proper seek support. NOT net.fetch(file://…) passthrough —
 *  that was tried first and spiked as broken: it returns 200 instead of 206 for a Range request
 *  (no Content-Range/Accept-Ranges at all) and video.currentTime silently fails to update after a
 *  seek, reproducing a known open Electron issue (#38749) on this app's Electron version. Manual
 *  Range parsing, tested against the same spike, produces correct 206 responses and working seeks. */
export function registerVideoProtocolHandler(): void {
  protocol.handle('ocvideo', (request) => {
    const url = new URL(request.url)
    const filePath = url.searchParams.get('path')
    if (!filePath || !isPathInsideVideosDir(filePath)) {
      return new Response('Forbidden', { status: 403 })
    }
    return streamFile(filePath, request.headers.get('range'))
  })
}

function isPathInsideVideosDir(filePath: string): boolean {
  const rel = relative(getVideosDir(), filePath)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

// fs.ReadStream isn't a standard BodyInit per TS's DOM lib, but Electron's Response/protocol.handle
// accepts a Node readable stream as the body directly — confirmed working via the spike (see the
// module doc comment above): the video plays and seeks correctly with this exact construction.
type NodeStreamBody = ConstructorParameters<typeof Response>[0]

function streamFile(filePath: string, range: string | null): Response {
  const stat = statSync(filePath)
  if (!range) {
    return new Response(createReadStream(filePath) as unknown as NodeStreamBody, {
      headers: { 'Content-Length': String(stat.size), 'Accept-Ranges': 'bytes', 'Content-Type': 'video/mp4' }
    })
  }
  const [startStr, endStr] = range.replace('bytes=', '').split('-')
  const start = Number(startStr)
  const end = endStr ? Number(endStr) : stat.size - 1
  return new Response(createReadStream(filePath, { start, end }) as unknown as NodeStreamBody, {
    status: 206,
    headers: {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(end - start + 1),
      'Content-Type': 'video/mp4'
    }
  })
}
