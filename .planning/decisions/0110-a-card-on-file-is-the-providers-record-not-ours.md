# 0110 — A card on file is the provider's record, not ours: Stripe by SetupIntent, no SDK, no charge

- **Status:** proposed — built behind a flag, founder review open
- **Date:** 2026-09-03
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** stripe, payments, setup intent, payment method, webhook, hmac, idempotency, PCI, SAQ-A, provider state, absence-reported-as-health, OD-23, profile, register V
- **Links:** [[0020-no-fabricated-answers]] (the rule this build is a test of), [[0042-iznik-seal-and-warm-charcoal]] (the seal), [[0044-mudavym-implementation-kickoff]] (the flag this ships behind), `.planning/06-pages/profile.md` §9 G10 (the gap this closes), `.planning/decisions/OPEN-DECISIONS.md` OD-23 (pricing — still open, and the reason this build stops where it does)

## Context

`/profile` Register V — *How the house pays* — was built on 2026-09-03 as a real
table (`supabase/migrations/20260903094600_payment_methods.sql`), a real gateway
module (`apps/api-gateway/src/payment-methods/`) and three working routes, with
one deliberate hole: `PaymentMethodsService.assertProviderConnected`
(`payment-methods.service.ts:74-83`) refuses `POST /payment-methods` with 503
while `STRIPE_SECRET_KEY` is unset, and the page's submit is disabled carrying
the same sentence (`PaymentRegister.tsx:284-286`). That was filed as gap **G10**
(`profile.md:538`): *"Everything except the credential is built."*

That claim was **not true**, and this ADR exists because saying it plainly is the
point of the rule it was written under. Measured on this branch, 2026-09-03:

| claim in G10 | measured |
|---|---|
| a provider client exists | **no** — `grep -ril stripe apps/api-gateway/src` matched three files, all in `payment-methods/`, all prose or the string `'stripe'`; zero HTTP calls to any provider |
| a webhook exists | **no** — `grep -rn "stripe" supabase/ apps/api-gateway/src/**/webhook*` empty; the only signed webhooks in the repo are Toast and pos-hub (`pos-hub.controller.ts:72-115`) |
| the `pm_...` reference could be obtained | **no** — nothing mints a SetupIntent, so `CreatePaymentMethodDto.providerRef` (`dto/payment-method.dto.ts:50-52`) was a required field no caller in this product could ever fill |
| `stripe` is a dependency | **no** — absent from `apps/api-gateway/package.json`; `@stripe/stripe-js` absent from `apps/web/package.json` |

So the honest description of the pre-existing state is *the register can list and
delete rows that nothing can create*. Setting `STRIPE_SECRET_KEY` on that tree
would have switched the refusal off and produced a **worse** surface than the
refusal: an enabled form whose four typed fields (`brand`, `last4`, `exp`,
`kind`) would be written straight into `payment_methods` with an operator-invented
`provider_ref`. That is the fabricated-record shape in its purest form — a row
that renders as `Visa ••••4242` and can never be charged — and it was one env var
away.

The founder's instruction for this pass was *"Stripe as the live payment
provider … the build stops at 'a card on file'"*. Four things had to be decided
to do that.

## Options considered

### 1. How to talk to Stripe — the `stripe` npm SDK, or HTTP

1. **`stripe` (official Node SDK).** Types, retries, `webhooks.constructEvent`,
   pagination helpers. Costs: a new production dependency in a pnpm workspace
   three other builders are editing in the same worktree this hour; `pnpm install`
   rewrites the shared `pnpm-lock.yaml`, and `pnpm install --frozen-lockfile` is
   the install command on both Vercel entry points (`vercel.json:3`,
   `apps/web/vercel.json:2`), so a half-written lockfile breaks every deploy, not
   just this feature. The SDK is also ~1.9 MB of surface for four REST calls.
2. **A thin HTTP client over `https://api.stripe.com/v1` using the `axios` already
   in `apps/api-gateway/package.json:44`.** Four calls (`POST /customers`,
   `POST /setup_intents`, `GET /payment_methods`, `POST /payment_methods/:id/detach`),
   form-encoded, `Stripe-Version` pinned, `Idempotency-Key` on every write.
   Signature verification is 12 lines of `node:crypto`. Costs: we own the retry
   and error-shape code, and a Stripe API change is ours to notice.
