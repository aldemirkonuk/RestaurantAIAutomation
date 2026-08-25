---
type: agenda-full
division: platform
department: data
team: pos-operational-telemetry-ingest
status: provisional
metrics: [pos.line_resolution_rate, pos.worst_restaurant_resolution_rate, pos.unresolved_queue_depth, sales.density]
updated: 2026-08-24
links: ["[[pos-operational-telemetry-ingest-charter]]", "[[pos-operational-telemetry-ingest-premortem]]", "[[pos-operational-telemetry-ingest-agenda-board]]", "[[pos-operational-telemetry-ingest-loops]]", "[[pos-operational-telemetry-ingest-directive]]", "[[pos-operational-telemetry-ingest-schedule]]", "[[data-agenda-full]]", "[[integration-engineering-charter]]", "[[analytics-bi-charter]]", "[[corpora-enrichment-charter]]"]
---

# POS & Operational Telemetry Ingest — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact. The pipes run today; the
> *corpus* is thin and the *fitness measurement* does not exist.

## What

Turn real restaurant operational traffic into an L0 asset that can be joined, counted and
trusted — and know, per restaurant, what fraction of it actually is.

Three things exist: ingest surfaces (20 routes across `pos-hub/` and `toast/`), the schema
for what does not resolve (`pos_unresolved_lines`, `pos_catalog_match_proposals`,
`drift_findings`), and one provider adapter. Three things do not: a published resolution
rate, an owner for the unresolved queue, and a dense enough sales corpus for anything above
to be fitted honestly.

## How

**Fitness, not volume.** The primary metric is resolution rate, which makes
rows-landed unreportable as progress ([[pos-operational-telemetry-ingest-premortem]] M1).

**Per restaurant, minimum and distribution — never a mean.** One badly-mapped account hides
perfectly behind a healthy fleet average (M2), and a mean is what everyone reaches for by
default.

**Watch distributions, not uptime.** A provider schema change delivers a perfect 200 and a
subtly wrong payload. `drift_findings` exists for this
(`…pos_unresolved_lines_and_review_queues.sql:82`) and should be watching line counts,
modifier rates, category mix, void rate and check value for step changes on a named date (M3).

**Keep raw payloads.** Re-fetch is impossible; **re-parse is the only recovery available**,
and it depends entirely on having kept the raw payload. Retention here is a data decision,
not a storage decision.

**Resolve the seam before diagnosis, not after.** Integration owns *"did the payload arrive
intact?"* by default because that question is upstream and cheap; ownership transfers here
once the payload is confirmed intact, and the transfer is recorded (M5).

## Why now

- **The unresolved queue has no owner today.** That is the observable precondition of M1, and
  it is fixable this week at approximately zero cost.
- **`apps/api-gateway/src/analytics/` (39 routes) is already consuming this substrate.**
  Baselines are being fitted right now on an unmeasured resolvable fraction.
- **`demand_score` depends on sales data** (`…enrichment_demand_priority.sql:80-95`). Thin
  or biased sales quietly mis-orders a sibling team's entire work queue while their metric
  still reads correct (M4).
- **Every day without shape monitoring is a day a silent provider change could be corrupting
  data that cannot be re-fetched.** This is the only team in the department where a week's
  delay costs a week's data permanently.

## Next steps

| # | Move | Blocks | Notes |
|---|---|---|---|
| 1 | Name an owner for `pos_unresolved_lines` and give the drain a weekly close-time | M1 | Costs nothing; removes M1's precondition |
| 2 | Publish `pos.line_resolution_rate` **per restaurant**, with min and distribution | M1, M2 | The tables to compute it already exist |
| 3 | Daily per-provider shape monitoring into `drift_findings` | M3 | Distributions, step-change alarm on a named date |
| 4 | Confirm and state the raw-payload retention window | M3 | Re-parse is the only recovery path that exists |
| 5 | Publish `sales.density` as one of the three mandatory L0 numbers | M4 | Currently absent — the absence is the signal |
| 6 | Exclude below-threshold restaurants from `demand_score` | M4 | Stops a bad account mis-ordering enrichment for everyone |
| 7 | Gate onboarding on a first-week resolution rate | M2 | The only preventive control on this page |
| 8 | Write the incident triage rule with [[integration-engineering-charter]] | M5 | Must exist before the incident, not during |

## Questions for the founder

1. **What resolution rate is acceptable** before we tell a restaurant its analytics are
   unreliable? A number is needed; the default today is that nobody is told anything.
2. **Raw payload retention window** — how long, and where? Re-fetch is impossible; this
   window is the entire disaster-recovery story for the one irreplaceable data source.
3. **A second POS provider.** `pos-provider.registry.ts` and `pos-adapters.ts` anticipate one
   and the abstraction has never been tested against a real second provider. Is that a
   near-term commitment, or should the charter stop implying multi-provider capability?
4. **Do we tell customers when their data is thin?** This is the same question as
   [[data-agenda-full]] Q3, from the ingest side. Silence is the current default and it is a
   choice.
5. **Analytics on a partial substrate.** `apps/api-gateway/src/analytics/` is live on it now.
   Label the insights, gate them below a density floor, or accept the risk explicitly?
