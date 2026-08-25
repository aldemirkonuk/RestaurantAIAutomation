---
type: charter
division: product
department: partnerships-integrations
team: connector-platform-trust
status: partial
metrics: [pi.verified_ingress_ratio]
updated: 2026-08-24
links:
  - "[[partnerships-integrations-charter]]"
  - "[[connector-platform-trust-premortem]]"
  - "[[connector-platform-trust-directive]]"
  - "[[connector-platform-trust-loops]]"
  - "[[perimeter-ingress-integrity-charter]]"
  - "[[access-control-tenant-isolation-charter]]"
  - "[[pos-bridge-charter]]"
  - "[[supplier-distributor-network-charter]]"
  - "[[engineering-charter]]"
  - "[[ENDPOINTS]]"
  - "[[EXTERNAL_CONNECTIONS]]"
  - "[[PAGE_MAP]]"
  - "[[OPEN-DECISIONS]]"
---

# Connector Platform & Trust — Charter

## Mandate

Own the shared substrate every integration rides: the **connector catalogue**, **OAuth and
credential lifecycle**, the **per-connector trust contract** (including what verification each
inbound route must enforce), **connection status and health**, and **deprecation**.

## Why this team is distinct

Every other team in [[partnerships-integrations-charter]] is **per-counterparty**. This one is
**per-integration-class.** If each adapter rolls its own credential path, we get 27 credential
paths and 27 ways to leak one. If each connector invents its own failure posture, nobody can
answer *"is this verified?"* about the system as a whole — which is not a hypothetical: it is
**true today**, and this charter documents it below.

## The Security boundary — coordination, explicitly not duplication

This is the most important boundary in this charter, and it is open as **PROD-F4**.

[[perimeter-ingress-integrity-charter]] (Security SEC-2) owns *"every unauthenticated request
that is supposed to be unauthenticated: webhook signature verification, public-content routes,
CORS, rate limiting, and secrets handling."* That is a **control**. This team owns the
**contract the control is measured against.**

| Layer | Owner | Deliverable |
|---|---|---|
| *What data flows, under what auth, with what verification, failing which way* — per connector | **this team** | The trust contract |
| *Is that control correctly implemented and enforced everywhere* | [[perimeter-ingress-integrity-charter]] | The control + its baseline |
| *The code that implements it, and the CI wiring* | [[engineering-charter]] | Runtime |

**We do not ship a second `verifyWebhookSignature`.** Two units implementing verification is
precisely how a secret ends up unset in one environment with each assuming the other checked —
which is SEC-2's own premortem, and it would be an unusually stupid way to prove them right.

**Concretely:** we produce the **ingress inventory** and the per-connector contracts, and hand
them to Security as the thing to measure. Security's `unverified_public_ingress` metric and
our `pi.verified_ingress_ratio` should be **the same number computed once**. If they diverge,
one of them is deleted — and it should be ours.

**⬦ PROD-F4 is asserted here, not decided:** *"does Partnerships own the per-connector trust
contract while Engineering owns runtime, or is verification wholly Security's?"*
(`product.md:861`). This charter takes the first branch and flags it.

## Boundaries — owned outright

- `apps/api-gateway/src/integrations/` — `integrations-oauth.controller.ts`,
  `integrations-oauth.service.ts`, `integrations-oauth.constants.ts`, `integrations.module.ts`.
- **The connector catalogue** — what integrations exist, what scopes they request, what they
  are for.
- **Credential lifecycle** — issue, encrypt, rotate, revoke; and the consent/scope disclosure
  that precedes it.
- **Connection status and health** — is this connection alive, and how would we know.
- **Deprecation** — retiring a connector without stranding a restaurant.
- **The ingress classification**: which routes are ingress, which are management, which are
  simulator. This is a *contract* judgment, and it is the thing the whole "webhook module"
  label got wrong.

## Explicit non-goals

1. **We do not implement or own security controls.** See the boundary table above.
2. **We do not own per-provider normalizers or the canonical shape.**
   [[pos-bridge-charter]]'s.
3. **We do not own publish-state of vendor pages.** That is a relationship property —
   [[supplier-distributor-network-charter]]'s. Our surface is credentials and connections, not
   published content.
4. **We do not own `JwtAuthGuard` coverage generally.** The 94-or-so routes unguarded by
   omission are [[access-control-tenant-isolation-charter]]'s (SEC-1) under OD-19. We own only
   the subset where the correct answer is *"public, but verified"* rather than *"authenticate
   it."*
5. **We do not own runtime code or CI infrastructure.** [[engineering-charter]]'s. We specify;
   they implement.

## Metrics it moves

| Metric | Definition | Today |
|---|---|---|
| `pi.verified_ingress_ratio` | Inbound **ingress** routes enforcing signature or shared-secret verification ÷ all inbound ingress routes. *Ingress* excludes management and simulator routes | **1 of 3 correct** — see below |

