---
type: agenda-full
division: product
department: partnerships-integrations
team: connector-platform-trust
status: provisional
metrics: [pi.verified_ingress_ratio]
updated: 2026-08-24
links:
  - "[[connector-platform-trust-charter]]"
  - "[[connector-platform-trust-premortem]]"
  - "[[connector-platform-trust-agenda-board]]"
  - "[[connector-platform-trust-directive]]"
  - "[[perimeter-ingress-integrity-charter]]"
  - "[[access-control-tenant-isolation-charter]]"
  - "[[pos-bridge-agenda-full]]"
  - "[[engineering-charter]]"
  - "[[ENDPOINTS]]"
  - "[[EXTERNAL_CONNECTIONS]]"
---

# Connector Platform & Trust — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

The substrate every integration rides: connector catalogue, credential lifecycle,
per-connector trust contract, connection health, deprecation.

**The first deliverable is a number nobody currently has:** how many inbound ingress routes
actually enforce verification, and which ones. The widely-cited figure — *"0 of 32"*
(`product.md:783`) — is wrong, and the way it is wrong matters more than the error itself.

## How

### Step one: the honest baseline, because the current framing hides the real risk

The "32 unguarded routes in webhook modules" framing is misleading in **both** directions:

| The framing says | The code says |
|---|---|
| 32 routes need signature verification | **3 are ingress.** 29 are management or simulator routes that need *authentication*, which is a different control |
| 0 verify today | `pos-hub`'s webhook verifies correctly, HMAC-SHA256 + `timingSafeEqual`, fails closed (`pos-hub.service.ts:96-121`) |
| The webhooks are the risk | The catalogue-match **approval gate** — `POST /pos-hub/catalog-match/.../proposals/:id/approve|reject` (`ENDPOINTS.md:361-362`) — is unauthenticated and mutates what the system believes about a restaurant's inventory |
| `simpos` is a webhook module | It is the local POS simulator — catalog/check/table CRUD (`ENDPOINTS.md:540-550`) |

**A per-module label cannot produce a correct control.** That is the same conclusion Security's
SEC-2 reached from the other side when it found `ENDPOINTS.md` prescribing signature
verification for `vendor-portal`, a public catalogue page. **The classification file itself
contained a classification error, twice, in opposite directions.** Route-level judgment is the
deliverable.

### Step two: the guard, not the fix

The two live repairs — the toast call site, the catalogue-match gate — are each an afternoon.
**They are not the deliverable.** This defect class has been documented three times in this
repo without a guard being added; a fourth description is worth nothing.

The deliverable is a **CI check that fails the build when a route in an ingress-classified
module has no verification call, or no classification at all.** This team specifies it,
[[engineering-charter]] implements it, [[perimeter-ingress-integrity-charter]] measures it.

### Step three: generated, not written

The inventory must be **regenerated from source**, the way `ENDPOINTS.md` already is
(foundation README §0). A hand-maintained inventory is stale within a quarter — that is
[[connector-platform-trust-premortem]] M3, and it is the mechanism that produced the incorrect
"0 of 32" figure in the first place.

### How we work with Security — stated first, because it is the main risk of our existence

[[perimeter-ingress-integrity-charter]] owns the **control**. We own the **contract**.

- **We produce**: the route classification, the per-connector trust contract (what data flows,
  under what auth, with what verification, failing which way), and the CI guard specification.
- **They produce**: `unverified_public_ingress`, the enforcement baseline, and the verdict on
  whether a control is correctly implemented.
- **We do not ship a second verifier.** Two implementations is how a secret ends up unset in
  one environment with each unit assuming the other checked — SEC-2's own premortem, arriving
  via org duplication ([[connector-platform-trust-premortem]] M2).
- **Deletion rule, named in advance:** if `pi.verified_ingress_ratio` and
  `unverified_public_ingress` measure the same surface, **ours is deleted.**

Coordination is a standing bi-weekly slot, not an escalation path.

## Why now

