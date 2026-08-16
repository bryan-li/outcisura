import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// A warning rather than a throw here — this module is imported eagerly by anything that uses it,
// and during Phase 0's build-out (before a Supabase project exists) the env vars are legitimately
// empty. Once the auth gate and shim layer actually call this client, a missing URL/key surfaces
// as a clear network error at that call site instead.
if (!url || !anonKey) {
  console.warn(
    'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set — add them to .env once the ' +
      'Supabase project exists (Project Settings > API).'
  )
}

// Not typed against a generated `Database` schema yet — that requires `supabase gen types
// typescript` run against a real project, which doesn't exist until the account/project setup
// step is done. Run that once it does and pass the result as createClient<Database>(...) rather
// than hand-writing a type here that could drift from what Supabase actually creates.
export const supabase = createClient(url, anonKey)
