-- Needed for the local-first bidirectional sync engine's last-write-wins comparison (folders had no
-- updated_at at all before this). Backfilled from created_at for existing rows; default now() so a
-- future insert that forgets to set it explicitly still gets a sane value — updates must still set
-- it explicitly, since Postgres doesn't auto-bump a column on UPDATE.
alter table folders add column updated_at timestamptz not null default now();
update folders set updated_at = created_at;
