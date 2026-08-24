---
type: loops
division: product
department: design
team: ux-path-burn-down
status: provisional
metrics: [design.ledger_drift_days, design.paths_closed_per_month, design.deferred_unblocker_ratio, design.blocked_on_endpoint_count, design.paths_closed_on_service_routes]
updated: 2026-08-24
links: ["[[ux-path-burn-down-charter]]", "[[ux-path-burn-down-premortem]]", "[[ux-path-burn-down-directive]]", "[[design-loops]]", "[[LOOP-MAP]]", "[[engineering-charter]]", "[[data-charter]]", "[[decision-office-charter]]", "[[UX_PATHS_CATALOG]]"]
loop_count: 4
loop_count: 4
loop_count: 4
loop_ids: ["uxb-blocker-reconciliation", "uxb-close-rate-vs-service", "uxb-endpoint-blocked-escalation", "uxb-inflow-from-reality"]
loop_close_times: ["weekly", "monthly", "monthly", "monthly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed"]
---

# UX Path Burn-Down — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

Four loops. The first exists because the ledger is **already** wrong; the other three exist
because the ways it will go wrong next are all predictable.

---

## L-UXB-1 — Blocker reconciliation

```yaml
type: loop
id: uxb-blocker-reconciliation
owner: ux-path-burn-down
measures: [design.ledger_drift_days, design.stale_unblocker_rows, design.uncheckable_unblocker_cells, design.deferred_unblocker_ratio]
changes: [ux_paths_catalog.deferred_log, ux_paths_catalog.section_banners, ux-path-burn-down.queue]
inputs_from: [engineering, data, analytics-bi, design-system-motion-substrate, exploration-studio]
outputs_to: [design, decision-office]
close_time: weekly
status: proposed
```

Every "Unblocked by" cell in `UX_PATHS_CATALOG.md:10-67`, checked **against the repo**.
Reports **three** numbers, never one:

| Number | Meaning | Predicts |
|---|---|---|
| still-blocked | Verified, blocker holds | Baseline health |
| now-unblocked | Blocker resolved, row not updated | Premortem M1 — this is `:49` |
| **uncheckable** | Cell names no path/table/endpoint/OD-id | Premortem M4 — the ratio being gamed |

A summary that collapses these into one number destroys the loop. **Weekly, not monthly**:
the log's own instruction at `:15` already failed once by relying on human memory during
burn-down sessions, and a month is long enough for the failure to repeat before anyone
looks.

Day-one input: the §AA row at `:49`, stale since 2026-07-27.

---

## L-UXB-2 — Close rate versus service surface

```yaml
type: loop
id: uxb-close-rate-vs-service
owner: ux-path-burn-down
measures: [design.paths_closed_per_month, design.paths_closed_on_service_routes, design.paths_closed_by_tier]
changes: [ux_paths_catalog.priority_order, ux-path-burn-down.allocation]
inputs_from: [surface-portfolio, activation-in-product-guidance, design-system-motion-substrate]
outputs_to: [design, product-vision, red-team]
close_time: monthly
status: proposed
```

Counters premortem M2. **Two numbers side by side, always.** Total closed can rise for a
year while service-route closed is flat; only this loop sees that, and only if the second
number is published. Alarm state: three consecutive close-times where the first moves and
the second does not.

Monthly rather than weekly because the comparison is a trend, and a weekly reading of it
is noise presented as signal. The underlying counts are still collected weekly by
[[ux-path-burn-down-schedule]].

---

## L-UXB-3 — Endpoint-blocked escalation

```yaml
type: loop
id: uxb-endpoint-blocked-escalation
owner: ux-path-burn-down
measures: [design.blocked_on_endpoint_count, design.blocked_rows_with_named_counterpart, design.escalations_filed]
changes: [decisions.open_queue, engineering.intake, ux-path-burn-down.queue]
inputs_from: [engineering, data]
outputs_to: [engineering, decision-office, red-team]
close_time: monthly
status: proposed
```

Counters premortem M3 and is the **evidence base for the commissioning fork**. Publishes
the count of endpoint-blocked rows, how many carry a named Engineering counterpart, and how
many escalations were filed.

The failure it detects is silence, not volume: a rising count with **zero escalations**
means the team has adapted to the open fork instead of forcing it closed. When that
pattern appears, [[decision-office-charter]] is told by name and the loop says so out loud
rather than filing a number.

Interim rule while the fork is open: no more than one close-time's worth of
endpoint-blocked rows may be carried without a named counterpart per row. A blocker with
nobody's name on it is a wish.

---

## L-UXB-4 — Inflow from reality

```yaml
type: loop
id: uxb-inflow-from-reality
owner: ux-path-burn-down
measures: [design.rows_originated_outside_catalogue, design.rows_closed_will_not_build, design.catalogue_total]
changes: [ux_paths_catalog.rows, ux_paths_catalog.statuses]
inputs_from: [exploration-studio, activation-in-product-guidance, sales, guest-experience, surface-portfolio]
outputs_to: [design, product-vision]
close_time: monthly
status: proposed
```

Counters premortem M5 — the catalogue becoming the definition of the product. At least one
row per close-time must originate **outside** the catalogue: a support question, an
observed service moment, or an [[exploration-studio-charter]] winner. A backlog with no
inflow from reality is a museum catalogue, and perfect ledger adherence is the tell.

Also tracks `design.catalogue_total`, currently **910** — because the corpus grows, and
the last time it grew nobody updated the figure ([[engineering-premortem]] M5 still says
760). A denominator that is measured monthly cannot silently rot.

`design.rows_closed_will_not_build` reports **unavailable** until the founder grants that
state. Reporting *unavailable* is honest; reporting **0** would falsely imply the option
exists and is unused.

---

## Close-time summary

| Loop | Close-time | Counters | Can it close today? |
|---|---|---|---|
| L-UXB-1 blocker reconciliation | weekly | M1, M4 | **Yes** — the log and the repo are both on disk |
| L-UXB-2 close rate vs service | monthly | M2 | Partly — the service-route set must be defined first |
| L-UXB-3 endpoint-blocked escalation | monthly | M3 | **Yes** — counting is possible now |
| L-UXB-4 inflow from reality | monthly | M5 | Partly — "will not build" needs a founder call |
