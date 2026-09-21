import { app, shell, type BrowserWindow } from 'electron'
import { spawn } from 'child_process'
import { accessSync, constants, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { dirname, join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { IpcChannels } from '../shared/ipc'
import type { UpdateStatus } from '../shared/types'

const run = promisify(execFile)

const REPO = 'bryan-li/outcisura'
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000
const FIRST_CHECK_DELAY_MS = 15_000

/** Why this is hand-rolled rather than electron-updater: Squirrel.Mac (what electron-updater drives
 *  on macOS) refuses to swap in an update unless the app carries a real Developer ID signature, and
 *  these builds are ad-hoc signed. A file Node downloads itself never gets the quarantine flag a browser
 *  download does, so the app can just replace itself: fetch the release zip, unpack it, and hand a tiny
 *  detached script the swap-and-relaunch once this process has exited. */

interface ReleaseAsset {
  name: string
  size: number
  browser_download_url: string
  digest?: string | null
}
interface Release {
  tag_name: string
  html_url: string
  draft: boolean
  prerelease: boolean
  assets: ReleaseAsset[]
}

/** "v0.3.0", "v0.2.0-installer", "0.3.0" -> [0,3,0]; null if there's no x.y.z in it. */
export function parseVersion(text: string): [number, number, number] | null {
  const m = text.match(/(\d+)\.(\d+)\.(\d+)/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

/** The .zip built for this CPU (electron-builder names them ...-arm64-mac.zip / ...-mac.zip for x64). */
export function pickZipAsset(assets: ReleaseAsset[], arch: string): ReleaseAsset | null {
  const zips = assets.filter((a) => a.name.toLowerCase().endsWith('.zip') && !a.name.endsWith('.blockmap'))
  const arm = zips.find((a) => /arm64/i.test(a.name))
  const intel = zips.find((a) => !/arm64/i.test(a.name))
  return (arch === 'arm64' ? arm : intel) ?? null
}

let status: UpdateStatus = { state: 'idle', currentVersion: app.getVersion(), canAutoInstall: false }
let windowGetter: () => BrowserWindow | null = () => null
let pendingApp: { path: string; version: string } | null = null
let timer: NodeJS.Timeout | null = null
let inFlight: Promise<UpdateStatus> | null = null
let latestZip: ReleaseAsset | null = null

function setStatus(patch: Partial<UpdateStatus>): UpdateStatus {
  status = { ...status, ...patch, currentVersion: app.getVersion() }
  windowGetter()?.webContents.send(IpcChannels.updatesStatus, status)
  return status
}

/** The running .app bundle (…/Outcisura.app), or null when running unpackaged. */
function currentAppBundle(): string | null {
  if (!app.isPackaged) return null
  const match = process.execPath.match(/^(.*?\.app)\//)
  return match ? match[1] : null
}

function canReplaceSelf(): boolean {
  if (process.platform !== 'darwin') return false
  const bundle = currentAppBundle()
  if (!bundle) return false
  // A translocated (quarantined, never moved) app runs from a read-only copy.
  if (bundle.includes('/AppTranslocation/')) return false
  try {
    accessSync(dirname(bundle), constants.W_OK)
    return true
  } catch {
    return false
  }
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

export function checkForUpdates(): Promise<UpdateStatus> {
  // Don't step on a download or a ready install; a repeat click while checking shares the request.
  if (status.state === 'downloading' || status.state === 'ready') return Promise.resolve(status)
  if (inFlight) return inFlight
  setStatus({ state: 'checking', error: undefined })
  inFlight = (async () => {
    try {
      const response = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=10`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Outcisura-updater' }
      })
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`)
      const releases = ((await response.json()) as Release[]).filter((r) => !r.draft && !r.prerelease)
      let best: Release | null = null
      for (const r of releases) {
        if (!parseVersion(r.tag_name)) continue
        if (!best || isNewer(r.tag_name, best.tag_name)) best = r
      }
      if (!best || !isNewer(best.tag_name, app.getVersion())) {
        latestZip = null
        return setStatus({ state: 'up-to-date', version: undefined, canAutoInstall: canReplaceSelf() })
      }
      latestZip = pickZipAsset(best.assets, process.arch)
      const version = parseVersion(best.tag_name)!.join('.')
      return setStatus({
        state: 'available',
        version,
        releaseUrl: best.html_url,
        // Without a zip for this machine (or no way to replace ourselves) it's a manual download.
        canAutoInstall: !!latestZip && canReplaceSelf()
      })
    } catch (err) {
      return setStatus({ state: 'error', error: err instanceof Error ? err.message : String(err) })
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  if (status.state !== 'available' || !status.canAutoInstall || !latestZip) return status
  const asset = latestZip
  const version = status.version!
  const dir = join(app.getPath('userData'), 'updates')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const zipPath = join(dir, asset.name)
  setStatus({ state: 'downloading', progress: 0, error: undefined })
  try {
    const response = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'Outcisura-updater' } })
    if (!response.ok || !response.body) throw new Error(`Download failed (${response.status})`)
    const total = Number(response.headers.get('content-length')) || asset.size
    const hash = createHash('sha256')
    const out = createWriteStream(zipPath)
    let received = 0
    let lastReport = 0
    const reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      hash.update(value)
      if (!out.write(value)) await new Promise<void>((resolve) => out.once('drain', () => resolve()))
      received += value.length
      const now = Date.now()
      if (total && now - lastReport > 120) {
        lastReport = now
        setStatus({ progress: Math.min(1, received / total) })
      }
    }
    await new Promise<void>((resolve, reject) => {
      out.end((err?: Error | null) => (err ? reject(err) : resolve()))
    })
    const expected = asset.digest?.startsWith('sha256:') ? asset.digest.slice(7) : null
    if (expected && hash.digest('hex') !== expected) throw new Error('The download was corrupted — try again.')

    const unpackDir = join(dir, 'unpacked')
    mkdirSync(unpackDir)
    await run('/usr/bin/ditto', ['-x', '-k', zipPath, unpackDir])
    const bundle = readdirSync(unpackDir).find((n) => n.endsWith('.app'))
    if (!bundle) throw new Error('The update package didn’t contain an app.')
    rmSync(zipPath, { force: true })
    pendingApp = { path: join(unpackDir, bundle), version }
    return setStatus({ state: 'ready', progress: 1 })
  } catch (err) {
    return setStatus({ state: 'error', error: err instanceof Error ? err.message : String(err), progress: undefined })
  }
}

/** POSIX shell run detached after we quit: wait for this process to exit, swap the bundle (keeping the
 *  old one until the new one is in place, restoring it if anything fails), clear any quarantine flag
 *  and relaunch. */
export function buildSwapScript(): string {
  return `#!/bin/sh
PID="$1"; NEW="$2"; TARGET="$3"
while kill -0 "$PID" 2>/dev/null; do sleep 0.3; done
BACKUP="$TARGET.previous"
rm -rf "$BACKUP"
if mv "$TARGET" "$BACKUP" && ditto "$NEW" "$TARGET"; then
  xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null
  rm -rf "$BACKUP"
else
  rm -rf "$TARGET"
  mv "$BACKUP" "$TARGET"
fi
rm -rf "$(dirname "$NEW")"
open "$TARGET"
`
}

export async function installUpdate(): Promise<void> {
  const bundle = currentAppBundle()
  if (status.state !== 'ready' || !pendingApp || !bundle) return
  const script = join(app.getPath('userData'), 'updates', 'swap.sh')
  writeFileSync(script, buildSwapScript(), { mode: 0o755 })
  const child = spawn('/bin/sh', [script, String(process.pid), pendingApp.path, bundle], { detached: true, stdio: 'ignore' })
  child.unref()
  app.quit()
}

/** Manual fallback when the app can't replace itself. */
export function openReleasePage(): void {
  void shell.openExternal(status.releaseUrl ?? RELEASES_URL)
}

/** Dev/debug: show what an update looks like without a real release. */
export function simulateUpdate(): UpdateStatus {
  latestZip = null
  return setStatus({ state: 'available', version: '9.9.9', releaseUrl: RELEASES_URL, canAutoInstall: false })
}

export function startUpdater(getWindow: () => BrowserWindow | null): void {
  windowGetter = getWindow
  status = { ...status, currentVersion: app.getVersion(), canAutoInstall: canReplaceSelf() }
  // Cleanup of a previous run's leftovers.
  const leftover = join(app.getPath('userData'), 'updates')
  if (existsSync(leftover)) rmSync(leftover, { recursive: true, force: true })
  // Only auto-check from a real install — a dev run would just compare against package.json.
  if (!app.isPackaged) return
  setTimeout(() => void checkForUpdates(), FIRST_CHECK_DELAY_MS)
  timer = setInterval(() => void checkForUpdates(), CHECK_EVERY_MS)
}

export function stopUpdater(): void {
  if (timer) clearInterval(timer)
}
