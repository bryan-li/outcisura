import Anthropic from '@anthropic-ai/sdk'

/** The signed-in user's Supabase session, pushed here by the renderer (see authStore.ts) whenever
 *  it changes or refreshes — the main process has no Supabase client of its own. Read fresh on
 *  every request, so a refreshed token is picked up without rebuilding any Anthropic client. */
let proxySession: { accessToken: string; supabaseUrl: string } | null = null

export function setProxySession(session: { accessToken: string; supabaseUrl: string } | null): void {
  proxySession = session
}

/** Every AI request goes through the ai-proxy Edge Function, which holds the one Anthropic key and
 *  enforces the signed-in user's plan and credits — see supabase/migrations/0014_ai_proxy.sql and
 *  0018_ai_plans_credits.sql. The proxy speaks Anthropic's own Messages API, so callers use the SDK
 *  exactly as if they were talking to Anthropic directly.
 *
 *  The SDK's `apiKey` is required by its constructor but meaningless here (the proxy authenticates via
 *  the Supabase JWT, and ignores x-api-key). */
export function createAnthropicClient(): Anthropic {
  return new Anthropic({
    apiKey: 'proxy',
    // Placeholder until a session arrives; the fetch wrapper below swaps in the real URL.
    baseURL: 'https://proxy.invalid',
    fetch: async (input, init) => {
      // A synthetic 401, not a thrown error: the SDK turns thrown fetch errors into a vague "Connection
      // error." and retries them, while a 401 surfaces this message once, unretried.
      if (!proxySession) {
        return new Response(
          JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'Sign in to use AI features.' } }),
          { status: 401, headers: { 'content-type': 'application/json' } }
        )
      }
      const original = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      const url = `${proxySession.supabaseUrl}/functions/v1/ai-proxy${original.pathname}${original.search}`
      const headers = new Headers(init?.headers)
      headers.delete('x-api-key')
      headers.set('authorization', `Bearer ${proxySession.accessToken}`)
      return fetch(url, { ...init, headers })
    }
  })
}

/** Tags a request with the app feature that made it, so the admin usage log can say what the money
 *  was spent on, and lets the proxy apply a per-feature credit multiplier. */
export function featureHeader(feature: string): { headers: Record<string, string> } {
  return { headers: { 'x-outcisura-feature': feature } }
}
