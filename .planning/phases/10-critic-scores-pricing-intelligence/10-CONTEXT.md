# Phase 10: Critic Scores & Pricing Intelligence - Context

**Gathered:** 2026-04-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Enrich each wine in `master_wine_library` with professional critic scores from ≥3 sources (via Serper search), benchmark menu prices against Wine-Searcher retail averages (via Serper), compute per-restaurant markup ratios, create a `wine_menu_prices` price-history table, build a dataset ingestion pipeline from existing library/archive files for wine metadata enrichment, and expose a scores + pricing API endpoint at `GET /api/v1/analytics/wine/{id}/scores`.

New capabilities NOT in scope: live Vivino API integration, critic score subscription management, front-end dashboards.

</domain>

<decisions>
## Implementation Decisions

### Score Data Acquisition (D-01)
- **D-01a:** Use **Serper search** for all critic scores — Wine Advocate, Wine Spectator, Decanter, JancisRobinson via targeted search queries (e.g., `"wine_name vintage site:wineadvocate.com"`). Same client and pattern as Phase 8 (`serper_client.py`).
- **D-01b:** Use **Serper search** for Wine-Searcher retail pricing (query `"wine_name vintage wine-searcher average price"`). No separate Wine-Searcher API key required.
- **D-01c:** Scores not found via Serper are marked `not_found` — graceful null, no blocking. Wine keeps processing.

### Dataset Enrichment Pipeline (D-02)
- **D-02a:** Build a **dataset ingestion pipeline** that reads `library/wineops_basic_v1.jsonl`, `library/restaurant_wine_dataset.jsonl`, and `External_Wine_Datasets/WineDataset.csv` to enrich wine metadata — specifically `wine_structure`, `sensory_profile`, and `quality_signals` JSONB columns on `master_wine_library`.
- **D-02b:** Dataset pipeline enriches **wine characteristics** (body, acidity, aromas, flavor profile, producer tier) — NOT pricing. External prices vary per restaurant/provider and are not authoritative.
- **D-02c:** Dataset match key: fuzzy match on `(name, producer, vintage, appellation)`. Confidence threshold for write: must match ≥ 2 of 4 fields.
- **D-02d:** Dataset pipeline runs as a separate Celery task (`dataset_enrich_task`) triggered alongside `score_lookup_task`.

### Pipeline Trigger (D-03)
- **D-03a:** **Chain trigger**: ontology validation completion → `score_lookup_task.delay(wine_id)` (extending the existing Phase 9 chain). Every new wine auto-receives scoring.
- **D-03b:** **Nightly Celery beat**: re-scores all wines where `critic_scores` is empty `{}` OR `scores_last_updated_at < NOW() - INTERVAL '30 days'`. Covers existing wines and stale records.
- **D-03c:** Redis NX dedup (`wine:scores:{wine_id}`, TTL=3600) — same pattern as Phase 9 `ontology_tasks.py`.

### menu_price Schema (D-04)
- **D-04a:** Create a new `wine_menu_prices` table: `(id UUID PK, restaurant_id UUID FK, wine_id UUID FK, menu_price DECIMAL(10,2), currency VARCHAR(3) DEFAULT 'USD', source VARCHAR(50), scanned_at TIMESTAMPTZ, created_at TIMESTAMPTZ)`. Each menu scan writes a new row — full price history preserved.
- **D-04b:** Add `menu_price_current DECIMAL(10,2)` column to `restaurant_inventory` as a cached denormalized latest price — refreshed when a new `wine_menu_prices` row is inserted via trigger or task.
- **D-04c:** `markup_ratio` computed on-read from `(menu_price_current / retail_price_avg)` OR stored as `markup_ratio DECIMAL(10,4)` on `restaurant_inventory` (updated when either price changes). Store for query performance.

### Composite Score Weights (D-05)
- **D-05:** Weights are **locked from ROADMAP**: WA 30%, WS 25%, Vivino 20%, Decanter 15%, JR 10%. Computed only when ≥ 2 sources return valid scores. Not user-configurable in Phase 10.

