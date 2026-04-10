# Phase 10: Critic Scores & Pricing Intelligence - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-06
**Phase:** 10-critic-scores-pricing-intelligence
**Areas discussed:** Score Data Acquisition, Pipeline Trigger, menu_price Schema Gap

---

## Score Data Acquisition

| Option | Description | Selected |
|--------|-------------|----------|
| Option A: Serper search-and-parse for all sources | No new keys, same Phase 8 pattern, ~60-70% hit rate | |
| Option B: Vivino direct API + Serper for WA/WS/Decanter/JR | Best coverage, lowest per-query cost, mixed sources | |
| Option C: External_Wine_Datasets lookup first, then Serper for misses | Fastest/cheapest, dataset freshness varies | ✓ (refined) |

**User's choice (refined after dataset inspection):** External dataset (`WineDataset.csv` + `library/*.jsonl`) for **wine metadata enrichment** (NOT prices — prices vary per restaurant/provider). Use Serper for all critic scores AND retail pricing. Build a pipeline to use from existing datasets, books, archives, critic notes for wine-specific details (wine_structure, sensory_profile, quality_signals).

**Notes:** WineDataset.csv (1,526 wines) has retail prices in GBP but no critic scores — prices are not authoritative for restaurant context. `library/wineops_basic_v1.jsonl` (200 wines) has rich wine metadata matching `master_wine_library` JSONB columns.

---

## Pipeline Trigger

| Option | Description | Selected |
|--------|-------------|----------|
| Chain from Phase 9 (ontology → score_lookup_task) | Automatic for every new wine | |
| Nightly Celery beat schedule | Re-scores stale wines (> 30 days old) | |
| Both: chain trigger + nightly beat | Covers new wines and existing/stale records | ✓ |

**User's choice:** Both — chain trigger for new wines + nightly beat for stale scores.

---

## menu_price Schema Gap

| Option | Description | Selected |
|--------|-------------|----------|
| Add menu_price column to restaurant_inventory | Simple, but loses history | |
| Create wine_menu_prices table (price history) | Better for future analytics, time-series | ✓ |
| Pull from TOAST API via toast_item_guid | Uses existing integration, but TOAST-only | |

**User's choice:** `wine_menu_prices` table for full price history + cached `menu_price_current` on `restaurant_inventory`.

**Notes:** User confirmed they want individual restaurant menu price comparisons for future analytics — the history table approach enables this natively.

---

## Claude's Discretion

- Exact Serper query templates per rating source
- Score extraction regex from result snippets
- Nightly beat schedule time
- Migration file naming

## Deferred Ideas

- Vivino direct API integration
- Front-end analytics dashboards
- Wine-Searcher official API access
- Critic score subscription management
