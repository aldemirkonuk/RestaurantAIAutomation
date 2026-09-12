---
type: charter
division: product
department: partnerships-integrations
status: partial
metrics: [pi.merchant_backed_providers, pi.verified_ingress_ratio, pi.live_counterparties, nf_a.task_success_rate]
updated: 2026-08-24
links:
  - "[[partnerships-integrations-premortem]]"
  - "[[partnerships-integrations-directive]]"
  - "[[partnerships-integrations-loops]]"
  - "[[pos-bridge-charter]]"
  - "[[partner-alliance-development-charter]]"
  - "[[supplier-distributor-network-charter]]"
  - "[[connector-platform-trust-charter]]"
  - "[[perimeter-ingress-integrity-charter]]"
  - "[[engineering-charter]]"
  - "[[product-vision-charter]]"
  - "[[ENDPOINTS]]"
  - "[[PAGE_MAP]]"
  - "[[OPEN-DECISIONS]]"
---

# Partnerships & Integrations — Charter

## Mandate

Make Mudavym **the bridge, not another POS.** This department is accountable for the
universal connector layer: one canonical data shape, N provider adapters, the
counterparty relationships that engineering cannot unblock, and the trust contract every
integration rides on. The strategic claim is that the restaurant's system of record is
already chosen — Toast, Square, Clover, a Turkish POS, or a nightly CSV — and that the
durable position is to plug into all of them rather than to compete with any of them. We
therefore **do not build a POS**, and we do not let the product become Toast-locked.

## Boundaries — what this department owns outright

| Owned | Where it lives |
|---|---|
| The canonical check shape and every provider normalizer | `apps/api-gateway/src/pos-hub/` |
| The 27-entry provider registry and its status ladder | `pos-provider.registry.ts` |
| POS→catalogue item mapping and its human approval gate | `catalog-matcher.service.ts` |
| POS partner agreements — the 9 providers no amount of code unblocks | `pos-provider.registry.ts` (`authModel: "partner_agreement"`) |
| The Beli exploration (**not** the guest-app build) | OD-07 |
| Supplier and distributor relationships, and the vendor portal as their surface | `apps/api-gateway/src/vendor-portal/`, `vendor-catalogue/`, `distributor-discovery/` |
| Connector catalogue, OAuth/credential lifecycle, connection health, deprecation | `apps/api-gateway/src/integrations/` |
| The **per-connector trust contract**: what data flows, under what auth, with what verification | this department, asserted — see PROD-F4 |

## Explicit non-goals

1. **We do not build a point-of-sale system.** Not a lightweight one, not "just for the
   venues that have nothing." The moment we ship a POS we are competing with every
   counterparty in the registry, and the bridge thesis dies. Venues with no POS are served
   by `csv_import` and `generic_webhook` (`pos-provider.registry.ts:29-51`), which are the
   two providers already at `status: "available"`.
2. **We do not own runtime security code.** We own the trust *contract* per connector;
   [[perimeter-ingress-integrity-charter]] (Security SEC-2) owns webhook signature
   verification, CORS, rate limiting and secrets handling as a **control**, and
   [[engineering-charter]] owns the code that implements it. Our deliverable is a
   per-connector specification and the evidence that it is enforced — not a second
   implementation of `verifyWebhookSignature`. Duplicating SEC-2 would produce exactly the
   failure SEC-2's own premortem names: two teams each assuming the other set the secret.
3. **We do not own vendor *discovery* software.** [[supply-discovery-charter]] (Product &
   Vision §1.3) ships the software that finds vendors; we sign and maintain them. This is
   the division's highest-duplication boundary and is open as **PROD-F2**.
4. **We do not build the guest consumer app.** [[consumer-app-points-economy-charter]]
   does. We own only the Beli *conversation* (OD-07). Both are gated on the same founder
   call and neither should move without it.
5. **We do not set pricing, and we do not name the first outbound targets.** Both are
   founder-deferred. This charter proposes neither, deliberately.
6. **⚠️ Distributor connectivity — contested, stated rather than claimed.** See below.

### The distributor-connectivity boundary — CM-F3, surfaced not silently claimed

The Commercial division's team layer raises this as a live fork:

> **CM-F3** — *"Distributor connectivity — Sales or Product → Partnerships & Integrations?
> [YC_WEDGE_PLAN.md:41] calls it a commercial problem; the org already has a partnerships
> department. Unowned today either way."*
> — `.planning/foundation/teams/commercial.md:631`

The source it cites says, of restaurant-side EDI: *"build no VAN or AS2 transport. The
connectivity is a commercial problem, not a technical one"* (`.planning/YC_WEDGE_PLAN.md:41`).
The org nevertheless gives this department [[supplier-distributor-network-charter]].

