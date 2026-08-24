---
type: loops
division: product
department: product-vision
team: surface-portfolio
status: provisional
metrics: [surface.unowned_surface_count, surface.untraceable_route_components, surface.routes_without_owning_module]
updated: 2026-08-24
links: ["[[surface-portfolio-charter]]", "[[surface-portfolio-directive]]", "[[surface-portfolio-premortem]]", "[[surface-portfolio-schedule]]", "[[product-vision-loops]]", "[[ux-path-burn-down-charter]]", "[[client-surfaces-charter]]", "[[PAGE_MAP]]", "[[ENDPOINTS]]"]
loop_count: 6
loop_count: 6
loop_count: 6
loop_ids: ["route-portfolio-verdict", "route-duplication-resolution", "route-module-reconciliation", "route-untraceability", "cold-entry-recheck", "mobile-inventory-gap"]
loop_close_times: ["monthly", "monthly", "monthly", "monthly", "quarterly", "quarterly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed", "proposed"]
---

# Surface Portfolio — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

**None of these loops is blocked.** That is unusual in this department and is the reason
this team is first in the activation order — every input it needs already exists on disk.

---

## L1 — Route verdict loop (the spine)

```yaml
type: loop
id: route-portfolio-verdict
owner: product-vision
team: surface-portfolio
measures: [surface.routes_with_verdict, surface.routes_killed, surface.routes_merged, surface.routes_made_reachable, surface.routes_newly_intentionally_cold, surface.unowned_surface_count]
changes: [routes.verdict_sheet, apps/web/src/App.tsx, PAGE_MAP.md]
inputs_from: [design, engineering, ux-path-burn-down]
outputs_to: [client-surfaces, design, ux-path-burn-down]
close_time: monthly
status: proposed
baseline: "0 of 51 routes have a verdict; 24 cold-entry + 13 untraceable (26 distinct routes, 11 on both lists)"
```

**The loop closes on the diff between the regenerated map and the verdict sheet** — never on
the regeneration alone. Five of the six measures are movement buckets rather than a single
count, because a count that falls through reclassification looks identical to a count that
falls through work ([[surface-portfolio-premortem]] M2).

---

## L2 — Duplication-resolution loop

```yaml
type: loop
id: route-duplication-resolution
owner: product-vision
team: surface-portfolio
measures: [surface.live_duplications]
changes: [routes.verdict_sheet, apps/web/src/App.tsx]
inputs_from: [ask-ai, design]
outputs_to: [client-surfaces, ask-ai]
close_time: monthly
status: proposed
baseline: "3 — /wine-agent + /wineagent (App.tsx:293-294, both rendering PlaceholderPage from :349); /inventory + /inventory-legacy; /calendar + /calendar-classic"
```

The cheapest possible proof this team can decide something. Two URLs rendering the same
placeholder is pure waste with no learning attached, and it is resolvable by one person in
an hour. If this loop has not closed by the second close-time, that is the team's own M1
signal firing early.

---

## L3 — Route ↔ module reconciliation loop

```yaml
type: loop
id: route-module-reconciliation
owner: product-vision
team: surface-portfolio
measures: [surface.routes_without_owning_module, surface.modules_without_a_page]
changes: [routes.verdict_sheet, module.ownership_map]
inputs_from: [engineering, platform-api]
outputs_to: [engineering, product-vision]
close_time: monthly
status: proposed
baseline: "unmeasured; 51 routes vs 448 endpoints across 44 modules (ENDPOINTS.md)"
```

Two orphan directions, deliberately measured separately. A page with no module is dead
surface; a module with no page is capability nobody can reach. They have different owners
and different remedies, and neither is visible from the route list alone.

---

## L4 — Untraceability-resolution loop

```yaml
type: loop
id: route-untraceability
owner: product-vision
team: surface-portfolio
measures: [surface.untraceable_route_components, surface.untraceable_asks_open, surface.untraceable_asks_past_due]
changes: [PAGE_MAP.md, apps/web/src/App.tsx]
inputs_from: [client-surfaces]
outputs_to: [client-surfaces, decision-office]
close_time: monthly
status: proposed
baseline: "13 untraceable (PAGE_MAP:151-167); 11 of them also cold-entry; 0 asks filed"
```

Tracked separately from L1's count on purpose: **unreachable** and **unmapped** are
different problems with different owners, and 11 routes are both — summing them would
double-count. Until these resolve, [[PAGE_MAP]]'s 39 navigation edges are a **floor**, not a
count, because navigation *out* of untraceable components is unrepresented.

---

## L5 — Cold-entry re-check loop

```yaml
type: loop
id: cold-entry-recheck
owner: product-vision
team: surface-portfolio
measures: [surface.intentionally_cold_count, surface.cold_rechecks_overdue]
changes: [routes.verdict_sheet]
inputs_from: [design, growth]
outputs_to: [design, product-vision]
close_time: quarterly
status: proposed
baseline: "0 routes formally declared intentionally-cold; several are correctly cold today (/v/:slug, /invite/:code, /login, /register)"
```

*Intentionally-cold* is the classification most likely to become a permanent hiding place,
so it is the one with a mandatory expiry. `surface.cold_rechecks_overdue` should be **0**;
any non-zero value is the escalation.

---

## L6 — Mobile-inventory-gap loop

```yaml
type: loop
id: mobile-inventory-gap
owner: product-vision
team: surface-portfolio
measures: [surface.mobile_routes_inventoried, surface.mobile_routes_shipped_since_gap_raised]
changes: [inventory.scope, PAGE_MAP.md]
inputs_from: [client-surfaces, design]
outputs_to: [client-surfaces, decision-office]
close_time: quarterly
status: proposed
baseline: "0 mobile routes inventoried; apps/mobile has no PAGE_MAP equivalent anywhere in the repo"
```

A deliberately small loop that exists so the gap is *counted* rather than assumed. The web
portfolio's 24 orphans accumulated because nobody was counting; the second measure exists so
the same thing cannot happen on native unobserved
([[surface-portfolio-premortem]] M5).
