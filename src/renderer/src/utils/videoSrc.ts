/** Builds a URL a native <video> element can load directly against the ocvideo custom protocol
 *  (registered in main/videoProtocol.ts) — synchronous, no IPC round-trip needed, unlike images
 *  (useResolvedImage), since Chromium resolves the custom scheme itself and can issue its own
 *  Range requests for seeking. */
export function videoSrc(path: string): string {
  return 'ocvideo://local/stream?path=' + encodeURIComponent(path)
}
