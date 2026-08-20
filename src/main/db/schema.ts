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
  `,
  `
  -- One row per already-transcribed [start,end) range on a video, per engine — lets a new range
  -- request reuse whatever's already been transcribed instead of re-running Whisper over audio it's
  -- already seen, while keeping engines tracked separately (switching engines gets no free reuse,
  -- by design — see repository.ts's getTranscriptCoverage).
  CREATE TABLE transcript_segments (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    engine TEXT NOT NULL CHECK (engine IN ('whisper-local', 'openai-whisper')),
    start_seconds REAL NOT NULL,
    end_seconds REAL NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_transcript_segments_document_engine ON transcript_segments(document_id, engine);
  `,
  `
  -- Widen cards.card_type to allow 'picture' (front shows an image + a question, back reveals the
  -- answer — distinct from image_occlusion, which masks a REGION of an image rather than hiding the
  -- whole thing). Also adds reveal_image_on_flip so a picture card's image can optionally stay
  -- hidden until flipped instead of showing on both faces like every other image-bearing card type
  -- (the default for everything else, including image_occlusion's own unmasked areas). SQLite can't
  -- ALTER a CHECK constraint in place, so this rebuilds the table the same way migrations 8/9 did —
  -- see the FK_OFF_MIGRATIONS handling below.
  CREATE TABLE cards_new (
    id TEXT PRIMARY KEY,
    front TEXT NOT NULL,
    back TEXT NOT NULL,
    card_type TEXT NOT NULL CHECK (card_type IN ('basic', 'image_occlusion', 'cloze', 'picture')),
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
    last_reviewed_at TEXT,
    reveal_image_on_flip INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO cards_new SELECT
    id, front, back, card_type, ai_generated, prev_front, prev_back, created_at, updated_at,
    folder_id, sort_order, due_at, interval_days, ease_factor, repetitions, lapses, last_reviewed_at, 0
  FROM cards;
  DROP TABLE cards;
  ALTER TABLE cards_new RENAME TO cards;
  `,
  `
  -- The end of a transcribed [start,end) range, alongside pages.timestamp_seconds (its start) — a
  -- transcript-range card's backlink can then highlight the whole span it came from on the
  -- timeline, not just flash a single point. NULL for every other kind of page (ordinary pdf/pptx
  -- pages, and single-frame OCR/region-select video captures, none of which have a range). A plain
  -- additive column, not a CHECK constraint, so no table rebuild needed here.
  ALTER TABLE pages ADD COLUMN timestamp_end_seconds REAL;
  `,
  `
  -- Which side of the card an image source belongs to — lets a card assembled via the multi-image
  -- "Create Flashcard" modal carry several images on its front and several (possibly different) on
  -- its back. NULL for every other kind of source (occlusion crops, parsed-element sources, a
  -- single picture-card image), which have no "which face" concept — the CHECK explicitly allows
  -- NULL so it validates cleanly against every existing row. A plain additive column, not a
  -- constraint change on an existing column, so no FK_OFF table rebuild needed here.
  ALTER TABLE card_sources ADD COLUMN image_face TEXT CHECK (image_face IS NULL OR image_face IN ('front', 'back'));
  `,
  `
  -- Tags a migrated record with where it came from, so switching data-storage mode back and forth
  -- doesn't recreate it as a duplicate every time — see dataMigration.ts's dedup logic. NULL means
  -- native to whichever backend the row currently lives in (never migrated). Plain additive columns,
  -- no CHECK constraint, no FK_OFF table-rebuild needed.
  ALTER TABLE cards ADD COLUMN origin_backend TEXT;
  ALTER TABLE cards ADD COLUMN origin_id TEXT;
  ALTER TABLE folders ADD COLUMN origin_backend TEXT;
  ALTER TABLE folders ADD COLUMN origin_id TEXT;
  `,
  `
  -- Local-first bidirectional cloud sync (see renderer/src/lib/syncEngine.ts). sync_ops is the
  -- operation log that replaces the old localStorage-backed outbox — colocated in the same
  -- transaction as the mutation it tracks (see repository.ts), so the log and the actual data can
  -- never drift apart the way a separate storage engine (localStorage) could. id is
  -- AUTOINCREMENT, not created_at, because it's the replay-order key: a card and its card_sources
  -- rows are created in the same millisecond by one transaction, so string-timestamp ordering
  -- isn't reliable and pushing sources before their parent card would fail Supabase's FK
  -- constraint. sync_meta holds small engine state as key/value (bootstrap-complete flag,
  -- review_log pull watermark) instead of one-off columns scattered elsewhere.
  CREATE TABLE sync_ops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT NOT NULL,
    op TEXT NOT NULL CHECK (op IN ('insert', 'update', 'delete')),
    record_id TEXT NOT NULL,
    payload TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE sync_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  -- folders had no updated_at at all — needed for the sync engine's last-write-wins comparison
  -- against Supabase's copy. Backfilled from created_at for existing rows.
  ALTER TABLE folders ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
  UPDATE folders SET updated_at = created_at WHERE updated_at = '';
  `,
  `
  -- Missing-source detection + replace (see repository.ts's applyRemoteCardUpsert/
  -- replaceOrphanedSource). document_id/page_id can no longer be NOT NULL: a standalone-uploaded
  -- replacement image has no real document/page to point at. SQLite can't drop NOT NULL in place,
  -- so this rebuilds the table — but unlike the cards/documents rebuilds above, card_sources has
  -- no INCOMING foreign keys from any other table (nothing references card_sources.id), so this
  -- doesn't need the heavier FK_OFF_MIGRATIONS/foreign_keys=OFF dance; a plain transaction-wrapped
  -- rebuild is safe. Does need its own two indices recreated explicitly, though — DROP TABLE drops
  -- them with it, and unlike the cards/documents rebuilds (which have no indices of their own to
  -- lose), missing this here would silently fall back to full table scans with no error anywhere.
  --
  -- source_document_filename/source_page_index are new: a denormalized snapshot of
  -- documents.filename/pages.pageIndex, captured once at creation time (or backfilled here via
  -- LEFT JOIN for existing rows) and never re-derived. Without this, a source that turns out to be
  -- unresolvable on another device carries zero human-readable context — the real document/page
  -- never syncs, so this snapshot is the only thing left to show the user.
  CREATE TABLE card_sources_new (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    page_id TEXT REFERENCES pages(id) ON DELETE CASCADE,
    element_id TEXT REFERENCES elements(id) ON DELETE SET NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    w REAL NOT NULL,
    h REAL NOT NULL,
    label TEXT NOT NULL,
    image_path TEXT,
    mask_x REAL,
    mask_y REAL,
    mask_w REAL,
    mask_h REAL,
    image_face TEXT CHECK (image_face IS NULL OR image_face IN ('front', 'back')),
    source_document_filename TEXT,
    source_page_index INTEGER
  );
  INSERT INTO card_sources_new (
    id, card_id, document_id, page_id, element_id, x, y, w, h, label, image_path,
    mask_x, mask_y, mask_w, mask_h, image_face, source_document_filename, source_page_index
  )
  SELECT
    cs.id, cs.card_id, cs.document_id, cs.page_id, cs.element_id, cs.x, cs.y, cs.w, cs.h, cs.label,
    cs.image_path, cs.mask_x, cs.mask_y, cs.mask_w, cs.mask_h, cs.image_face, d.filename, p.page_index
  FROM card_sources cs
  LEFT JOIN documents d ON d.id = cs.document_id
  LEFT JOIN pages p ON p.id = cs.page_id;
  DROP TABLE card_sources;
  ALTER TABLE card_sources_new RENAME TO card_sources;
  CREATE INDEX idx_card_sources_card ON card_sources(card_id);
  CREATE INDEX idx_card_sources_page ON card_sources(page_id);

  -- What's broken on THIS device, per source — never synced (each device discovers its own gaps
  -- independently). Keyed by the dangling source's own id (not a fresh one) so re-detecting the
  -- same still-broken source on a later pull is a harmless no-op (see the INSERT OR IGNORE this is
  -- paired with in repository.ts), not a duplicate. resolved_at (not row deletion) tracks a fix —
  -- the origin device's own dangling card_sources row is never edited or removed, so without this
  -- a "fixed" orphan would silently reappear the next time that card updates anywhere.
  CREATE TABLE orphaned_sources (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    reason TEXT NOT NULL CHECK (reason IN ('unresolved_document', 'missing_file')),
    document_id TEXT,
    page_id TEXT,
    element_id TEXT,
    x REAL NOT NULL,
    y REAL NOT NULL,
    w REAL NOT NULL,
    h REAL NOT NULL,
    label TEXT NOT NULL,
    image_path TEXT,
    mask_x REAL,
    mask_y REAL,
    mask_w REAL,
    mask_h REAL,
    image_face TEXT,
    source_document_filename TEXT,
    source_page_index INTEGER,
    detected_at TEXT NOT NULL,
    resolved_at TEXT
  );
  CREATE INDEX idx_orphaned_sources_card ON orphaned_sources(card_id);
  `,
  `
  -- Denormalized snapshot of a video source's captured moment (pages.timestamp_seconds), alongside
  -- the existing source_document_filename/source_page_index snapshot. page_index alone means "page
  -- N of the file" for pdf/pptx — deterministic no matter which device parsed it — but for a video
  -- document it's only ever "however many frames had been captured on THAT device before this one"
  -- (see createVideoFramePage's plain COUNT(*)), which carries no meaning anywhere else. Recapturing
  -- a video-sourced orphan needs the actual moment in the video, not a meaningless capture-order
  -- counter — and since the original page/document never sync, this snapshot is the only place that
  -- moment survives. Plain additive columns, not a CHECK/NOT NULL change, so no table rebuild needed.
  ALTER TABLE card_sources ADD COLUMN source_timestamp_seconds REAL;
  ALTER TABLE orphaned_sources ADD COLUMN source_timestamp_seconds REAL;

  -- Backfill for existing rows whose page still resolves locally (same pattern as migration 12's
  -- source_document_filename/source_page_index backfill). orphaned_sources gets no equivalent
  -- backfill — an orphan's page never resolves locally by definition, that's what makes it an orphan.
  UPDATE card_sources
  SET source_timestamp_seconds = (SELECT timestamp_seconds FROM pages WHERE pages.id = card_sources.page_id)
  WHERE page_id IS NOT NULL;
  `,
  `
  -- Folders for imported documents (Library sidebar), mirroring the folders table cards already
  -- have (same shape: nesting via parent_id, manual sort_order, persisted collapsed state) — but a
  -- deliberately SEPARATE table, not a document_id column added onto the existing folders table.
  -- folders syncs to Supabase (cards need it to); documents never do and never will (see the
  -- Phase 0 scope revision documented in supabase/migrations/0001_init.sql's own header). Reusing
  -- one synced table for both would mean a document folder syncs to another device while the
  -- documents inside it don't — an empty "ghost" folder there with no way to know it's supposed to
  -- hold local files that device doesn't have. A same-shaped but separate, never-synced table keeps
  -- documents and their folders on the same side of the local/cloud boundary.
  CREATE TABLE document_folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    parent_id TEXT REFERENCES document_folders(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    collapsed INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_document_folders_parent ON document_folders(parent_id);

  ALTER TABLE documents ADD COLUMN folder_id TEXT REFERENCES document_folders(id) ON DELETE SET NULL;
  `,
  `
  -- One row per completed review session (start to finish), for a "how long did I actually study"
  -- stat — review_log only ever logged individual grade *events*, with no notion of the session
  -- they happened within. Local-only, like document_folders: this is a personal habit-tracking
  -- stat, not something that needs cross-device aggregation, so it doesn't need the sync_ops
  -- plumbing review_log itself has.
  CREATE TABLE review_sessions (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    duration_seconds REAL NOT NULL,
    cards_reviewed INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_review_sessions_started ON review_sessions(started_at);
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
const FK_OFF_MIGRATIONS = new Set([8, 9, 12])

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
