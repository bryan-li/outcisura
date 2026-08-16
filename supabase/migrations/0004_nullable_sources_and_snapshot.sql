-- Missing-source detection + replace (see repository.ts's applyRemoteCardUpsert/
-- replaceOrphanedSource). document_id/page_id can no longer be not null: a standalone-uploaded
-- replacement image has no real document/page to point at (see the matching SQLite migration,
-- which relaxes the same columns via a table rebuild since SQLite can't drop NOT NULL in place).
-- Postgres supports this natively, no rebuild needed — the exact simplification 0001_init.sql's
-- own header comment already called out for constraint changes here.
alter table card_sources alter column document_id drop not null;
alter table card_sources alter column page_id drop not null;

-- A denormalized snapshot of documents.filename/pages.pageIndex, captured once at source-creation
-- time and never re-derived — documents/pages themselves never sync (local-only, see 0001_init.sql's
-- own header), so without this a source that turns out unresolvable on another device carries zero
-- human-readable context to show the user.
alter table card_sources add column source_document_filename text;
alter table card_sources add column source_page_index integer;
