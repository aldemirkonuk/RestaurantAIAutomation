---
type: loops
division: product
department: partnerships-integrations
status: partial
metrics: [pi.merchant_backed_providers, pi.verified_ingress_ratio, pi.live_counterparties, pi.unblocking_agreements, nf_a.task_success_rate]
updated: 2026-08-24
links:
  - "[[partnerships-integrations-charter]]"
  - "[[partnerships-integrations-directive]]"
  - "[[pos-bridge-loops]]"
  - "[[connector-platform-trust-loops]]"
  - "[[supplier-distributor-network-loops]]"
  - "[[partner-alliance-development-loops]]"
  - "[[perimeter-ingress-integrity-charter]]"
  - "[[LOOP-MAP]]"
loop_count: 6
loop_count: 6
loop_count: 6
loop_ids: ["pi-merchant-pull", "pi-ingress-verification", "pi-counterparty-unblocking", "pi-open-fork-staleness", "pi-canonical-shape-neutrality", "pi-doc-drift-repair"]
loop_close_times: ["weekly", "weekly", "monthly", "monthly", "per-change", "weekly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed", "proposed"]
---

# Partnerships & Integrations — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

## Metric registry — `pi.*` defined once, here

Team loop files reference these by id and do not redefine them.

| Metric | Definition | Source of truth | Today |
|---|---|---|---|
| `pi.merchant_backed_providers` | Registry providers at `status: "available"` **with at least one real merchant connected** | `pos-provider.registry.ts` + `pos_checks` rows with a non-simulator source | **0** |
| `pi.verified_ingress_ratio` | Ingress routes enforcing signature/shared-secret verification ÷ all ingress routes. *Ingress* excludes management and simulator routes | the ingress inventory owned by [[connector-platform-trust-charter]] | 1 of 3 correct |
| `pi.live_counterparties` | Distributors with a refreshing price feed **or** an active portal login | `vendor-portal` sessions, feed refresh timestamps | **0** |
| `pi.unblocking_agreements` | Signed agreements that move a `partner_agreement` provider off blocked | `authModel: "partner_agreement"` × 9 in the registry | **0** of 9 |
| `pi.canonical_shape_drift` | Fields in `pos-types.ts` populated by exactly one provider and not capability-gated | `pos-types.ts` vs registry | baseline unmeasured |
| `pi.doc_corrections_carried` | Verified doc corrections carried back to source ÷ corrections found | this department's own log | 0 of 3 |

---

## L1 — Merchant pull, not adapter count

The department's spine. Everything else is subordinate to it.

```yaml
type: loop
id: pi-merchant-pull
owner: partnerships-integrations
measures: [pi.merchant_backed_providers]
changes: [pos_provider_registry.sequencing, partnerships.adapter_gate]
inputs_from: [pos-bridge, partner-alliance-development, sales]
outputs_to: [product-vision, analytics-bi, engineering]
close_time: weekly
status: proposed
```

**What changes when it reads 0.** The adapter gate in [[partnerships-integrations-directive]]
stays shut: no new adapter may begin. Effort is redirected to the two `available` universal
paths (`pos-provider.registry.ts:29-51`) or to a named venue. The loop closes weekly because
that is how often the gate decision is actually taken — any slower and a quarter of adapter
work lands before anyone notices the number never moved.

**Why it is not `scaffolded` count.** Counting scaffolded providers is a loop that always
reads "up" and therefore changes nothing. It is a diagram.

---

## L2 — Ingress verification integrity

```yaml
type: loop
id: pi-ingress-verification
owner: connector-platform-trust
measures: [pi.verified_ingress_ratio]
changes: [connector.trust_contracts, ci.ingress_guard, engineering.route_guards]
inputs_from: [security, engineering, pos-bridge]
outputs_to: [security, engineering, red-team]
close_time: weekly
status: proposed
```

**Trigger, not just cadence.** This loop also closes **on every PR** that adds or changes a
route in an ingress module — that is the CI guard, and it is the part that makes the weekly
review a check rather than a discovery.

**Coordination, not duplication.** [[perimeter-ingress-integrity-charter]] owns the control.
This loop measures whether the per-connector *contract* is satisfied and feeds Security the
inventory. If both units run the same measurement, delete this one and keep Security's.

