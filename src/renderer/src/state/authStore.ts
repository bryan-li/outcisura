import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/

interface AuthState {
  session: Session | null
  /** True until the initial getSession() check resolves — the auth gate renders nothing (rather
   *  than flashing the login screen) while this is true, since a returning signed-in user
   *  otherwise sees a login-screen flicker before their session loads. */
  loading: boolean
  error: string | null
  /** Subscribes to auth state changes and loads whatever session already exists (e.g. a returning
   *  user). Call once, from App.tsx — mirrors this codebase's other stores' load* pattern. */
  init: () => void
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, username: string) => Promise<void>
  /** Hands off to the system browser for Google's consent screen (Electron can't complete OAuth
   *  inside an embedded webview — Google blocks it) — see main/index.ts's outcisura:// protocol
   *  handler for how the redirect back into the app completes the flow via onDeepLink below. */
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
}

/** Registered once from init() below — the deep link carries the OAuth `code` query param that
 *  completes signInWithGoogle's flow. Not wired up if Google sign-in was never started, but
 *  listening unconditionally is simpler than tracking whether one is in flight, and a stray
 *  outcisura:// link with no `code` is just a silent no-op. */
function handleAuthDeepLink(url: string, set: (partial: Partial<AuthState>) => void): void {
  let code: string | null
  try {
    code = new URL(url).searchParams.get('code')
  } catch {
    return
  }
  if (!code) return
  supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
    if (error) set({ error: error.message })
  })
}

/** This project's Supabase Auth config requires email confirmation, so signUp() never has a live
 *  session to create a `profiles` row against (RLS needs auth.uid()) — the chosen username rides
 *  along in Supabase Auth's own user_metadata instead (set at signUp time, survives the
 *  confirmation gap for free) and gets materialized into a real profiles row here, the first time a
 *  real authenticated session shows up with no profile row yet. Idempotent — a returning user with
 *  a profile already created on a previous sign-in is a no-op every time after the first. Skipped
 *  entirely for anonymous (guest) sessions, which never get a profile row at all (see
 *  0008_user_profiles.sql's own header). A genuine username collision at this point (someone else
 *  claimed the same name while this account's confirmation was pending — rare) surfaces via `error`
 *  same as any other auth failure; no dedicated recovery flow, matching this project's "reasonable
 *  diligence, not exhaustive edge-case hardening" bar for a low-stakes, low-probability race. */
async function ensureProfile(session: Session, set: (partial: Partial<AuthState>) => void): Promise<void> {
  if (session.user.is_anonymous) return
  const username = session.user.user_metadata?.username
  if (typeof username !== 'string' || !username) return

  const { data: existing } = await supabase.from('profiles').select('user_id').eq('user_id', session.user.id).maybeSingle()
  if (existing) return

  const { error } = await supabase.from('profiles').insert({ user_id: session.user.id, username })
  if (error && error.code !== '23505') {
    set({ error: `Could not set your username "${username}": ${error.message}` })
  } else if (error) {
    set({ error: `Username "${username}" was taken while your account was pending confirmation — contact support to choose another.` })
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  loading: true,
  error: null,

  init: () => {
    supabase.auth.getSession().then(({ data }) => {
      set({ session: data.session, loading: false })
      if (data.session) void ensureProfile(data.session, set)
    })
    // Keeps session state current across sign-in/out from this call and token refreshes Supabase
    // performs on its own — not just a one-time load.
    supabase.auth.onAuthStateChange((_event, session) => {
      set({ session })
      if (session) void ensureProfile(session, set)
    })
    window.api.auth.onDeepLink((url) => handleAuthDeepLink(url, set))
  },

  signIn: async (email, password) => {
    set({ error: null })
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      set({ error: error.message })
      throw error
    }
  },

  signUp: async (email, password, username) => {
    set({ error: null })
    if (!USERNAME_PATTERN.test(username)) {
      const message = 'Username must be 3-20 characters: letters, numbers, and underscores only.'
      set({ error: message })
      throw new Error(message)
    }
    const { error } = await supabase.auth.signUp({ email, password, options: { data: { username } } })
    if (error) {
      set({ error: error.message })
      throw error
    }
  },

  signInWithGoogle: async () => {
    set({ error: null })
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: 'outcisura://auth-callback', skipBrowserRedirect: true }
    })
    if (error) {
      set({ error: error.message })
      throw error
    }
    // skipBrowserRedirect means Supabase hands back the consent URL instead of navigating there
    // itself — this IS the renderer's own window, and an embedded webview can't complete Google's
    // OAuth flow anyway (Google blocks it), so the system browser opens it instead.
    window.api.auth.openOAuthUrl(data.url)
  },

  signOut: async () => {
    await supabase.auth.signOut()
  }
}))
