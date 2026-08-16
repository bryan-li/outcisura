-- Custom, globally-unique usernames for real (non-anonymous) accounts — shown on live-session
-- rosters/leaderboards instead of a raw email address. Guests don't get a profile row at all: their
-- display_name (live_session_participants, 0006) is free-text and scoped to one session only, since
-- "different accounts, disallowing overlap" is specifically about real signed-up identities.
--
-- Not stored directly on auth.users — that table is Supabase-managed, not something this project's
-- migrations touch. A separate profiles table keyed 1:1 by user_id is the standard pattern.
--
-- This project's Supabase Auth config requires email confirmation before a session exists (see
-- LoginView.tsx's "check your email to confirm" flow) — so a profile row can't be created at signUp()
-- time (no auth.uid() to satisfy RLS yet). authStore.ts's signUp() stashes the chosen username in
-- Supabase Auth's own user_metadata instead (survives the confirmation gap for free, no extra
-- table needed to bridge it), and authStore.ts creates the actual profile row lazily, the first
-- time a real authenticated session is seen with no existing profile row yet.
create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (username ~ '^[a-zA-Z0-9_]{3,20}$'),
  created_at timestamptz not null default now()
);

-- Case-insensitive uniqueness ("Bryan" and "bryan" collide) via a functional unique index rather
-- than a plain `unique` constraint on username directly — preserves the chosen display casing while
-- still disallowing a case-only-different duplicate.
create unique index idx_profiles_username_unique on profiles (lower(username));

alter table profiles enable row level security;

-- Readable by any authenticated user (including a session's other participants, guest or not) —
-- unlike live_sessions' join code, a username isn't a credential; showing it on a roster/leaderboard
-- is the entire point of this table existing. Only the owning user can ever insert/update their own.
create policy profiles_select on profiles for select
  to authenticated using (true);
create policy profiles_insert on profiles for insert
  to authenticated with check (user_id = auth.uid());
create policy profiles_update on profiles for update
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