**Both are right about different halves, and we do not claim the whole.** Proposed line, to
be ratified or overruled by the founder — we are not deciding it here:

| Half | Owner | Because |
|---|---|---|
| *Getting a distributor to agree to send data at all* — the ask, the terms, the account relationship | **Commercial → Sales** ([[design-partner-operations-charter]]) | This is the commercial problem YC_WEDGE_PLAN.md:41 names. It runs on a sales clock and closes with a signature, not a schema. |
| *Turning whatever they agreed to send into our canonical shape and keeping it flowing* — feed format, refresh, breakage, portal login lifecycle | **Partnerships → [[supplier-distributor-network-charter]]** | Identical failure mode to a POS adapter, and it reuses the same connector substrate ([[connector-platform-trust-charter]]). |

The seam is the **signed intent to send data**. Before it, Sales. After it, us. If the
founder prefers a single owner, this department's teams should shrink by one rather than
run a shared metric neither side controls — see [[partnerships-integrations-premortem]] M4.

**Note on the fork ID.** This department's assignment brief referred to this conflict as
CM-F6. CM-F6 is a different fork (whether Social & Community is chartered dormant,
`commercial.md:634`). The distributor-connectivity fork is **CM-F3**, `commercial.md:631`.

## Metrics it moves

Metrics prefixed `pi.` are department-local and are defined once, canonically, in
[[partnerships-integrations-loops]]. `nf_a.*` are the shared agent spine
([foundation README §4.2](../../../foundation/README.md)).

| Metric | Definition | Today |
|---|---|---|
| `pi.merchant_backed_providers` | Providers at `status: "available"` **with a real merchant behind them** | **0** (2 available, 0 with a merchant) |
| `pi.verified_ingress_ratio` | Inbound ingress routes with enforced signature/secret verification ÷ all inbound ingress routes | **1 of 3 correct** — see Evidence |
| `pi.live_counterparties` | Distributors with a refreshing price feed or an active portal login | **0** |
| `pi.unblocking_agreements` | Signed agreements that move a `partner_agreement` provider off blocked | **0** of 9 blocked |
| `nf_a.task_success_rate` | Applies to one agent surface we own: catalogue-match proposal accuracy at the human gate | no baseline — gate has never run on real data |

`pi.merchant_backed_providers` is deliberately phrased so that the second half carries the
whole metric. **`scaffolded` count is vanity.**

## Evidence today

Every citation below was read or grepped in this session against the working tree at
`feat/beverage-catalogue-wine-identity`.

### The key finding: this is not greenfield, and the docs have been wrong about that

The vision treats multi-POS as future work. The code disagrees.

| Claim | Grade | Citation |
|---|---|---|
| `developer.squareup.com` is in source | **EXISTS** | `apps/api-gateway/src/pos-hub/pos-provider.registry.ts:75` |
| `developers.lightspeedhq.com` is in source | **EXISTS** | `pos-provider.registry.ts:109` |
| Square is `status: "scaffolded"` — *"Orders API normalizer implemented; needs merchant OAuth token"* | **EXISTS** | `pos-provider.registry.ts:71`, `:76` |
| Clover is `status: "scaffolded"` — *"Orders v3 normalizer implemented; needs merchant API token"* | **EXISTS** | `pos-provider.registry.ts:83` |
| Toast is `status: "partial"` | **EXISTS** | `pos-provider.registry.ts:58` |
| Onboarding already asks which POS: `'square' | 'toast' | 'clover' | 'lightspeed' | 'other' | 'none'` | **EXISTS** | `apps/web/src/contexts/OnboardingContext.tsx:95` |
| The registry is a sequenced strategy document, not a list | **EXISTS** | `pos-provider.registry.ts:3-16` |
| Two providers are `available` today — *"any POS or middleware can push the canonical shape and the whole analytics stack lights up"* | **EXISTS** | `pos-provider.registry.ts:13-15`, entries at `:29-51` |
| Nine providers are blocked on a signature, not on code | **EXISTS** | `authModel: "partner_agreement"` × 9 — `:119, :171, :192, :222, :232, :242, :254, :264, :298` |

**Two of the four teams here inherit working code, not a blank page.** That changes the
department's first job from *build* to *finish, verify, and get one merchant behind it*.

### Correction 1 — the registry has 27 providers, not 30

`.planning/foundation/teams/product.md:658` says *"(30 providers)"*. Counted this session:
**27** entries — 2 `available`, 1 `partial`, 2 `scaffolded`, 22 `planned`. The strategy is
unchanged; the number is not. Carried back to the team doc as a correction.

### Correction 2 — "0 of 32 webhooks verify signatures" is wrong, and the truth is more useful

`product.md:783` states *"0 of the 32 verify signatures today."* That is not what the code
does. Verified this session:

| Module | Routes | Reality |
|---|---|---|
| `pos-hub` | 10 | **1 ingress route verifies correctly.** `POST /pos-hub/webhook/:provider/:restaurantId` requires HMAC-SHA256 over the raw body in `X-Pos-Hub-Signature`, compares with `crypto.timingSafeEqual`, and **fails closed** when `POS_HUB_WEBHOOK_SECRET` is unset (`pos-hub.controller.ts:68-75`, `pos-hub.service.ts:96-121`). The other **9 routes are unauthenticated and unverified**. |
| `toast` | 10 | **1 ingress route verifies conditionally.** `POST /toast/webhook` (`toast.controller.ts:68`) calls the verifier **only `if (signature && timestamp)`** (`toast.service.ts:189`). The helper itself fails closed (`:111-119`) — but **an unsigned request never reaches it.** Fail-closed helper, fail-open call site. |
| `simpos` | 11 | **Not a webhook receiver at all.** It is the local POS simulator — catalog/check/table CRUD (`ENDPOINTS.md:540-550`). Labelling it "webhook module" prescribes a control it has no use for. |
| `inbound-email` | 1 | Shared secret enforced, refuses when unconfigured — but accepts it as `?secret=` query as well as a header (`inbound-email.controller.ts:38-40, 57-58`), i.e. a credential that lands in access logs. |

**The honest recount: of those 32 routes only 3 are inbound ingress points. One is correct,
one fails open when unsigned, one puts a secret in a query string. The remaining 29 are
ordinary management and simulator routes that are simply unauthenticated.**

The sharpest item is not in the "webhook" framing at all:
`POST /pos-hub/catalog-match/:restaurantId/proposals/:proposalId/approve` and `/reject`
(`ENDPOINTS.md:361-362`) are the **human approval gate for catalogue mapping**, and they
are callable by anyone on the internet. A gate that anyone can pull is not a gate.

This correction narrows the department's exposure claim and sharpens it. It is the shape of
finding [[connector-platform-trust-charter]] should produce weekly.

### Correction 3 — vendor-portal has already been reclassified upstream

`product.md:733-735` says vendor-portal's 2 routes are *"still marked 'classify these'"*.
`ENDPOINTS.md:656` now reads *"all carry explicit `@Public()` — intentionally public, not a
gap."* That assignment closed before this department existed. Security's SEC-2 evidence
independently reached the same conclusion. Nothing to do; the doc is stale, not the code.

### Per-team grades

| Team | Grade | One-line basis |
|---|---|---|
| [[pos-bridge-charter]] | **EXISTS** | 8 source files, 27-provider registry, capability model, 10 endpoints, tests, a simulator to develop against — and **0 real `pos_checks` rows** (`.planning/decisions/AGENT_NATIVE_UI_DECISION.md:56`) |
| [[partner-alliance-development-charter]] | **NEW** (function) / EXISTS (blocker list) | The 9 blocked providers are enumerable in code; **zero outreach has occurred**. Graded down from the team doc's EXISTS — see that charter's Evidence section for the reasoning |
| [[supplier-distributor-network-charter]] | **PARTIAL** | Portal, catalogue, discovery and reply-drafting all exist; `procurement_orders` = **1** (`AGENT_NATIVE_UI_DECISION.md:59`) |
| [[connector-platform-trust-charter]] | **PARTIAL** | 5 OAuth endpoints, all guarded — the good pattern; credential encryption exists; 2 providers only; its own UI is orphaned (`PAGE_MAP.md:110, 156`) |

## Entry conditions and open decisions

No team here is trigger-gated. All four can start. Two open decisions constrain what they
may conclude:

- **OD-07 (Beli — build independently vs collaborate).** **Open. This charter does not
  decide it.** [[partner-alliance-development-charter]] owns the exploration that makes the
  call answerable; it does not own the answer.
- **PROD-F4 (connector trust boundary).** This charter *asserts* that Partnerships owns the
  per-connector trust contract while Engineering owns runtime and Security owns the
  control. Asserted, not decided.
- **PROD-F2 (Vendor Finder boundary)** and **CM-F3 (distributor connectivity)** both cut
  through [[supplier-distributor-network-charter]]. Two open boundaries through one team is
  a finding, not a detail — see [[partnerships-integrations-premortem]] M4.

## Honest note on the team count

Four teams is defensible, but not equally. [[pos-bridge-charter]] and
[[connector-platform-trust-charter]] have code, exposure and a next action today.
[[partner-alliance-development-charter]] is a real and distinct job — nine providers that
no engineering unblocks is the strongest distinctness argument in the division — but it is
a **function with no work done**, and it should be honest about that rather than dressed in
the registry's evidence. [[supplier-distributor-network-charter]] is the one with two live
boundary disputes; if CM-F3 resolves toward Sales, it should be merged or dissolved rather
than kept as a shell.
