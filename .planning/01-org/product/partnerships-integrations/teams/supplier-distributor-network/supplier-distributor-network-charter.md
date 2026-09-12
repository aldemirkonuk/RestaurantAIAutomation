---
type: charter
division: product
department: partnerships-integrations
team: supplier-distributor-network
status: partial
metrics: [pi.live_counterparties]
updated: 2026-08-24
links:
  - "[[partnerships-integrations-charter]]"
  - "[[supplier-distributor-network-premortem]]"
  - "[[supplier-distributor-network-directive]]"
  - "[[supplier-distributor-network-loops]]"
  - "[[supply-discovery-charter]]"
  - "[[design-partner-operations-charter]]"
  - "[[connector-platform-trust-charter]]"
  - "[[perimeter-ingress-integrity-charter]]"
  - "[[YC_WEDGE_PLAN]]"
  - "[[OPEN-DECISIONS]]"
---

# Supplier & Distributor Network — Charter

## Mandate

Own the actual vendor and distributor **relationships**: who supplies our restaurants, on what
terms, and the vendor portal as the surface those relationships live on. Where
[[supply-discovery-charter]] ships software that *finds* vendors, this team's output is a
counterparty that is **live** — sending a refreshing price feed or logging into a portal.

## Why this team is distinct — and the boundary that is contested

**Against [[supply-discovery-charter]] (Product & Vision §1.3):** finding a vendor and signing
one are different jobs with different metrics. Discovery's metric is catalogue coverage; this
team's is live, willing counterparties. The gap between "distributors in the database" and
"distributors sending us data" is this team's entire job.

**⚠️ This is openly flagged as the highest duplication risk in the Product division**
(`foundation/teams/product.md:828`), and it is open as **PROD-F2**.

### The second, sharper conflict — CM-F3, stated rather than claimed

The Commercial division's team layer raises a boundary dispute that cuts straight through this
team, and this charter surfaces it rather than quietly claiming the territory:

> **CM-F3** — *"Distributor connectivity — Sales or Product → Partnerships & Integrations?
> [YC_WEDGE_PLAN.md:41] calls it a commercial problem; the org already has a partnerships
> department. Unowned today either way."*
> — `.planning/foundation/teams/commercial.md:631`

The cited source is unambiguous about its half. On restaurant-side EDI it concludes:
*"build no VAN or AS2 transport. The connectivity is a commercial problem, not a technical
one, and it is the same trap shape as the 22 'planned' POS adapters"*
(`.planning/YC_WEDGE_PLAN.md:41-42`).

**The org nevertheless gave this department a team for it. Both facts are true, and this
charter does not resolve them.**

**Proposed line — for the founder to ratify or overrule, not for us to assume:**

| Half | Proposed owner | Reasoning |
|---|---|---|
| Getting a distributor to **agree to send data at all** — the ask, the terms, the account relationship, the escalation when they stop | **Commercial → Sales** ([[design-partner-operations-charter]]) | This is precisely the commercial problem `YC_WEDGE_PLAN.md:41` names. It runs on a sales clock and closes with a person saying yes. |
| Turning **whatever they agreed to send** into our canonical shape and keeping it flowing — format, refresh, breakage, portal login lifecycle, deprecation | **this team** | Identical failure mode to a POS adapter, and it reuses [[connector-platform-trust-charter]]'s substrate rather than building a second one. |

**The seam is the signed intent to send data.** Before it, Sales. After it, us.

**If the founder prefers a single owner, this team should be merged or dissolved rather than
kept as a shell running a metric it does not control.** That is stated plainly here because
the alternative — a team that reports blockers which are entirely other units' actions — is
[[supplier-distributor-network-premortem]] M1, and it is this team's most likely failure.

*(Note: the assignment brief for this department referred to this conflict as CM-F6. CM-F6 is
a different fork — whether Social & Community is chartered dormant, `commercial.md:634`. The
distributor-connectivity fork is **CM-F3**, `commercial.md:631`.)*

## Boundaries — owned outright, under the proposed line

- **The vendor portal** as a relationship surface: `apps/api-gateway/src/vendor-portal/`,
  surfaced at `/v/:slug` (`PAGE_MAP.md:55, 129`).
- **Distributor feed connectivity after agreement** — ingestion format, refresh cadence,
  breakage detection, and the connector contract with
  [[connector-platform-trust-charter]].
- **Terms of supply** as recorded state: who supplies which restaurant, at what price basis,
  with what delivery constraints.
