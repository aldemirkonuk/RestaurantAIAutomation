---
type: loops
division: product
department: product-vision
status: provisional
metrics: [surface.unowned_surface_count, askai.refusal_correctness, inbound.false_accept_count, floor.misroute_rate, supply.sku_dual_price_coverage_pct]
updated: 2026-08-24
links: ["[[product-vision-charter]]", "[[product-vision-directive]]", "[[product-vision-premortem]]", "[[product-vision-schedule]]", "[[surface-portfolio-loops]]", "[[inbound-understanding-loops]]", "[[ask-ai-loops]]", "[[service-floor-loops]]", "[[supply-discovery-loops]]", "[[decision-office-charter]]"]
loop_count: 7
loop_ids: ["route-portfolio-verdict", "inbound-proposal-quality", "ask-ai-refusal", "floor-input-availability", "supply-coverage-freshness", "product-vision-decision-closure", "provisional-agenda-decay"]
loop_close_times: ["monthly", "weekly", "weekly", "monthly", "monthly", "daily", "monthly"]
loop_statuses: ["proposed", "proposed", "blocked", "blocked", "blocked", "proposed", "proposed"]
---

# Product & Vision — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

Three of the five team loops below are **blocked on a named input**, and say so in
`status`. A blocked loop with a named unblocker is honest; a blocked loop reported as
`proposed` is how a department drifts.

---

## L1 — Route portfolio verdict loop

```yaml
type: loop
id: route-portfolio-verdict
owner: product-vision
team: surface-portfolio
measures: [surface.unowned_surface_count, surface.untraceable_route_components, surface.routes_without_owning_module]
changes: [routes.verdict_sheet, apps/web/src/App.tsx, PAGE_MAP.md]
inputs_from: [design, engineering]
outputs_to: [design, engineering, ux-path-burn-down]
close_time: monthly
status: proposed
baseline: "24 orphan routes + 13 untraceable components, of 51 routes"
```

Regenerating [[PAGE_MAP]] is the measurement, not the loop. The loop closes when a **verdict
per route** exists and the three live duplications are decided.

---

## L2 — Inbound proposal quality loop

```yaml
type: loop
id: inbound-proposal-quality
owner: product-vision
team: inbound-understanding
measures: [inbound.proposal_accept_without_edit_rate, inbound.false_accept_count]
changes: [guardrail.confidence_threshold, guardrail.gate_shape, approval.primitive]
inputs_from: [engineering, data, connector-platform-trust]
outputs_to: [engineering, ai-orchestration, research-math]
close_time: weekly
status: proposed
baseline: "unmeasured; no correction-tracking exists"
```

**The paired number is the loop.** Acceptance alone rises when a human rubber-stamps.
`inbound.false_accept_count` (accepted, later corrected) is what makes it real, and it can
only be read after a correction path exists — building that path is the loop's first turn.

---

## L3 — Ask AI refusal loop

```yaml
type: loop
id: ask-ai-refusal
owner: product-vision
team: ask-ai
measures: [askai.refusal_correctness, askai.confirm_without_edit_rate, askai.allowlist_family_count, askai.entry_point_count]
changes: [action.allowlist_file, action.schema, refusal.policy]
inputs_from: [ai-orchestration, engineering, security]
outputs_to: [engineering, ai-orchestration, design]
close_time: weekly
status: blocked
blocked_on: "no action composer and no server module; 0 of 44 api-gateway modules is an ask/action module"
unblocked_by: "the typed allowlist file + refusal test set, which are writable today against FUTURES §8 without the composer"
baseline: "4 divergent entry points; target 1. refusal set: none"
```

`askai.refusal_correctness` is a **gate, not an optimization target**. It is published next
to acceptance so a rising confirm rate cannot hide a shrinking refusal set.

---

## L4 — Floor Checker input-availability loop

```yaml
type: loop
id: floor-input-availability
owner: product-vision
team: service-floor
measures: [floor.providers_emitting_table_and_server, floor.providers_emitting_kitchen_ready, floor.kitchen_ready_to_waiter_p95_seconds, floor.misroute_rate]
changes: [floor.v0_scope, pos.capability_flags_requested]
inputs_from: [pos-bridge, engineering]
outputs_to: [pos-bridge, engineering, design]
close_time: monthly
status: blocked
blocked_on: "server_name, covers, table_id, total are 0 of 47 rows (20260819000000_guest_identity_minimal_slice.sql:11-14); no kitchen-ready concept in pos-types.ts"
unblocked_by: "one non-simulator POS provider emitting table_id + server_name; separately, a provider emitting a kitchen-ready event"
baseline: "0 providers verified for either signal"
```

The two provider counts are the loop until they are non-zero. Latency and mis-route cannot
be measured against a null input, and reporting them from `simpos` fixtures would be
[[product-vision-premortem]] M3 happening on schedule.

---

## L5 — Supply coverage & freshness loop

```yaml
type: loop
id: supply-coverage-freshness
owner: product-vision
team: supply-discovery
measures: [supply.sku_dual_price_coverage_pct, supply.price_freshness_p50_days, supply.needed_sku_denominator_size]
changes: [discovery.crawl_targets, discovery.extraction_rules, catalogue.match_rules]
inputs_from: [data, supplier-distributor-network, engineering]
outputs_to: [supplier-distributor-network, engineering, growth]
close_time: monthly
status: blocked
blocked_on: "no 'needed SKU' denominator defined for any restaurant; procurement_orders = 1"
unblocked_by: "one restaurant's needed-SKU list, from its own par levels or menu"
baseline: "denominator undefined; coverage therefore undefined, not zero"
```

Coverage with no denominator is a vanity number. Defining the denominator for **one**
restaurant is a smaller and more useful first turn than crawling another distributor.

---

## L6 — Department decision-closure loop

```yaml
type: loop
id: product-vision-decision-closure
owner: product-vision
measures: [decisions.open_count_owned_by_product_vision, decisions.days_open_p50, decisions.escalations_closed_within_one_close_time]
changes: [OPEN-DECISIONS.md, product-vision-directive]
inputs_from: [decision-office, red-team, architecture-review]
outputs_to: [decision-office, founder]
close_time: daily
status: proposed
baseline: "3 department forks pending, all first minted under ids the register already holds — OD-20 (OPEN-DECISIONS.md:116), OD-21 (OPEN-DECISIONS.md:143), OD-24 (OPEN-DECISIONS.md:137) — since renumbered PROD-F1/F2/F5 (teams/product.md §6)"
```

Foundation [[README]] §6 assigns the **daily open-decision digest** to this department. It
is a scheduled job ([[product-vision-schedule]]), not a team — a team here would duplicate
[[decision-office-charter]] (`teams/product.md:819`). Anti-sprawl: three consecutive runs
with no action downgrades or deletes the job.

---

## L7 — Provisional-agenda decay loop

```yaml
type: loop
id: provisional-agenda-decay
owner: product-vision
measures: [artifacts.provisional_count, artifacts.days_since_updated_max]
changes: [product-vision-agenda-full, product-vision-agenda-board, team agendas]
inputs_from: [decision-office]
outputs_to: [decision-office]
close_time: monthly
status: proposed
baseline: "42 artifacts written 2026-08-24; all agendas provisional"
```

Foundation §3.3: an agenda unchanged in 60 days is either finished or fiction. The board's
stale query is the instrument; this loop is who acts on it.
