-- Throwaway diagnostic table — NOT part of the app schema, will be dropped once the live_sessions
-- RLS mystery is resolved. Purpose: determine whether the "authenticated role can't write even
-- with an unconditional with-check(true) policy" symptom is specific to live_sessions (and its
-- rebuild history) or affects ANY newly-migrated table in this project.
create table rls_scratch_test (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
);
alter table rls_scratch_test enable row level security;
create policy rls_scratch_allow_all on rls_scratch_test for insert to authenticated with check (true);
grant select, insert on rls_scratch_test to authenticated;
