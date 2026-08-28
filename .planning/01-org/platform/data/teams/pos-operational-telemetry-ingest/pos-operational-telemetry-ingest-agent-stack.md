---
type: agent-stack
division: platform
department: data
team: pos-operational-telemetry-ingest
status: designed
updated: 2026-08-27
metrics: [pos.line_resolution_rate, pos.worst_restaurant_resolution_rate, pos.unresolved_queue_depth, sales.density, nf_b.exposure_events]
links: ["[[pos-operational-telemetry-ingest-charter]]", "[[pos-operational-telemetry-ingest-schedule]]", "[[pos-operational-telemetry-ingest-loops]]", "[[pos-operational-telemetry-ingest-directive]]", "[[pos-operational-telemetry-ingest-premortem]]", "[[0034-agent-stack-artifact]]", "[[data-agent-stack]]", "[[integration-engineering-charter]]", "[[skills-charter]]"]
---

# POS & Operational Telemetry Ingest — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The only unit here whose source it does not own and cannot re-run: **a missed webhook is a
> permanently missing Tuesday**. That fact shapes the whole card — the agent's job is detection
> speed, not throughput, and it is fenced off the transport side of the seam with
> [[integration-engineering-charter]] (delivery vs. fitness, `technology.md:859`).

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `pos-fitness-monitor` | Publish resolution as a per-restaurant minimum and distribution, watch each provider's shape for step changes while the raw payload can still be re-read, and turn the unresolved queue into mapping-rule changes rather than cleared rows | NEW |

## 2. Agent cards

```yaml
agent: pos-fitness-monitor
unit: pos-operational-telemetry-ingest
triggers:
  - schedule: "daily — provider shape monitoring, and the raw-payload retention check"   # mirrored in [[pos-operational-telemetry-ingest-schedule]]
  - schedule: "weekly — unresolved queue drain, per-restaurant resolution report, sales.density"
  - topic: pos.restaurant_onboarded              # publisher: NONE (gap — no onboarding event exists; the first-week gate is manual)
consumes:
  - "`pos_unresolved_lines`, `pos_catalog_match_proposals`, `drift_findings` — publisher: the ingest surfaces `apps/api-gateway/src/{pos-hub,toast}/` and `agents/pos_integration_agent.py` (exists)"
  - "the POS-agnostic `pos_checks` / `tables` schema behind the analytics engine"
  - "counting and correlation columns — `supabase/migrations/20260805132000_counting_catalog_and_correlation_columns.sql`"
emits:
  - "`pos.line_resolution_rate` per restaurant, minimum and distribution — consumers: [[data-agent-stack|data-l0-rollup]] and [[analytics-bi-charter]]"
  - "`sales.density` per restaurant — consumer: [[corpora-enrichment-agent-stack|enrichment-runner]]'s demand queue (`…enrichment_demand_priority.sql:80-95`)"
  - "mapping-rule changes and match proposals — consumer: [[catalogue-identity-charter]]"
  - "`drift_findings` rows on a provider step change — consumer: NONE (gap, see §5)"
  - nf_a events (task_type: pos_line_resolution)
routing_class: extraction        # compare distributions, resolve lines to catalogue items, count per restaurant
quality_bar: "NONE (gap). The charter is explicit that no line-resolution rate is published today, per restaurant or otherwise; the tables that would let it be computed exist, the number does not. Until it exists this agent has a job and no grade"
autonomy:
  read: autonomous
  propose: autonomous
  mutate_stock_money_outbound: confirm   # constant
memory: pos-operational-telemetry-ingest
escalates_to: "[[data-charter]]"
```

**The card's two hard rules.** (1) It never reports a fleet mean — minimum and distribution
only ([[pos-operational-telemetry-ingest-directive]]); a healthy average is exactly how one dark
restaurant hides ([[pos-operational-telemetry-ingest-premortem]] M2). (2) It never reaches into
transport: no replay, no signature debugging, no retry. That belongs to
[[integration-engineering-charter]], and an agent that crosses the line during an incident
re-litigates the seam at the worst possible moment (M5).

## 3. Skills

*(intentionally empty)*

**There is no procedure this unit has actually repeated yet.** All four entries in
[[pos-operational-telemetry-ingest-schedule]] cite substrate rather than a completed run, and
under §3.3 rule 3 that is not a row. `pos-line-resolution-repair` cites tables and a matcher that
exist while the charter records **no queue owner and no published rate** — so no drain has been
performed. `pos-shape-drift-check` cites `agents/drift_agent.py`, which is real but runs the
**SimPOS** catalog↔mapping comparison: an analogue in another team's domain, not an instance of
provider shape monitoring. `pos-onboarding-verify` cites a control that *would have* prevented
M2 — a counterfactual. `sales-density-report` cites the `demand_score` computation that
*consumes* density, which is a downstream dependency, not evidence the report was produced.

