-- AI "share-ready" pipeline cache for live hosted study sessions (Phase 1) — see
-- aiService.ts's prepareForSharing() and sharePrep.ts's ensureSharePrepped(). Recommended format +
-- distractors + rubric cost a real Claude call, so they're cached here rather than recomputed every
-- time a host opens the session setup screen.
--
-- share_prep_source_front/back are a snapshot of the exact front/back text the cache was computed
-- from — the same "snapshot instead of a live comparison" idiom card_sources.
-- source_document_filename/source_page_index already established (0004), reused here for staleness
-- detection. Deliberately NOT comparing against cards.updated_at: that column is bumped by
-- gradeCard/setCardSrsState/folder moves/applyRemoteCardUpsert for reasons that have nothing to do
-- with front/back content, so it would spuriously invalidate this cache constantly. Comparing the
-- live front/back directly to this snapshot is cheap and exact. All-NULL means "never computed"
-- (a new card, or a card that predates this feature).
--
-- text[] not jsonb for the distractor list — a fixed 3-entry array has no nested/variable shape to
-- justify jsonb, and this schema has no existing jsonb usage to match either way.
--
-- No RLS change needed: these columns fall under cards' existing owner-only policy from
-- 0001_init.sql. Participants in a live session never read these columns directly — a host's own
-- session setup reads their own cards (already permitted) and copies the chosen distractors/rubric
-- into the public-safe live_session_questions/live_session_answer_keys tables (see 0006) at
-- question-creation time.
alter table cards add column share_format text check (share_format is null or share_format in ('mcq', 'free_text'));
alter table cards add column share_mcq_distractors text[];
alter table cards add column share_free_text_rubric text;
alter table cards add column share_prep_source_front text;
alter table cards add column share_prep_source_back text;
