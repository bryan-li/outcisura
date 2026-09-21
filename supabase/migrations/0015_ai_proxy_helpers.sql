-- Used by the ai-proxy Edge Function (service role) to sum a user's spend this month without
-- pulling every usage row over PostgREST. Not exposed to clients: they use ai_my_status() instead,
-- which is scoped to auth.uid() — this one takes an arbitrary user id, so it must stay service-only.
create function ai_spent_month(p_user uuid) returns numeric
  language sql stable security definer set search_path = public
  as $$ select coalesce(sum(cost_usd), 0) from ai_usage where user_id = p_user and created_at >= ai_month_start() $$;

revoke all on function ai_spent_month(uuid) from public, anon, authenticated;
grant execute on function ai_spent_month(uuid) to service_role;
