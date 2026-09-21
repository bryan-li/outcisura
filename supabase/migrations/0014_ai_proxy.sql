-- Server-side Anthropic key with per-user budgets (see supabase/functions/ai-proxy). The app no
-- longer needs its own API key: it sends its Supabase JWT to the ai-proxy Edge Function, which
-- checks the caller's quota here, forwards the request using the one key held as an Edge Function
-- secret, and logs what it cost.
--
-- Access model, deliberately small:
--   * A user with NO ai_quotas row has a budget of 0 — new sign-ups get no AI until an admin
--     grants them one (the admin screen lists every non-anonymous user, quota row or not).
--   * ai_usage is written only by the Edge Function (service role bypasses RLS) — there is no
--     INSERT policy, so a client can never forge or erase its own usage.
--   * Quota edits go through SECURITY DEFINER RPCs that check ai_admins themselves, rather than
--     giving admins INSERT/UPDATE policies on ai_quotas — one write path instead of two.
--   * Per-command policies only, never `for all` (see 0011_live_sessions_select_fix.sql and
--     0013_public_folders.sql for why SELECT scope must never ride along with write scope).
--   * New tables aren't auto-exposed to API roles (config.toml: auto_expose_new_tables), so every
--     table below is granted explicitly.

create table ai_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

-- Doubles as the model allow-list: a model with no row here (or enabled = false) is rejected by
-- the proxy, so a user can't route an expensive model through the shared key just because their
-- client asked for it. Prices are USD per million tokens — edit rows here when Anthropic changes
-- them; costs already logged in ai_usage keep the price in force when they were written.
create table ai_model_prices (
  model text primary key,
  input_usd_per_mtok numeric not null check (input_usd_per_mtok >= 0),
  output_usd_per_mtok numeric not null check (output_usd_per_mtok >= 0),
  enabled boolean not null default true
);

create table ai_quotas (
  user_id uuid primary key references auth.users(id) on delete cascade,
  monthly_budget_usd numeric not null default 0 check (monthly_budget_usd >= 0),
  requests_per_minute integer not null default 20 check (requests_per_minute > 0),
  disabled boolean not null default false,
  note text,
  updated_at timestamptz not null default now()
);

create table ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(12, 6) not null,
  created_at timestamptz not null default now()
);
create index idx_ai_usage_user_created on ai_usage (user_id, created_at desc);

insert into ai_model_prices (model, input_usd_per_mtok, output_usd_per_mtok) values
  ('claude-sonnet-5', 2, 10),
  ('claude-opus-5', 5, 25),
  ('claude-haiku-4-5', 1, 5);

-- SECURITY DEFINER so it can read ai_admins regardless of the caller's own RLS. ai_admins' own
-- SELECT policy below is `user_id = auth.uid()` — it never calls this function, so there's no
-- self-referential policy loop.
create function is_ai_admin() returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists (select 1 from ai_admins where user_id = auth.uid()) $$;

-- Budgets reset on the 1st of each month, UTC.
create function ai_month_start() returns timestamptz
  language sql stable
  as $$ select date_trunc('month', now() at time zone 'utc') at time zone 'utc' $$;

alter table ai_admins enable row level security;
alter table ai_model_prices enable row level security;
alter table ai_quotas enable row level security;
alter table ai_usage enable row level security;

create policy ai_admins_select on ai_admins for select to authenticated using (user_id = auth.uid());
create policy ai_model_prices_select on ai_model_prices for select to authenticated using (true);
create policy ai_quotas_select on ai_quotas for select to authenticated
  using (user_id = auth.uid() or is_ai_admin());
create policy ai_usage_select on ai_usage for select to authenticated
  using (user_id = auth.uid() or is_ai_admin());

grant select on ai_admins, ai_model_prices, ai_quotas, ai_usage to authenticated;
grant all on ai_admins, ai_model_prices, ai_quotas, ai_usage to service_role;
grant usage, select on sequence ai_usage_id_seq to service_role;

-- What Settings shows every user about themselves.
create function ai_my_status() returns table (
  monthly_budget_usd numeric,
  spent_month_usd numeric,
  requests_per_minute integer,
  disabled boolean,
  is_admin boolean
)
  language sql stable security definer set search_path = public
  as $$
    select
      coalesce(q.monthly_budget_usd, 0),
      coalesce((select sum(cost_usd) from ai_usage u where u.user_id = auth.uid() and u.created_at >= ai_month_start()), 0),
      coalesce(q.requests_per_minute, 20),
      coalesce(q.disabled, false),
      is_ai_admin()
    from (select 1) one
    left join ai_quotas q on q.user_id = auth.uid()
  $$;

-- The admin screen's one query: every real (non-anonymous) account with its quota and spend.
create function ai_admin_overview() returns table (
  user_id uuid,
  email text,
  username text,
  monthly_budget_usd numeric,
  requests_per_minute integer,
  disabled boolean,
  note text,
  spent_month_usd numeric,
  last_used_at timestamptz
)
  language plpgsql stable security definer set search_path = public
  as $$
  begin
    if not is_ai_admin() then raise exception 'not authorized'; end if;
    return query
      select
        u.id,
        u.email::text,
        p.username,
        coalesce(q.monthly_budget_usd, 0),
        coalesce(q.requests_per_minute, 20),
        coalesce(q.disabled, false),
        q.note,
        coalesce((select sum(cost_usd) from ai_usage x where x.user_id = u.id and x.created_at >= ai_month_start()), 0),
        (select max(created_at) from ai_usage x where x.user_id = u.id)
      from auth.users u
      left join profiles p on p.user_id = u.id
      left join ai_quotas q on q.user_id = u.id
      where not u.is_anonymous
      order by u.created_at;
  end;
  $$;

create function ai_admin_set_quota(
  target uuid, budget numeric, rpm integer, is_disabled boolean, quota_note text
) returns void
  language plpgsql security definer set search_path = public
  as $$
  begin
    if not is_ai_admin() then raise exception 'not authorized'; end if;
    insert into ai_quotas (user_id, monthly_budget_usd, requests_per_minute, disabled, note, updated_at)
      values (target, budget, rpm, is_disabled, quota_note, now())
      on conflict (user_id) do update set
        monthly_budget_usd = excluded.monthly_budget_usd,
        requests_per_minute = excluded.requests_per_minute,
        disabled = excluded.disabled,
        note = excluded.note,
        updated_at = now();
  end;
  $$;

revoke all on function ai_my_status(), ai_admin_overview(), ai_admin_set_quota(uuid, numeric, integer, boolean, text) from public, anon;
grant execute on function ai_my_status(), ai_admin_overview(), ai_admin_set_quota(uuid, numeric, integer, boolean, text) to authenticated;

-- Seed: the project owner is the first admin, with a starting cap of $25/month (edit from the
-- admin screen). Everyone else starts at no budget.
insert into ai_admins (user_id) select id from auth.users where email = 'bryanlischool@gmail.com';
insert into ai_quotas (user_id, monthly_budget_usd, note)
  select id, 25, 'owner' from auth.users where email = 'bryanlischool@gmail.com';
