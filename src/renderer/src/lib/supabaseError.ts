/** Supabase's PostgrestError (what every `if (error) throw error` against a supabase-js call
 *  actually throws) is a plain object, not an Error subclass — a bare `err instanceof Error` check
 *  misses it and falls through to whatever generic fallback the caller wrote, hiding the real
 *  reason (a trigger's RAISE EXCEPTION message, an RLS refusal, a unique-constraint violation) from
 *  both the user and whoever's debugging it. Use this instead everywhere a Supabase call's error is
 *  shown to the user. */
export function supabaseErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message
  }
  return fallback
}
