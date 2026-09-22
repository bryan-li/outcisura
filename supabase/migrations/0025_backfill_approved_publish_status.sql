-- Defensive backfill (no-op today — no folder currently has is_public = true — but keeps any
-- pre-existing public folder consistent with the new state machine rather than stuck: a folder with
-- is_public = true and publish_status still 'none' couldn't be unpublished by its owner, since the
-- trigger only allows that transition from 'approved'.
update public.folders set publish_status = 'approved', publish_reviewed_at = now()
where is_public = true and publish_status = 'none';
