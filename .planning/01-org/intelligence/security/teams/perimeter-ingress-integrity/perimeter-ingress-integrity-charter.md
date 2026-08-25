---
type: charter
division: intelligence
department: security
team: perimeter-ingress-integrity
status: partial
metrics: [sec.unverified_public_ingress, sec.fail_open_defaults, sec.distributed_rate_limit_present, sec.secrets_in_url_or_bundle]
updated: 2026-08-24
links: ["[[security-charter]]", "[[perimeter-ingress-integrity-premortem]]", "[[perimeter-ingress-integrity-agenda-full]]", "[[perimeter-ingress-integrity-agenda-board]]", "[[perimeter-ingress-integrity-directive]]", "[[perimeter-ingress-integrity-loops]]", "[[perimeter-ingress-integrity-schedule]]", "[[access-control-tenant-isolation-charter]]", "[[ai-surface-security-charter]]", "[[integration-engineering-charter]]", "[[platform-api-charter]]", "[[engineering-charter]]", "[[ENDPOINTS]]", "[[EXTERNAL_CONNECTIONS]]", "[[OPEN-DECISIONS]]"]
---

# Perimeter & Ingress Integrity — Charter

Division **Intelligence** → Department [[security-charter]] → Team
`perimeter-ingress-integrity` (SEC-2, `.planning/foundation/teams/intelligence.md:251-294`).

> ⬦ **Staffing note.** This charter is recommended to be held by the **same team** as
> [[access-control-tenant-isolation-charter]] until the endpoint campaign ships
> (INTEL-F4, `intelligence.md:190-199`). Written separately because the charters genuinely
> diverge once that campaign is over — not because two teams should start today.

## Mandate

Own **every unauthenticated request that is supposed to be unauthenticated**: webhook
signature verification, public-content routes, CORS, rate limiting, and secrets handling.
Where [[access-control-tenant-isolation-charter]] rejects the identity-less request, this
charter accepts it **and proves where it came from**.

## Boundaries

Owns outright:

- **Signature and shared-secret verification** on every ingress route, and the
  fail-closed default underneath it.
- **Public-content controls** — publish-state checks and enumeration resistance on routes
  where origin proof is impossible by design.
- **CORS policy** and the origin allowlist.
- **Rate limiting** — tiers, storage, and whether the limit is real across instances.
- **Secrets handling** — the 80 environment variables, fail-open defaults, credentials in
  URLs, and secrets reaching the frontend bundle.

## Distinct from siblings because

**The sibling's answer to an unauthenticated request is "reject it." This charter's is
"accept it, and prove it came from who it claims."** Merging the two permanently means the
second question gets answered with the first team's tool — which is how a webhook ends up
behind a JWT and an integration silently breaks at 3am. A guard cannot secure a webhook and
an HMAC cannot scope a tenant.

**[[ai-surface-security-charter]]** is distinct because its attacker's request passes every
control this charter owns. A perfectly signed, perfectly rate-limited, perfectly
CORS-compliant payload can carry hostile instructions in its body.

**[[integration-engineering-charter]]** (Engineering) owns the code that speaks a third
party's protocol. We own whether the protocol's authenticity claim is actually checked.
They author the wire; we specify the proof.

## Metrics it moves

**Primary: `sec.unverified_public_ingress`** — public routes accepting a request without a
verified signature, shared secret, or explicit publish-state check. Name taken from
`intelligence.md:287`.

The division doc records the baseline as *"unknown by design"*. **A provisional reading is
now available and is better than unknown** — 43 routes are in scope and their controls can
be read from source today:

| Module | Routes | Control today | Grade |
|---|---|---|---|
| `pos-hub` | 10 | HMAC-SHA256 over raw body, fail-closed (`pos-hub.service.ts:87-95`), enforced at `pos-hub.controller.ts:71-75`, **tested** (`pos-hub.service.spec.ts:239-252`) | ✅ verified |
| `toast` | 10 | HMAC-SHA256 over raw body, fail-closed with a written rationale (`toast.service.ts:106-130`, esp. `:112-121`) | ✅ verified |
| `simpos` | 11 | **None.** Labelled a webhook module (`ENDPOINTS.md:536`); it is an unguarded simulator control surface | 🔴 no control, misclassified |
| `communications/test/e2e/*` | 9 | **None.** `@Public()`, deliberately, and they trigger real vendor email | 🔴 no control |
| `vendor-portal` | 2 | `@Public()` with a written rationale (`vendor-portal.controller.ts:6-13`); publish-state via `getPublishedPage` | ❓ unaudited — enumeration + publish-state |
| `inbound-email` | 1 | Shared secret via `x-inbound-secret` header **or `?secret=` query**; fails closed when unconfigured (`inbound-email.controller.ts:53-58`) | ⚠️ partial |
| | **43** | | **20 verified · 23 not** |

So the honest first statement is **`sec.unverified_public_ingress` ≈ 23 of 43, provisional**
— and confirming it per route is the first deliverable. Publishing a provisional 23 beats
publishing "unknown", because 23 can be argued with.

Secondary:

- **`sec.fail_open_defaults`** — **4 today.** `tenant.guard.ts:38-46`, plus three
  independent `|| "your-secret-key-change-in-production"` fallbacks at
  `jwt.strategy.ts:12-13`, `auth.service.ts:64-66`, `auth.module.ts:28-30`. Target 0.
