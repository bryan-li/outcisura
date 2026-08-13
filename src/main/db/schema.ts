import Database from 'better-sqlite3'

const MIGRATIONS: string[] = [
  `
  CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('pdf', 'pptx')),
    imported_at TEXT NOT NULL,
    page_count INTEGER NOT NULL
  );

  CREATE TABLE pages (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page_index INTEGER NOT NULL,
    width REAL NOT NULL,
    height REAL NOT NULL,
    background_image_path TEXT
  );
  CREATE INDEX idx_pages_document ON pages(document_id);

  CREATE TABLE elements (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('text', 'image')),
    x REAL NOT NULL,
    y REAL NOT NULL,
    w REAL NOT NULL,
    h REAL NOT NULL,
    text TEXT,
    image_path TEXT
  );
  CREATE INDEX idx_elements_page ON elements(page_id);

  CREATE TABLE cards (
    id TEXT PRIMARY KEY,
    front TEXT NOT NULL,
    back TEXT NOT NULL,
    card_type TEXT NOT NULL CHECK (card_type IN ('basic', 'image_occlusion')),
    ai_generated INTEGER NOT NULL DEFAULT 0,
    prev_front TEXT,
    prev_back TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE card_sources (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    element_id TEXT REFERENCES elements(id) ON DELETE SET NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    w REAL NOT NULL,
    h REAL NOT NULL,
    label TEXT NOT NULL
  );
  CREATE INDEX idx_card_sources_card ON card_sources(card_id);
  CREATE INDEX idx_card_sources_page ON card_sources(page_id);
  `,
  `
  -- A source's image no longer has to be a parsed page element: a screenshot-cropped region
  -- (image occlusion made from an arbitrary drag selection, not a detected image) carries its own
  -- saved file directly, independent of element_id.
  ALTER TABLE card_sources ADD COLUMN image_path TEXT;
  `,
  `
  -- User-created, renamable groups for organizing cards beyond the default by-source grouping.
  -- A card with no folder falls back to being grouped by its source document in the UI.
  CREATE TABLE folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  ALTER TABLE cards ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
  `,
  `
  -- Nesting (parent_id, self-referential — deleting a folder cascades to its subfolders, whose
  -- cards then fall back to unfiled via cards.folder_id's own ON DELETE SET NULL), manual drag
  -- ordering among siblings (sort_order), and persisted expand/collapse state for the sidebar tree.
  ALTER TABLE folders ADD COLUMN parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE;
  ALTER TABLE folders ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE folders ADD COLUMN collapsed INTEGER NOT NULL DEFAULT 0;
  `,
  `
  -- Manual drag ordering for cards, scoped by whatever list a view renders (a folder's own cards,
  -- or a by-source group) — comparisons only ever happen within one such filtered subset, so a
  -- single global column is enough. Backfilled by creation order so existing decks don't reshuffle.
  ALTER TABLE cards ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
  UPDATE cards SET sort_order = (
    SELECT COUNT(*) FROM cards c2
    WHERE c2.created_at < cards.created_at OR (c2.created_at = cards.created_at AND c2.id < cards.id)
  );
  `,
  `
  -- Spaced-repetition scheduling (SM-2 style, see shared/srs.ts). due_at defaults to '' as a
  -- backfill sentinel (not datetime('now'), which would freeze at migration time) — existing rows
  -- backfill to created_at below, and createCard sets it explicitly on every new insert.
  ALTER TABLE cards ADD COLUMN due_at TEXT NOT NULL DEFAULT '';
  ALTER TABLE cards ADD COLUMN interval_days REAL NOT NULL DEFAULT 0;
  ALTER TABLE cards ADD COLUMN ease_factor REAL NOT NULL DEFAULT 2.5;
  ALTER TABLE cards ADD COLUMN repetitions INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE cards ADD COLUMN lapses INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE cards ADD COLUMN last_reviewed_at TEXT;
  UPDATE cards SET due_at = created_at WHERE due_at = '';
  `,
  `
  -- One row per review grade, purely for dashboard stats (reviewed-today, streak) — cards' own
  -- SRS fields only ever hold each card's LATEST state, so they can't answer "how many times was
  -- anything graded today" once a card's last grade overwrites an earlier one.
  CREATE TABLE review_log (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    grade TEXT NOT NULL,
    reviewed_at TEXT NOT NULL
  );
  CREATE INDEX idx_review_log_reviewed_at ON review_log(reviewed_at);
  `,
  `
  -- Each mask's own position, as a fraction (0-1) of the source image's natural width/height —
  -- deliberately NOT page-space (like card_sources' own bbox) so rendering a masked preview never
  -- needs to know the image's pixel dimensions, just percentage-position a div over the <img>.
  -- NULL for existing occlusion cards (made before this migration) and for non-occlusion sources —
  -- both render unmasked, which is the correct fallback, not a bug.
  ALTER TABLE card_sources ADD COLUMN mask_x REAL;
  ALTER TABLE card_sources ADD COLUMN mask_y REAL;
  ALTER TABLE card_sources ADD COLUMN mask_w REAL;
  ALTER TABLE card_sources ADD COLUMN mask_h REAL;
  `,
  `
  -- Widen documents.type to allow 'video'. SQLite can't ALTER a CHECK constraint in place, so this
  -- rebuilds the table — see the FK_OFF_MIGRATIONS handling in migrate() below. source_video_path/
  -- duration_seconds are video-only and NULL for existing pdf/pptx rows.
  CREATE TABLE documents_new (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('pdf', 'pptx', 'video')),
    imported_at TEXT NOT NULL,
    page_count INTEGER NOT NULL,
    source_video_path TEXT,
    duration_seconds REAL
  );
  INSERT INTO documents_new SELECT id, filename, type, imported_at, page_count, NULL, NULL FROM documents;
  DROP TABLE documents;
  ALTER TABLE documents_new RENAME TO documents;

  -- Which video-moment a captured frame belongs to. NULL for ordinary pdf/pptx pages.
  ALTER TABLE pages ADD COLUMN timestamp_seconds REAL;
  `,
  `
  -- Widen cards.card_type to allow 'cloze' (see renderer/src/utils/cloze.ts). SQLite can't ALTER a CHECK
  -- constraint in place, so this rebuilds the table the same way migration 8 widened documents.type
  -- — see the FK_OFF_MIGRATIONS handling below (card_sources cascades off cards.id, so a plain
  -- DROP TABLE here would silently delete every card's sources without it).
  CREATE TABLE cards_new (
    id TEXT PRIMARY KEY,
    front TEXT NOT NULL,
    back TEXT NOT NULL,
    card_type TEXT NOT NULL CHECK (card_type IN ('basic', 'image_occlusion', 'cloze')),
    ai_generated INTEGER NOT NULL DEFAULT 0,
    prev_front TEXT,
    prev_back TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    due_at TEXT NOT NULL DEFAULT '',
    interval_days REAL NOT NULL DEFAULT 0,
    ease_factor REAL NOT NULL DEFAULT 2.5,
    repetitions INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    last_reviewed_at TEXT
  );
  INSERT INTO cards_new SELECT
    id, front, back, card_type, ai_generated, prev_front, prev_back, created_at, updated_at,
    folder_id, sort_order, due_at, interval_days, ease_factor, repetitions, lapses, last_reviewed_at
  FROM cards;
  DROP TABLE cards;
  ALTER TABLE cards_new RENAME TO cards;
  `,
  `
  -- Where you left off — page index for pdf/pptx, playback position for video. Both NULL until a
  -- document is actually opened/played past the start; NULL means "open at the beginning," not 0,
  -- since 0 is itself a meaningful page index.
  ALTER TABLE documents ADD COLUMN last_page_index INTEGER;
  ALTER TABLE documents ADD COLUMN last_playback_seconds REAL;
  `
]

