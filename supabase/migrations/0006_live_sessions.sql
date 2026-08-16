-- Live hosted study sessions (Kahoot-style, Phase 1 M0 — see the "Phase 1, Milestone 0" plan and
-- the Cloud Sync Architecture Notion doc for full context). A host advances one question at a
-- time; every participant answers the same card simultaneously.
--
-- Every participant — host AND guest — authenticates via Supabase Auth first (host: normal
-- email+password from authStore.ts; guest: anonymous auth, see guestAuth.ts's signInAsGuest), so
-- every row below has a real auth.uid() even though a guest never sees a login screen.
-- auth.jwt() ->> 'is_anonymous' distinguishes the two — used once, in live_sessions' own insert
-- check, to enforce "hosting requires a real account" at the database level, not just the UI (a
-- guest could otherwise call the REST API directly and self-promote to host).
--
-- Unlike every table in 0001_init.sql, these are NOT single-owner: a session's rows need to be
-- readable/writable by the host AND by every participant who joined. Two SECURITY DEFINER helper
-- functions below encapsulate "does this uid have this relationship to this session" —
-- is_session_participant is SECURITY DEFINER specifically so live_session_participants' own SELECT
-- policy can call it without Postgres rejecting the policy as infinitely recursive: a SECURITY
-- DEFINER function executes as its owner (the migration-running role, which owns the table), and
-- RLS never applies to a table's owner, so the query inside the function body bypasses RLS entirely
-- instead of re-triggering the very policy that's calling it.
--
-- Scoring is never client-writable. answered_at is forced to the server's own now() by a trigger (a
-- client-supplied timestamp is exactly the kind of claim a guest could lie about for speed-ranking);
-- is_correct/points_awarded are only ever set by an UPDATE gated on is_session_host(...) — never by
-- the answering participant — since the host is the one running the AI judging pass (free-text) or
-- the instant index-compare (MCQ) and pushing the result back.
--
-- live_sessions deliberately has NO `using (true)` SELECT policy, unlike a first draft of this
-- migration — Postgres RLS filters by row visibility, not by what a query's WHERE clause asked for,
-- so `using (true)` would let ANY authenticated user (including a trivially-created guest) run a
-- bare `select * from live_sessions` and enumerate every host's active sessions app-wide, not just
-- the one they were invited to. Looking a session up by its join code instead goes through
-- find_session_by_join_code below — a narrow SECURITY DEFINER function that takes an exact code as
-- a parameter (no enumeration possible without already knowing a valid code) and returns only the
-- minimal public projection a join-confirmation screen needs.

create table live_sessions (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users(id) on delete cascade,
  join_code text not null unique,
  folder_id uuid references folders(id) on delete set null,
  folder_name_snapshot text,
  status text not null check (status in ('lobby', 'active', 'completed')) default 'lobby',
  current_question_index integer not null default -1,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz
);
create index idx_live_sessions_join_code on live_sessions(join_code);
create index idx_live_sessions_host on live_sessions(host_id);

create table live_session_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references live_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  is_guest boolean not null,
  joined_at timestamptz not null default now(),
  unique (session_id, user_id)
);
create index idx_live_session_participants_session on live_session_participants(session_id);

-- Public-safe question content — front text and shuffled option text, nothing that reveals the
-- correct answer. Snapshotted from the card at question-creation time (same idiom as
-- card_sources.source_document_filename/source_page_index and cards.share_prep_source_front/back)
-- so a card edited or deleted mid-session doesn't change or break a question already in flight.
create table live_session_questions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references live_sessions(id) on delete cascade,
  card_id uuid references cards(id) on delete set null,
  question_index integer not null,
  front_snapshot text not null,
  format text not null check (format in ('mcq', 'free_text')),
  mcq_options text[],
  unique (session_id, question_index)
);
create index idx_live_session_questions_session on live_session_questions(session_id);

-- Split into its own table specifically so RLS can hide it entirely — RLS is row-level, not
-- column-level, and a separate table is the standard way to get column-level secrecy on data that
-- would otherwise share a row with the public-safe question content above.
create table live_session_answer_keys (
  question_id uuid primary key references live_session_questions(id) on delete cascade,
  session_id uuid not null references live_sessions(id) on delete cascade,
  back_snapshot text not null,
  correct_mcq_index integer,
  free_text_rubric text,
  points_value integer not null default 1000
);

create table live_session_answers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references live_sessions(id) on delete cascade,
  question_id uuid not null references live_session_questions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  selected_mcq_index integer,
  free_text_answer text,
  answered_at timestamptz not null default now(),
  is_correct boolean,
  points_awarded integer,
  judged_at timestamptz,
  unique (question_id, user_id)
);
create index idx_live_session_answers_question on live_session_answers(question_id);
create index idx_live_session_answers_user on live_session_answers(user_id);

