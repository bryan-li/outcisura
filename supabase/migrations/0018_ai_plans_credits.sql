-- Plans + credits on top of the ai-proxy (0014-0017). Replaces per-user USD budgets with a plan
-- system whose unit is CREDITS, not dollars.
--
-- Why credits and not dollars: a plan promises "N credits a month"; what a credit costs us is a
-- separate, tunable knob. Each model has its own credit weights (ai_model_prices.*_credits_per_mtok),
-- and each app feature can carry a multiplier (ai_feature_weights). Anthropic re-pricing a model, or us
-- deciding cheap actions should feel cheaper than expensive ones, means editing weights — the plans
-- users already bought don't change. cost_usd is still logged per request, purely so admins can watch
-- real margin (credits sold vs dollars spent).
--
-- Launch calibration: 1 credit ~= $0.001 of Anthropic spend at the weights seeded below, i.e. Free =
-- 1,000 credits (~$1), Pro = 5,000 (~$5). That's a starting point, not a contract.
--
-- Entitlement, in one place (ai_entitlement below): the plan comes from ai_subscriptions (written by
-- the billing webhook, or by an admin for comps) and falls back to 'free'; the per-user ai_quotas row
-- can override the plan's credits/rate limit and switch an account off; ai_credit_grants add one-off
-- credits (top-ups, promos) that expire. Usage resets each billing period (subscription period for
-- paid plans, calendar month UTC for free).
--
-- Same access rules as 0014: usage/subscription/grant rows are written only by service_role or
-- SECURITY DEFINER admin RPCs (no client INSERT/UPDATE policies), per-command SELECT policies with
-- direct column comparisons, explicit grants.
--
-- DEPLOY ORDER: this drops ai_quotas.monthly_budget_usd and ai_spent_month(), which the previously
-- deployed ai-proxy reads. Apply this migration and deploy the new ai-proxy together.

-- ---------- plans ----------
create table ai_plans (
  id text primary key check (id ~ '^[a-z0-9_]+$'),
  name text not null,
  monthly_credits integer not null check (monthly_credits >= 0),
  requests_per_minute integer not null default 20 check (requests_per_minute > 0),
  -- null = every enabled model; otherwise only these (checked by the proxy).
  models text[],
  -- Display only. The billing provider is the source of truth for what's actually charged.
  price_cents integer check (price_cents >= 0),
  sort_order integer not null default 0,
  is_public boolean not null default true
);

insert into ai_plans (id, name, monthly_credits, requests_per_minute, models, sort_order) values
  ('free', 'Free', 1000, 10, array['claude-haiku-4-5', 'claude-sonnet-5'], 0),
  ('pro', 'Pro', 5000, 30, null, 10),
  ('max', 'Max', 25000, 60, null, 20);

-- ---------- credit weights ----------
alter table ai_model_prices
  add column input_credits_per_mtok numeric not null default 0 check (input_credits_per_mtok >= 0),
  add column output_credits_per_mtok numeric not null default 0 check (output_credits_per_mtok >= 0);
update ai_model_prices set
  input_credits_per_mtok = input_usd_per_mtok * 1000,
  output_credits_per_mtok = output_usd_per_mtok * 1000;

-- A feature with no row here has multiplier 1.
create table ai_feature_weights (
  feature text primary key,
  multiplier numeric not null default 1 check (multiplier >= 0),
  note text
);

-- ---------- subscriptions + grants ----------
create table ai_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_id text not null references ai_plans(id),
  status text not null check (status in ('active', 'trialing', 'past_due', 'canceled')),
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  cancel_at_period_end boolean not null default false,
  -- 'stripe' (or another provider) for real billing, 'manual' for admin comps.
  provider text not null default 'manual',
  provider_customer_id text,
  provider_subscription_id text,
  updated_at timestamptz not null default now()
);
create unique index idx_ai_subscriptions_provider_sub on ai_subscriptions (provider, provider_subscription_id)
  where provider_subscription_id is not null;

create table ai_credit_grants (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  credits integer not null check (credits > 0),
  reason text,
  created_at timestamptz not null default now(),
  -- Grants count toward the allowance until they expire. Null = never (rare; admin RPC defaults it
  -- to the end of the user's current period so a top-up doesn't quietly roll into future months).
  expires_at timestamptz,
  created_by uuid references auth.users(id) on delete set null
);
create index idx_ai_credit_grants_user on ai_credit_grants (user_id);

