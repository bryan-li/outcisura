-- The correct MCQ option used to just be the card's own back verbatim — often stylistically or
-- structurally distinct from the freshly AI-generated distractors (different length, phrasing,
-- capitalization...), which alone can give the right answer away without knowing the material.
-- This adds a rewritten stand-in for the *option shown on screen*, generated in the same
-- prepareForSharing() call as the distractors (aiService.ts) so it's produced in the same style/
-- length pass as them. The real answer (cards.back) is never touched — createSession.ts still uses
-- it verbatim for the answer key/reveal (see 0006_live_sessions.sql's back_snapshot) and everywhere
-- else in the app; this column only ever substitutes into the on-screen multiple-choice list.
alter table public.cards add column share_mcq_correct_rewrite text;