// Migration indices that rebuild a table other tables hold live foreign keys into (via DROP TABLE
// + RENAME, since SQLite can't ALTER a CHECK constraint in place). Under `foreign_keys = ON` (set
// in openDatabase below), dropping a table that's referenced by ON DELETE CASCADE children
// silently cascade-deletes those children — confirmed empirically, not a hypothetical. These
// migrations run outside the standard per-migration transaction, with foreign_keys explicitly
// toggled off for the rebuild and a foreign_key_check gate before commit. Do NOT "simplify" one of
// these back into the normal transaction loop below — PRAGMA foreign_keys is also a silent no-op
// when set inside an already-open transaction, so that mistake would reintroduce the cascade-delete
// data loss with no error raised anywhere.
const FK_OFF_MIGRATIONS = new Set([8, 9])

export function openDatabase(filePath: string): Database.Database {
  const db = new Database(filePath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)`)
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(
      (r) => r.version
    )
  )

  for (let version = 0; version < MIGRATIONS.length; version++) {
    if (applied.has(version)) continue
    if (FK_OFF_MIGRATIONS.has(version)) {
      runFkOffMigration(db, version)
      continue
    }
    const run = db.transaction(() => {
      db.exec(MIGRATIONS[version])
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version)
    })
    run()
  }
}

function runFkOffMigration(db: Database.Database, version: number): void {
  db.pragma('foreign_keys = OFF')
  try {
    const run = db.transaction(() => {
      db.exec(MIGRATIONS[version])
      const violations = db.pragma('foreign_key_check') as unknown[]
      if (violations.length > 0) {
        throw new Error(`Migration ${version} left FK violations: ${JSON.stringify(violations)}`)
      }
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version)
    })
    run()
  } finally {
    db.pragma('foreign_keys = ON')
  }
}