- **Portal login lifecycle** — provisioning, activity, deprovisioning.
- `apps/api-gateway/src/vendor-catalogue/` and `apps/api-gateway/src/distributor-discovery/`
  are **shared** with [[supply-discovery-charter]] pending PROD-F2 — cited by both, owned
  cleanly by neither. That is itself a finding.

## Explicit non-goals

1. **We do not do vendor discovery.** [[supply-discovery-charter]] ships the software that
   finds vendors. Open as PROD-F2.
2. **We do not own the commercial ask.** Under the proposed CM-F3 line, persuading a
   distributor to send data at all is [[design-partner-operations-charter]]'s. **We do not
   claim this half, and we do not silently work it either.**
3. **We do not build EDI transport.** `YC_WEDGE_PLAN.md:40-41` is explicit: *"build no VAN or
   AS2 transport."* Parse X12 (810/856/812; read 850/855) and accept it however it arrives.
   Building transport is the same trap shape as the 22 `planned` POS adapters.
4. **We do not own procurement workflow.** Ordering, receiving, and invoice understanding are
   Product & Vision's modules. We own who is on the other end of them.
5. **We do not own the verification control** on any route we surface — that is
   [[perimeter-ingress-integrity-charter]]'s.

## Metrics it moves

| Metric | Definition | Today |
|---|---|---|
| `pi.live_counterparties` | Distributors with a **refreshing price feed or an active portal login** | **0** |

Not distributors in the database. Not vendors in the catalogue. **The gap between those two
numbers and this one is the entire job**, and phrasing it any other way lets a discovery
metric masquerade as a relationship metric.

## Evidence today — PARTIAL

A real supply-side surface exists. Nothing has ever flowed through it.

### What exists

- **`apps/api-gateway/src/vendor-portal/`** — controller, service, module. Two routes, both
  `@Get`, both explicitly `@Public()` (`vendor-portal.controller.ts:20-21, 39-40`):
  `GET /vendor-portal/:slug` and `GET /vendor-portal/:slug/jsonld`. Surfaced at `/v/:slug`
  (`PAGE_MAP.md:55, 129`), a cold-entry page by design.
- **`apps/api-gateway/src/vendor-catalogue/`** — controller, service, module, DTOs.
- **`apps/api-gateway/src/distributor-discovery/`** — controller, service, `distributor-query`,
  DTOs, and **four spec files**. The best-tested surface this team touches, and it is the one
  PROD-F2 may hand to another team.
- **`provider-intelligence.service.ts`** — **six** distinct reads against `provider_promotions`
  at `:135, :159, :179, :197, :222, :414`. **The table is dormant; the code is not.**
  *(Correction: `foundation/teams/product.md:739` says five reads at `:135-222`. There are six;
  the sixth is at `:414`.)*
- Routes: `/providers` (linked), `/distributors` (cold-entry `PAGE_MAP.md:115`, **and route
  component untraceable** `PAGE_MAP.md:158`), `/vendor-prices` (cold-entry `PAGE_MAP.md:130`).
- **Outbound relationship machinery already ships:** vendor-reply AI drafts with one-tap
  approve that **never auto-send**, threaded through `procurement_conversations`.

### ⚠️ The reality check

**`procurement_orders` = 1** (`.planning/decisions/AGENT_NATIVE_UI_DECISION.md:59`). One order, in the
entire system. Every capability above is unexercised.

### Correction — this team's "first concrete assignment" is already closed

`foundation/teams/product.md:733-735` assigns this team, jointly with
[[connector-platform-trust-charter]] and Security, to classify vendor-portal's two unguarded
routes, which it says are *"still marked 'classify these'"*.

That is stale. `ENDPOINTS.md:656` now reads: *"2 unguarded (all carry explicit `@Public()` —
intentionally public, not a gap)"*, and the code confirms it —
`vendor-portal.controller.ts:21, :40`. Security's SEC-2 reached the same conclusion
independently and noted the real risks are **slug enumeration and unpublished-page leakage**,
not signature verification.

**So the assignment is not "classify these" — it is the residual risk SEC-2 named.** That is a
smaller, sharper job, and it belongs to this team because publish-state is a *relationship*
property: whether a vendor's page should be visible is a fact about the agreement, not about
the route.

## Entry conditions

Not trigger-gated. But this team carries **two open boundary forks simultaneously** (PROD-F2 and
CM-F3), which is unusual and is itself the risk. See
[[supplier-distributor-network-premortem]] M1 and the 90-day dissolution clause in
[[supplier-distributor-network-directive]].
