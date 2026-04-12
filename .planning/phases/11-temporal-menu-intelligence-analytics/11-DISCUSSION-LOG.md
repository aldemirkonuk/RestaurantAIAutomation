# Phase 11: Temporal Menu Intelligence & Analytics - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-06
**Phase:** 11-temporal-menu-intelligence-analytics
**Areas discussed:** Diff Snapshot Model, Popularity & Trending Computation, menu_changes Record Format, Crawl Schedule Defaults

---

## Diff Snapshot Model

| Option | Description | Selected |
|--------|-------------|----------|
| New crawl_snapshots table | Lightweight per-crawl ledger; separate from inventory | |
| Extend restaurant_inventory | Add signature_hash + last_seen_at + is_active flag | |
| **Current-state roster table** | restaurant_wine_roster unique on (restaurant_id, signature_hash); O(restaurants × wines) storage | ✓ |
| Keep JSONL files | Diff by re-parsing saved JSONL per restaurant | |

**User's choice:** Current-state roster table
**Notes:** User asked for "state of the art approach" — deep analysis presented showing production menu-sync systems (Doordash, Shopify) use current-state over per-crawl snapshots because `menu_changes` already provides the event history. User confirmed after analysis.

---

## Popularity & Trending Computation

| Option | Description | Selected |
|--------|-------------|----------|
| **Celery beat + regular tables** | Nightly task materializes wine_popularity and trending_wines rows | ✓ |
| PostgreSQL materialized views | REFRESH MATERIALIZED VIEW CONCURRENTLY nightly | |
| On-demand computation | COUNT query live from roster + menu_changes per API request | |

**Trending windows sub-question:**

| Option | Description | Selected |
|--------|-------------|----------|
| **Velocity-weighted trend_score** | Pre-compute 30/60/90d + trend_score + burst_detected_at | ✓ |
| Raw delta pre-computed | Pre-compute all 3 windows with plain count delta + pct_change | |

**User's choice:** Celery beat + regular tables with velocity-weighted trend_score
**Notes:** User asked for "state of the art approach and market edge" — deep analysis presented showing velocity scoring (Spotify/LinkedIn pattern) differentiates from raw deltas. Formula: (delta_30d × 3.0) + (delta_60d × 1.5) + (delta_90d × 1.0) + burst_bonus. User confirmed.

---

## menu_changes Record Format

| Option | Description | Selected |
|--------|-------------|----------|
| **JSONB full wine snapshot** | {wine_name, producer, vintage, price_reference, signature_hash} for all change types | ✓ |
| String scalar | price as string, wine_name only for added/removed | |
| Type-specific fields | Split schema with separate columns per change type | |

**Price threshold sub-question:**

| Option | Description | Selected |
|--------|-------------|----------|
| **Combined gate ≥$1 AND ≥3%** | Handles cheap and expensive wines; per-restaurant by nature | ✓ |
| 5% relative only | Simpler, single parameter | |
| No threshold | Record every price difference | |

**User's choice:** JSONB full snapshot + combined ≥$1 AND ≥3% gate
**Notes:** User asked architectural question about whether price changes are per-restaurant or global. Clarified that `menu_changes` is inherently per-restaurant (has restaurant_id). Combined threshold handles both cheap wines (where $1 = 10%) and expensive wines (where 3% = meaningful). User confirmed.

---

## Crawl Schedule Defaults

| Option | Description | Selected |
|--------|-------------|----------|
| **Weekly default + tier column** | Weekly for all new restaurants; tier column (fine_dining/casual/hotel/other) for future tiered logic | ✓ |
| Biweekly default | Conservative, lower load | |
| Tiered by restaurant type | Requires tier classification (not yet in schema) | |

**Backfill sub-question:**

| Option | Description | Selected |
|--------|-------------|----------|
| **DB migration seed** | Seeds crawl_schedule for all existing restaurant_directory entries with weekly default + 0–7d jitter | ✓ |
| Lazy on first crawl | Created when beat task first encounters a restaurant | |
| Manual admin action | Operators add each restaurant explicitly | |

**User's choice:** Weekly default + tier column (forward planning) + migration seed with jitter
**Notes:** User said "do option A, add the tier per restaurant for future planning." Tier column is added to schema but has no behavioral effect in Phase 11.

---

## Claude's Discretion

- Internal structure of scheduled_recrawl_task (batching, concurrency limits)
- Error state handling after N consecutive failed crawls
- Exact diff engine module organization
- wine_popularity vs trending_wines beat task separation or combined

## Deferred Ideas

None — discussion stayed within phase scope.