3. **Do nothing — leave the 503.** Costs: the register stays a list of rows
   nothing can create, and the founder's instruction is unmet.

### 2. Where the card is collected — our form, a Stripe hosted page, or Stripe Elements

1. **Our own card fields, posted to our gateway.** Puts the product in **PCI DSS
   SAQ-D**: the PAN transits our server. Rejected on sight; the existing migration
   header already refuses to have a column for it
   (`20260903094600_payment_methods.sql:22-27`).
2. **Stripe Checkout / hosted Billing Portal (a redirect).** Least code, and it
   is a whole second visual language in the middle of a page whose entire argument
   is one row shape. Also carries pricing furniture we have no prices for (OD-23).
3. **Stripe Elements mounted in Register V, confirming a SetupIntent.** The card
   fields are Stripe's iframes on Stripe's origin, so the PAN never touches our
   DOM or our server (**SAQ-A**); the page keeps its own layout; and what we
   receive is a `pm_...` reference, which is exactly the one field the DTO already
   requires and nothing could previously supply.

### 3. How Stripe.js gets into the page — npm package, or Stripe's own host

1. **`@stripe/stripe-js` + `@stripe/react-stripe-js`.** The ergonomic answer, and
   `@stripe/stripe-js` is itself only a loader: it injects
   `<script src="https://js.stripe.com/v3">` at runtime, because Stripe's terms
   require the script be served from their domain and forbid bundling it. So the
   packages buy typings and an `<Elements>` context, not a different network path.
   Cost is the same shared-lockfile risk as (1) above.
2. **Inject `https://js.stripe.com/v3` directly, from a 40-line loader in the
   page's own directory.** Measured before choosing: this app ships **no
   Content-Security-Policy at all** — no `<meta http-equiv>` in
   `apps/web/index.html`, no `headers` entry naming CSP in either `vercel.json`,
   and no `helmet` anywhere in `apps/api-gateway/`. So there is no allow-list to
   add a host to, and nothing to break. Cost: we hand-write the `window.Stripe`
   typings we use (six methods), and if a CSP is ever added, `script-src` must
   name `js.stripe.com` — which would be true of the npm package too.

### 4. What the webhook is for

1. **No webhook; sync on demand.** The register would be correct only while
   somebody is looking at it. A card that expires, or is removed from the Stripe
   dashboard, would stay on the page indefinitely — the register would report
   absence of news as health.
2. **A signed webhook with a schema-enforced idempotency key**, plus an explicit
   `POST /billing/sync` the page can call after a confirmation so the row appears
   without waiting for delivery.

## Decision

**Stripe is reached over plain HTTP with the dependencies already installed; the
card is collected by Stripe Elements against a SetupIntent so no PAN reaches us;
Stripe.js is loaded from `js.stripe.com` because there is no CSP to allow it
through; and the webhook is signature-verified with idempotency enforced by a
primary key rather than by code.** Options 1.2, 2.3, 3.2, 4.2.

Four things carried it.

**The lockfile is shared and the install command is `--frozen-lockfile`.** Adding
either dependency is a change to a file three concurrent builders on this branch
also touch, gating both Vercel deploys, for typings and a React context we can
write in an afternoon. The npm route buys nothing on the network path — the
script still comes from `js.stripe.com` either way — so the risk buys ergonomics
only.

**The reference is the record; everything else is a copy.** `provider_ref` is the
only column the provider cannot disagree with us about. `brand`, `last4`, `exp`
and now `provider_type` are all *the provider's answer, cached*, and this build
stamps `synced_at` on each so the page can say **when** it last agreed with
Stripe rather than implying it agrees now.

**No charge, and the code cannot express one.** `StripeClient` has four methods
and none of them is `POST /payment_intents` or `POST /charges`; a
`FORBIDDEN_PATHS` guard in the client throws before the request is built if a
caller ever names one (`stripe.client.ts`). Pricing is OD-23 and open; a product
that can take money before it has a price is the surface `DESIGN-FOUNDATION` §6
tells us to refuse.

