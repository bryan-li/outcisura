-- Hostable card decks: publicly-visible, premade folders (see the "Hostable card decks" plan for
-- full context). Cards inherit visibility through folder_id — no separate cards.is_public column;
-- "premade card decks" is inherently folder-scoped, and denormalizing onto every card would need a
-- trigger or app-level fan-out to stay in sync with its folder's flag for no correctness benefit.
alter table folders add column is_public boolean not null default false;
create index idx_folders_is_public on folders(is_public) where is_public;

-- 0001_init.sql gave folders/cards one `for all` policy each — the same USING/WITH CHECK expression
-- for every command. That collapses SELECT and write scope together, which no longer works: SELECT
-- needs to widen for public folders while INSERT/UPDATE/DELETE must stay strictly owner-only. Split
-- into per-command policies. Explicit `to authenticated` here (0001's original loop had none,
-- applying to PUBLIC by default) matches the more carefully-specified live_sessions-family tables.
drop policy if exists folders_owner_only on folders;
create policy folders_select on folders for select to authenticated
  using (user_id = auth.uid() or is_public = true);
create policy folders_insert on folders for insert to authenticated
  with check (user_id = auth.uid());
create policy folders_update on folders for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy folders_delete on folders for delete to authenticated
  using (user_id = auth.uid());

-- The subquery below queries a DIFFERENT table (folders, not cards) whose relevant rows
-- (is_public = true) are always from an already-committed prior transaction (a folder's flag is
-- toggled via its own separate UPDATE, never in the same transaction as a card SELECT) via a plain
-- subquery, not a SECURITY DEFINER function re-querying the same table being protected — none of the
-- three factors that broke live_sessions' self-referential SELECT policies (see
-- 0011_live_sessions_select_fix.sql's header) apply here. Verified live anyway, not just reasoned
-- through, given exactly this kind of reasoning looked sound for live_sessions too at first.
drop policy if exists cards_owner_only on cards;
create policy cards_select on cards for select to authenticated
  using (user_id = auth.uid() or folder_id in (select id from folders where is_public = true));
create policy cards_insert on cards for insert to authenticated
  with check (user_id = auth.uid());
create policy cards_update on cards for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy cards_delete on cards for delete to authenticated
  using (user_id = auth.uid());

-- card_sources/review_log are deliberately untouched (_owner_only, for all) — a public deck's cards
-- become readable once its folder is public, but source backlinks (meaningless cross-user anyway,
-- images/documents are local-only per Phase 0) and personal SRS review history are not part of "the
-- deck."
