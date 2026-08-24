---
type: loops
division: platform
department: data
team: pos-operational-telemetry-ingest
status: provisional
metrics: [pos.line_resolution_rate, pos.worst_restaurant_resolution_rate, pos.unresolved_queue_depth, pos.provider_schema_drift_findings, sales.density]
updated: 2026-08-24
links: ["[[pos-operational-telemetry-ingest-charter]]", "[[pos-operational-telemetry-ingest-premortem]]", "[[pos-operational-telemetry-ingest-directive]]", "[[pos-operational-telemetry-ingest-schedule]]", "[[data-loops]]", "[[corpora-enrichment-loops]]", "[[integration-engineering-charter]]", "[[catalogue-identity-charter]]", "[[analytics-bi-charter]]", "[[LOOP-MAP]]"]
loop_count: 5
loop_count: 5
loop_count: 5
loop_ids: ["unresolved-queue-drain", "onboarding-resolution-gate", "provider-shape-monitoring", "sales-density-reporting", "ingest-incident-triage"]
loop_close_times: ["weekly", "per onboarding, within 7 days", "daily", "weekly", "per incident, ownership within 1 hour"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed"]
---

# POS & Operational Telemetry Ingest — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a diagram,
not a loop ([[ORG_STRUCTURE]] §5).

**Close-times here are tighter than elsewhere in the department, on purpose.** This is the
only source that cannot be re-run — a detection delay is a permanent data loss, not a delayed
fix.

---

## 1. Unresolved queue drain — the loop the team exists for

```yaml
type: loop
id: unresolved-queue-drain
owner: pos-operational-telemetry-ingest
measures: [pos.unresolved_queue_depth, pos.line_resolution_rate, pos.worst_restaurant_resolution_rate]
changes: [pos.mapping_rules, catalogue.match_candidates]
inputs_from: [integration-engineering, catalogue-identity]
outputs_to: [analytics-bi, corpora-enrichment, data]
close_time: weekly
status: proposed
```

Drains `pos_unresolved_lines` and `pos_catalog_match_proposals`
(`…20260805133000_pos_unresolved_lines_and_review_queues.sql:12,47`).

**Closes when a mapping rule changes, not when rows are cleared.** A drain that only clears
rows is a treadmill and the queue refills at the rate it was emptied
([[pos-operational-telemetry-ingest-directive]] Rule 1). Reported per restaurant — minimum
and distribution, never mean.

---

## 2. Onboarding resolution gate — the only preventive loop here

```yaml
type: loop
id: onboarding-resolution-gate
owner: pos-operational-telemetry-ingest
measures: [pos.first_week_resolution_rate]
changes: [pos.onboarding_mapping, pos.onboarding_completion_status]
inputs_from: [sales, partnerships-integrations]
outputs_to: [data, sales, catalogue-identity]
close_time: per onboarding, within 7 days
status: proposed
```

A badly-mapped account costs an afternoon to fix in week one and is nearly undetectable in
month six ([[pos-operational-telemetry-ingest-premortem]] M2). **Onboarding does not complete
until this closes.** Every other loop on this page is detective; this one is preventive, which
makes it worth more than its size suggests.

---

## 3. Provider shape monitoring — the loop that races an irreversible clock

```yaml
type: loop
id: provider-shape-monitoring
owner: pos-operational-telemetry-ingest
measures: [pos.provider_schema_drift_findings, pos.mean_lines_per_check, pos.modifier_rate, pos.category_mix_distance, pos.void_rate, pos.mean_check_value]
changes: [pos.parser_mappings, pos.provider_adapter]
inputs_from: [integration-engineering]
outputs_to: [integration-engineering, data, analytics-bi]
close_time: daily
status: proposed
```

Feeds `drift_findings` (`…:82`). Watches **distributions, not uptime** — a provider change
delivers a perfect 200 with subtly wrong semantics
([[pos-operational-telemetry-ingest-premortem]] M3). Step change on a named date escalates the
**same day**.

**Paired obligation:** raw payloads retained for a stated window. Re-fetch is impossible;
re-parse is the only recovery, and it exists only if the payload was kept.

---

## 4. Sales density — the loop that protects a sibling's metric

```yaml
type: loop
id: sales-density-reporting
owner: pos-operational-telemetry-ingest
measures: [sales.density, pos.restaurants_below_demand_threshold]
changes: [corpora.demand_score_eligibility, analytics.insight_density_gate]
inputs_from: [analytics-bi]
outputs_to: [corpora-enrichment, analytics-bi, data]
close_time: weekly
status: proposed
```

One of the department's three mandatory L0 numbers ([[data-loops]] loop 1) and currently
**absent — the absence is the signal**.

The cross-team edge is the important part: `demand_score` is computed from restaurant
inventory and sales (`…20260813170000_enrichment_demand_priority.sql:80-95`), so a
badly-resolving restaurant mis-orders [[corpora-enrichment-charter]]'s entire work queue while
*their* metric still reads correct. This loop excludes below-threshold restaurants from
`demand_score` — a sibling team's primary metric depends on this loop closing
([[pos-operational-telemetry-ingest-premortem]] M4).

---

## 5. Seam triage — the loop that runs during an incident

```yaml
type: loop
id: ingest-incident-triage
owner: integration-engineering
measures: [ingest.time_to_ownership, ingest.disputed_incident_count]
changes: [pos.triage_rule]
inputs_from: [pos-operational-telemetry-ingest]
outputs_to: [pos-operational-telemetry-ingest, engineering, data]
close_time: per incident, ownership within 1 hour
status: proposed
```

**Owner is the other side of the seam, deliberately.** Integration holds ingest incidents by
default because *"did the payload arrive intact?"* is upstream and cheap; ownership transfers
here once intactness is confirmed, and the transfer is recorded
([[pos-operational-telemetry-ingest-directive]] Decision 2).

The measured quantity is **time-to-ownership**, not time-to-resolution — the failure mode
being prevented is a delay in deciding whose problem it is (M5), not a slow fix.

---

## Cross-team dependency map

```
integration-engineering ──(payload intact)──> this team ──(resolved lines)──> analytics-bi
                                                  │
                                                  ├──(demand_score input)──> corpora-enrichment
                                                  └──(match proposals)─────> catalogue-identity
```

Two of these edges carry silent failures: a mis-ordered `demand_score` looks correct to
[[corpora-enrichment-charter]], and baselines fitted on the resolvable half look correct to
[[analytics-bi-charter]]. Neither downstream team can detect the problem from their side,
which is why both edges are named here rather than assumed.