-- Forces server time regardless of what a client sends — see module header. A client-supplied
-- answered_at is discarded outright, not merely defaulted-and-overridable.
create or replace function force_server_answered_at()
returns trigger
language plpgsql
as $$
begin
  new.answered_at := now();
  return new;
end;
$$;
create trigger trg_live_session_answers_server_time
  before insert on live_session_answers
  for each row execute function force_server_answered_at();

-- --- Helper functions -----------------------------------------------------------------------

create or replace function is_session_host(p_session_id uuid, p_uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from live_sessions where id = p_session_id and host_id = p_uid
  );
$$;

create or replace function is_session_participant(p_session_id uuid, p_uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from live_session_participants where session_id = p_session_id and user_id = p_uid
  );
$$;

-- The one sanctioned way to look a session up before you're a participant of it (i.e. before
-- joining) — see the module header for why live_sessions itself has no broad SELECT policy. Takes
-- an exact code, returns only what a join-confirmation screen needs, never the host or full row.
create or replace function find_session_by_join_code(p_code text)
returns table (id uuid, status text, folder_name_snapshot text)
language sql
security definer
set search_path = public
stable
as $$
  select id, status, folder_name_snapshot from live_sessions where join_code = p_code;
$$;

revoke all on function is_session_host(uuid, uuid) from public;
revoke all on function is_session_participant(uuid, uuid) from public;
revoke all on function find_session_by_join_code(text) from public;
grant execute on function is_session_host(uuid, uuid) to authenticated;
grant execute on function is_session_participant(uuid, uuid) to authenticated;
grant execute on function find_session_by_join_code(text) to authenticated;

-- --- RLS --------------------------------------------------------------------------------------

alter table live_sessions enable row level security;
alter table live_session_participants enable row level security;
alter table live_session_questions enable row level security;
alter table live_session_answer_keys enable row level security;
alter table live_session_answers enable row level security;

-- live_sessions: readable only by the host or an already-joined participant — see module header
-- for why this is NOT `using (true)`. Only the host can create/modify it, and only a REAL
-- (non-anonymous) account can ever become host.
create policy live_sessions_select on live_sessions for select
  to authenticated using (
    is_session_host(id, auth.uid()) or is_session_participant(id, auth.uid())
  );
create policy live_sessions_insert on live_sessions for insert
  to authenticated with check (
    host_id = auth.uid() and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
  );
create policy live_sessions_update on live_sessions for update
  to authenticated using (host_id = auth.uid()) with check (host_id = auth.uid());

-- live_session_participants: identity/roster only — deliberately no score column here at all (see
-- live_session_answers below for why). Anyone can insert themselves as a participant (that's what
-- "join" means); only the participant themselves can touch their own row afterward.
create policy live_session_participants_select on live_session_participants for select
  to authenticated using (
    is_session_participant(session_id, auth.uid()) or is_session_host(session_id, auth.uid())
  );
create policy live_session_participants_insert on live_session_participants for insert
  to authenticated with check (user_id = auth.uid());
create policy live_session_participants_update on live_session_participants for update
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- live_session_questions: host has full access; participants can only ever read up to the
-- currently-active question index — blocks reading ahead to future questions/options before the
-- host advances to them.
create policy live_session_questions_all_host on live_session_questions for all
  to authenticated using (is_session_host(session_id, auth.uid()))
  with check (is_session_host(session_id, auth.uid()));
create policy live_session_questions_select_participant on live_session_questions for select
  to authenticated using (
    is_session_participant(session_id, auth.uid())
    and question_index <= (select current_question_index from live_sessions where id = session_id)
  );

-- live_session_answer_keys: host only, full stop — no participant policy at all means participants
-- get zero rows back, ever (default-deny under RLS). This is what actually prevents a participant
-- from reading the correct answer before answering; question content alone never reveals it.
create policy live_session_answer_keys_all_host on live_session_answer_keys for all
  to authenticated using (is_session_host(session_id, auth.uid()))
  with check (is_session_host(session_id, auth.uid()));

-- live_session_answers: a participant can insert exactly one row for themselves per question
-- (unique constraint above) and can never update it afterward — the absence of a participant UPDATE
-- policy locks their answer in at submission time. Only the host can write is_correct/
-- points_awarded (the judging step) — this is why there's no score column on
-- live_session_participants: a per-participant running total is a SUM over this table's
-- host-written points_awarded, computed at read time by the client, never a raw column any
-- participant could self-update.
create policy live_session_answers_select on live_session_answers for select
  to authenticated using (
    is_session_participant(session_id, auth.uid()) or is_session_host(session_id, auth.uid())
  );
create policy live_session_answers_insert on live_session_answers for insert
  to authenticated with check (
    user_id = auth.uid() and is_session_participant(session_id, auth.uid())
  );
create policy live_session_answers_update_host on live_session_answers for update
  to authenticated using (is_session_host(session_id, auth.uid()))
  with check (is_session_host(session_id, auth.uid()));
