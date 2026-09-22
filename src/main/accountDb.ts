import { app } from 'electron'
import type Database from 'better-sqlite3'
import { existsSync, mkdirSync, renameSync } from 'fs'
import { dirname, join } from 'path'
import { openDatabase } from './db/schema'
import type { Repository } from './db/repository'

/** Each signed-in account gets its own local SQLite file, so switching accounts on the same device
 *  never shows one account's cards, folders, or sync state to another — before this, every account
 *  shared the single `flashcards.db` this app always used.
 *
 *  `userId === null` covers being signed out and an anonymous guest session (see App.tsx — a guest
 *  never reaches a view that reads local data, so this is just "no real account's data should be
 *  reachable right now", not a real account of its own) — it points at its own small placeholder
 *  database under a fixed folder name rather than leaving whichever account was last active still
 *  open. */

const SIDECAR_SUFFIXES = ['-wal', '-shm', '-journal']
const SIGNED_OUT_FOLDER = '_signed-out'

function accountFolderName(userId: string | null): string {
  // A Supabase user id is already a plain UUID, but sanitised defensively rather than trusted verbatim
  // as a path segment.
  return userId ? userId.replace(/[^a-zA-Z0-9-]/g, '_') : SIGNED_OUT_FOLDER
}

/** Renames every file of a WAL-mode SQLite database (the main file plus whichever of -wal/-shm/
 *  -journal exist) in one go, so a mid-transaction database still migrates as a consistent whole. */
function moveDatabaseFiles(fromBase: string, toBase: string): void {
  mkdirSync(dirname(toBase), { recursive: true })
  for (const suffix of ['', ...SIDECAR_SUFFIXES]) {
    const from = fromBase + suffix
    if (existsSync(from)) renameSync(from, toBase + suffix)
  }
}

/** Resolves this account's own database file, migrating the old shared one into place first if this
 *  is the very first account on this device to need a per-account database at all. Moving (not
 *  copying) the legacy file makes that inherently one-time: once moved, `flashcards.db` is gone, so
 *  a second account can never also claim it — no separate "already migrated" marker needed. */
function openAccountDatabase(userId: string | null): Database.Database {
  const target = join(app.getPath('userData'), 'accounts', accountFolderName(userId), 'flashcards.db')
  if (!existsSync(target)) {
    mkdirSync(dirname(target), { recursive: true })
    const legacy = userId ? join(app.getPath('userData'), 'flashcards.db') : null
    if (legacy && existsSync(legacy)) moveDatabaseFiles(legacy, target)
  }
  return openDatabase(target)
}

/** Constructs the Repository the rest of main/index.ts wires up once, already pointed at the
 *  signed-out placeholder — real account data only becomes reachable once the renderer's auth store
 *  reports a real signed-in user via setActiveUser below. */
export function createInitialRepository(RepositoryClass: new (db: Database.Database) => Repository): Repository {
  return new RepositoryClass(openAccountDatabase(null))
}

let currentUserId: string | null = null

/** Called from the 'auth:setActiveUser' IPC handler every time the renderer's Supabase session
 *  changes (including on launch) — see authStore.ts's syncActiveUser, which awaits this (through the
 *  IPC round-trip) before it lets React render anything that would read local data, so a just-signed-
 *  in account's UI can never render a frame against the previous account's database. A no-op when
 *  the user hasn't actually changed, so Supabase's own periodic token refreshes don't reopen the
 *  database on every one. */
export function setActiveUser(repo: Repository, userId: string | null): void {
  if (userId === currentUserId) return
  currentUserId = userId
  repo.setDatabase(openAccountDatabase(userId))
}

/** Test-only: lets a standalone test script reset the module-level dedupe state between cases
 *  without spinning up a whole Electron process per case. */
export function _resetActiveUserForTests(): void {
  currentUserId = null
}
