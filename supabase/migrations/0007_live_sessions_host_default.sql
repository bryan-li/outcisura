-- Fix: three user-owned columns across the new live-session tables (0006) were missing
-- `default auth.uid()`, unlike every user-owned column elsewhere in this schema (0001_init.sql's
-- user_id, on every table). Caught by a real insert failing RLS: with no default and a client that
-- doesn't explicitly pass the column, it inserts NULL, and `<column> = auth.uid()` in the relevant
-- WITH CHECK evaluates to NULL (not true) rather than surfacing as a not-null violation — RLS is
-- checked first, so the error looks like a policy problem rather than the missing-default problem
-- it actually is. Fixing all three here (not just the one caught live) rather than waiting to hit
-- the same footgun again for the other two.
alter table live_sessions alter column host_id set default auth.uid();
alter table live_session_participants alter column user_id set default auth.uid();
alter table live_session_answers alter column user_id set default auth.uid();
