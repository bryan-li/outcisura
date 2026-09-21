// Outcisura's Anthropic proxy. The desktop app points the Anthropic SDK's baseURL here and sends
// the signed-in user's Supabase JWT instead of an API key; this function is the only thing that
// ever holds the real key (Edge Function secret ANTHROPIC_API_KEY).
//
// Per request: authenticate -> reject guests -> check the model is allowed -> check the account
// isn't disabled, is within its per-minute rate limit and has budget left this month -> forward
// to Anthropic verbatim -> log what it cost. The request/response bodies are Anthropic's own
// Messages API shapes, untouched, so the app's existing call sites keep working unchanged.
//
// Limits are checked BEFORE the call and usage recorded AFTER it, so a burst of concurrent
// requests can overshoot a budget by a request or two. Fine at this scale; a hard cap would need a
// reserve-then-settle step.
//
// verify_jwt is off at the gateway on purpose: this function authenticates the caller itself via
// auth.getUser(), which works regardless of how the project's JWT signing keys are configured.

import { createClient } from 'npm:@supabase/supabase-js@2'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01'
/** Output ceiling per request, whatever the client asked for — one bad request can't run up a huge bill. */
const MAX_TOKENS_CAP = 8192

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false }
})

/** Anthropic-shaped error body, so the SDK on the client raises a readable message. */
function fail(status: number, type: string, message: string, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ type: 'error', error: { type, message } }), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders }
  })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST' || !new URL(req.url).pathname.endsWith('/v1/messages')) {
    return fail(404, 'not_found_error', 'Only POST /v1/messages is supported.')
  }

  // --- Who is calling ---
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return fail(401, 'authentication_error', 'Sign in to use AI features.')
  const { data: userData, error: userError } = await supabase.auth.getUser(token)
  const user = userData?.user
  if (userError || !user) return fail(401, 'authentication_error', 'Your session has expired — sign in again.')
  if (user.is_anonymous) return fail(403, 'permission_error', 'AI features need a full account, not a guest session.')

  // --- What they're asking for ---
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return fail(400, 'invalid_request_error', 'Request body must be JSON.')
  }
  if (body.stream) return fail(400, 'invalid_request_error', 'Streaming is not supported through the proxy.')
  const model = typeof body.model === 'string' ? body.model : ''
  const feature = req.headers.get('x-outcisura-feature') ?? 'unknown'

  const { data: price } = await supabase.from('ai_model_prices').select('*').eq('model', model).maybeSingle()
  if (!price || !price.enabled) return fail(400, 'invalid_request_error', `Model "${model}" is not available on this server.`)

  // --- May they? (403 not 429 for budget/disabled: the SDK retries 429s, which would just repeat the refusal) ---
  const { data: quota } = await supabase.from('ai_quotas').select('*').eq('user_id', user.id).maybeSingle()
  const budget = Number(quota?.monthly_budget_usd ?? 0)
  const rpm = Number(quota?.requests_per_minute ?? 20)
  if (quota?.disabled) return fail(403, 'permission_error', 'Your AI access has been turned off. Ask the admin.')

  const { count: recent } = await supabase
    .from('ai_usage')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', new Date(Date.now() - 60_000).toISOString())
  if ((recent ?? 0) >= rpm) return fail(429, 'rate_limit_error', 'Too many AI requests this minute — try again shortly.', { 'retry-after': '15' })

  const { data: spentData } = await supabase.rpc('ai_spent_month', { p_user: user.id })
  const spent = Number(spentData ?? 0)
  if (spent >= budget) {
    return fail(
      403,
      'permission_error',
      budget === 0
        ? 'You have no AI budget yet. Ask the admin to enable it for your account.'
        : `You've used your AI budget for this month ($${spent.toFixed(2)} of $${budget.toFixed(2)}). It resets on the 1st.`
    )
  }

  // --- Forward ---
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!anthropicKey) return fail(500, 'api_error', 'AI proxy is not configured: the ANTHROPIC_API_KEY secret is missing.')

  const maxTokens = typeof body.max_tokens === 'number' ? Math.min(body.max_tokens, MAX_TOKENS_CAP) : MAX_TOKENS_CAP
  const upstreamHeaders: Record<string, string> = {
    'content-type': 'application/json',
    'x-api-key': anthropicKey,
    'anthropic-version': req.headers.get('anthropic-version') ?? DEFAULT_ANTHROPIC_VERSION
  }
  const beta = req.headers.get('anthropic-beta')
  if (beta) upstreamHeaders['anthropic-beta'] = beta

  const upstream = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: upstreamHeaders,
    body: JSON.stringify({ ...body, max_tokens: maxTokens })
  })
  const text = await upstream.text()

  // --- Record what it cost (only when Anthropic actually did the work) ---
  if (upstream.ok) {
    try {
      const usage = JSON.parse(text).usage ?? {}
      const inputTokens = Number(usage.input_tokens ?? 0)
      const outputTokens = Number(usage.output_tokens ?? 0)
      // Cache writes bill at 1.25x input, cache reads at 0.1x — the app doesn't use prompt caching
      // today, but pricing it correctly means turning it on later can't silently under-count.
      const inputEquivalent =
        inputTokens + Number(usage.cache_creation_input_tokens ?? 0) * 1.25 + Number(usage.cache_read_input_tokens ?? 0) * 0.1
      const cost =
        (inputEquivalent * Number(price.input_usd_per_mtok) + outputTokens * Number(price.output_usd_per_mtok)) / 1_000_000
      await supabase.from('ai_usage').insert({
        user_id: user.id,
        feature,
        model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: cost.toFixed(6)
      })
    } catch (err) {
      // The user got their answer; a logging failure shouldn't turn that into an error. It does mean
      // this call went unbilled, so surface it loudly in the function logs.
      console.error('ai-proxy: failed to record usage', err)
    }
  }

  return new Response(text, { status: upstream.status, headers: { 'content-type': 'application/json' } })
})
