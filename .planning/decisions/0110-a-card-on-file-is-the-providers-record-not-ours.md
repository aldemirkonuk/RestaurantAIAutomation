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

---

## Addendum — 2026-09-05: the census, and the door the seal was missing from (G-PAY-SETUP)

**Founder decision, 2026-09-05**, verbatim: *"verify the pipeline, make sure its
bulletproof, and covers all possible future routes."* Of the two options put, the
founder chose **option 1 — seal the setup-intent route**: the hold mints before
Stripe opens, the intent is issued only against a redeemed seal, and billing sync
checks the same subject. (Option 2 — route the card panel through the already
sealed `POST /payment-methods` — was rejected because it would have made the
browser record an instrument from its own confirmation rather than from the
provider's answer, which is the one thing the register's whole design refuses.)

### What the previous addendum got right, and what that cost

Its closing section is quoted above and it was correct: `create` was sealed on a
route with no caller. What it did not say is that this was a **module boundary**,
not an oversight in judgement — the pass named `payment-methods/**` as its scope,
and `billing/**` sat outside it holding the route that actually attaches an
instrument. That is why the answer here is a census and a guard rather than one
more careful pass.

### The census — measured 2026-09-05 on `feat/mudavym-design-p4` @ `3ab6302a`

Every route in the gateway that can add, replace, prefer or remove the instrument
this house is charged on. Commands: `grep -rn "@\(Post\|Put\|Patch\|Delete\|All\)("
--include="*.controller.ts" apps/api-gateway/src/{payment-methods,billing}` for the
routes; `grep -rln 'from("payment_methods")\|from("billing_customers")\|from("billing_webhook_events")'
--include="*.ts" apps/api-gateway/src services` for the writers (five files, all
inside those two modules); `grep -rn "@Cron\|@Interval\|@Timeout" apps/api-gateway/src/{billing,payment-methods}`
→ **0**. There is no subscriptions module, no plan, no autopay and no credit
account: the only three `*.controller.ts` matching `subscription` are an iCal
feed, a Gmail Pub/Sub push and a Web Push registration.

| Route | What it can change | Who may call it today | Redeems a seal | Decision |
|---|---|---|---|---|
| `POST /payment-methods/seal-challenge` | Nothing about an instrument — inserts one 120s challenge row | manager/owner of the house | n/a | **allow-listed**: requiring a seal to obtain a seal is circular |
| `GET /payment-methods` | Nothing (read) | manager/owner (G19) | n/a | out of scope — read |
| `POST /payment-methods` | Records an instrument in the register | manager/owner | **yes** (`create`) | sealed 2026-09-04. Still has no caller; kept because it is the route a server-side recorder would use |
| `PATCH /payment-methods/:id/default` | Which instrument the provider charges first | manager/owner | **yes** (`set_default`) | sealed 2026-09-04 |
| `DELETE /payment-methods/:id` | Detaches at the provider, drops the row | manager/owner | **yes** (`remove`) | sealed 2026-09-04 |
| `GET /billing/provider` | Nothing (read) | manager/owner (G19) | n/a | out of scope — read |
| `POST /billing/setup-intent` | **Hands out the capability to attach an instrument** | manager/owner | **yes** (`create`) — **new** | **sealed here.** The client secret is the whole capability: whoever holds one attaches a card on Stripe's origin, where no guard of ours reaches. Redeemed BEFORE the provider is touched |
| `POST /billing/sync` | Mirrors the provider's list into the register; drops rows the provider no longer has | manager/owner | **conditionally** — **new** | **verifies, does not spend.** With `setupIntentId`: the seal id is read back FROM STRIPE off that intent and proven redeemed by this person for this house. Without it: a plain reconcile, deliberately unsealed (below) |
| `POST /billing/webhook` | Upserts and removes register rows | **anyone** — `@Public()` | no | **allow-listed**: not a person's act (below) |

Two service surfaces have no route of their own and are named so the census is not
a list of doors with a window left out. `BillingCustomerService.ensure` opens the
Stripe customer and is reachable only from `createSetupIntent`, now behind the
seal. `PaymentMethodMirrorService` writes every `payment_methods` row in the
module and is reachable only from `sync` and from the webhook. `procurement/credits`
is **out of scope and named**: those are vendor credit notes — money a supplier
owes the house on a delivery — not what the house is charged by us.

### The webhook: what proves it, and what stops a replay

It is `@Public()` because the caller is Stripe and holds no JWT. Four things
stand in for the seal, and none of them is "we trust the URL":

