import { app, BrowserWindow, shell } from 'electron'
import { readFileSync } from 'fs'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { openDatabase } from './db/schema'
import { Repository } from './db/repository'
import { AiService } from './aiService'
import { OcrService } from './ocrService'
import { TranscriptionService } from './transcriptionService'
import { registerIpc } from './ipc/registerIpc'
import { registerVideoProtocolPrivileges, registerVideoProtocolHandler } from './videoProtocol'
import { getApiKey, getOpenAiApiKey } from './settingsStore'
import { IpcChannels } from '../shared/ipc'

/** Custom scheme for OS-level deep links back into the app — currently only the Google OAuth
 *  redirect (see authStore.ts's signInWithGoogle) uses this, since Electron can't complete
 *  Google's consent flow inside an embedded webview and has to hand off to the system browser.
 *  Registered here rather than left for a later feature because both the OAuth callback and the
 *  live-session join deep link need the exact same protocol-handler plumbing — see the "Google
 *  sign-in" Notion task's own note on why these should share it. */
const DEEP_LINK_PROTOCOL = 'outcisura'

// Electron's docs recommend this exact process.defaultApp branch for dev (unpackaged, launched via
// `electron .`) — without the explicit execPath/argv, the OS would try to reopen via `electron`
// itself rather than this specific project, and registration would silently fail to round-trip.
if (process.defaultApp) {
  if (process.argv.length >= 2) app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL, process.execPath, [join(__dirname, process.argv[1])])
} else {
  app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL)
}

// Windows/Linux hand a outcisura://... link to a NEW process launch (its argv), not an event on
// the running one — the single-instance lock redirects that second launch's argv back to the
// first (already-running) instance via 'second-instance' below, then the second process exits.
// macOS instead fires 'open-url' directly on the running instance; requestSingleInstanceLock is a
// harmless no-op there, so this stays one code path across platforms rather than branching on OS.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

// Pinned to the app's original internal name, independent of package.json's "name"/"productName"
// (branded as "Outcisura" — see index.html/Sidebar) — app.getPath('userData') derives from
// app.name, and letting that drift with a rebrand would silently point the database at a brand
// new, empty folder, orphaning every existing card.
app.setName('flashcard-app')

// Electron requires privileged scheme registration before app.whenReady() — can't be deferred
// alongside the actual handler registration below.
registerVideoProtocolPrivileges()

/** Loads simple KEY=value lines from .env into process.env, without pulling in the `dotenv` dependency. */
function loadDotEnv(path: string): void {
  let contents: string
  try {
    contents = readFileSync(path, 'utf-8')
  } catch {
    return
  }
  for (const line of contents.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!(key in process.env)) process.env[key] = value
  }
}

loadDotEnv(join(app.getAppPath(), '.env'))

let mainWindow: BrowserWindow | null = null
// A deep link can arrive before the renderer has a listener attached (cold start via a
// outcisura://... link, or 'open-url' firing before app.whenReady() on macOS) — stashed here and
// flushed once the window finishes its first load, rather than dropped.
let pendingDeepLink: string | null = null

function handleDeepLink(url: string): void {
  if (!url.startsWith(`${DEEP_LINK_PROTOCOL}://`)) return
  if (mainWindow) {
    mainWindow.webContents.send(IpcChannels.authDeepLink, url)
    mainWindow.show()
    mainWindow.focus()
  } else {
    pendingDeepLink = url
  }
}

app.on('second-instance', (_event, argv) => {
  const url = argv.find((arg) => arg.startsWith(`${DEEP_LINK_PROTOCOL}://`))
  if (url) handleDeepLink(url)
})

app.on('open-url', (event, url) => {
  event.preventDefault()
  handleDeepLink(url)
})

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })
  mainWindow = win

  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  win.webContents.once('did-finish-load', () => {
    if (pendingDeepLink) {
      handleDeepLink(pendingDeepLink)
      pendingDeepLink = null
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  const dbPath = join(app.getPath('userData'), 'flashcards.db')
  const db = openDatabase(dbPath)
  const repo = new Repository(db)

  // Settings-saved key wins over .env, falls back to it otherwise (see settingsStore). Both
  // services are always constructed — like OcrService already was — and expose setApiKey so the
  // Settings view can update them live, with no restart, when the user saves/clears a key there.
  const apiKey = getApiKey()
  const ai = new AiService(apiKey, repo)
  if (!apiKey) {
    console.warn('No Anthropic API key set — AI regenerate and Claude Vision OCR will be unavailable until one is added in Settings.')
  }
  const ocr = new OcrService(apiKey)
  // Same shape again: the local Whisper engine needs no key, only the OpenAI engine does.
  const transcription = new TranscriptionService(getOpenAiApiKey())

  registerIpc(repo, ai, ocr, transcription)
  registerVideoProtocolHandler()

  createWindow()

  // Windows/Linux cold start directly via a outcisura://... link (no other instance was running
  // to catch it via 'second-instance') — the link is just this fresh process's own argv.
  const coldStartUrl = process.argv.find((arg) => arg.startsWith(`${DEEP_LINK_PROTOCOL}://`))
  if (coldStartUrl) handleDeepLink(coldStartUrl)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