-- ---------- usage + quotas: move to credits ----------
alter table ai_usage add column credits numeric(12, 3) not null default 0;
update ai_usage set credits = round(cost_usd * 1000, 3);
create index idx_ai_usage_created on ai_usage (created_at);

alter table ai_quotas
  add column monthly_credits_override integer check (monthly_credits_override >= 0),
  add column rpm_override integer check (rpm_override > 0);
-- Old rows with a real budget keep it as an explicit override (1000 credits per old dollar); rows at
-- $0 had "no AI" and now simply follow their plan. Rate limits other than the old default carry over.
update ai_quotas set monthly_credits_override = round(monthly_budget_usd * 1000) where monthly_budget_usd > 0;
update ai_quotas set rpm_override = requests_per_minute where requests_per_minute <> 20;

drop function ai_my_status();
drop function ai_admin_overview();
drop function ai_admin_set_quota(uuid, numeric, integer, boolean, text);
drop function ai_admin_recent_usage(integer, uuid);
drop function ai_admin_set_price(text, numeric, numeric, boolean);
drop function ai_spent_month(uuid);

alter table ai_quotas drop column monthly_budget_usd, drop column requests_per_minute;

-- ---------- RLS ----------
alter table ai_plans enable row level security;
alter table ai_feature_weights enable row level security;
alter table ai_subscriptions enable row level security;
alter table ai_credit_grants enable row level security;