1. **HMAC-SHA256 over the exact request bytes.** `verifyStripeSignature`
   (`billing/stripe-signature.ts`) recomputes `HMAC(${t}.${rawBody})` under
   `STRIPE_WEBHOOK_SECRET` and compares with `crypto.timingSafeEqual`. `rawBody`
   is what Express received (`main.ts` sets `rawBody: true`), never a
   re-serialisation. It **fails closed** on a missing secret
   (`stripe-signature.ts:100-102`) — an endpoint that accepted everything because
   it was never configured is the absence-as-health shape at its most expensive,
   because it writes.
2. **A five-minute replay window.** `STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300`
   (`stripe-signature.ts:39`, checked at `:113-116`). A captured delivery is
   worthless six minutes later even with a valid signature.
3. **Exactly-once by PRIMARY KEY.** `billing_webhook_events` keys on the
   provider's event id, so a redelivery inside the window cannot re-apply an
   effect. The subtle half is deliberate: a delivery CLAIMED and then failed
   halfway is left `handled = false` and IS reprocessed on redelivery, so a
   transient database error cannot permanently swallow the event that says a card
   was removed.
4. **The event body cannot name its own restaurant.** The house is resolved from
   `billing_customers` by the Stripe customer id (`billing.service.ts:360`), and
   `setup_intent.succeeded` re-fetches the payment method from Stripe rather than
   trusting the object in the event.

So a replayed webhook cannot attach an instrument the house never held: to be
accepted at all it must be a genuine Stripe delivery, inside five minutes, with an
event id never completed here, naming a customer already linked to this house —
and the instrument it names is re-read from Stripe, where it must actually exist.
What a valid webhook CAN do is record an instrument attached at Stripe by someone
with dashboard access. That is a Stripe-account fact, not a hole in this product,
and it is exactly what `payment_method.attached` exists to reflect.

### Why the plain reconcile stays unsealed — argued, not assumed

`POST /billing/sync` with no `setupIntentId` is the register's refresh button and
is **not** sealed. The strongest case against that: a manager's stolen session can
still cause writes to `payment_methods`. It survives three tests:

- With `setup-intent` sealed, **no session can attach an instrument**, so the
  provider's list holds only what this house approved. Reconciling writes that
  list back.
- Reconcile **cannot choose which instrument is charged first** — `is_default` is
  not in `MirrorRow` — and cannot invent a field: every column comes from the
  provider object, `null` where the provider is silent.
- The **identical rows arrive unsealed anyway** through `payment_method.attached`,
  which is Stripe's act. Sealing the refresh would refuse a button while changing
  nothing an attacker could do — security theatre with a cost.

To keep that from becoming absence-reported-as-health, `SyncResponse` now carries
`provenance: "sealed-intent" | "reconcile-only"`. A reconciliation that skipped
the seal check no longer returns the same shape as one that passed it.

### The mechanism: two requests, one seal

