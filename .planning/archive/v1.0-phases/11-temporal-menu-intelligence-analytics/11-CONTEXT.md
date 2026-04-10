# Phase 11: Temporal Menu Intelligence & Analytics - Context

**Gathered:** 2026-04-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Transform the restaurant crawling system into a living temporal intelligence platform. This phase delivers:
1. **Scheduled re-crawls** — configurable per-restaurant crawl frequency (weekly/biweekly/monthly)
2. **Diff engine** — detects added/removed/price_change events between crawls
3. **menu_changes audit trail** — full history of every menu event per restaurant
4. **wine_popularity** — count of distinct restaurants currently carrying each wine
5. **trending_wines** — velocity-scored trend computation across 30/60/90-day windows
6. **Two new API endpoints** — `/api/v1/analytics/trends` and `/api/v1/analytics/wine/{id}/timeline`

This phase does NOT include new crawl infrastructure (web_crawler.py is complete), new wine enrichment, or pricing changes.

</domain>

<decisions>
## Implementation Decisions

### D-01: Diff Snapshot Model — current-state roster table

Use a `restaurant_wine_roster` table as the per-restaurant snapshot store for diff detection.

- **Schema:** `(restaurant_id, signature_hash, wine_name, price_reference, first_seen_at, last_seen_at)` — unique on `(restaurant_id, signature_hash)`
- **Access pattern:** Diff engine computes new crawl set ↔ roster, writes `menu_changes` events, then upserts roster
- **Storage:** O(restaurants × wines) — bounded, not O(crawls × wines)
- **Rationale:** `menu_changes` already provides full event history (TEMP-04). The roster only answers "what was there last crawl?" — it does not need to be a per-crawl audit log. Matches production menu-sync patterns (Doordash, Shopify catalog sync).

The existing `signature_hash` in `web_crawler.py` (MD5 of normalized_name + producer + vintage + region) is the diff key — no change to its computation.

### D-02: Popularity & Trending — Celery beat + regular tables

- **wine_popularity**: Nightly Celery beat task materializes wine popularity into a `wine_popularity` table. Schema: `(wine_id, restaurant_count, computed_at)`.
- **trending_wines**: Same nightly beat pre-computes all three windows (30/60/90d) with velocity-weighted `trend_score` + burst detection.

**Trending_wines table schema:** `(wine_id, window_days, restaurant_count_start, restaurant_count_end, delta, pct_change, trend_score, burst_detected_at, computed_at)` — unique on `(wine_id, window_days)`.

**Velocity score formula:**
```
trend_score = (delta_30d × 3.0) + (delta_60d × 1.5) + (delta_90d × 1.0) + burst_bonus
burst_bonus = +2.0 if wine appeared in ≥3 new restaurants within 14 days
```

- **Rationale:** Consistent with Phase 10 `rescore_stale_wines_task` pattern. Avoids PostgreSQL materialized view CONCURRENTLY lock contention. Velocity score differentiates from raw count deltas — "wine that exploded onto 8 menus in 2 weeks" scores higher than "wine that drifted onto 15 menus over 90 days," which is the signal restaurant buyers actually care about.

### D-03: menu_changes Record Format — JSONB full snapshot

Both `old_value` and `new_value` columns store JSONB full wine snapshot for all change types:
```json
{"wine_name": "...", "producer": "...", "vintage": 2019, "price_reference": 45.00, "signature_hash": "abc123"}
```

For `added` events: `old_value = null`, `new_value = snapshot`.
For `removed` events: `old_value = snapshot`, `new_value = null`.
For `price_change` events: both populated with before/after snapshots.

**Price change detection threshold (diff engine):** Combined gate:
- `abs(new_price - old_price) >= 1.0` AND
- `abs(new_price - old_price) / old_price >= 0.03` (3% relative)

This is per-restaurant by nature (restaurant_id scoped) and filters minor rounding noise. The `wine_menu_prices` table (Phase 10) retains full price history for deeper analysis.

### D-04: Crawl Schedule — weekly default with tier forward-planning

