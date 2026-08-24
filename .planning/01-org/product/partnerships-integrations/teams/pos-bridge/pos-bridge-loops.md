---
type: loops
division: product
department: partnerships-integrations
team: pos-bridge
status: exists
metrics: [pi.merchant_backed_providers, pi.canonical_shape_drift, nf_a.task_success_rate, nf_a.cost_per_task]
updated: 2026-08-24
links:
  - "[[pos-bridge-charter]]"
  - "[[pos-bridge-directive]]"
  - "[[partnerships-integrations-loops]]"
  - "[[connector-platform-trust-loops]]"
  - "[[analytics-engine-charter]]"
  - "[[architecture-review-charter]]"
  - "[[LOOP-MAP]]"
loop_count: 5
loop_count: 5
loop_count: 5
loop_ids: ["pos-registry-truth", "pos-canonical-neutrality", "pos-catalog-match-gate", "pos-hub-route-posture", "pos-real-throughput"]
loop_close_times: ["monthly", "per-change", "weekly", "per-PR", "weekly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed"]
---

# POS Bridge — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

`pi.*` metrics are defined canonically in [[partnerships-integrations-loops]] and referenced
by id here.

---

## L1 — Registry truth

The registry claims things. This loop makes the claims falsifiable.

```yaml
type: loop
id: pos-registry-truth
owner: pos-bridge
measures: [pi.merchant_backed_providers, registry.status_distribution]
changes: [pos_provider_registry.status, pos_provider_registry.capabilities]
inputs_from: [partner-alliance-development, sales, engineering]
outputs_to: [partnerships-integrations, product-vision, sales]
close_time: monthly
status: proposed
```

**What it changes.** Provider statuses, in both directions. A provider whose `scaffolded`
normalizer no longer builds is **demoted the same week**, without escalation. A provider only
reaches `available` when a real merchant has connected — not when the sandbox works.

**Why monthly.** Registry status changes on the timescale of adapter work and merchant
connections, both of which are monthly-or-slower events. A weekly loop here would report "no
change" and train people to skip it.

**Today's reading:** 27 providers — 2 `available`, 1 `partial`, 2 `scaffolded`, 22 `planned`.
`pi.merchant_backed_providers` = **0**.

---

## L2 — Canonical shape neutrality

```yaml
type: loop
id: pos-canonical-neutrality
owner: pos-bridge
measures: [pi.canonical_shape_drift]
changes: [pos_types.canonical_check, pos_provider_registry.capabilities]
inputs_from: [engineering, analytics-bi]
outputs_to: [architecture-review, analytics-bi, engineering]
close_time: per-change
status: proposed
```

**Close-time is per-change, and that is the point.** Shape drift is not a rate you observe
quarterly — it is a decision taken at a diff, and the diff is the only moment the fix is free.
The loop closes when the two-provider rule is applied at review
([[pos-bridge-directive]] Graph B). A monthly trend goes to
[[architecture-review-charter]], but the *close* happens at the merge.

**The mechanical check inside it.** Every shape change must keep the `generic_webhook`
canonical contract valid (`pos-provider.registry.ts:29-40`). That path is provider-neutral by
construction, so it fails loudly when the shape becomes vendor-specific. Free, and it does not
rely on anyone remembering the rule.

---

## L3 — Catalogue-match gate honesty

The loop that must exist **before** the first real merchant, not after.

```yaml
type: loop
id: pos-catalog-match-gate
owner: pos-bridge
measures: [nf_a.task_success_rate, nf_a.cost_per_task, gate.approval_rate, gate.dwell_time]
changes: [catalog_matcher.confidence_threshold, catalog_matcher.batching_policy]
inputs_from: [research-math, engineering]
outputs_to: [research-math, analytics-bi, people-agent-ops]
close_time: weekly
status: proposed
```

**What it measures and why both halves matter.** `nf_a.task_success_rate` alone is
approve-vs-reject, which a fatigued human inflates to ~100%. Pairing it with dwell time makes
gate fatigue visible: **approval rate rising while dwell time falls is the signature of a
rubber stamp**, and it is the failure in [[pos-bridge-premortem]] M4.

**What it changes.** The matcher's confidence threshold, and how proposals are batched —
low-confidence proposals are presented separately rather than buried in a run of 200.

**Status today: cannot close.** The gate has never run on real data, so there is no baseline.
Establishing one *is* the first deliverable of this loop, and it must be instrumented before
the first merchant connects or the baseline is contaminated on arrival.

---

## L4 — Ingress posture of the routes this team owns

```yaml
type: loop
id: pos-hub-route-posture
owner: pos-bridge
measures: [pi.verified_ingress_ratio]
changes: [pos_hub.route_guards, connector.trust_contracts]
inputs_from: [connector-platform-trust, security, engineering]
outputs_to: [connector-platform-trust, security]
close_time: per-PR
status: proposed
```

**Close-time is per-PR because that is where the CI guard runs.** A weekly review of route
posture discovers problems; a per-PR guard prevents them. The weekly reading exists only to
confirm the guard is still wired.

**Coordination, not duplication.** [[connector-platform-trust-charter]] owns the inventory and
the contract; [[perimeter-ingress-integrity-charter]] owns the control. This loop covers only
*the ten routes in `pos-hub`* and reports into both.

**Today's reading:** 1 of 10 pos-hub routes verifies
(`pos-hub.controller.ts:68-75`, `pos-hub.service.ts:96-121` — HMAC-SHA256, `timingSafeEqual`,
fails closed). Nine are unauthenticated, including the catalogue-match approval gate
(`ENDPOINTS.md:361-362`).

---

## L5 — Real-throughput watch

The smallest loop here, and the one that decides whether any of the others matter.

```yaml
type: loop
id: pos-real-throughput
owner: pos-bridge
measures: [pos_checks.real_rows, pos_checks.distinct_real_sources]
changes: [partnerships.adapter_gate, pos_provider_registry.sequencing]
inputs_from: [sales, product-vision]
outputs_to: [partnerships-integrations, analytics-bi, product-vision]
close_time: weekly
status: proposed
```

**Why it is separate from L1.** L1 measures what the registry *claims*. This measures what
arrived. The gap between them is the entire risk in [[pos-bridge-premortem]] M1, and keeping
them as one number would let a rising `scaffolded` count mask a flat row count.

**Definition care:** `real_rows` **excludes** `source='generic_webhook'` rows originating from
SimPOS. Today that exclusion takes 47 rows to 0
(`20260819000000_guest_identity_minimal_slice.sql:11-14`). If this metric is ever computed
without that exclusion it will read as success on simulator traffic — which is precisely the
mistake the metric exists to prevent.

---

## Not owned here

| Loop | Owner | Why |
|---|---|---|
| Verification control effectiveness | [[perimeter-ingress-integrity-charter]] | We measure our ten routes; Security measures the control across all ingress |
| Insight quality from canonical checks | [[analytics-engine-charter]] | We owe them true data, not their metric |
| Counterparty outreach | [[partner-alliance-development-charter]] | Different clock, different skill |
| Inference cost of catalogue matching | [[inference-cost-charter]] | We emit `nf_a.cost_per_task`; Finance owns the cost loop over it |