- **`sec.distributed_rate_limit_present`** — boolean, **`false`**.
- **`sec.secrets_in_url_or_bundle`** — **2 known**: the `?secret=` query credential, and
  `VITE_DEV_AUTH_BYPASS_SECRET` shipping in the web bundle.

## Evidence today

**PARTIAL — two of five ingress modules are exemplary; the other three are unmeasured,
misclassified, or shipping a credential in a query string.**

**EXISTS — the good case, usable as the standard.** `toast.service.ts:112-121` refuses
every signed request when `TOAST_WEBHOOK_SECRET` is absent and says why in a comment
citing the decision that made it so. `pos-hub` does the same and has tests. `main.ts:9-14`
sets `rawBody: true` **specifically** so exact-byte HMAC verification is possible rather
than a re-serialized JSON approximation. That is a perimeter built by someone who
understood the failure mode. **This charter's job on three modules is to reach the standard
already set on two, not to invent one.**

**EXISTS — one live misclassification with a real consequence.** `simpos` is labelled
*"webhook module — expected public, must verify signatures instead"* (`ENDPOINTS.md:536`).
It receives no webhooks. It is `@Controller("simpos/:restaurantId")`
(`simpos.controller.ts:23`) — eleven unguarded routes for catalogue CRUD, check creation
and check close, taking the tenant from the URL. On close it calls `sendSignedWebhook`
(`simpos.service.ts:489-520`), where **our own server signs the payload with
`POS_HUB_WEBHOOK_SECRET`** and POSTs to `/pos-hub/webhook/generic_webhook/:restaurantId`,
which verifies correctly and — per `pos-hub.controller.ts:57` — *"for closed checks —
depletes stock via `apply_stock_movement`/`record_glass_pour`."* `SimposModule` is
registered unconditionally at `app.module.ts:84` with no `NODE_ENV` gate.

**This is a confused deputy, and it is the clearest possible argument for this charter's
existence and for per-route classification.** Our signature verification is correct,
fail-closed and tested — and it authenticates the *sender* (us), not the *originator*. An
auditor reading the module label checks the HMAC, finds it green, and moves on. Recorded as
a finding: whether `close` reaches a real tenant's inventory, and whether the sim
restaurant is an isolated tenant, is exactly the classification nobody has done.

**PARTIAL — a credential in a query string.** `inbound-email.controller.ts:53-58` accepts
`INBOUND_WEBHOOK_SECRET` as either an `x-inbound-secret` header **or** `?secret=`. A
query-string credential lands in access logs, proxy logs, and `Referer` headers. It does
fail closed when unconfigured (`:39-45`), which is right, and the controller docstring
(`:38-42`) states the design honestly. The header path is correct; the query path is the
finding.

**PARTIAL — rate limiting is global but not distributed.** Registered as an `APP_GUARD`
(`app.module.ts:120-123`) with sane tiers including `ai: 20/60s`
(`rate-limit.guard.ts:27-33`), backed by an in-memory `Map` whose own comment says *"In
production, use Redis for distributed rate limiting"* (`:65-70`). On more than one instance
the effective limit is *tier × instance count*. This was the only brake on the analytics
denial-of-wallet hole, which makes its weakness a matter of record rather than theory.

**PARTIAL — CORS is not `*`, but it is close in one dimension.** `main.ts:16-38`
allow-lists explicit origins plus `/^https:\/\/.*\.vercel\.app$/` with `credentials: true`
— **in production**. That is every application on a shared multi-tenant preview domain.
The `NODE_ENV !== "production"` localhost widening (`:33-35`) is correctly scoped and
carefully commented; the `vercel.app` regex is not scoped at all.

**PARTIAL — secrets surface.** 80 environment variables (`EXTERNAL_CONNECTIONS.md`).
`abc123.ngrok.io` and placeholder domains (`your-domain.com`, `a.com`, `via.placeholder.com`)
appear in source paths (`README:59`). `VITE_DEV_AUTH_BYPASS_SECRET` is one of 17 `VITE_*`
vars and therefore ships in the web bundle — its server-side gate is fail-closed and
`NODE_ENV`-scoped (`dev-bypass.util.ts:46-52`), so the exposure is contained, but a secret
in a bundle is still a secret in a bundle.

**NEW — nothing exists.** No signature-coverage measurement. No publish-state or
enumeration audit on `vendor-portal`. No secret rotation policy. No distributed rate-limit
store.

## Explicit non-goals

| Not ours | Whose it is |
|---|---|
| Requests that should carry identity and don't | [[access-control-tenant-isolation-charter]] |
| Hostile content inside a validly-signed payload | [[ai-surface-security-charter]] |
| The code that speaks a third party's protocol | [[integration-engineering-charter]] *(Engineering)* |
| Authoring the rate-limit store, the CORS config, the guard | [[platform-api-charter]] *(Engineering)* — we specify, they build |
| Whether a vendor's catalogue *may* be published (consent, contract) | [[compliance-privacy-charter|compliance-charter]] *(Corporate)* — we own whether an unpublished one leaks |
| Attacking our own perimeter design | [[red-team-charter]] *(advisory)* |

## Split trigger

Shares a team with [[access-control-tenant-isolation-charter]] today. Splits when
`sec.unguarded_authenticated_surface` = 0 **and** `sec.recurrence_guard_present` = true
**and** `sec.unverified_public_ingress` has a confirmed (not provisional) reading. At that
point this charter becomes its own campaign — distributed rate limiting, secret rotation,
signature coverage — with a file set that no longer overlaps the sibling's.
