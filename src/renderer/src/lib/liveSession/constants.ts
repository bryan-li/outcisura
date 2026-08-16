/** How long each question stays open for answers, synced across host and guests via the
 *  `question_advanced` broadcast's own `deadline` field (see realtime.ts) — not host-configurable
 *  in this pass. */
export const QUESTION_SECONDS = 20
