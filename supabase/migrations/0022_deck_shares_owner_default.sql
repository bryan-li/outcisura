-- Same oversight as friendships.requester_id (see 0021_friendships_requester_default.sql) —
-- deck_shares.owner_id needs the same default auth.uid() every other owner column in this schema
-- has, since the real app's insert never supplies it explicitly.
alter table public.deck_shares alter column owner_id set default auth.uid();