-- Public plans are readable by anyone (the website's pricing page uses the anon key); admins see all.
create policy ai_plans_select on ai_plans for select to anon, authenticated using (is_public or is_ai_admin());
create policy ai_feature_weights_select on ai_feature_weights for select to authenticated using (is_ai_admin());
create policy ai_subscriptions_select on ai_subscriptions for select to authenticated using (user_id = auth.uid());
create policy ai_credit_grants_select on ai_credit_grants for select to authenticated using (user_id = auth.uid());

grant select on ai_plans to anon, authenticated;
grant select on ai_feature_weights, ai_subscriptions, ai_credit_grants to authenticated;
grant all on ai_plans, ai_feature_weights, ai_subscriptions, ai_credit_grants to service_role;
grant usage, select on sequence ai_credit_grants_id_seq to service_role;

-- ---------- entitlement ----------
-- Which plan a user is on right now, and the window their credits are counted over. A paid
-- subscription counts while it's active/trialing/past_due and not more than 3 days past its period
-- end (renewal webhooks can lag); inside that grace window a new period is assumed to have started at
-- the old end, so usage doesn't look like it never reset. Otherwise: free, on the calendar month.
create function ai_effective_plan(p_user uuid)
  returns table (plan_id text, period_start timestamptz, period_end timestamptz)
  language sql stable security definer set search_path = public
  as $$
    select
      coalesce(p.id, 'free'),
      case
        when p.id is null then ai_month_start()
        when now() < s.current_period_end then s.current_period_start
        else s.current_period_end
      end,
      case
        when p.id is null then ai_month_start() + interval '1 month'
        when now() < s.current_period_end then s.current_period_end
        else s.current_period_end + interval '1 month'
      end
    from (select 1) one
    left join ai_subscriptions s
      on s.user_id = p_user
     and s.status in ('active', 'trialing', 'past_due')
     and now() < s.current_period_end + interval '3 days'
    left join ai_plans p on p.id = s.plan_id
  $$;

-- Everything the proxy needs to decide about one request, in one round trip. allowance = the user's
-- override if set, else their plan's credits, plus any unexpired grants.
create function ai_entitlement(p_user uuid)
  returns table (
    plan_id text,
    plan_name text,
    credits_allowance numeric,
    credits_used numeric,
    credits_remaining numeric,
    requests_per_minute integer,
    disabled boolean,
    models text[],
    period_start timestamptz,
    period_end timestamptz,
    cancel_at_period_end boolean
  )
  language sql stable security definer set search_path = public
  as $$
    with base as (
      select
        e.plan_id,
        pl.name as plan_name,
        pl.models,
        e.period_start,
        e.period_end,
        coalesce(q.monthly_credits_override, pl.monthly_credits)
          + coalesce((
              select sum(g.credits) from ai_credit_grants g
              where g.user_id = p_user and (g.expires_at is null or g.expires_at > now())
            ), 0) as allowance,
        coalesce((
          select sum(x.credits) from ai_usage x
          where x.user_id = p_user and x.created_at >= e.period_start and x.created_at < e.period_end
        ), 0) as used,
        coalesce(q.rpm_override, pl.requests_per_minute) as rpm,
        coalesce(q.disabled, false) as is_disabled,
        (coalesce(s.cancel_at_period_end, false) and e.plan_id <> 'free') as cancelling
      from ai_effective_plan(p_user) e
      join ai_plans pl on pl.id = e.plan_id
      left join ai_quotas q on q.user_id = p_user
      left join ai_subscriptions s on s.user_id = p_user
    )
    select plan_id, plan_name, allowance, used, greatest(0, allowance - used), rpm, is_disabled, models,
           period_start, period_end, cancelling
    from base
  $$;

revoke all on function ai_effective_plan(uuid), ai_entitlement(uuid) from public, anon, authenticated;
grant execute on function ai_effective_plan(uuid), ai_entitlement(uuid) to service_role;

-- What Settings shows every user about themselves. Scoped to auth.uid(); calls ai_entitlement as the
-- function owner, so clients never get to pass an arbitrary user id.
create function ai_my_status()
  returns table (
    plan_id text,
    plan_name text,
    credits_allowance numeric,
    credits_used numeric,
    credits_remaining numeric,
    requests_per_minute integer,
    disabled boolean,
    period_end timestamptz,
    cancel_at_period_end boolean,
    is_admin boolean
  )
  language sql stable security definer set search_path = public
  as $$
    select e.plan_id, e.plan_name, e.credits_allowance, e.credits_used, e.credits_remaining,
           e.requests_per_minute, e.disabled, e.period_end, e.cancel_at_period_end, is_ai_admin()
    from ai_entitlement(auth.uid()) e
  $$;

revoke all on function ai_my_status() from public, anon;
grant execute on function ai_my_status() to authenticated;

-- ---------- admin RPCs (each checks is_ai_admin() itself, as in 0014/0016/0017) ----------
create function ai_admin_overview()
  returns table (
    user_id uuid,
    email text,
    username text,
    plan_id text,
    plan_source text,
    credits_override integer,
    credits_allowance numeric,
    credits_used numeric,
    cost_period_usd numeric,
    rpm_override integer,
    disabled boolean,
    note text,
    last_used_at timestamptz,
    is_admin boolean
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
        ent.plan_id,
        case when ent.plan_id = 'free' then 'free' else coalesce(s.provider, 'billing') end,
        q.monthly_credits_override,
        ent.credits_allowance,
        ent.credits_used,
        coalesce((
          select sum(x.cost_usd) from ai_usage x
          where x.user_id = u.id and x.created_at >= ent.period_start and x.created_at < ent.period_end
        ), 0),
        q.rpm_override,
        ent.disabled,
        q.note,
        (select max(created_at) from ai_usage x where x.user_id = u.id),
        exists (select 1 from ai_admins a where a.user_id = u.id)
      from auth.users u
      left join profiles p on p.user_id = u.id
      left join ai_quotas q on q.user_id = u.id
      left join ai_subscriptions s on s.user_id = u.id
      cross join lateral ai_entitlement(u.id) ent
      where not u.is_anonymous
      order by u.created_at;
  end;
  $$;

-- Per-account override of the plan: credits (null = follow the plan), rate limit (null = follow the
-- plan), an off switch, and a private note.
create function ai_admin_set_quota(
  p_target uuid, p_credits_override integer, p_rpm_override integer, p_disabled boolean, p_note text
) returns void
  language plpgsql security definer set search_path = public
  as $$
  begin
    if not is_ai_admin() then raise exception 'not authorized'; end if;
    insert into ai_quotas (user_id, monthly_credits_override, rpm_override, disabled, note, updated_at)
      values (p_target, p_credits_override, p_rpm_override, p_disabled, p_note, now())
      on conflict (user_id) do update set
        monthly_credits_override = excluded.monthly_credits_override,
        rpm_override = excluded.rpm_override,
        disabled = excluded.disabled,
        note = excluded.note,
        updated_at = now();
  end;
  $$;

-- Comp an account onto a plan for p_days (default 30), or drop a manual comp back to free. Refuses to
-- touch a subscription owned by the billing provider — that has to be changed in the provider, or the
-- next webhook would silently undo it.
create function ai_admin_set_plan(p_target uuid, p_plan text, p_days integer default 30)
  returns void
  language plpgsql security definer set search_path = public
  as $$
  begin
    if not is_ai_admin() then raise exception 'not authorized'; end if;
    if not exists (select 1 from auth.users where id = p_target and not is_anonymous) then
      raise exception 'no such account';
    end if;
    if exists (select 1 from ai_subscriptions where user_id = p_target and provider <> 'manual') then
      raise exception 'this account''s plan is managed by the billing provider — change it there';
    end if;
    if p_plan = 'free' then
      delete from ai_subscriptions where user_id = p_target and provider = 'manual';
      return;
    end if;
    if not exists (select 1 from ai_plans where id = p_plan) then raise exception 'unknown plan'; end if;
    insert into ai_subscriptions (user_id, plan_id, status, current_period_start, current_period_end, provider, updated_at)
      values (p_target, p_plan, 'active', now(), now() + make_interval(days => greatest(p_days, 1)), 'manual', now())
      on conflict (user_id) do update set
        plan_id = excluded.plan_id,
        status = 'active',
        current_period_start = excluded.current_period_start,
        current_period_end = excluded.current_period_end,
        cancel_at_period_end = false,
        updated_at = now();
  end;
  $$;

-- One-off credits (top-up, apology, promo). Default expiry is the end of the account's current period.
create function ai_admin_grant_credits(p_target uuid, p_credits integer, p_reason text, p_days integer default null)
  returns void
  language plpgsql security definer set search_path = public
  as $$
  begin
    if not is_ai_admin() then raise exception 'not authorized'; end if;
    if not exists (select 1 from auth.users where id = p_target and not is_anonymous) then
      raise exception 'no such account';
    end if;
    insert into ai_credit_grants (user_id, credits, reason, expires_at, created_by)
      values (
        p_target, p_credits, p_reason,
        case when p_days is null then (select period_end from ai_effective_plan(p_target))
             else now() + make_interval(days => p_days) end,
        auth.uid()
      );
  end;
  $$;

create function ai_admin_upsert_plan(p_id text, p_name text, p_credits integer, p_rpm integer, p_models text[], p_sort integer default 0)
  returns void
  language plpgsql security definer set search_path = public
  as $$
  begin
    if not is_ai_admin() then raise exception 'not authorized'; end if;
    insert into ai_plans (id, name, monthly_credits, requests_per_minute, models, sort_order)
      values (trim(p_id), trim(p_name), p_credits, p_rpm, p_models, p_sort)
      on conflict (id) do update set
        name = excluded.name,
        monthly_credits = excluded.monthly_credits,
        requests_per_minute = excluded.requests_per_minute,
        models = excluded.models,
        sort_order = excluded.sort_order;
  end;
  $$;

create function ai_admin_set_feature_weight(p_feature text, p_multiplier numeric, p_note text default null)
  returns void
  language plpgsql security definer set search_path = public
  as $$
  begin
    if not is_ai_admin() then raise exception 'not authorized'; end if;
    insert into ai_feature_weights (feature, multiplier, note) values (trim(p_feature), p_multiplier, p_note)
      on conflict (feature) do update set multiplier = excluded.multiplier, note = excluded.note;
  end;
  $$;

-- Model prices now carry both the real USD price (for margin tracking) and the credit weights (what
-- a user's allowance is actually charged in).
create function ai_admin_set_price(
  p_model text, p_input_usd numeric, p_output_usd numeric, p_input_credits numeric, p_output_credits numeric, p_enabled boolean
) returns void
  language plpgsql security definer set search_path = public
  as $$
  begin
    if not is_ai_admin() then raise exception 'not authorized'; end if;
    insert into ai_model_prices (model, input_usd_per_mtok, output_usd_per_mtok, input_credits_per_mtok, output_credits_per_mtok, enabled)
      values (trim(p_model), p_input_usd, p_output_usd, p_input_credits, p_output_credits, p_enabled)
      on conflict (model) do update set
        input_usd_per_mtok = excluded.input_usd_per_mtok,
        output_usd_per_mtok = excluded.output_usd_per_mtok,
        input_credits_per_mtok = excluded.input_credits_per_mtok,
        output_credits_per_mtok = excluded.output_credits_per_mtok,
        enabled = excluded.enabled;
  end;
  $$;

create or replace function ai_admin_summary() returns jsonb
  language plpgsql stable security definer set search_path = public
  as $$
  declare result jsonb;
  begin
    if not is_ai_admin() then raise exception 'not authorized'; end if;
    select jsonb_build_object(
      'month_credits', coalesce((select sum(credits) from ai_usage where created_at >= ai_month_start()), 0),
      -- Real Anthropic spend, for margin: compare against credits sold.
      'month_cost_usd', coalesce((select sum(cost_usd) from ai_usage where created_at >= ai_month_start()), 0),
      'month_requests', (select count(*) from ai_usage where created_at >= ai_month_start()),
      'active_users', (select count(distinct user_id) from ai_usage where created_at >= ai_month_start()),
      'by_plan', coalesce((
        select jsonb_agg(jsonb_build_object('name', plan_id, 'accounts', n) order by n desc)
        from (
          select ent.plan_id, count(*) n
          from auth.users u cross join lateral ai_entitlement(u.id) ent
          where not u.is_anonymous group by ent.plan_id
        ) p
      ), '[]'::jsonb),
      'by_feature', coalesce((
        select jsonb_agg(jsonb_build_object('name', feature, 'requests', n, 'credits', cr, 'cost_usd', c) order by cr desc)
        from (select feature, count(*) n, sum(credits) cr, sum(cost_usd) c from ai_usage where created_at >= ai_month_start() group by feature) f
      ), '[]'::jsonb),
      'by_model', coalesce((
        select jsonb_agg(jsonb_build_object('name', model, 'requests', n, 'credits', cr, 'cost_usd', c) order by cr desc)
        from (select model, count(*) n, sum(credits) cr, sum(cost_usd) c from ai_usage where created_at >= ai_month_start() group by model) m
      ), '[]'::jsonb),
      'daily', (
        select jsonb_agg(jsonb_build_object('day', d::date, 'requests', coalesce(u.n, 0), 'credits', coalesce(u.cr, 0), 'cost_usd', coalesce(u.c, 0)) order by d)
        from generate_series((now() at time zone 'utc')::date - 29, (now() at time zone 'utc')::date, interval '1 day') d
        left join (
          select (created_at at time zone 'utc')::date as usage_day, count(*) n, sum(credits) cr, sum(cost_usd) c
          from ai_usage where created_at >= now() - interval '31 days' group by 1
        ) u on u.usage_day = d::date
      )
    ) into result;
    return result;
  end;
  $$;

create function ai_admin_recent_usage(p_limit integer default 100, p_user uuid default null)
  returns table (
    id bigint, created_at timestamptz, user_id uuid, email text, username text,
    feature text, model text, input_tokens integer, output_tokens integer, credits numeric, cost_usd numeric
  )
  language plpgsql stable security definer set search_path = public
  as $$
  begin
    if not is_ai_admin() then raise exception 'not authorized'; end if;
    return query
      select x.id, x.created_at, x.user_id, u.email::text, p.username, x.feature, x.model,
             x.input_tokens, x.output_tokens, x.credits, x.cost_usd
      from ai_usage x
      join auth.users u on u.id = x.user_id
      left join profiles p on p.user_id = x.user_id
      where p_user is null or x.user_id = p_user
      order by x.created_at desc
      limit least(greatest(p_limit, 1), 500);
  end;
  $$;

revoke all on function
  ai_admin_overview(), ai_admin_set_quota(uuid, integer, integer, boolean, text), ai_admin_set_plan(uuid, text, integer),
  ai_admin_grant_credits(uuid, integer, text, integer), ai_admin_upsert_plan(text, text, integer, integer, text[], integer),
  ai_admin_set_feature_weight(text, numeric, text), ai_admin_set_price(text, numeric, numeric, numeric, numeric, boolean),
  ai_admin_summary(), ai_admin_recent_usage(integer, uuid)
  from public, anon;
grant execute on function
  ai_admin_overview(), ai_admin_set_quota(uuid, integer, integer, boolean, text), ai_admin_set_plan(uuid, text, integer),
  ai_admin_grant_credits(uuid, integer, text, integer), ai_admin_upsert_plan(text, text, integer, integer, text[], integer),
  ai_admin_set_feature_weight(text, numeric, text), ai_admin_set_price(text, numeric, numeric, numeric, numeric, boolean),
  ai_admin_summary(), ai_admin_recent_usage(integer, uuid)
  to authenticated;
