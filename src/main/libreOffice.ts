import { execFile, execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { app, BrowserWindow } from 'electron'
import { IpcChannels } from '../shared/ipc'
import type { LibreOfficeStatus } from '../shared/types'

const run = promisify(execFile)

/**
 * PPTX import needs headless LibreOffice to convert to PDF (see pptxConverter.ts) — the one piece
 * of this app that isn't in the box. Bundling it would add ~800MB to a 230MB download for a
 * dependency only PPTX users need, and would mean re-signing hundreds of third-party binaries
 * inside our own ad-hoc-signed bundle (see build/afterSign.cjs for how fragile that already is).
 *
 * So it's fetched on demand instead, the first time someone actually imports a .pptx, into
 * userData — outside the app bundle, never re-signed, keeping The Document Foundation's own
 * signature intact. A file Node downloads itself never picks up the quarantine flag a browser
 * download would, so the copied bundle runs without a Gatekeeper prompt (same reasoning as
 * updater.ts's self-replace).
 *
 * Anyone who already has LibreOffice installed system-wide pays none of this — that copy is found
 * first and used as-is.
 */

/** Pinned rather than "whatever is latest": the checksum below only means anything against a known
 *  build, and a surprise major version is not something to discover mid-import. Sourced from the
 *  download archive rather than the `stable/` tree, because `stable/` only carries the current
 *  release — a pinned URL there starts 404ing the moment the line moves on, while the archive keeps
 *  every release permanently. */
const PINNED_VERSION = '26.2.6.2'

interface Build {
  url: string
  /** Published alongside the download as .../<file>.sha256. */
  sha256: string
  bytes: number
}

/** Only the platform/arch combinations we ship and can verify. Everything else falls back to the
 *  manual-install message — better than downloading something unverified. */
const BUILDS: Record<string, Build | undefined> = {
  'darwin-arm64': {
    url: `https://downloadarchive.documentfoundation.org/libreoffice/old/${PINNED_VERSION}/mac/aarch64/LibreOffice_${PINNED_VERSION}_MacOS_aarch64.dmg`,
    sha256: 'f8d37fca7b7cda5898f77845d599d7820832dcb6614786d8c558367a5633bf96',
    bytes: 297825210
  }
}

export const LIBREOFFICE_MISSING_MESSAGE =
  'LibreOffice is needed to import PPTX files. Install it from https://www.libreoffice.org/download/ (or `brew install --cask libreoffice` on macOS).'

/** Common system install locations, tried in order, in case `soffice` isn't on PATH. */
const SYSTEM_CANDIDATES = [
  'soffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/usr/bin/soffice',
  '/usr/local/bin/soffice',
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe'
]

function managedDir(): string {
  return join(app.getPath('userData'), 'libreoffice')
}

/** Where our own copy lives once installed — checked last, so a system LibreOffice always wins. */
function managedSofficePath(): string {
  if (process.platform === 'darwin') return join(managedDir(), 'LibreOffice.app', 'Contents', 'MacOS', 'soffice')
  return join(managedDir(), 'program', process.platform === 'win32' ? 'soffice.exe' : 'soffice')
}

function buildForThisMachine(): Build | undefined {
  return BUILDS[`${process.platform}-${process.arch}`]
}

/** Resolves a bare command name through PATH without running it — spawning soffice would also tell
 *  us, but only by paying for a LibreOffice startup just to answer "is it there". Throws when the
 *  command isn't found, which is the normal "not installed" case, hence the swallowed catch. */
function onPath(command: string): string | null {
  try {
    const which = process.platform === 'win32' ? 'where' : 'which'
    const first = execFileSync(which, [command], { encoding: 'utf-8' }).split('\n')[0].trim()
    return first || null
  } catch {
    return null
  }
}

/** The soffice binary to use, or null when there isn't one yet. System install first, then ours. */
export function resolveSoffice(): string | null {
  for (const candidate of SYSTEM_CANDIDATES) {
    if (candidate.includes('/') || candidate.includes('\\')) {
      if (existsSync(candidate)) return candidate
    } else {
      const resolved = onPath(candidate)
      if (resolved) return resolved
    }
  }
  const managed = managedSofficePath()
  return existsSync(managed) ? managed : null
}

let status: LibreOfficeStatus = { state: 'missing', canAutoInstall: false }
let windowGetter: () => BrowserWindow | null = () => null
let inFlight: AbortController | null = null

export function setLibreOfficeWindowGetter(getter: () => BrowserWindow | null): void {
  windowGetter = getter
}

function setStatus(patch: Partial<LibreOfficeStatus>): LibreOfficeStatus {
  status = { ...status, ...patch }
  windowGetter()?.webContents.send(IpcChannels.libreOfficeStatus, status)
  return status
}

export function getLibreOfficeStatus(): LibreOfficeStatus {
  // Re-resolved on every read rather than cached at startup: the user may have installed
  // LibreOffice themselves since the app launched, and that shouldn't need a restart to notice.
  if (status.state !== 'downloading' && status.state !== 'extracting') {
    const found = resolveSoffice()
    const build = buildForThisMachine()
    status = {
      ...status,
      state: found ? 'installed' : 'missing',
      path: found ?? undefined,
      canAutoInstall: !!build,
      downloadBytes: build?.bytes,
      error: found ? undefined : status.error
    }
  }
  return status
}

export function cancelLibreOfficeInstall(): LibreOfficeStatus {
  inFlight?.abort()
  inFlight = null
  return setStatus({ state: 'missing', progress: undefined, error: undefined })
}

/**
 * Downloads the pinned build, verifies it against the published checksum, and installs it under
 * userData. Resolves to the final status either way — a failure is reported as state 'error'
 * rather than thrown, since the caller is a UI prompt, not a code path that can recover.
 */
export async function installLibreOffice(): Promise<LibreOfficeStatus> {
  if (status.state === 'downloading' || status.state === 'extracting') return status
  const existing = resolveSoffice()
  if (existing) return setStatus({ state: 'installed', path: existing, progress: undefined, error: undefined })

  const build = buildForThisMachine()
  if (!build) return setStatus({ state: 'error', error: LIBREOFFICE_MISSING_MESSAGE, canAutoInstall: false })

  const dir = managedDir()
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const archivePath = join(dir, 'libreoffice-download')

  const controller = new AbortController()
  inFlight = controller
  setStatus({ state: 'downloading', progress: 0, error: undefined, downloadBytes: build.bytes })

  try {
    const response = await fetch(build.url, { signal: controller.signal, headers: { 'User-Agent': 'Outcisura' } })
    if (!response.ok || !response.body) throw new Error(`Download failed (${response.status})`)
    const total = Number(response.headers.get('content-length')) || build.bytes
    const hash = createHash('sha256')
    const out = createWriteStream(archivePath)
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

    if (hash.digest('hex') !== build.sha256) throw new Error('The download was corrupted — try again.')

    setStatus({ state: 'extracting', progress: 1 })
    await installFromArchive(archivePath, dir)
    rmSync(archivePath, { force: true })

    const soffice = resolveSoffice()
    if (!soffice) throw new Error('LibreOffice was downloaded but could not be found afterwards.')
    inFlight = null
    return setStatus({ state: 'installed', path: soffice, progress: undefined, error: undefined })
  } catch (err) {
    inFlight = null
    rmSync(dir, { recursive: true, force: true })
    // An abort is the user cancelling, not a failure worth showing as one.
    if (controller.signal.aborted) return setStatus({ state: 'missing', progress: undefined, error: undefined })
    return setStatus({ state: 'error', error: err instanceof Error ? err.message : String(err), progress: undefined })
  }
}

/** Mounts the .dmg read-only, copies the app bundle out, and unmounts — no installer, no admin
 *  rights, nothing touched outside userData. `ditto` rather than `cp -r` to preserve the bundle's
 *  symlinks and extended attributes, which its code signature is computed over. */
async function installFromArchive(archivePath: string, destDir: string): Promise<void> {
  if (process.platform !== 'darwin') throw new Error(LIBREOFFICE_MISSING_MESSAGE)
  const mountPoint = mkdtempSync(join(tmpdir(), 'outcisura-lo-'))
  try {
    await run('/usr/bin/hdiutil', ['attach', archivePath, '-nobrowse', '-readonly', '-mountpoint', mountPoint])
    const bundle = readdirSync(mountPoint).find((name) => name.endsWith('.app'))
    if (!bundle) throw new Error('The LibreOffice disk image didn’t contain an app.')
    await run('/usr/bin/ditto', [join(mountPoint, bundle), join(destDir, 'LibreOffice.app')])
  } finally {
    // Best-effort: a failed detach would otherwise mask the real error above, and the mount is
    // cleaned up on reboot regardless.
    await run('/usr/bin/hdiutil', ['detach', mountPoint, '-force']).catch(() => undefined)
    rmSync(mountPoint, { recursive: true, force: true })
  }
}
