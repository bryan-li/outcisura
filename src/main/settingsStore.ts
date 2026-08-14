import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { ApiKeyStatus } from '../shared/types'

interface StoredSettings {
  apiKey: string | null
  openaiApiKey: string | null
}

let settingsPath: string | null = null

function getSettingsPath(): string {
  if (!settingsPath) {
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    settingsPath = join(dir, 'settings.json')
  }
  return settingsPath
}

function readStoredSettings(): Partial<StoredSettings> {
  try {
    return JSON.parse(readFileSync(getSettingsPath(), 'utf-8')) as Partial<StoredSettings>
  } catch {
    return {}
  }
}

/** Merges over whatever's already on disk — both keys share one file, so a naive overwrite here
 *  would wipe out the other key every time either one is saved. */
function writeStoredSettings(patch: Partial<StoredSettings>): void {
  const next = { ...readStoredSettings(), ...patch }
  writeFileSync(getSettingsPath(), JSON.stringify(next, null, 2), 'utf-8')
}

/** `undefined` means this key has never been explicitly set via Settings (no file, or the file
 *  predates this field) — distinct from `null`, an explicit clear. Only the `undefined` case falls
 *  back to .env; an explicit clear must actually disable the feature even if .env still has a key. */
function readStoredKey(field: keyof StoredSettings): string | null | undefined {
  const parsed = readStoredSettings()
  return field in parsed ? parsed[field] ?? null : undefined
}

/** A key saved via Settings always wins; otherwise falls back to ANTHROPIC_API_KEY from .env, so
 *  existing setups keep working without needing to re-enter anything in the UI. */
export function getApiKey(): string | null {
  const stored = readStoredKey('apiKey')
  return stored !== undefined ? stored : process.env.ANTHROPIC_API_KEY ?? null
}

export function setApiKey(apiKey: string | null): void {
  writeStoredSettings({ apiKey })
}

export function getApiKeyStatus(): ApiKeyStatus {
  return toStatus(getApiKey())
}

/** Same shape as the Anthropic key above, for the OpenAI Whisper transcription engine — falls back
 *  to OPENAI_API_KEY from .env the same way. */
export function getOpenAiApiKey(): string | null {
  const stored = readStoredKey('openaiApiKey')
  return stored !== undefined ? stored : process.env.OPENAI_API_KEY ?? null
}

export function setOpenAiApiKey(apiKey: string | null): void {
  writeStoredSettings({ openaiApiKey: apiKey })
}

export function getOpenAiApiKeyStatus(): ApiKeyStatus {
  return toStatus(getOpenAiApiKey())
}

function toStatus(key: string | null): ApiKeyStatus {
  return { hasKey: !!key, last4: key && key.length >= 4 ? key.slice(-4) : null }
}
