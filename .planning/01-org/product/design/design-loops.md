---
type: loops
division: product
department: design
status: provisional
metrics: [design.ledger_drift_days, design.paths_closed_per_month, design.resolved_question_rate, design.token_source_count, design.time_to_first_real_action_staff_min]
updated: 2026-08-24
links: ["[[design-charter]]", "[[design-premortem]]", "[[design-directive]]", "[[ux-path-burn-down-loops]]", "[[design-system-motion-substrate-loops]]", "[[exploration-studio-loops]]", "[[activation-in-product-guidance-loops]]", "[[LOOP-MAP]]", "[[decision-office-charter]]"]
loop_count: 5
loop_count: 5
loop_count: 5
loop_ids: ["dsn-ledger-reconciliation", "dsn-convergence-pressure", "dsn-substrate-leakage", "dsn-activation-by-role", "dsn-service-surface-allocation"]
loop_close_times: ["weekly", "biweekly", "monthly", "monthly", "monthly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed"]
---

# Design — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

Department-level loops are deliberately few — five. Design's real loops live in the four
teams. These five exist because they **cross** teams, and because two of them exist to
counter failures that are already measurable in the repo today rather than forecast.

---

## L-DSN-1 — Ledger reconciliation

```yaml
type: loop
id: dsn-ledger-reconciliation
owner: design
measures: [design.ledger_drift_days, design.stale_unblocker_rows, design.deferred_unblocker_ratio]
changes: [ux_paths_catalog.deferred_log, design.agenda_board]
inputs_from: [ux-path-burn-down, engineering, data, analytics-bi]
outputs_to: [product-vision, decision-office]
close_time: weekly
status: proposed
```

The direct counter-pressure to [[design-premortem]] M1. Each week, every "Unblocked by"
cell in the Deferred Decisions Log (`UX_PATHS_CATALOG.md:10-67`) is checked **against the
repository**, not against memory. A cell claiming a widget does not exist while the widget
is on disk is a drift event and resets the counter.

Known drift on day one: `:49` says the Seating Density widget *"does not exist yet"*;
`:1013` says it shipped; `apps/web/src/components/reports/organisms/SeatingDensityPanel.tsx`
has been on disk since 2026-07-27. **Weekly, not monthly** — the log's own instruction at
`:15` already failed once by relying on a human remembering, and monthly is long enough to
forget.

---

## L-DSN-2 — Convergence pressure

```yaml
type: loop
id: dsn-convergence-pressure
owner: design
measures: [design.resolved_question_rate, design.open_null_winner_count, design.sketch_index_completeness, design.winner_shipped_conversion]
changes: [exploration_studio.wip_limit, sketches.manifest, design.agenda_board]
inputs_from: [exploration-studio, ux-path-burn-down, activation-in-product-guidance]
outputs_to: [ux-path-burn-down, design-system-motion-substrate, decision-office]
close_time: biweekly
status: proposed
```

Counters [[design-premortem]] M3. Baselines: **28 of 43** manifest rows carry
`Winner: null`; **43 of 53** directories are indexed; manifest row `039` points at no
directory. A row null for two consecutive close-times is resolved as *"no winner —
question withdrawn"*, which counts as convergence. Biweekly matches the natural length of
a sketch cycle; weekly would penalize exploration that is legitimately mid-flight, and
monthly is slow enough for the null count to double before anyone looks.

---

## L-DSN-3 — Substrate leakage

```yaml
type: loop
id: dsn-substrate-leakage
owner: design
measures: [design.token_source_count, design.system_composition_pct, design.primitive_documented_ratio, design.bespoke_components_added]
changes: [ci.design_lint_rules, packages_ui.primitive_set, mobile.token_source]
inputs_from: [design-system-motion-substrate, ux-path-burn-down, activation-in-product-guidance, engineering]
outputs_to: [engineering, architecture-review, decision-office]
close_time: monthly
status: proposed
```

Counters [[design-premortem]] M4. Measures the **forward** number — new surface composed
from system primitives — alongside the backward one (primitives documented), because M4's
whole mechanism is that the backward number can reach 100% while the system constrains
nothing. Standing alarm state: a component added under `apps/web/src/components/` with no
token reference and no story. Baselines: token sources **2**; documented primitives
**5 of 18** in `apps/web/src/components/ui/`, **0 of ~11** in `packages/ui`, **0** in
`apps/mobile`.

---

## L-DSN-4 — Activation by role

```yaml
type: loop
id: dsn-activation-by-role
owner: design
measures: [design.time_to_first_real_action_staff_min, design.time_to_first_real_action_owner_min, design.time_to_first_real_action_manager_min, design.role_default_coverage_pct, design.first_run_completion_rate_by_role]
changes: [onboarding.role_defaults, guidance.tour_policy, design.agenda_full]
inputs_from: [activation-in-product-guidance, analytics-bi, guest-experience]
outputs_to: [product-vision, growth, decision-office]
close_time: monthly
status: proposed
```

Counters [[design-premortem]] M5. **Three numbers, never averaged** — averaging them hides
staff behind owner, which is the exact failure. Monthly because activation cohorts are
monthly-sized at 11 restaurants; weekly readings would be noise presented as signal.

**This loop cannot close until the "real action" event exists.** Until then it reports
*unmeasured* every month, out loud, on [[design-agenda-board]]. A loop that reports
"unmeasured" honestly for three months is doing its job; a loop that reports nothing is
the failure.

---

## L-DSN-5 — Service-surface allocation

```yaml
type: loop
id: dsn-service-surface-allocation
owner: design
measures: [design.paths_closed_per_month, design.paths_closed_on_service_routes, design.blocked_on_endpoint_count]
changes: [design.team_allocation, ux_paths_catalog.priority_order, decisions.open_queue]
inputs_from: [ux-path-burn-down, exploration-studio, engineering, data, surface-portfolio]
outputs_to: [engineering, product-vision, decision-office, red-team]
close_time: monthly
status: proposed
```

Counters [[design-premortem]] M2, and it is the loop most likely to be quietly dropped
because it produces uncomfortable readings. Tracks **two numbers side by side**: total
paths closed, and paths closed on routes a staff member touches during service. The first
can rise for a year while the second is flat — that is M2, and only this loop can see it.

Also carries `design.blocked_on_endpoint_count`, which is the evidence base for the
commissioning-authority fork. If that number climbs for three close-times with no
escalation, the fork is being avoided rather than answered, and
[[decision-office-charter]] is told so by name.

---

## Close-time summary

| Loop | Close-time | Counters | Can it close today? |
|---|---|---|---|
| L-DSN-1 ledger reconciliation | weekly | premortem M1 | **Yes** — data is on disk |
| L-DSN-2 convergence pressure | biweekly | premortem M3 | **Yes** — manifest is countable |
| L-DSN-3 substrate leakage | monthly | premortem M4 | Partly — composition % undefined |
| L-DSN-4 activation by role | monthly | premortem M5 | **No** — event does not exist |
| L-DSN-5 service-surface allocation | monthly | premortem M2 | Partly — service-route set undefined |

Two of five can close on day one. Two can close partially. One cannot close at all and
says so. That distribution is the honest state of a department whose corpora are large and
whose instrumentation is absent — and it is why [[design-agenda-full]] sequences
*measure* before *ship*.
