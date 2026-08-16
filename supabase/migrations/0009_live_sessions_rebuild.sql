-- Clean rebuild of every table from 0006_live_sessions.sql, folding in 0007's host_id/user_id
-- default fixes directly rather than as a follow-up ALTER. Live debugging (see the session's own
-- notes, summarized: a permissive `with check (true)` policy on live_sessions still rejected every
-- insert from the `authenticated` role, even with no JWT claims involved at all, while the exact
-- same role/policy shape works normally on every pre-existing table) pointed at something
-- structurally wrong with this specific table's state rather than the policy/grant/trigger logic
-- itself, all of which were individually verified correct. `drop ... cascade` + recreate is the
-- pragmatic fix — cheap here since these tables have never held real data (Phase 1 hasn't shipped
-- any UI that writes to them yet).
-- Explicit, individual drops (not just live_sessions cascading) — DROP TABLE ... CASCADE only
-- cascades to objects that depend on THAT table (its own constraints/views), not to sibling tables
-- whose policies merely call a shared function like is_session_host(). Caught live: dropping
-- live_sessions alone left the other four tables' policies still referencing is_session_host(),
-- which then blocked dropping the function.
drop table if exists live_session_answers cascade;
drop table if exists live_session_answer_keys cascade;
drop table if exists live_session_questions cascade;
drop table if exists live_session_participants cascade;
drop table if exists live_sessions cascade;
drop function if exists is_session_host(uuid, uuid);
drop function if exists is_session_participant(uuid, uuid);
drop function if exists find_session_by_join_code(text);
drop function if exists force_server_answered_at() cascade;

create table live_sessions (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
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
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  display_name text not null,
  is_guest boolean not null,
  joined_at timestamptz not null default now(),
  unique (session_id, user_id)
);
create index idx_live_session_participants_session on live_session_participants(session_id);

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
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
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

alter table live_sessions enable row level security;
alter table live_session_participants enable row level security;
alter table live_session_questions enable row level security;
alter table live_session_answer_keys enable row level security;
alter table live_session_answers enable row level security;

grant select, insert, update, delete on live_sessions to authenticated;
grant select, insert, update, delete on live_session_participants to authenticated;
grant select, insert, update, delete on live_session_questions to authenticated;
grant select, insert, update, delete on live_session_answer_keys to authenticated;
grant select, insert, update, delete on live_session_answers to authenticated;

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

create policy live_session_participants_select on live_session_participants for select
  to authenticated using (
    is_session_participant(session_id, auth.uid()) or is_session_host(session_id, auth.uid())
  );
create policy live_session_participants_insert on live_session_participants for insert
  to authenticated with check (user_id = auth.uid());
create policy live_session_participants_update on live_session_participants for update
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy live_session_questions_all_host on live_session_questions for all
  to authenticated using (is_session_host(session_id, auth.uid()))
  with check (is_session_host(session_id, auth.uid()));
create policy live_session_questions_select_participant on live_session_questions for select
  to authenticated using (
    is_session_participant(session_id, auth.uid())
    and question_index <= (select current_question_index from live_sessions where id = session_id)
  );

create policy live_session_answer_keys_all_host on live_session_answer_keys for all
  to authenticated using (is_session_host(session_id, auth.uid()))
  with check (is_session_host(session_id, auth.uid()));

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
