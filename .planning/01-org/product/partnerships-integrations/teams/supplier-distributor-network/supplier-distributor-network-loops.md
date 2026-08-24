---
type: loops
division: product
department: partnerships-integrations
team: supplier-distributor-network
status: partial
metrics: [pi.live_counterparties]
updated: 2026-08-24
links:
  - "[[supplier-distributor-network-charter]]"
  - "[[supplier-distributor-network-directive]]"
  - "[[partnerships-integrations-loops]]"
  - "[[supply-discovery-charter]]"
  - "[[design-partner-operations-charter]]"
  - "[[decision-office-charter]]"
  - "[[LOOP-MAP]]"
---

# Supplier & Distributor Network — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

`pi.*` metrics are defined canonically in [[partnerships-integrations-loops]].

---

## L1 — Counterparty liveness

```yaml
type: loop
id: sdn-counterparty-liveness
owner: supplier-distributor-network
measures: [pi.live_counterparties, feed.stale_count, portal.active_logins]
changes: [counterparty.state, feed.cadence_expectations, partnerships.escalations]
inputs_from: [design-partner-operations, supply-discovery, connector-platform-trust]
outputs_to: [partnerships-integrations, product-vision, sales]
close_time: weekly
status: proposed
```

**The definitional care that makes this loop real.** `pi.live_counterparties` counts
distributors with a **refreshing** feed or an **active** login — not distributors in the
database. Present-but-stale must therefore be a distinguishable state, which is why
`feed.stale_count` is measured alongside rather than folded in. A single "counterparties"
number would climb on discovery and never fall on decay.

**What it changes.** Counterparty state transitions (*live → stale → lapsed*), cadence
expectations, and escalation when a relationship decays. Weekly, because a feed that stops on
Monday should not be discovered in the monthly review.

**Today's reading:** 0 live · 0 stale · 0 logins · 1 `procurement_order` in the entire system.

---

## L2 — Feed freshness

The loop that has to exist before L1 can be computed at all.

```yaml
type: loop
id: sdn-feed-freshness
owner: supplier-distributor-network
measures: [feed.last_refreshed_at, feed.cadence_breach_count]
changes: [feed.alert_state, counterparty.state]
inputs_from: [connector-platform-trust, engineering]
outputs_to: [supplier-distributor-network, procurement, notifications]
close_time: daily
status: proposed
```

**Why daily and why it is separate from L1.** L1 asks *how many are live*; this asks *is each
one still arriving on time*. Daily is the shortest cadence at which a price feed's breach is
actionable, and it is fast enough that a break is caught inside one ordering cycle.

**The failure it prevents, which is present in the code today.**
`provider-intelligence.service.ts` reads `provider_promotions` six times (`:135, :159, :179,
:197, :222, :414`) against a dormant table. Every read returns nothing, gracefully. Nothing in
the system distinguishes **dormant** from **empty** from **stale** — so when a real feed
eventually breaks it will report the same calm nothing it reports now
([[supplier-distributor-network-premortem]] M5). This loop's whole job is to make that
distinction exist.

**Status: cannot close today.** There is no `last_refreshed_at` to read. Building it is the
loop's first deliverable, and it must be built before the first live feed rather than after
the first silent break.

---

## L3 — Publish-state integrity

```yaml
type: loop
id: sdn-publish-state
owner: supplier-distributor-network
measures: [vendor_pages.published_without_relationship, slug.enumerability]
changes: [vendor_portal.render_gate, vendor.slug_policy]
inputs_from: [connector-platform-trust, security]
outputs_to: [security, connector-platform-trust]
close_time: per-page-creation
status: proposed
```

**Close-time is per-page-creation**, because the risk is created by the workflow, not by the
request. A vendor page drafted during a negotiation with a guessable slug is exposed the
moment it exists; checking at request time is checking after the fact.

**Why this loop is ours and not Security's.** The route is correctly public
(`vendor-portal.controller.ts:21, :40`; `ENDPOINTS.md:656` — *"intentionally public, not a
gap"*). Security's SEC-2 already named the residual risks as slug enumeration and
unpublished-page leakage. Both are answered by **publish-state, which is a property of the
relationship** — whether a vendor's page should be visible is a fact about the agreement.
Security owns the control; we own the fact it is controlling.

---

## L4 — Boundary resolution pressure

The loop whose subject is this team's own existence.

```yaml
type: loop
id: sdn-boundary-pressure
owner: supplier-distributor-network
measures: [cm_f3.days_since_touched, od_21.days_since_touched, pi.live_counterparties, blockers.owned_elsewhere_ratio]
changes: [partnerships.team_shape, decision_office.escalation_queue]
inputs_from: [sales, supply-discovery, decision-office]
outputs_to: [decision-office, partnerships-integrations]
close_time: monthly
status: proposed
```

**The fourth measure is the interesting one.** `blockers.owned_elsewhere_ratio` — the share of
this team's blockers that are other units' actions — is the direct instrumentation of
[[supplier-distributor-network-premortem]] M1. A team whose blockers are all external is not
blocked; it is misdrawn.

**What it changes — a dated action, not a report.** At **day 90**, if CM-F3 and OD-21 are both
still open and `pi.live_counterparties` is still 0, this loop triggers the dissolution clause
in [[supplier-distributor-network-directive]]: a written proposal to merge into
[[pos-bridge-charter]] and hand the relationship half to
[[design-partner-operations-charter]].

**A loop that measures its own team's viability is unusual, and it is deliberate.** The
alternative is that the question gets asked in month thirteen by someone else, after a year of
work that may need to be handed over anyway.

---

## Not owned here

| Loop | Owner | Why |
|---|---|---|
| Vendor catalogue coverage | [[supply-discovery-charter]] | Coverage is a discovery metric; liveness is ours (OD-21 open) |
| The commercial ask that produces a willing distributor | [[design-partner-operations-charter]] | Pre-seam under the CM-F3 proposal |
| Route auth and verification controls | [[perimeter-ingress-integrity-charter]] | We own publish-state, they own the control |
| Procurement ordering and invoice understanding | Product & Vision modules | We own who is on the other end |
| EDI transport health | **nobody — deliberately.** `YC_WEDGE_PLAN.md:40-41` says build none | A loop over infrastructure we refuse to build would be a diagram |