**The definition is doing real work.** Counting "unguarded routes in webhook modules" produces
32 and is misleading in both directions: it inflates the number with routes that are not
ingress, and it hides that some of the *management* routes are more dangerous than the
webhooks. Establishing this baseline honestly **is** the first deliverable.

## Evidence today — PARTIAL (a real substrate with a real, sized gap)

Verified in-session.

### What exists — and it is the good pattern

- `apps/api-gateway/src/integrations/` — 4 files. Providers today are `google` and `microsoft`
  only, with per-scope disclosure declared in code
  (`integrations-oauth.constants.ts:1` — `IntegrationProvider = "google" | "microsoft"`;
  `:37-45` google_drive with `drive.file` scope; `:69-74` excel).
- **5 endpoints, all guarded** (`ENDPOINTS.md:226-234`) — `POST /integrations/oauth/
  :integrationId/authorize`, `GET /:provider/callback`, `GET /catalog`, `GET /connections`,
  `DELETE /:integrationId`. **This is the pattern that should generalize**, and it is worth
  saying plainly: this module got it right.
- `apps/api-gateway/src/common/crypto/token-crypto.service.ts` — credential encryption exists.
- A single source of truth for scopes, *"shared by the consent screen"*
  (`integrations-oauth.constants.ts:25`) — consent and enforcement read the same declaration,
  which is the structural property that keeps a consent screen honest.

### ⚠️ The gap, recounted honestly — and the upstream claim it corrects

`foundation/teams/product.md:783` states: *"**0 of the 32 verify signatures today.**"*
**That is not what the code does.** The recount:

| Module | Routes | What is actually true |
|---|---|---|
| `pos-hub` | 10 (`ENDPOINTS.md:355-368`) | **1 ingress route verifies correctly** — `POST /pos-hub/webhook/:provider/:restaurantId` requires HMAC-SHA256 over the raw body in `X-Pos-Hub-Signature`, compares with `crypto.timingSafeEqual`, and **fails closed** when `POS_HUB_WEBHOOK_SECRET` is unset (`pos-hub.controller.ts:68-75`, `pos-hub.service.ts:96-121`). The other **9 are unauthenticated management routes** |
| `toast` | 10 (`ENDPOINTS.md:603`) | **1 ingress route verifies conditionally.** `POST /toast/webhook` (`toast.controller.ts:68`) invokes the verifier **only `if (signature && timestamp)`** (`toast.service.ts:189`). The helper fails closed (`:111-119`) — but **an unsigned request never reaches it.** Fail-closed helper, fail-open call site |
| `simpos` | 11 (`ENDPOINTS.md:540-550`) | **Not a webhook receiver at all** — catalog/check/table CRUD for the local simulator. The label prescribes a control it has no use for |
| `inbound-email` | 1 (`ENDPOINTS.md:120`) | Shared secret enforced, refuses when unconfigured — but accepts it as `?secret=` **query parameter** as well as a header (`inbound-email.controller.ts:38-40, 57-58`), i.e. a credential in access logs, proxies and referrers |

**Honest baseline: of those 32 routes, only 3 are inbound ingress. One is correct, one fails
open on an unsigned request, one puts a secret in a query string. The remaining 29 are
management and simulator routes that are simply unauthenticated.**

**The sharpest item is not framed as a webhook at all.**
`POST /pos-hub/catalog-match/:restaurantId/proposals/:proposalId/approve` and `/reject`
(`ENDPOINTS.md:361-362`) are the **human approval gate over catalogue mapping**, callable by
anyone. A gate anyone can pull is not a gate — and no amount of signature verification fixes
it, because the correct control there is authentication, not verification.

**This is the finding this team exists to produce**, and it is the same shape foundation §2.3
prescribes: evidence, `file:line`, a classification step, and a recurrence guard.

### Correction carried, and one carried *back*

- `product.md:788-790` already corrected foundation README's *"≈51 routes"* down to **32**, and
  that correction stands. **This charter corrects the next layer: 32 is the right route count
  and the wrong ingress count.**
- `product.md:733-735` says vendor-portal's routes are *"still marked 'classify these'"*.
  `ENDPOINTS.md:656` now reads *"all carry explicit `@Public()` — intentionally public, not a
  gap."* Already closed.

### ⚠️ Its own surface is orphaned

`/authorize/:integrationId` has **no inbound in-app link** (`PAGE_MAP.md:110`) **and** its
route component could not be traced (`PAGE_MAP.md:156`). The OAuth consent surface — the one
screen where a user grants access to their data — is a page nobody can navigate to and nobody
can statically analyse.

### The wider surface this team must inventory

**80 environment variables** and every third-party host
([[EXTERNAL_CONNECTIONS]]) — including `abc123.ngrok.io` and placeholder domains
(`your-domain.com`, `a.com`, `b.com`, `via.placeholder.com`) appearing in source paths
(foundation `README.md:57-59`). Fixtures or stale config, but they should never be reachable
from a production code path.
