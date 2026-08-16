-- Phase 0 cloud-sync schema: cards, folders, and review_log move to Supabase; documents, pages,
-- elements, and transcript_segments deliberately stay local (local SQLite + local image files,
-- untouched) — the PDF/PPTX/video library and image storage aren't in scope for this pass, only
-- the actual study content (cards) and its review history. This keeps card_sources' document_id/
-- page_id/element_id as plain uuid columns, NOT foreign keys — those ids now point at rows that
-- live in a different, un-migrated local database, so there's nothing here to enforce a reference
-- against. They're carried purely for the existing "jump back to source" backlink feature, which
-- resolves them against local IPC exactly as it does today.
--
-- Two things that differ deliberately from the SQLite source, not oversights:
--   - CHECK constraints are plain Postgres CHECKs, not something that ever needs a table rebuild
--     to change — SQLite's FK_OFF_MIGRATIONS dance (schema.ts migrations 8, 9, 12) doesn't apply
--     here; a future card_type addition is a plain `ALTER TABLE ... DROP/ADD CONSTRAINT`.
--   - Timestamp and boolean columns use native `timestamptz`/`boolean` instead of SQLite's TEXT/
--     INTEGER stand-ins. supabase-js still hands these back as ISO strings / real booleans to the
--     client, so this is a server-side correctness upgrade, not a client-facing shape change
--     (aside from booleans arriving as true/false instead of 0/1 — no more `!!row.x` coercion
--     needed in the client-side shim).
--
-- IDs are NOT server-generated on insert as the primary mechanism — the client generates
-- crypto.randomUUID() itself (see src/main/db/repository.ts's existing use of randomUUID(), which
-- this preserves) so the ID is known immediately for optimistic local state updates, no round trip
-- required. `default gen_random_uuid()` is kept only as a safety net for the case a caller forgets.
--
-- user_id defaults to auth.uid() so the client doesn't need to set it explicitly on every insert;
-- RLS's `with check` still enforces it server-side regardless of what a client sends, so this is
-- not a trust-the-client shortcut.

create table folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null,
  created_at timestamptz not null,
  parent_id uuid references folders(id) on delete cascade,
  sort_order integer not null default 0,
  collapsed boolean not null default false
);
create index idx_folders_user on folders(user_id);
create index idx_folders_parent on folders(parent_id);

create table cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  front text not null,
  back text not null,
  card_type text not null check (card_type in ('basic', 'image_occlusion', 'cloze', 'picture')),
  ai_generated boolean not null default false,
  prev_front text,
  prev_back text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  folder_id uuid references folders(id) on delete set null,
  sort_order integer not null default 0,
  due_at timestamptz,
  interval_days double precision not null default 0,
  ease_factor double precision not null default 2.5,
  repetitions integer not null default 0,
  lapses integer not null default 0,
  last_reviewed_at timestamptz,
  reveal_image_on_flip boolean not null default false
);
create index idx_cards_user on cards(user_id);
create index idx_cards_folder on cards(folder_id);

-- document_id/page_id/element_id/image_path all refer to LOCAL entities (see file header) — plain
-- uuid/text, no foreign key. element_id and image_path stay nullable exactly as in the SQLite
-- source; document_id/page_id stay not-null since every source is created from some local page.
create table card_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  card_id uuid not null references cards(id) on delete cascade,
  document_id uuid not null,
  page_id uuid not null,
  element_id uuid,
  x double precision not null,
  y double precision not null,
  w double precision not null,
  h double precision not null,
  label text not null,
  image_path text,
  mask_x double precision,
  mask_y double precision,
  mask_w double precision,
  mask_h double precision,
  image_face text check (image_face is null or image_face in ('front', 'back'))
);
create index idx_card_sources_card on card_sources(card_id);
create index idx_card_sources_user on card_sources(user_id);

create table review_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  card_id uuid not null references cards(id) on delete cascade,
  grade text not null,
  reviewed_at timestamptz not null
);
create index idx_review_log_reviewed_at on review_log(reviewed_at);
create index idx_review_log_user on review_log(user_id);

-- Row-level security: every table's only access rule. Once the anon key ships in the built app,
-- this — not key secrecy — is what stops one user reading another's flashcards. `with check`
-- applies to insert/update, `using` to select/update/delete; setting both to the same expression
-- on every table means a client can never read, write, or reassign a row it doesn't own, even if
-- it tries to set a different user_id explicitly.
do $$
declare
  t text;
begin
  for t in select unnest(array['folders', 'cards', 'card_sources', 'review_log'])
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for all using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t || '_owner_only', t
    );
  end loop;
end $$;