**Every seam reports presence, not absence.** The provider state is no longer one
boolean. It names each of the three secrets separately, derives `mode` from the
key prefix (`sk_test_` → test, `sk_live_` → live, anything else → `unknown`,
never a guess), and — the line that matters — reports `webhookLastReceivedAt`,
so a webhook secret that is configured and has **never had a delivery** reads as
*"configured, never delivered"* and not as *"working"*. That is the
absence-reported-as-health inversion caught at the one seam where it is most
expensive: the seam that tells us a card was removed.

### The ADR number

Taken **0110**, and the route to it is worth recording because it is the failure
mode this repo already has a memory about.

`python3 scripts/check_adr_numbers_unique.py` reported *"Next free number, swept
across 617 refs: 0102"*, and 0102 was written. That sweep reads **refs**, so it
cannot see a number claimed in an unpushed peer worktree — and four builders were
filing ADRs into this one checkout within the same hour. Re-measured at the end
of the build, across `git -C /Users/aldemirkonuk/Projects/restaurant-ai-automation
worktree list` (44 worktrees) rather than refs alone:

| number | held by | where |
|---|---|---|
| 0103, 0104, 0105 | another session's ADR batch | `wt-adr-9d440f0f` |
| 0106 | `every-dependabot-pr-resolved-by-measurement` | `wt-deps` |
| 0107 | build D, MCP runtime | this worktree |
| 0108 | build C, cellar registers | this worktree |
| 0109 | build B, calendar reminders | this worktree (renumbered from 0106 after colliding with `wt-deps`) |
| **0110** | **this ADR** | free in every worktree and on all 622 refs at the time of writing |

0102 was in fact free everywhere at the final measurement — an earlier report
that `wt-deps` held a second 0102 was itself stale by the time it was read, which
is the same class of error one level up. **0110** was taken on the parent's
instruction to move above the highest claimed number rather than argue about a
number that had already been reported two different ways in one hour. That is the
right trade: an ADR number costs nothing and a collision costs a rename across
seventeen files, which is what this one cost.

The durable lesson, and it is not new: `next_free()` sees refs, `git worktree
list` sees the rest, and **the only sufficient check is the one run after the
file is written**. Re-run both before pushing.

## Consequences

**Easier.**

- Connecting the provider is now three environment variables and nothing else:
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (gateway) and
  `VITE_STRIPE_PUBLISHABLE_KEY` (browser). Every code path above them is built
  and tested with a stubbed client; the page names the missing variable by name.
- A card removed in the Stripe dashboard disappears from the register, because
  `payment_method.detached` is handled and `billing_webhook_events` makes the
  handling exactly-once.
- Adding a second provider is a `provider` value, a client, and the same three
  seams — the row shape, `provider_ref` and `provider_type` already carry it.

**Harder, or given up.**

- We own the Stripe wire format. `STRIPE_API_VERSION` is pinned (default
  `2024-06-20`) precisely so an upstream change is a deliberate bump rather than
  a surprise, but nobody will hand us a deprecation warning.
- No `<Elements>` React context, so the Payment Element is mounted and unmounted
  imperatively in one effect. That is 30 lines that the npm package would have
  hidden.
- `payment_methods.kind` gained `'other'`. Stripe has ~30 payment-method types
  and our register offers four; forcing an unmapped type into `card` would be a
  quiet lie, so an unmapped instrument is filed as `other` and the row prints
  Stripe's own word for it from `provider_type`.

**What would trigger revisiting this.**

- **A second Stripe surface** — invoices, subscriptions, or any endpoint that
  moves money. At that point the SDK's retry/idempotency/pagination handling
  starts paying for itself and the dependency should be taken deliberately, in
  its own PR, not smuggled in beside a page rebuild.
- **A CSP being introduced.** `script-src` must then name `https://js.stripe.com`
  and `frame-src` must name `https://js.stripe.com` and
  `https://hooks.stripe.com`, or the card fields silently do not render.
- **OD-23 closing with a price.** The build deliberately stops at *a card on
  file*; the first charge is a different decision with a different blast radius.
- **`webhookLastReceivedAt` staying null after the secret is set.** That is the
  signal the endpoint was never registered in the Stripe dashboard, and it is
  surfaced on the page rather than left for someone to notice.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-03 | — | Created; built behind `mudavym_design_profile`, founder review open |

