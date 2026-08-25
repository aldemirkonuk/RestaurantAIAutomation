---
type: loops
division: product
department: design
team: design-system-motion-substrate
status: provisional
metrics: [design.system_composition_pct, design.token_source_count, design.primitive_documented_ratio, design.a11y_violations_per_pr, design.bespoke_components_added]
updated: 2026-08-24
links: ["[[design-system-motion-substrate-charter]]", "[[design-system-motion-substrate-premortem]]", "[[design-system-motion-substrate-directive]]", "[[design-loops]]", "[[LOOP-MAP]]", "[[ux-path-burn-down-charter]]", "[[exploration-studio-charter]]", "[[client-surfaces-charter]]", "[[decision-office-charter]]"]
loop_count: 4
loop_ids: ["dss-composition-vs-documentation", "dss-token-divergence", "dss-a11y-enforcement", "dss-motion-convergence"]
loop_close_times: ["monthly", "monthly", "weekly", "fortnightly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed"]
---

# Design System & Motion Substrate — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

Four loops. This team's failures compound **silently** across 51 routes and two apps, so
every loop here publishes a **delta**, not a level — a level can sit unchanged for a year
while everyone assumes it is being worked.

---

## L-DSS-1 — Composition versus documentation

```yaml
type: loop
id: dss-composition-vs-documentation
owner: design-system-motion-substrate
measures: [design.system_composition_pct, design.primitive_documented_ratio, design.bespoke_components_added]
changes: [packages_ui.primitive_set, ci.design_lint_rules, design-system-motion-substrate.queue]
inputs_from: [ux-path-burn-down, activation-in-product-guidance, exploration-studio, engineering]
outputs_to: [design, red-team]
close_time: monthly
status: proposed
```

Counters premortem M1 and M4 together, because they are the same failure seen from two
sides: the system documents itself while bespoke components accumulate elsewhere.

**Two numbers, forward one first.** If `design.primitive_documented_ratio` rises while
`design.system_composition_pct` is still undefined, the loop reports that as the alarm
rather than as progress. Baselines: 5 of 18 documented in `apps/web/src/components/ui/`,
**0 of ~11** in `packages/ui`, **0** in `apps/mobile`; composition **undefined**.

---

## L-DSS-2 — Token divergence

```yaml
type: loop
id: dss-token-divergence
owner: design-system-motion-substrate
measures: [design.token_source_count, design.token_divergence_values]
changes: [mobile.token_source, web.token_source, decisions.open_queue]
inputs_from: [engineering, client-surfaces, media-brand]
outputs_to: [design, decision-office, architecture-review]
close_time: monthly
status: proposed
```

Counters premortem M2. The level (`2`) will not move without a migration budget, so the
loop's real output is the **divergence list**: every value present in one source and not
the other, published by name. Divergence precedes entrenchment — it is the number that
rises while the level looks stable.

**Hard escalation built into this loop:** at four consecutive close-times with
`design.token_source_count = 2` and no migration plan filed, it escalates to
[[decision-office-charter]] asking for a budget *or* permission to delete the metric. A
loop that can only report the same number forever is a diagram; this one is given an exit.

---

## L-DSS-3 — Accessibility enforcement

```yaml
type: loop
id: dss-a11y-enforcement
owner: design-system-motion-substrate
measures: [design.a11y_violations_per_pr, design.a11y_rules_enforced, design.a11y_paths_covered]
changes: [ci.a11y_gate, packages_ui.primitive_set, ux_paths_catalog.section_x]
inputs_from: [ux-path-burn-down, client-surfaces, engineering]
outputs_to: [design, ux-path-burn-down, decision-office]
close_time: weekly
status: proposed
```

Counters premortem M3. Tracks §X `NEW-667…NEW-676` (`UX_PATHS_CATALOG.md:1493`) converting
from prose to enforcement, rule by rule: skip links, focus rings, Escape behaviour, SR
announcements, reduced-motion, RTL, grid roles — **10 paths, `design.a11y_rules_enforced`
currently 0**.

Weekly because it runs per-PR and a weekly reading is the natural aggregation, and because
the department's argument against a standalone accessibility team depends entirely on this
loop actually closing. `design.a11y_violations_per_pr` reports **unmeasured**, never zero,
until a gate exists — an unmeasured violation count printed as `0` is the most misleading
cell this team could publish.

---

## L-DSS-4 — Motion convergence and cost

```yaml
type: loop
id: dss-motion-convergence
owner: design-system-motion-substrate
measures: [design.motion_specs_with_winner, design.motions_shipped_untraceable, design.motion_added_latency_ms]
changes: [sketches.manifest, mobile.motion_implementation, design-system-motion-substrate.queue]
inputs_from: [exploration-studio, engineering, activation-in-product-guidance]
outputs_to: [design, exploration-studio, decision-office]
close_time: fortnightly
status: proposed
```

Counters premortem M5. Baseline: **0 of 4** motion sketches (043, 044, 045, 046) carry a
winner; **9 named motions** fully specified with trigger / motion / haptic / anti-gimmick;
stack decided at sketch **042** (*H — RN Skia + Reanimated*).

Two failure detectors, in opposite directions:

- `design.motions_shipped_untraceable` — an animation in the product matching no spec means
  motion is being invented at the point of use.
- `design.motion_added_latency_ms` — measured on during-service interactions. Motion that
  delays a tap a somm makes at 4pm is a cost, not a delight
  ([[AGENT_NATIVE_UI_DECISION]]:92-95). The anti-gimmick clauses already in the specs are
  binding, and this is the number that enforces them.

Biweekly, matching [[exploration-studio-charter]]'s convergence cadence, so a withdrawal
decision and a winner decision arrive on the same clock.

---

## Close-time summary

| Loop | Close-time | Counters | Can it close today? |
|---|---|---|---|
| L-DSS-1 composition vs documentation | monthly | M1, M4 | Partly — composition % has no denominator yet |
| L-DSS-2 token divergence | monthly | M2 | **Yes** — both sources are on disk and diffable |
| L-DSS-3 a11y enforcement | weekly | M3 | **No** — no gate exists. Reports *unmeasured*, out loud |
| L-DSS-4 motion convergence | biweekly | M5 | **Yes** for the winner count; latency needs instrumentation |

One loop closes fully today, one partly, one needs a definition, one needs a gate that does
not exist. That is what `status: partial` means in practice — real substrate, no
instrumentation.
