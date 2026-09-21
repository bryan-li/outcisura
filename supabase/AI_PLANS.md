# AI plans & credits

How Outcisura meters and monetises AI use. Implemented by `migrations/0018_ai_plans_credits.sql`, the
`ai-proxy` Edge Function, and the Settings / Admin screens. Billing (taking money) is a defined seam, not
built yet — see [What's not built](#whats-not-built).

## Principles

1. **The one Anthropic key lives on the server.** The app has no API key and users can't bring one
   (bring-your-own-key was removed). Every AI call goes app → `ai-proxy` → Anthropic.
2. **Users are limited in credits, never dollars.** A plan promises "N credits a month". What a credit
   *costs us* is a separate, tunable weight, so Anthropic re-pricing a model, or deciding a cheap action
   should feel cheaper, never changes what someone already bought.
3. **Dollars still exist, for us.** `ai_usage.cost_usd` records real spend per request so the admin
   dashboard can show margin (credits sold vs dollars spent, and cost per 1,000 credits).
4. **The server decides, the client displays.** Every limit is enforced in the proxy against the database;
   the UI only shows what the database says.

## The unit: a credit

```
credits = ( input_tokens × model.input_credits_per_mtok
          + output_tokens × model.output_credits_per_mtok ) / 1,000,000
          × feature.multiplier
```

* `ai_model_prices.*_credits_per_mtok` — per-model weights. Independent of the USD columns beside them.
* `ai_feature_weights.multiplier` — optional per-feature scale (`regenerate`, `share_prep`,
  `judge_free_text`, `summarize`, `ocr`). Missing row = 1. Use it to make a feature feel cheaper or dearer
  without touching models.
* Prompt-cache writes/reads are priced at 1.25× / 0.1× input, as Anthropic bills them.

**Launch calibration:** weights are seeded so **1 credit ≈ $0.001 of Anthropic spend** (Sonnet 5: 2,000 in /
10,000 out per million tokens). A typical card regeneration is ~5–10 credits. This is a starting point —
the dashboard's *Cost / 1,000 credits* tile is the number to watch; if it drifts, adjust weights, not plans.

## Plans

`ai_plans` (editable in Admin → Plans):

| plan | credits / period | req / min | models | note |
|------|------------------|-----------|--------|------|
| `free` | 1,000 | 10 | Haiku 4.5, Sonnet 5 | everyone by default (≈ $1) |
| `pro`  | 5,000 | 30 | all enabled | (≈ $5) |
| `max`  | 25,000 | 60 | all enabled | placeholder tier |

`price_cents` exists for display only; the billing provider is the source of truth for what's charged.
Seeded values are placeholders — set real ones from Admin.

## Entitlement: who gets what right now

`ai_entitlement(user)` (service-role only; one round trip for the proxy, `ai_my_status()` wraps it for the
signed-in user) resolves:

* **Plan** — from `ai_subscriptions` if it's `active`/`trialing`/`past_due` and not > 3 days past its
  period end (webhook lag), otherwise `free`.
* **Period** — the subscription's billing period for paid plans; the calendar month (UTC) for free. Usage is
  summed over that window, so credits reset with the billing cycle.
* **Allowance** = `ai_quotas.monthly_credits_override` **or** the plan's credits, **plus** unexpired
  `ai_credit_grants`. An override *replaces* the plan's credits (it's for one-off exceptions); grants *add*.
* **Rate limit** = `ai_quotas.rpm_override` or the plan's.
* **Off switch** — `ai_quotas.disabled`.
* **Models** — the plan's `models` list (null = all enabled).

## Request flow (`ai-proxy`)

```
app ──JWT──▶ authenticate ─▶ reject guests
                   │
        ai_entitlement + model weights + feature multiplier   (parallel)
                   │
   disabled? ─▶ 403   model not on plan? ─▶ 403   over rate limit? ─▶ 429
   credits_remaining ≤ 0? ─▶ 403 "used all N credits on the X plan, reset on <date>"
                   │
             forward to Anthropic (max_tokens capped, no streaming)
                   │
       insert ai_usage { credits, cost_usd, tokens, feature, model }
```

Budget/plan refusals are 403, not 429 — the Anthropic SDK retries 429s, which would just repeat the refusal.
Limits are checked before the call and usage recorded after, so a burst of concurrent requests can overshoot
an allowance by a request or two. Fine at this scale; a hard cap would need reserve-then-settle.

## Data model

| table | who writes | purpose |
|-------|-----------|---------|
| `ai_plans` | admin RPC | plan definitions; public plans readable by anyone (pricing page) |
| `ai_subscriptions` | billing webhook (service role) / `ai_admin_set_plan` (manual comps) | one row per user; absent = free |
| `ai_credit_grants` | `ai_admin_grant_credits` (later: top-up purchases) | one-off credits with expiry |
| `ai_quotas` | `ai_admin_set_quota` | per-user overrides + off switch + note |
| `ai_usage` | proxy only (service role) | append-only ledger: credits + real USD |
| `ai_model_prices`, `ai_feature_weights` | admin RPC | model allow-list, USD prices, credit weights |

RLS: users read only their own subscription/grants/usage; no client write policies exist anywhere on these
tables. Admin actions are `SECURITY DEFINER` RPCs that check `ai_admins` themselves.

## Wiring up billing (Stripe)

The only thing billing has to do is keep `ai_subscriptions` true. Suggested shape:

1. **Checkout** — an Edge Function creates a Stripe Checkout Session for `plan_id`, with
   `client_reference_id = user.id`, and returns the URL. Set `UPGRADE_URL` in `AiAccessSection.tsx` (or make
   it open that function's URL) so the "Get more credits" button appears.
2. **Webhook** — an Edge Function (`verify_jwt` off, Stripe signature verified) handles
   `checkout.session.completed`, `customer.subscription.updated|deleted`, `invoice.payment_failed`, and upserts:
   `plan_id` (map Stripe price → plan), `status`, `current_period_start/end`, `cancel_at_period_end`,
   `provider = 'stripe'`, `provider_customer_id`, `provider_subscription_id`.
3. **Portal** — a Stripe Customer Portal link for managing/cancelling.
4. **Top-ups** (optional) — a one-off Checkout for a credit pack inserts an `ai_credit_grants` row.

Nothing in the proxy changes. `ai_admin_set_plan` refuses to touch a Stripe-owned row, so admin comps and
billing can't fight.

## Operations

* **Deploy order matters once:** 0018 drops `ai_quotas.monthly_budget_usd` and `ai_spent_month()`, which the
  previously deployed proxy reads. Apply the migration and deploy `ai-proxy` together.
* Older app builds' Settings meter reads the old `ai_my_status` shape and will show an error until updated;
  AI calls themselves keep working (they only go through the proxy).
* **Comp someone:** Admin → account row → plan dropdown (30 days, lapses to Free) or `+ credits` (expires at
  period end).
* **Change what a credit costs:** Admin → Models & credit weights / Feature multipliers.
* **Existing per-user budgets** were converted at 1,000 credits per old dollar into `monthly_credits_override`.

## What's not built

* Checkout, webhook, customer portal, pricing page (the schema and proxy are ready for them).
* A dedicated "out of credits" prompt — today the proxy's 403 message surfaces through each feature's normal
  error text, and Settings shows the meter.
* OpenAI Whisper transcription (it needed a personal key). The on-device Whisper engine is the only one; a
  hosted engine metered in credits would need its own proxy route.
* Hard reservation of credits before a call (see the overshoot note above).