- **Default frequency:** `weekly` for all new restaurants added to `crawl_schedule`
- **`crawl_schedule` schema:** `(restaurant_id, crawl_frequency ENUM(weekly|biweekly|monthly), last_crawled_at, next_crawl_at, status ENUM(active|paused|error), tier VARCHAR(50) NULLABLE)` — `tier` column (values: `fine_dining|casual|hotel|other`) is added for future tiered scheduling logic but has no behavioral effect in Phase 11.
- **Backfill:** DB migration seeds `crawl_schedule` rows for all existing `restaurant_directory` entries using `weekly` default and `next_crawl_at = NOW() + random 0–7 day jitter` to avoid thundering herd on first beat run.
- **`scheduled_recrawl_task`:** Daily Celery beat (e.g., 4 AM UTC). Selects all `crawl_schedule` rows where `next_crawl_at <= now()` and `status = 'active'`. Triggers `web_crawler.crawl_restaurant()` for each, updates `last_crawled_at` and `next_crawl_at`.

### Claude's Discretion

- Internal structure of `scheduled_recrawl_task` (batching, concurrency limits)
- How to handle `status = 'error'` after N consecutive failed crawls
- Exact diff engine module organization (single service file vs. multiple classes)
- `wine_popularity` vs `trending_wines` beat task separation or single combined task

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Infrastructure
- `services/agent-orchestrator/services/web_crawler.py` — Has `crawl_restaurant()`, `crawl_batch()`, and `signature_hash` computation (MD5 of normalized_name + producer + vintage + region). Lines 480–535 show hash computation. Do NOT change the hash function.
- `services/agent-orchestrator/jobs/celery_app.py` — Existing beat schedule and task imports. New tasks and beat entries must be added here.
- `services/agent-orchestrator/jobs/score_tasks.py` — Phase 10 Celery task pattern to follow (Redis NX dedup, beat schedule entry).
- `services/agent-orchestrator/api/analytics_routes.py` — Existing analytics router. Phase 11 endpoints extend this router.

### Phase Context
- `.planning/REQUIREMENTS.md` §TEMP-01 through TEMP-08 — Full acceptance criteria for Phase 11
- `.planning/phases/10-critic-scores-pricing-intelligence/10-CONTEXT.md` — Phase 10 decisions (wine_menu_prices schema, markup_ratio pattern)
- `supabase/migrations/20260225000000_restaurant_directory.sql` — `restaurant_directory` table schema (has `last_crawled_at`, no `crawl_schedule` yet)

### No external specs — requirements fully captured in decisions above

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `web_crawler.py:crawl_restaurant()` — Entry point for Phase 11's re-crawl trigger. Already handles robots.txt, Playwright, PDF/image detection.
- `signature_hash` computation (line 491) — Already generates the diff key per wine. Reuse without modification.
- `jobs/score_tasks.py:rescore_stale_wines_task` — Template for the nightly `scheduled_recrawl_task` beat pattern.
- `api/analytics_routes.py` — Router already registered in `main.py`. TEMP-07 and TEMP-08 endpoints extend it directly.
- `jobs/celery_app.py:beat_schedule` — Add `"recrawl-nightly"` entry following the `"score-stale-nightly"` pattern.

### Established Patterns
- Redis NX deduplication (`wine:scores:{id}` pattern from Phase 10) — apply same pattern to `crawl:{restaurant_id}` to prevent concurrent crawl tasks for same restaurant.
- Non-fatal try/except chain trigger (ontology_tasks.py) — same pattern for chaining diff engine from `crawl_restaurant()` completion.
- JSONB writes (dataset_ingestion_service.py) — same non-destructive JSONB merge pattern for `menu_changes.old_value/new_value`.

### Integration Points
- `scheduled_recrawl_task` → calls `web_crawler.crawl_restaurant()` → triggers diff engine
- Diff engine reads `restaurant_wine_roster`, writes `menu_changes`, upserts roster
- Nightly popularity/trending beat → reads `restaurant_wine_roster` + `menu_changes` → writes `wine_popularity` + `trending_wines`
- `GET /analytics/trends` and `GET /analytics/wine/{id}/timeline` read from pre-computed tables

</code_context>

<specifics>
## Specific Ideas

- velocity score formula is product-differentiating: `(delta_30d × 3.0) + (delta_60d × 1.5) + (delta_90d × 1.0) + burst_bonus(+2.0)`
- `tier` column on `crawl_schedule` is forward infrastructure only — no tiered logic in Phase 11
- Price change combined gate (`≥$1 AND ≥3%`) to be implemented in diff engine service, not in DB constraints
- Migration backfill uses random 0–7 day jitter on `next_crawl_at` to spread initial load

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 11-temporal-menu-intelligence-analytics*
*Context gathered: 2026-04-06*