The qualifying event for the first row is one weekly drain that ends in a changed mapping rule
and a republished per-restaurant rate. That is also the team's first real metric.

**Deliberately never proposed: `pos-webhook-replay`.** Replay is on the delivery side of the
seam; a skill here that reaches into transport re-blurs the exact line
[[pos-operational-telemetry-ingest-directive]] Decision 2 exists to keep sharp.

## 4. Memory

- **Procedural** — empty today, honestly. Candidates reach [[skill-harvesting-charter]]'s queue
  once §3 has a row; consolidation is what promotes them.
- **Episodic** — nf_a `task_type: pos_line_resolution`. Needs `context.restaurant_id` and
  `context.provider` as jsonb keys, for the same reason the metric is per restaurant: that slice
  must be one filter, not a join reinvented weekly. `nf_b.exposure_events` sit downstream — an
  unresolved line is a guest choice never recorded, and unresolved lines cluster on unusual items,
  which carry the most preference information ([[README]] §4.2).
- **Semantic** — `memory/` beside this file, `pos-operational-telemetry-ingest-MEMORY.md` as
  index. Founding facts: each provider's normal shape (line count, modifier rate, category mix,
  void rate, check value) as the baseline a step change is measured against; the per-restaurant
  mapping quirks behind past unresolved classes; and the raw-payload retention window, which is
  the clock every other fact here races. Provenance frontmatter; every write a PR.
- **Working** — this card, the MEMORY index, charter §Mandate, and the current restaurant's
  baseline. Check-level data is a retrieval target by restaurant and date, never preloaded.

**Consolidation** — monthly, with one exception the other four units do not need: **a provider
step change is written as a fact the same day it is found**, not at month end, because the raw
payload that would let it be diagnosed can expire first
([[pos-operational-telemetry-ingest-schedule]]'s daily retention check). Otherwise standard:
failures first, every unresolved class named by mechanism, expire at 90 days, one PR, "no delta"
stated when true.

## 5. Async contract

Loops ([[pos-operational-telemetry-ingest-loops]]: `unresolved-queue-drain`,
`onboarding-resolution-gate`, `provider-shape-monitoring`, `sales-density-reporting`, and
`ingest-incident-triage` — the last owned by [[integration-engineering-charter]], per-event),
NF-A events, vault PRs. Gap rows:

| Gap | Why it is a gap |
|---|---|
| The unresolved queue has no named drainer | The queue exists in schema and nobody owns driving it down — [[pos-operational-telemetry-ingest-premortem]] M1's mechanism, not its symptom. This card *proposes* the owner; it does not make one |
| `drift_findings` rows have no consumer | The table is written; no unit is named as reading it. Same-day escalation is declared in the schedule and lands nowhere specific |
| `pos.restaurant_onboarded` has no publisher | The first-week resolution gate is a manual step in an onboarding flow this team does not own |
| One provider, untested abstraction | Toast is the only adapter; `pos-provider.registry.ts` and `pos-adapters.ts` anticipate more and have never met a second real provider. Recorded, not counted as capability |
| The analytics consumers are unguarded | `apps/api-gateway/src/analytics/` (39 routes) reads this substrate with no guard; the guard question belongs to [[security-charter]] and [[platform-api-charter]], the **dependency** is noted here |

## 6. Evidence today

- **EXISTS — the pipes.** `…20260805133000_pos_unresolved_lines_and_review_queues.sql`
  (`pos_unresolved_lines` `:12`, `pos_catalog_match_proposals` `:47`, `drift_findings` `:82`),
  `…20260805132000_counting_catalog_and_correlation_columns.sql`, `apps/api-gateway/src/pos-hub/`
  (10 routes), `apps/api-gateway/src/toast/` (10 routes), `agents/pos_integration_agent.py`,
  `adapters/toast_adapter.py`.
- **PARTIAL — the corpus.** Sales metrics are named thin in [[README]] §1; the team is graded
  `partial` on that basis and not on the state of its code.
- **NEW — the monitor, its memory, and (for now) its entire skill table.** The honest summary:
  everything needed to compute this unit's primary metric exists, and the metric has never been
  computed.
