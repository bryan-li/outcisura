-- Read/write RPCs for the in-app Admin dashboard (see AdminDashboard.tsx). Same rule as 0014's
-- admin RPCs: SECURITY DEFINER, and each one checks is_ai_admin() itself — the UI hiding the page
-- from non-admins is a convenience, not the access control.

create function ai_admin_summary() returns jsonb
  language plpgsql stable security definer set search_path = public
  as $$
  declare result jsonb;
  begin
    if not is_ai_admin() then raise exception 'not authorized'; end if;
    select jsonb_build_object(
      'month_spend_usd', coalesce((select sum(cost_usd) from ai_usage where created_at >= ai_month_start()), 0),
      'month_requests', (select count(*) from ai_usage where created_at >= ai_month_start()),
      'active_users', (select count(distinct user_id) from ai_usage where created_at >= ai_month_start()),
      'by_feature', coalesce((
        select jsonb_agg(jsonb_build_object('name', feature, 'requests', n, 'cost_usd', c) order by c desc)
        from (select feature, count(*) n, sum(cost_usd) c from ai_usage where created_at >= ai_month_start() group by feature) f
      ), '[]'::jsonb),
      'by_model', coalesce((
        select jsonb_agg(jsonb_build_object('name', model, 'requests', n, 'cost_usd', c) order by c desc)
        from (select model, count(*) n, sum(cost_usd) c from ai_usage where created_at >= ai_month_start() group by model) m
      ), '[]'::jsonb),
      -- Last 30 days including days with no usage, so the chart's x-axis is continuous.
      'daily', (
        select jsonb_agg(jsonb_build_object('day', d::date, 'requests', coalesce(u.n, 0), 'cost_usd', coalesce(u.c, 0)) order by d)
        from generate_series((now() at time zone 'utc')::date - 29, (now() at time zone 'utc')::date, interval '1 day') d
        left join (
          select (created_at at time zone 'utc')::date as usage_day, count(*) n, sum(cost_usd) c
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
    feature text, model text, input_tokens integer, output_tokens integer, cost_usd numeric
  )
  language plpgsql stable security definer set search_path = public
  as $$
  begin
    if not is_ai_admin() then raise exception 'not authorized'; end if;
    return query
      select x.id, x.created_at, x.user_id, u.email::text, p.username, x.feature, x.model,
             x.input_tokens, x.output_tokens, x.cost_usd
      from ai_usage x
      join auth.users u on u.id = x.user_id
      left join profiles p on p.user_id = x.user_id
      where p_user is null or x.user_id = p_user
      order by x.created_at desc
      limit least(greatest(p_limit, 1), 500);
  end;
  $$;

create function ai_admin_set_price(p_model text, p_input numeric, p_output numeric, p_enabled boolean)
  returns void
  language plpgsql security definer set search_path = public
  as $$
  begin
    if not is_ai_admin() then raise exception 'not authorized'; end if;
    insert into ai_model_prices (model, input_usd_per_mtok, output_usd_per_mtok, enabled)
      values (trim(p_model), p_input, p_output, p_enabled)
      on conflict (model) do update set
        input_usd_per_mtok = excluded.input_usd_per_mtok,
        output_usd_per_mtok = excluded.output_usd_per_mtok,
        enabled = excluded.enabled;
  end;
  $$;

revoke all on function ai_admin_summary(), ai_admin_recent_usage(integer, uuid), ai_admin_set_price(text, numeric, numeric, boolean) from public, anon;
grant execute on function ai_admin_summary(), ai_admin_recent_usage(integer, uuid), ai_admin_set_price(text, numeric, numeric, boolean) to authenticated;