1. **Two connectors already disagree about failure posture.** `pos-hub` fails closed; `toast`'s
   call site bypasses verification on an unsigned request (`toast.service.ts:189`). Connector
   three copies one of them at random. The window to set the pattern is now, at two, not later
   at eight.
2. **A gate anyone can pull is not a gate.** `catalog-match/.../approve|reject` is
   unauthenticated today and needs no design partner to matter.
3. **The credential decision is imminent and unmade.** Square and Clover are both blocked on
   merchant tokens (`pos-provider.registry.ts:76, :88`), and `IntegrationProvider` is a
   two-member union of `google | microsoft` (`integrations-oauth.constants.ts:1`). The first
   POS token needs a home **before** someone improvises one
   ([[connector-platform-trust-premortem]] M4).
4. **The good pattern exists and is unspread.** 5 endpoints, all guarded; scopes declared once
   and shared with the consent screen; credential encryption present. Generalizing a working
   pattern is far cheaper than inventing one.

## Next steps

| # | Step | Depends on | Done when |
|---|---|---|---|
| 1 | **Ingress inventory**: classify every route in `pos-hub`, `toast`, `simpos`, `inbound-email`, `integrations`, `vendor-portal` as ingress / management / simulator / public-content, with actual posture | — | `pi.verified_ingress_ratio` has a real, defensible baseline |
| 2 | Make the inventory **generated from source**, not hand-written | [[engineering-charter]] | It regenerates; drift is impossible |
| 3 | **CI guard spec**: unclassified or unverified ingress route fails the build | [[engineering-charter]], [[perimeter-ingress-integrity-charter]] | A PR adding one fails |
| 4 | Repair: **toast call site unconditional** — unsigned must reject (`toast.service.ts:189`) | Engineering | Unsigned POST returns 401 |
| 5 | Repair: **guard the catalogue-match approval gate** (`ENDPOINTS.md:361-362`) | [[pos-bridge-charter]], Engineering | Anonymous POST rejected |
| 6 | Repair: **inbound-email secret out of the query string** (`inbound-email.controller.ts:57-58`) | Engineering | Header-only |
| 7 | **Trust contract template**, then contracts for the connectors that exist | [[perimeter-ingress-integrity-charter]] co-sign | Every live connector has one |
| 8 | **Credential-path decision**: extend `IntegrationProvider` to POS merchant tokens, or a documented exception with a named owner | [[pos-bridge-charter]] | Written before the first merchant token exists |
| 9 | Make `/authorize/:integrationId` **reachable and traceable** (`PAGE_MAP.md:110, 156`) | Design / Engineering | It has an inbound link and a traceable component |
| 10 | **Env-var and host inventory** — 80 variables, every third-party host; flag `abc123.ngrok.io` and placeholder domains reachable from production paths | [[EXTERNAL_CONNECTIONS]] | Inventory exists with an owner per entry |
| 11 | Carry the ingress-count correction upstream to `product.md` and `ENDPOINTS.md` | — | The corrections land |

Steps 1, 7, 8 and 11 need nobody's permission. Steps 3–6 are joint with Engineering. Step 3 is
the one that makes the rest durable.

## Questions for the founder

1. **OD-23.** This charter asserts: Partnerships owns the trust contract, Engineering the
   runtime, Security the control. Right? It is the boundary that most needs to be *decided*
   rather than assumed, because both plausible answers are workable and only ambiguity is not.
2. **The deletion rule.** We have committed that if our metric duplicates Security's, **ours**
   is deleted. Endorse — or is the duplication considered acceptable redundancy? *(We think
   not: redundant verification is how the failure happens.)*
3. **Credential path (step 8).** Do POS merchant tokens belong in the existing OAuth substrate,
   or is a separate class justified? This is cheap now and a migration in six months.
4. **Priority of the two repairs vs the guard.** The repairs are an afternoon; the guard is a
   week. We propose guard-first, accepting a few extra days of a live gap, because the repairs
   without the guard will simply recur. That trade is offered, not assumed.
