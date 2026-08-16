-- Root cause of the "authenticated role can't INSERT into any new table" mystery, finally found:
-- it's a well-documented Postgres/PostgREST behavior, not a platform bug. When a client asks for
-- the row back after an insert (.select()/.single() in supabase-js, `Prefer: return=representation`
-- over REST, or even a plain `RETURNING` clause in raw SQL), Postgres evaluates that RETURNING
-- output against the table's SELECT policy, not just the INSERT policy's WITH CHECK — "the insert
-- policy is not enough, you need the select policy to pass too" (this is Postgres RLS behavior,
-- confirmed against a public GitHub Supabase discussion hitting the identical symptom). A brand-new
-- scratch table with an unconditional `with check (true)` INSERT policy and NO select policy at all
-- reproduced this exactly — adding a trivial `for select using (true)` policy fixed it instantly.
--
-- live_sessions/live_session_participants DO have SELECT policies, but both route entirely through
-- a SECURITY DEFINER helper function (is_session_host/is_session_participant) that queries the
-- SAME table the policy is protecting. That self-referential shape is exactly the fragile case: at
-- RETURNING-evaluation time for a row inserted in the SAME transaction, the function's own internal
-- query didn't reliably see the not-yet-committed row, so the SELECT policy evaluated false and the
-- whole insert was rejected with the misleading generic RLS error — even though the INSERT policy's
-- own WITH CHECK was correct all along.
--
-- Fix: add a direct column comparison (host_id = auth.uid() / user_id = auth.uid()) as an
-- additional OR-branch on each affected SELECT policy — a plain comparison against columns of the
-- row being evaluated has no self-referential-subquery indirection to go stale, so "can I see my
-- own just-inserted row" no longer depends on the SECURITY DEFINER function at all. The functions
-- stay in place for the cross-user case (a participant needing to see a session/roster row they
-- don't own), which was never the part that was broken.
drop policy if exists live_sessions_select on live_sessions;
create policy live_sessions_select on live_sessions for select
  to authenticated using (
    host_id = auth.uid() or is_session_host(id, auth.uid()) or is_session_participant(id, auth.uid())
  );

drop policy if exists live_session_participants_select on live_session_participants;
create policy live_session_participants_select on live_session_participants for select
  to authenticated using (
    user_id = auth.uid() or is_session_participant(session_id, auth.uid()) or is_session_host(session_id, auth.uid())
  );

drop policy if exists live_session_answers_select on live_session_answers;
create policy live_session_answers_select on live_session_answers for select
  to authenticated using (
    user_id = auth.uid() or is_session_participant(session_id, auth.uid()) or is_session_host(session_id, auth.uid())
  );
