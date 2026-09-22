-- Lets a user change their own username (previously a one-time choice made at signup — see
-- authStore.ts's ensureProfile). Case-insensitive uniqueness is already enforced by
-- idx_profiles_username_unique (0008_user_profiles.sql); this adds the other rule: a change locks
-- the username for 30 days.
--
-- NULL (the default for every existing row) means "never changed under this rule yet" — the cooldown
-- check below treats that as eligible immediately, so existing accounts aren't retroactively locked
-- out of a first change just because this migration didn't run at signup time.
alter table public.profiles add column username_changed_at timestamptz;

-- A BEFORE UPDATE trigger (rather than a check constraint) because the 30-day check needs the OLD
-- row's username_changed_at, which a check constraint can't see. Keeps the client-side call a plain
-- `update profiles set username = ...` — same shape as every other profile-table write in this app —
-- with RLS (profiles_update: user_id = auth.uid()) already covering "only your own row".
create or replace function public.enforce_username_change_cooldown()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Only actually changing the username re-arms the cooldown; a no-op update (same value) or any
  -- future update to some other profiles column should never be blocked or reset it.
  if NEW.username = OLD.username then
    return NEW;
  end if;
  if OLD.username_changed_at is not null and now() < OLD.username_changed_at + interval '30 days' then
    raise exception 'You can change your username again in % day(s).',
      ceil(extract(epoch from (OLD.username_changed_at + interval '30 days' - now())) / 86400)
      using errcode = 'P0001';
  end if;
  NEW.username_changed_at := now();
  return NEW;
end;
$$;

create trigger profiles_username_cooldown
  before update of username on public.profiles
  for each row
  execute function public.enforce_username_change_cooldown();
