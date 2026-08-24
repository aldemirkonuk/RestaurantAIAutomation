---
type: loops
division: platform
department: engineering
team: client-surfaces
status: provisional
metrics: [surfaces.reachable_route_ratio, surfaces.untraceable_route_components, surfaces.semi_orphaned_routes]
updated: 2026-08-24
links: ["[[client-surfaces-charter]]", "[[client-surfaces-premortem]]", "[[client-surfaces-directive]]", "[[engineering-loops]]", "[[design-charter]]", "[[PAGE_MAP]]", "[[LOOP-MAP]]"]
loop_count: 5
loop_count: 5
loop_count: 5
loop_ids: ["cs-route-reachability", "cs-burndown-vs-reachability", "cs-comprehension-defects", "cs-surface-health", "cs-mobile-load-watch"]
loop_close_times: ["per-PR", "fortnightly", "weekly", "weekly", "monthly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed"]
---

# Client Surfaces — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

---

## L-CS-1 — Route reachability

```yaml
type: loop
id: cs-route-reachability
owner: client-surfaces
measures: [surfaces.reachable_route_ratio, surfaces.orphan_routes, surfaces.untraceable_route_components, surfaces.semi_orphaned_routes]
changes: [web.navigation_graph, router.config, page_map.doc]
inputs_from: [design, product-and-vision]
outputs_to: [engineering, design, decision-office]
close_time: per-PR
status: proposed
```

The team's spine, and the loop that must exist before any orphan is fixed (premortem M2).
A static link-graph pass over `apps/web/src/pages/` and the router config, seeded by
`.planning/foundation/PAGE_MAP.md`. Baseline: **24 orphan routes, 13 untraceable
components** ([[README]] §0). Reports three categories — reached, **semi-orphaned**
(reachable only from an index, footer, or debug page), orphaned — because two categories
are gameable (premortem M3).

---

## L-CS-2 — Burn-down versus reachability

```yaml
type: loop
id: cs-burndown-vs-reachability
owner: client-surfaces
measures: [surfaces.ux_paths_closed, surfaces.reachable_route_ratio]
changes: [client-surfaces.work_allocation, engineering.team_allocation]
inputs_from: [design]
outputs_to: [engineering, decision-office]
close_time: fortnightly
status: proposed
```

Counters premortem M1 — deliberately a **comparison** loop rather than a progress loop.
Its only output is the relationship between two numbers. Three consecutive close-times of
burn-down movement with flat reachability triggers a department reallocation
([[engineering-premortem]] M5). Placed here, but watched at department level, because a
team cannot reliably police its own most legible metric.

---

## L-CS-3 — Comprehension defects

```yaml
type: loop
id: cs-comprehension-defects
owner: client-surfaces
measures: [surfaces.comprehension_defects_open, surfaces.screens_with_repeat_confusion, surfaces.story_coverage_of_edge_states]
changes: [component.implementation, storybook.coverage, design.intent_requests]
inputs_from: [design, guest-experience, sales]
outputs_to: [design, engineering]
close_time: weekly
status: proposed
```

Counters premortem M5. The correctness criterion here is **comprehension, not data
integrity** (`technology.md:189-190`), and comprehension has no unit test. Every relayed
"what does this screen mean?" is logged as a defect against a named screen and routed
across the Design seam (`technology.md:865`). Story coverage is measured against
**edge states** — empty, error, partial, stale — not component count; there are 4 stories
today and the evidence calls them thin.

---

## L-CS-4 — Surface health

```yaml
type: loop
id: cs-surface-health
owner: client-surfaces
measures: [surfaces.bundle_size_web, surfaces.route_render_failures, surfaces.a11y_violations, surfaces.web_test_count]
changes: [bundle.strategy, component.implementation, test.coverage]
inputs_from: [sre-observability, sre-release-engineering]
outputs_to: [engineering, sre-release-engineering]
close_time: weekly
status: proposed
```

The unglamorous half of the mandate: renders, performs, is usable with assistive
technology. Bundle health matters more for a **Vite SPA** than the CLAUDE.md §1 "Next.js"
claim implies — no server rendering, no automatic route-level splitting by default — which
is one concrete reason correcting that claim (`apps/web/package.json:8,55,94`) is this
team's work and not a documentation chore.

---

## L-CS-5 — Mobile load watch

```yaml
type: loop
id: cs-mobile-load-watch
owner: client-surfaces
measures: [surfaces.mobile_route_count, surfaces.mobile_commits_per_close_time, surfaces.mobile_orphan_routes]
changes: [client-surfaces.team_shape_recommendation]
inputs_from: [product-and-vision, guest-experience]
outputs_to: [engineering, decision-office]
close_time: monthly
status: proposed
```

Counters premortem M4. The one-team decision is right today —
`apps/mobile/app/` is roughly eight route files (`technology.md:190-192`) — and has no
expiry. This loop is the expiry: it tracks mobile's route count and commit share
separately under the single team, so the moment the structural call stops being correct is
**visible** rather than inferred a year late.

---

## Close-time summary

| Loop | Close-time | Counters |
|---|---|---|
| L-CS-1 route reachability | per-PR | M2, M3 |
| L-CS-2 burn-down vs reachability | fortnightly | M1 |
| L-CS-3 comprehension defects | weekly | M5 |
| L-CS-4 surface health | weekly | render/perf/a11y half of the mandate |
| L-CS-5 mobile load watch | monthly | M4 |
