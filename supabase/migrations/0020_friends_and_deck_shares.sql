-- Friends + deck sharing.
--
-- friendships: one row per pair of accounts, regardless of who requested. 'pending' until the
-- addressee accepts (-> 'accepted'). A decline or an unfriend is just DELETE, not a third status —
-- that keeps the unique index below meaningful forever (a declined pair can just ask again) instead
-- of needing to prune old 'declined' rows to unblock a repeat request.
create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> addressee_id)
);

-- Order-independent uniqueness: A->B and B->A are the same relationship, so only one row can ever
-- exist for a given pair regardless of who sent it.
create unique index friendships_pair_unique
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

create index friendships_addressee_idx on public.friendships (addressee_id);

alter table public.friendships enable row level security;

create policy friendships_select on public.friendships for select
  using (requester_id = auth.uid() or addressee_id = auth.uid());

-- Same anonymous-guest exclusion as live_sessions_insert (see that migration's own reasoning) — a
-- guest join-a-session identity has no business sending friend requests.
create policy friendships_insert on public.friendships for insert
  with check (
    requester_id = auth.uid()
    and addressee_id <> auth.uid()
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
  );

-- Only the addressee can act on a request, and only to accept it (pending -> accepted). Declining,
-- cancelling a request you sent, and unfriending an accepted one are all just deletes, below.
create policy friendships_update on public.friendships for update
  using (addressee_id = auth.uid() and status = 'pending')
  with check (addressee_id = auth.uid() and status = 'accepted');

create policy friendships_delete on public.friendships for delete
  using (requester_id = auth.uid() or addressee_id = auth.uid());

-- deck_shares: an owner sharing one of their folders with one specific friend. A row here is what
-- makes that folder (and its cards — see the folders_select/cards_select changes below) visible to
-- the recipient at all; it doesn't touch card_sources (images/backlinks stay owner-only, same as
-- public decks today — those store a local file path meaningless on another device anyway, since
-- images never sync, only card content does).
create table public.deck_shares (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references public.folders(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  shared_with_id uuid not null references auth.users(id) on delete cascade,
  -- Snapshotted so the recipient's "shared with me" list still reads sensibly if the owner later
  -- renames or deletes the folder (a deleted folder cascades this row away too, but a rename
  -- shouldn't retroactively relabel something already shared) — same snapshot precedent as
  -- live_sessions.folder_name_snapshot.
  folder_name_snapshot text not null,
  created_at timestamptz not null default now(),
  check (owner_id <> shared_with_id),
  unique (folder_id, shared_with_id)
);

create index deck_shares_shared_with_idx on public.deck_shares (shared_with_id);

alter table public.deck_shares enable row level security;

create policy deck_shares_select on public.deck_shares for select
  using (owner_id = auth.uid() or shared_with_id = auth.uid());

-- Sharing requires: you own the folder, the recipient is an accepted friend, and you're not a guest.
create policy deck_shares_insert on public.deck_shares for insert
  with check (
    owner_id = auth.uid()
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
    and folder_id in (select id from public.folders where user_id = auth.uid())
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.requester_id = auth.uid() and f.addressee_id = shared_with_id)
          or (f.addressee_id = auth.uid() and f.requester_id = shared_with_id))
    )
  );

-- Either the owner (unshare) or the recipient (remove it from their own list) can delete a share;
-- either way it only ever affects this one row, never the folder or its cards themselves.
create policy deck_shares_delete on public.deck_shares for delete
  using (owner_id = auth.uid() or shared_with_id = auth.uid());

-- Extend the existing "public folders are readable by anyone" policies with "and so are folders
-- explicitly shared with me" — same shape, one more OR branch each.
drop policy folders_select on public.folders;
create policy folders_select on public.folders for select
  using (
    user_id = auth.uid()
    or is_public = true
    or id in (select folder_id from public.deck_shares where shared_with_id = auth.uid())
  );

drop policy cards_select on public.cards;
create policy cards_select on public.cards for select
  using (
    user_id = auth.uid()
    or folder_id in (select id from public.folders where is_public = true)
    or folder_id in (select folder_id from public.deck_shares where shared_with_id = auth.uid())
  );
