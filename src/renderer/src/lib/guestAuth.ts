import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

/** Signs in as an anonymous Supabase Auth user — used by a guest joining a live session without
 *  ever seeing a login screen (see the Phase 1 M0 plan's RLS design: every session participant,
 *  host or guest, needs a real auth.uid() for row-level security to work at all, even though a
 *  guest's presence is otherwise invisible as a "login"). `auth.jwt() ->> 'is_anonymous'`
 *  distinguishes this identity from a real signed-up account server-side.
 *
 *  Deliberately takes no display-name argument — Supabase Auth identity and a session's own roster
 *  (`live_session_participants.display_name`) are different concerns. A display name is only ever
 *  written when a guest actually joins a *specific* session, not baked into the anonymous identity
 *  itself, since the same anonymous session could in principle join more than one session with a
 *  different name each time.
 *
 *  Requires Anonymous Sign-Ins to be enabled on the Supabase project (Authentication settings, or
 *  `supabase config push` after flipping `enable_anonymous_sign_ins` in config.toml) — throws
 *  whatever Supabase itself throws if it isn't. */
export async function signInAsGuest(): Promise<Session> {
  const { data, error } = await supabase.auth.signInAnonymously()
  if (error) throw error
  if (!data.session) throw new Error('Anonymous sign-in did not return a session')
  return data.session
}