**Today's reading, verified in-session:** 3 real ingress routes — `pos-hub` webhook
(correct, fails closed, `pos-hub.service.ts:96-121`), `toast` webhook (verifies only when a
signature is present, `toast.service.ts:189` — fails open on unsigned), `inbound-email`
(shared secret, but accepts it in the query string, `inbound-email.controller.ts:38-40`).

---

## L3 — Counterparty unblocking

```yaml
type: loop
id: pi-counterparty-unblocking
owner: partner-alliance-development
measures: [pi.unblocking_agreements, pi.live_counterparties]
changes: [pos_provider_registry.status, partnerships.outreach_queue]
inputs_from: [sales, strategy-fundraising, supplier-distributor-network]
outputs_to: [pos-bridge, product-vision]
close_time: monthly
status: proposed
```

**Why monthly and not weekly.** A counterparty's clock is not ours. A weekly loop over
signatures would produce 51 "no change" entries a year and be ignored by week six.
**Zero is an acceptable reading.** What is not acceptable is a reading that cannot say
whether outreach happened — so this loop reports *attempts and response times* alongside the
count, which move weekly even when agreements do not.

---

## L4 — Boundary-dispute staleness

The loop that exists because [[partnerships-integrations-premortem]] M3 and M4 are both
failures of *nothing happening*.

```yaml
type: loop
id: pi-open-fork-staleness
owner: partnerships-integrations
measures: [od_07.days_since_touched, cm_f3.days_since_touched, od_21.days_since_touched, od_23.days_since_touched]
changes: [partnerships.team_shape, decision_office.escalation_queue]
inputs_from: [decision-office, guest-experience, sales]
outputs_to: [decision-office, product-vision]
close_time: monthly
status: proposed
```

**What it actually does.** Two hard actions, not a report:
- OD-07 untouched 60 days **while** guest-experience commits continue → *decision-by-drift*
  finding filed with [[decision-office-charter]], naming the commits.
- CM-F3 and OD-21 both open at day 90 with `pi.live_counterparties` = 0 → dissolution
  proposal for [[supplier-distributor-network-charter]].

A staleness loop with no consequence is the thing it is supposed to prevent.

---

## L5 — Canonical shape neutrality

```yaml
type: loop
id: pi-canonical-shape-neutrality
owner: pos-bridge
measures: [pi.canonical_shape_drift]
changes: [pos_types.canonical_check, pos_provider_registry.capabilities]
inputs_from: [engineering, analytics-bi]
outputs_to: [engineering, analytics-bi, architecture-review]
close_time: per-change
status: proposed
```

**Close-time is per-change, deliberately.** Shape drift is not a rate to be observed
monthly; it is a decision taken at a diff. The loop closes when the two-provider rule is
applied at review time — which is also the only moment the fix is cheap. Reported monthly to
[[architecture-review-charter]] as a trend, but *closed* at the diff.

---

## L6 — Doc-code drift repair

```yaml
type: loop
id: pi-doc-drift-repair
owner: partnerships-integrations
measures: [pi.doc_corrections_carried]
changes: [foundation.teams_product, foundation.endpoints, foundation.page_map]
inputs_from: [pos-bridge, connector-platform-trust]
outputs_to: [knowledge-documentation, product-vision, decision-office]
close_time: weekly
status: proposed
```

**Why this is a department loop and not a chore.** Three upstream errors surfaced in one
reading session, all of which would have misdirected planning: the registry has 27 providers
not 30; "0 of 32 webhooks verify" is false; vendor-portal was already reclassified. This
department sits where docs and code drift apart fastest, so it will keep generating these.
The loop closes weekly and its metric is *carried back*, not *found* — finding without
repairing produces private knowledge.

---

## Loops we deliberately do **not** own

| Loop | Owner | Why not here |
|---|---|---|
| Webhook signature control effectiveness | [[perimeter-ingress-integrity-charter]] | We measure the contract; Security measures the control. Two loops on one number is how a secret ends up unset in one environment with both units assuming the other checked. |
| Vendor catalogue coverage | [[supply-discovery-charter]] | Coverage is discovery's metric; live feeds are ours (OD-21). |
| Guest-app build progress | [[consumer-app-points-economy-charter]] | We own only the Beli conversation (OD-07). |
| Inference cost of catalogue matching | [[inference-cost-charter]] | We supply `nf_a.*` events from the match agent; Finance owns the cost loop. |
