---
type: loops
division: product
department: product-vision
team: supply-discovery
status: provisional
metrics: [supply.sku_dual_price_coverage_pct, supply.price_freshness_p50_days, supply.needed_sku_denominator_size]
updated: 2026-08-24
links: ["[[supply-discovery-charter]]", "[[supply-discovery-directive]]", "[[supply-discovery-premortem]]", "[[supply-discovery-schedule]]", "[[product-vision-loops]]", "[[supplier-distributor-network-charter]]", "[[legal-charter]]", "[[surface-portfolio-charter]]"]
---

# Supply Discovery (Vendor Finder) — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

---

## L1 — Coverage loop (blocked on its own denominator)

```yaml
type: loop
id: supply-coverage
owner: product-vision
team: supply-discovery
measures: [supply.sku_dual_price_coverage_pct, supply.needed_sku_denominator_size, supply.skus_with_zero_prices]
changes: [discovery.crawl_targets, catalogue.match_threshold]
inputs_from: [data, supplier-distributor-network, engineering]
outputs_to: [supplier-distributor-network, engineering, growth]
close_time: monthly
status: blocked
blocked_on: "no restaurant has a needed-SKU list; the coverage fraction has no denominator"
unblocked_by: "one restaurant's needed-SKU list, derived from its par levels or menu"
baseline: "denominator 0; coverage undefined, not zero"
```

`supply.skus_with_zero_prices` is the loop's action output: it is the **only** list that
justifies crawl expansion, because every entry on it names a real restaurant's real need.

---

## L2 — Freshness loop

```yaml
type: loop
id: supply-price-freshness
owner: product-vision
team: supply-discovery
measures: [supply.price_freshness_p50_days, supply.prices_beyond_stale_threshold, supply.prices_displayed_without_age]
changes: [freshness.stale_threshold, freshness.hide_threshold, refetch.priority_order]
inputs_from: [engineering, data]
outputs_to: [engineering, design]
close_time: weekly
status: blocked
blocked_on: "no freshness policy exists and no price carries a displayed age"
unblocked_by: "the freshness policy artifact (stale / hide / refetch thresholds)"
baseline: "unmeasured"
```

`supply.prices_displayed_without_age` should reach **0 and stay there**; it is the direct
instrument for [[supply-discovery-premortem]] M3. The joint tell to watch on
[[supply-discovery-agenda-board]] is freshness p50 **and** coverage both rising — coverage
being propped up by old rows.

---

## L3 — Match-confidence loop

```yaml
type: loop
id: supply-match-confidence
owner: product-vision
team: supply-discovery
measures: [supply.match_precision_on_labelled_set, supply.unmatched_vendor_lines, supply.mismatched_price_corrections]
changes: [catalogue.match_threshold, extraction.rules]
inputs_from: [catalogue-identity, data]
outputs_to: [catalogue-identity, engineering]
close_time: monthly
status: proposed
baseline: "no labelled set; wine-identity.ts + spec exist but precision is unpublished"
```

A wrong match is worse than an unmatched line: an unmatched line is visibly missing, a
wrong match is a confident price on the wrong bottle. The two errors are not summed. Wine
enrichment (144 of 1,448, commits `f7e0ea1`, `ef19b81`) is the input that makes this
tractable first for wine.

---

## L4 — Permission loop

```yaml
type: loop
id: supply-crawl-permission
owner: product-vision
team: supply-discovery
measures: [supply.targets_with_recorded_permission, supply.targets_ambiguous_open, supply.blocks_received]
changes: [discovery.crawl_targets, legal.escalation_queue]
inputs_from: [legal, compliance-privacy, supplier-distributor-network]
outputs_to: [legal, supplier-distributor-network]
close_time: monthly
status: proposed
baseline: "0 targets carry a recorded permission status"
```

`supply.blocks_received` is a **signal, not a bug count**. A block routed around rather than
escalated is the failure this loop exists to catch.

---

## L5 — Duplication-seam loop

```yaml
type: loop
id: supply-distributor-stage-ownership
owner: product-vision
team: supply-discovery
measures: [supply.distributors_with_two_owners_at_one_stage, supply.distributors_by_stage]
changes: [distributor.state_list, team.boundary]
inputs_from: [supplier-distributor-network]
outputs_to: [supplier-distributor-network, decision-office, product-vision]
close_time: monthly
status: proposed
baseline: "state list does not exist; boundary fork open with a colliding OD id"
```

Named the division's **highest duplication risk** (`teams/product.md:828`). The first
measure should be **0** permanently; any non-zero reading is the finding, and it is cheaper
to catch here than to resolve after two teams have each half-built the same distributor
relationship.

---

## L6 — Comparison-reachability loop

```yaml
type: loop
id: supply-surface-reachability
owner: product-vision
team: supply-discovery
measures: [supply.comparison_surfaces_reachable_in_app]
changes: [routes.verdict_sheet]
inputs_from: [surface-portfolio, design]
outputs_to: [surface-portfolio, design]
close_time: monthly
status: proposed
baseline: "0 of 2 — /distributors (PAGE_MAP:116) and /vendor-prices (:130) are both cold-entry"
```

A perfect supply graph behind a page nobody can click to is [[supply-discovery-premortem]]
M1 with extra steps. This loop is small, cheap, and jointly owned with
[[surface-portfolio-charter]].
