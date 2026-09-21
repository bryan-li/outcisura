-- Lets admins grant/revoke admin on other accounts from the dashboard, and exposes is_admin on the
-- accounts list. ai_admin_overview's return type changes, which CREATE OR REPLACE can't do — hence
-- drop + recreate.
--
-- Rules enforced here, not in the UI: only an existing admin can call this; the target must be a
-- real (non-anonymous) account; and the LAST admin can never be removed, so the project can't end up
-- with nobody able to manage budgets (the only recovery would be raw SQL).

drop function ai_admin_overview();

create function ai_admin_overview() returns table (
  user_id uuid,
  email text,
  username text,
  monthly_budget_usd numeric,
  requests_per_minute integer,
  disabled boolean,
  note text,
  spent_month_usd numeric,
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
        coalesce(q.monthly_budget_usd, 0),
        coalesce(q.requests_per_minute, 20),
        coalesce(q.disabled, false),
        q.note,
        coalesce((select sum(cost_usd) from ai_usage x where x.user_id = u.id and x.created_at >= ai_month_start()), 0),
        (select max(created_at) from ai_usage x where x.user_id = u.id),
        exists (select 1 from ai_admins a where a.user_id = u.id)
      from auth.users u
      left join profiles p on p.user_id = u.id
      left join ai_quotas q on q.user_id = u.id
      where not u.is_anonymous
      order by u.created_at;
  end;
  $$;

create function ai_admin_set_admin(target uuid, make_admin boolean) returns void
  language plpgsql security definer set search_path = public
  as $$
  begin
    if not is_ai_admin() then raise exception 'not authorized'; end if;
    if not exists (select 1 from auth.users where id = target and not is_anonymous) then
      raise exception 'no such account';
    end if;
    if make_admin then
      insert into ai_admins (user_id) values (target) on conflict do nothing;
    else
      if (select count(*) from ai_admins) <= 1 and exists (select 1 from ai_admins where user_id = target) then
        raise exception 'cannot remove the last admin';
      end if;
      delete from ai_admins where user_id = target;
    end if;
  end;
  $$;

revoke all on function ai_admin_overview(), ai_admin_set_admin(uuid, boolean) from public, anon;
grant execute on function ai_admin_overview(), ai_admin_set_admin(uuid, boolean) to authenticated;