---

## Addendum — 2026-09-04: a card-on-file change is REDEEMED, not asserted

**Founder decision, 2026-09-04**, the same one recorded in ADR 0116's addendum:
challenge-and-redeem extends from MCP tool writes to order approval and to
payments.

**Why here, given this ADR's own headline is that nothing charges anybody.** The
seal is not protecting a payment; it is protecting the *setup* for one. The three
writes that exist decide which instrument the provider is told to charge first
and which instruments stay attached at all. Every one of them ran
`assertCanManageRestaurant` and nothing else — which answers *may this role* and
cannot answer *did a person*. An attacker holding a manager's session could
quietly attach their own instrument as the default and wait for the charge path
to arrive. Doing this before money moves is the only order in which it is cheap.

**What changed.**

- `POST /payment-methods/seal-challenge` mints a one-time, 120-second token for
  one act — `create`, `set_default` or `remove` — at the moment the hold begins.
- `POST /payment-methods`, `PATCH /payment-methods/:id/default` and
  `DELETE /payment-methods/:id` each redeem it, from `X-Seal-Challenge`, after
  the role check and **before** the write. An absent seal is refused before the
  instrument is even read, so a caller with no seal gets the sentence telling
  them to begin the hold rather than whatever the read happened to say.
- **The card the manager was looking at is hashed into the seal**: a token minted
  against "Visa ····4242" cannot be spent after the row behind that id became a
  different card.
- `create` has no instrument yet, so its subject is the **house's register** —
  the restaurant's id — stated in `payment-methods/payment-seal.ts` rather than
  inferred. A `create` seal still cannot pay for a `remove`, because the act is
  part of the binding.

**Proven by** `payment-methods.seal.spec.ts` (14 cases, all failing against the
pre-pass controller because it wrote with no seal at all) and, live on `:4000`, a
403 carrying the whole sentence for a `DELETE` with no seal. A successful
redemption is NOT proven live: the local Supabase has neither `payment_methods`
nor `mcp_seal_challenges`.

---

### Addendum status — 2026-09-04, the browser half (G-PAY-SEAL)

**The page caught up the same day.** What this addendum listed as NOT built —
`PaymentRegister.tsx` rendering plain buttons the gateway would refuse — is
built. *Charge this first* and *Remove* are `HoldToApprove` on both surfaces that
carry the register: `/profile` Register V (`PaymentRegister.tsx`, `SealedControl`;
hook `useProfileNextData.ts` — `mintPaymentSeal`, `setDefaultPaymentMethod`,
`removePaymentMethod`) and `/connections` Register II (`ConnectionsNext.tsx`;
hook `useConnectionsNextData.ts` — `paymentSeal`, `setDefaultPayment`,
`removePayment`). On `/connections` the two controls did not exist to convert:
the collapse had left them disabled placeholders, so this closed half of
`connections.md` §9 G-C9 at the same time. The mint runs on `onChallenge` — when
the gesture begins — the write carries `X-Seal-Challenge`, a mint that fails
approves nothing and says so, and a 403 reaches the operator as this addendum's
own sentence rather than as a status code.

**Proven by** 106 page tests (63 `/profile`, 43 `/connections`), twelve of which
fail against HEAD copies of the two directories, and by the two read-only refusal
curls above re-run on the current tree.

**One thing this addendum claims that the product does not yet deliver.**
`create` is sealed here and **nothing calls it**: `POST /payment-methods` has no
caller in `apps/web` or `apps/mobile` (grep, 2026-09-04). A card is attached by
confirming a SetupIntent on Stripe's origin and then reconciling —
`POST /billing/setup-intent` and `POST /billing/sync` — and neither redeems a
seal. So the attack this addendum names in its own second paragraph, *"an
attacker attaches their own instrument"*, is guarded on the route nobody uses.
Sealing `/billing/setup-intent` needs no new subject: `payment-seal.ts` already
defines `create`'s subject as the house's register. It was not done here because
`apps/api-gateway/src/billing/**` was outside the pass's named modules. Filed as
`profile.md` §9 **G-PAY-SETUP**, and it is a founder call whether to seal that
route or to route the panel through the sealed `create` instead.
