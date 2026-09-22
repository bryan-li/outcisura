-- Publishing a deck (folders.is_public — see 0013_public_folders.sql) used to be a plain self-serve
-- toggle any owner could flip themselves. This adds an approval step: an owner now requests
-- publishing, and only an admin's approval actually sets is_public = true.

alter table public.folders
  add column publish_status text not null default 'none'
    check (publish_status in ('none', 'pending', 'approved', 'rejected')),
  add column publish_requested_at timestamptz,
  add column publish_reviewed_at timestamptz,
  add column publish_reviewed_by uuid references auth.users(id),
  add column publish_reject_reason text;

-- Enforces the state machine so it can't be bypassed by calling the API directly, the same way the
-- username cooldown trigger backs its own rule (0023_username_change_rule.sql) rather than trusting
-- the client. Admins (is_ai_admin() — already SECURITY DEFINER, so callable here regardless of this
-- trigger's own context) are exempt: the approval RPC below is how they actually flip is_public.
create or replace function public.enforce_publish_workflow()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if is_ai_admin() then
    return NEW;
  end if;

  -- The one legitimate owner-initiated combination that changes is_public directly: unpublishing an
  -- already-approved deck. Both columns must move together in the same statement.
  if OLD.publish_status = 'approved' and NEW.publish_status = 'none' and OLD.is_public = true and NEW.is_public = false then
    return NEW;
  end if;

  if NEW.is_public IS DISTINCT FROM OLD.is_public then
    raise exception 'is_public can only change via the publish approval workflow';
  end if;

  if NEW.publish_status IS DISTINCT FROM OLD.publish_status then
    if not (
      (OLD.publish_status in ('none', 'rejected') and NEW.publish_status = 'pending')
      or (OLD.publish_status = 'pending' and NEW.publish_status = 'none')
    ) then
      raise exception 'Not an allowed publish-status change: % -> %', OLD.publish_status, NEW.publish_status;
    end if;
  end if;

  return NEW;
end;
$$;

create trigger folders_publish_workflow
  before update on public.folders
  for each row
  execute function public.enforce_publish_workflow();

-- Approve or reject a pending request — the only way is_public actually becomes true. Mirrors the
-- ai_admin_* RPC shape (0014_ai_proxy.sql onward): SECURITY DEFINER, admin-gated, one call per action.
create or replace function public.ai_admin_review_publish_request(p_folder_id uuid, p_approve boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_ai_admin() then
    raise exception 'Admin only';
  end if;

  update public.folders set
    publish_status = case when p_approve then 'approved' else 'rejected' end,
    is_public = p_approve,
    publish_reviewed_at = now(),
    publish_reviewed_by = auth.uid(),
    publish_reject_reason = case when p_approve then null else p_reason end
  where id = p_folder_id and publish_status = 'pending';

  if not found then
    raise exception 'No pending publish request for that folder';
  end if;
end;
$$;

-- Read-only list for the admin dashboard's review queue. A `language sql` function can't branch, so
-- non-admins just get an empty result (is_ai_admin() in the WHERE clause) rather than an error —
-- fine for a read with nothing sensitive to hide behind a hard refusal.
create or replace function public.ai_admin_list_publish_requests()
returns table (
  folder_id uuid,
  folder_name text,
  owner_id uuid,
  owner_username text,
  card_count bigint,
  requested_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select f.id, f.name, f.user_id, p.username, count(c.id), f.publish_requested_at
  from public.folders f
  left join public.profiles p on p.user_id = f.user_id
  left join public.cards c on c.folder_id = f.id
  where f.publish_status = 'pending' and is_ai_admin()
  group by f.id, f.name, f.user_id, p.username, f.publish_requested_at
  order by f.publish_requested_at asc
$$;
