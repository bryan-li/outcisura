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

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