### Claude's Discretion
- Exact Serper query templates for each rating source (WA, WS, Decanter, JR) — planner decides best search string patterns.
- Score extraction regex/parsing from Serper result snippets.
- Nightly beat schedule time (e.g., 3 AM UTC).
- Migration file naming convention.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Goal and Requirements
- `.planning/ROADMAP.md` §Phase 10 — full goal, rationale, scoring weights, markup classification tiers, anomaly detection thresholds
- `.planning/REQUIREMENTS.md` CRIT-01 through CRIT-07 — all 7 success criteria

### Existing Schema (must not duplicate or conflict)
- `supabase/migrations/20260405000003_master_wine_library_jsonb.sql` — `critic_scores JSONB DEFAULT '{}'` stub already exists; also `wine_structure`, `sensory_profile`, `quality_signals` JSONB columns
- `supabase/migrations/20260208024921_new-migration.sql` — `restaurant_inventory` table schema (no `menu_price` yet, `toast_item_guid` present)

### Phase 9 Chain Pattern (reuse directly)
- `services/agent-orchestrator/jobs/ontology_tasks.py` — Redis NX dedup + Celery chain trigger pattern
- `services/agent-orchestrator/jobs/web_verify_tasks.py` — chain trigger insertion pattern (where to add `score_lookup_task.delay()`)

### Phase 8 Serper Integration (reuse directly)
- `services/agent-orchestrator/services/serper_client.py` — existing Serper API client

### Dataset Sources for Ingestion Pipeline
- `library/wineops_basic_v1.jsonl` — 200 wines, schema: `wine_structure`, `sensory_profile`, `quality_signals`, `classification`
- `library/restaurant_wine_dataset.jsonl` — 200 wines, same schema
- `External_Wine_Datasets/WineDataset.csv` — 1,526 wines, columns: Title, Grape, Country, Region, Appellation, Vintage, ABV, Characteristics, Style

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `serper_client.py`: Existing async Serper client — use directly for all score and price queries
- `ontology_tasks.py`: Redis NX dedup + Celery retry pattern — copy exactly for `score_lookup_task`
- `web_verify_tasks.py`: Chain trigger insertion point — add `score_lookup_task.delay(wine_id)` after ontology chain call
- `field_confidence.py`: Confidence tracking — use for dataset enrichment writes (D-02c confidence guard)
- `spend_logger.py`: Cost tracking — wrap Serper calls with spend logging
- `jobs/celery_app.py`: Add `"jobs.score_tasks"` to imports tuple

### Established Patterns
- Celery task dedup: Redis `SET NX` with TTL=3600, `finally` block to release lock
- Chain triggers: non-fatal `try/except` block at end of upstream task
- Budget cap: check daily Serper call budget before each search (Phase 5/8 governance)

### Integration Points
- `master_wine_library.critic_scores` JSONB — target for score writes (stub already exists)
- `master_wine_library.retail_price_avg` — new column needed (add in migration)
- `restaurant_inventory` — add `menu_price_current` + `markup_ratio` columns
- New `wine_menu_prices` table — price history storage
- `field_review_queue` — for anomaly flagging (markup_ratio > 5x or < 0.8x)

</code_context>

<specifics>
## Specific Ideas

- Dataset ingestion pipeline should extend to future archives/books/critic notes as new files are added to `library/` or `External_Wine_Datasets/` — design with a file-discovery pattern rather than hardcoded paths.
- Wine matching in dataset pipeline should use the same normalization logic from Phase 9 `ontology_normalization.py` (canonical name lookup, alias resolution).
- The `wine_menu_prices` table enables future analytics: price trend charts, cross-restaurant price comparisons, price change detection on re-scans.

</specifics>

<deferred>
## Deferred Ideas

- Vivino direct API integration (public endpoint) — deferred to Phase 12 or a quick task if needed
- Front-end analytics dashboard for markup ratios and critic scores — post-Phase 10
- Wine-Searcher official API key setup — current Serper-based approach sufficient for Phase 10
- Critic score subscription management (paying for WA/WS API access) — business decision, not Phase 10

</deferred>

---

*Phase: 10-critic-scores-pricing-intelligence*
*Context gathered: 2026-04-06*
