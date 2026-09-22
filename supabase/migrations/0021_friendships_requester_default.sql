-- Missed on the first pass: every other user-owned table in this schema (folders.user_id,
-- cards.user_id, live_sessions.host_id, ...) defaults its owner column to auth.uid(), so the app
-- never has to supply it and it can't be spoofed. friendships.requester_id didn't get the same
-- default, so the real app's insert (which only ever sends addressee_id, exactly like every other
-- owner-column insert in this app) failed outright.
alter table public.friendships alter column requester_id set default auth.uid();