The seal cannot be redeemed at `sync` — by then the instrument is already attached
at Stripe, and refusing afterwards is an audit trail, not a guard. It cannot be
redeemed twice either. So:

    POST /payment-methods/seal-challenge {"act":"create"}   -> a 120s token
    POST /billing/setup-intent  X-Seal-Challenge: <token>   -> SPENDS it, and
                                stamps the spent seal's id into the SetupIntent's
                                metadata at Stripe
    (the card is typed and confirmed on Stripe's origin)
    POST /billing/sync {"setupIntentId": "seti_..."}        -> reads that id back
                                FROM STRIPE and proves it was redeemed by this
                                person, for this house's register, for `create`

The browser authors neither half of the pairing: it never supplies the seal id,
and the metadata it would have to forge lives at the provider. `redeem` now
returns `{ sealId }` — the receipt, not a status — and `assertRedeemed` is the new
mirror of it, with its own refusal (`unredeemed`, `seal-subject.ts`) for the case
that matters most: a seal that exists and was never spent proves nothing.

`create`'s binding at `/billing/setup-intent` is **byte-identical** to the one
`POST /payment-methods` redeems, deliberately. One seal is spendable at either
route and, being single use, at only one of them. "Permission to put one
instrument on file" is one permission; which route records it is our plumbing.

### What was rejected

- *A `setup_intent` subject kind.* The subject is the house's register either way;
  a second kind would mean a `create` seal minted on the page could not be spent
  by the route that opens the form, for no gain.
- *Redeeming a second seal at `sync`.* Two seals for one attach, the second
  arriving after the instrument already exists at the provider.
- *Sealing the plain reconcile.* Argued above.
- *Checking `expires_at` in `assertRedeemed`.* The TTL bounds when a seal may be
  SPENT, and it was spent inside it. Refusing later would mean a card form held
  open through a 3-D Secure step recorded nothing, with a sentence blaming the
  operator for the bank.

### The guard, because the next boundary is not this one

`scripts/check_money_routes_are_sealed.py` enumerates every non-GET route under
`payment-methods/**` and `billing/**` and requires each to reach a redemption
primitive in its own call graph — following private helpers and injected services
within those modules, reading **code only** (comments are blanked first; these
controllers discuss `redeem` at length in prose) — or to carry an allow-list row
with the sentence that makes the exemption true. Two rows exist: the webhook and
the mint. It exits 2 when it cannot check, **including on a stale allow-list row**,
because an exemption that stops matching anything still reads like a decision in
force. Wired into `ci.yml` beside `check_route_exposure.py`, with its self-test.

**Measured, and it caught itself.** Run on the current tree it printed 5 sealed, 2
allow-listed, 2 reads, exit 0. Run on a `git show HEAD:` copy of the four
directories under `p4-scratch/p4ae/prefix-tree` it printed **FAIL, exit 1**, naming
`billing.controller.ts` `setupIntent` and `sync` — exactly the two routes this
addendum seals. Its first version reported all five sealed routes as UNSEALED
because handler signatures in this codebase contain
`@Req() req: Request & { user: AuthenticatedUser }` and its brace counter closed on
the parameter list; the fixed version balances parentheses first. That bug is in
its docstring, because a guard proved only against fixtures would have shipped
confidently reporting the opposite of the truth. Probes, then deleted: a renamed
route in the allow-list → exit 2; a deleted money module → exit 2; renaming
`redeem` in the seal service → **exit 1**, every route UNSEALED (loud and closed —
the docstring says so rather than claiming exit 2).

### Proven by

`npx jest src/billing src/payment-methods src/common/seal` — **9 suites, 111
tests, all passing** on the tree this addendum describes. Twelve of them are new
(`billing/billing.seal.spec.ts`).

**Pre-fix, measured rather than asserted.** The six files this pass changed under
`billing/**` and `common/seal/**` were replaced with `git show HEAD:` copies (the
originals saved to `p4-scratch/p4ae/mine/` first and restored after, verified byte
-identical by `diff -q`; no git state change), and the same suite run:
**10 of 12 failed**, log at `p4-scratch/p4ae/prefix-spec-run.txt`. That controller
mints an intent with no seal at all and that `sync` takes no body.

The two that passed before and after are cases 5 and 11, and both are the
manager-or-owner check, which HEAD already ran. They are in the suite on purpose:
a suite that only proved the new refusals would not notice a pass that quietly
removed the role check underneath them. Case 10 — the plain reconcile stays open —
is a behaviour this pass deliberately did NOT change, and it still failed pre-fix,
because `provenance` is the new field that makes the skipped check legible; the
reconcile worked before, it just could not say that nothing had been proven.

Live, read-only, against the local gateway on production Supabase with **no**
Stripe key (`p4-scratch/p4ae/live-refusals.txt`):

    POST /api/v1/billing/setup-intent   (no X-Seal-Challenge)  -> HTTP 403
      "This payment method is sealed, and a seal must be proven rather than
       asserted. Begin the hold on the payment method: it issues a one-time seal
       that the write has to carry back. Nothing was changed."

Nothing was created at the provider: the refusal happens before `BillingService`
is reached. `POST /billing/sync` naming an intent answered 503 with the provider's
own reason, because `sealOnSetupIntent` asserts the credential before it can ask
Stripe anything — it could not verify, so it reconciled nothing. **Not exercised:
a successful redemption end to end.** That needs a Stripe key this deployment does
not have, and the local Supabase has neither `payment_methods` nor
`mcp_seal_challenges`.

### NOT built here, and it is user-visible

**The browser half.** `StripeCardPanel.tsx` still calls `createSetupIntent()` with
no seal, so **adding a card is refused on both surfaces until it mints** — the same
deliberate, explained refusal ADR 0116's addendum took for the legacy orders page,
and the one thing here a founder should look at before this merges. The panel is
builder p4y's file and was mid-flight during this pass (its earlier port was lost
in the 2026-09-05 scratchpad wipe), so the hunks are written and left ready rather
than applied: `p4-scratch/p4ae/client-mint-for-setup-intent.patch.md`. They move
the hold to the front of the panel — *Hold to open the card form* mints `create`
and spends it on the intent; the existing hold then confirms and syncs naming the
intent — because Elements needs the client secret before it can mount the fields,
so a seal minted on the existing hold would be minted after the capability it
authorises had been handed out.

**No pytest file.** The repo's guards are self-tested through `--self-test` and CI
runs pytest only against `services/agent-orchestrator/tests/`; a pytest file beside
this script would never be executed. The self-test is wired as its own CI step
instead, which is the same assertion in the place that runs it.

### Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-05 | — | Census measured; `POST /billing/setup-intent` sealed, `POST /billing/sync` verifies; guard + CI; browser half left as ready hunks. G-PAY-SETUP closed on the gateway, open on the page. |
