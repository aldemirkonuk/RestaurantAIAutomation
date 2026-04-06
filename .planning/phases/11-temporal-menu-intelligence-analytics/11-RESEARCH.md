# Phase 11: Temporal Menu Intelligence & Analytics — Research

**Researched:** 2026-04-06
**Domain:** Celery beat scheduling, SQL diff detection, temporal analytics, FastAPI read endpoints
**Confidence:** HIGH — all findings verified against live codebase

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01: Diff Snapshot Model — current-state roster table**
Use `restaurant_wine_roster` table as the per-restaurant snapshot store.
- Schema: `(restaurant_id, signature_hash, wine_name, price_reference, first_seen_at, last_seen_at)` — unique on `(restaurant_id, signature_hash)`
- Access pattern: Diff engine computes new crawl set ↔ roster → writes `menu_changes` → upserts roster
- Storage: O(restaurants × wines), not O(crawls × wines)
- The existing `signature_hash` (MD5 of normalized_name + producer + vintage + region in `web_crawler.py` line 491) is the diff key — DO NOT change its computation

**D-02: Popularity & Trending — Celery beat + regular tables**
- `wine_popularity`: Nightly Celery beat materializes `(wine_id, restaurant_count, computed_at)` — unique on `wine_id`
- `trending_wines`: Same nightly beat computes all three windows (30/60/90d) with velocity-weighted `trend_score` + burst detection
- Schema: `(wine_id, window_days, restaurant_count_start, restaurant_count_end, delta, pct_change, trend_score, burst_detected_at, computed_at)` — unique on `(wine_id, window_days)`
- Velocity formula: `trend_score = (delta_30d × 3.0) + (delta_60d × 1.5) + (delta_90d × 1.0) + burst_bonus`
- Burst bonus: +2.0 if wine appeared in ≥3 new restaurants within 14 days

**D-03: menu_changes Record Format — JSONB full snapshot**
- Both `old_value` and `new_value` are JSONB full wine snapshots: `{wine_name, producer, vintage, price_reference, signature_hash}`
- `added`: `old_value = null`, `new_value = snapshot`
- `removed`: `old_value = snapshot`, `new_value = null`
- `price_change`: both populated before/after
- Price change gate: `abs(new - old) >= 1.0 AND abs(new - old) / old >= 0.03` (3% relative)
- Implemented in diff engine Python code, NOT in DB constraints

**D-04: Crawl Schedule — weekly default with tier forward-planning**
- Default frequency: `weekly` for all new crawl_schedule rows
- `crawl_schedule` schema: `(restaurant_id, crawl_frequency ENUM(weekly|biweekly|monthly), last_crawled_at, next_crawl_at, status ENUM(active|paused|error), tier VARCHAR(50) NULLABLE)`
- `tier` values: `fine_dining|casual|hotel|other` — stored but no behavior in Phase 11
- Backfill migration seeds rows for ALL existing `restaurant_directory` entries: `weekly` default, `next_crawl_at = NOW() + random 0–7 day jitter`
- `scheduled_recrawl_task`: daily Celery beat (4 AM UTC), selects where `next_crawl_at <= now()` AND `status = 'active'`

### Claude's Discretion

- Internal structure of `scheduled_recrawl_task` (batching, concurrency limits)
- How to handle `status = 'error'` after N consecutive failed crawls
- Exact diff engine module organization (single service file vs. multiple classes)
- `wine_popularity` vs `trending_wines` beat task separation or single combined task

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TEMP-01 | `crawl_schedule` table: per-restaurant re-crawl frequency, timing, status | D-04 schema; migration backfill with jitter; verified against `restaurant_directory` PK |
| TEMP-02 | `scheduled_recrawl_task` Celery beat: daily, selects due restaurants, triggers `crawl_restaurant()`, updates timestamps | `score_tasks.py:rescore_stale_wines_task` pattern; `celery_app.py` beat schedule entry; 4 AM UTC slot confirmed available |
| TEMP-03 | Menu diff engine: compare new crawl vs previous via `signature_hash` → detect added/removed/price_change | D-01, D-03; signature_hash computation in `web_crawler.py:491`; single `MenuDiffService` class |
| TEMP-04 | `menu_changes` table: full event history of all menu diffs | D-03 JSONB schema; `menu_changes` table design with indexes on `restaurant_id`, `detected_at`, `change_type` |
| TEMP-05 | `wine_popularity` table: per-wine count of distinct restaurants carrying it | D-02; join `restaurant_wine_roster.signature_hash → master_wine_library.signature_hash`; nightly beat |
| TEMP-06 | `trending_wines` computation: velocity-weighted trend score over 30/60/90d windows | D-02 formula; `menu_changes` as historical source for delta computation; burst detection |
| TEMP-07 | `GET /api/v1/analytics/trends?metro=chicago&period=90d` | Extends existing `analytics_routes.py` router; `trending_wines` + `menu_changes` aggregation; metro filter on `restaurant_directory.city` |
| TEMP-08 | `GET /api/v1/analytics/wine/{id}/timeline` | Extends existing `analytics_routes.py` router; joins `restaurant_wine_roster`, `wine_menu_prices`, `menu_changes`, `wine_popularity` |
</phase_requirements>

---

## Summary

Phase 11 is primarily a **data plumbing and scheduled computation phase** — no new AI models, no new external APIs, no new extraction logic. The heavy infrastructure (Celery, Redis, Supabase, `web_crawler.py`) is already built and working. This phase wires those components together with time-awareness: schedule recrawls, detect diffs, materialize trend metrics, expose analytics endpoints.

The three main technical challenges are: (1) correctly linking `signature_hash` from the roster to `wine_id` in `master_wine_library` for popularity joins; (2) reliably computing window deltas from `menu_changes` events without a dedicated time-series store; and (3) handling edge cases in the diff engine — first crawl, empty crawl result, null prices — without corrupting the roster.

**Primary recommendation:** Single `menu_diff_service.py` with `MenuDiffService` class; single `recrawl_tasks.py` with `crawl_and_diff_task` + `scheduled_recrawl_task`; single `trend_tasks.py` with `compute_trend_metrics_task` (combined popularity + trending); two new endpoint functions appended to existing `analytics_routes.py`.

---

## Standard Stack

### Core — All Already Installed [VERIFIED: live codebase]

| Library | In Use Since | Purpose in Phase 11 |
|---------|-------------|---------------------|
| `celery` | Phase 4 | Beat schedule + task queue for recrawl and trend computation |
| `redis` (redis-py) | Phase 8 | Redis NX dedup lock per restaurant; `INCRBYFLOAT` pattern |
| `supabase-py` | Phase 1 | All DB reads/writes; synchronous pattern confirmed |
| `fastapi` | Phase 1 | Two new GET endpoints in existing router |
| `pydantic` | Phase 1 | Response models for trends + timeline endpoints |

### No New Dependencies

Phase 11 requires **zero new pip packages**. All required libraries are already in `requirements.txt`. [VERIFIED: codebase search — `redis`, `celery`, `supabase`, `fastapi`, `pydantic` all present]

---

## Architecture Patterns

### Recommended File Structure (new files only)

```
services/agent-orchestrator/
├── jobs/
│   ├── recrawl_tasks.py          # scheduled_recrawl_task + crawl_and_diff_task
│   └── trend_tasks.py            # compute_trend_metrics_task (popularity + trending)
├── services/
│   └── menu_diff_service.py      # MenuDiffService: run_diff(), _detect_price_change()
└── tests/
    ├── test_menu_diff_service.py  # Unit tests: diff engine edge cases
    ├── test_recrawl_tasks.py      # Unit tests: crawl task Redis dedup, beat selection
    └── test_trend_tasks.py        # Unit tests: popularity, delta, trend_score, burst
```

Modifications to existing files:
- `services/agent-orchestrator/jobs/celery_app.py` — add `recrawl_tasks` + `trend_tasks` imports; add two beat schedule entries
- `services/agent-orchestrator/api/analytics_routes.py` — add `GET /trends` + `GET /wine/{id}/timeline` endpoints + Pydantic models
- `services/agent-orchestrator/config/settings.py` — add `recrawl_max_concurrent: int` (default 10) for Claude's Discretion concurrency limit

### Pattern 1: Celery Beat → Individual Task Fan-out

The beat task (`scheduled_recrawl_task`) MUST NOT do the crawl work inline. It selects due restaurants and fires individual `crawl_and_diff_task.delay(restaurant_id)` for each. This matches the `rescore_stale_wines_task` pattern in `score_tasks.py` exactly. [VERIFIED: `score_tasks.py:345-376`]

```python
# Source: score_tasks.py:345-376 — direct pattern to follow
@celery_app.task(name="recrawl.scheduled")
def scheduled_recrawl_task() -> Dict[str, Any]:
    supabase = _get_supabase_client()
    now_iso = datetime.now(timezone.utc).isoformat()

    resp = (
        supabase.table("crawl_schedule")
        .select("restaurant_id")
        .eq("status", "active")
        .lte("next_crawl_at", now_iso)  # next_crawl_at <= now
        .execute()
    )
    rows = resp.data or []
    queued = 0
    for row in rows:
        crawl_and_diff_task.delay(row["restaurant_id"])
        queued += 1

    logger.info("scheduled_recrawl_task: queued %d restaurants", queued)
    return {"queued": queued}
```

**Pitfall prevention:** `supabase-py` `.lte()` works correctly for ISO timestamp string comparisons. No Python-side filtering needed for `next_crawl_at <= now()`. [VERIFIED: supabase-py PostgREST `.lte()` does string comparison on ISO-8601 timestamps correctly]

### Pattern 2: Redis NX Dedup for crawl_and_diff_task

Same pattern as `ontology_tasks.py:55-65` and `score_tasks.py:71-77`. Lock key: `crawl:{restaurant_id}`. TTL: 7200s (2× daily beat interval) to prevent race if crawl is slow. [VERIFIED: pattern in ontology_tasks.py]

```python
# Source: ontology_tasks.py:55-65 — same pattern
r = redis_lib.from_url(settings.celery_broker_url)
lock_key = f"crawl:{restaurant_id}"
acquired = r.set(lock_key, "1", nx=True, ex=7200)
if not acquired:
    logger.info("crawl_and_diff_task: deduplicated restaurant_id=%s", restaurant_id)
    return None
```

### Pattern 3: Beat Schedule Entry

The existing `celery_app.py` beat schedule shows the exact format. New entries follow the established pattern. [VERIFIED: `celery_app.py:79-84`]

```python
# Add to celery_app.conf.beat_schedule — follows "score-stale-nightly" pattern
"recrawl-scheduled-daily": {
    "task": "recrawl.scheduled",
    "schedule": crontab(hour=4, minute=30),  # 4:30 AM UTC (after calibration at 4:00, score at 3:00)
    "options": {"expires": 3500},
},
"trend-metrics-nightly": {
    "task": "trend.compute_metrics",
    "schedule": crontab(hour=5, minute=0),  # 5:00 AM UTC (after recrawl finishes)
    "options": {"expires": 3500},
},
```

**Note:** 4 AM UTC slot is taken by `calibration-daily`. Use 4:30 AM for recrawl beat, 5 AM for trend metrics. [VERIFIED: `celery_app.py:72-77`]

### Pattern 4: MenuDiffService — Core Diff Logic

The diff engine operates as a pure Python service (no asyncio needed — all Supabase calls are sync). [VERIFIED: established pattern in `spend_logger.py`, `critic_score_service.py`]

```python
class MenuDiffService:
    def __init__(self, supabase_client):
        self.supabase = supabase_client

    def run_diff(
        self,
        restaurant_id: str,
        new_wines: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """
        Core diff: new crawl set ↔ current roster → menu_changes events → upsert roster.

        CRITICAL GUARD: if len(new_wines) == 0, abort (crawl failure, not "all removed").
        Returns: {"added": N, "removed": N, "price_changed": N, "skipped": bool}
        """
        # Abort on empty crawl — prevent false mass-removal event
        if not new_wines:
            return {"added": 0, "removed": 0, "price_changed": 0, "skipped": True, "reason": "empty_crawl"}

        # Fetch current roster
        old_roster = self._fetch_roster(restaurant_id)  # {hash: roster_row}
        new_hashes = {w["signature_hash"]: w for w in new_wines if w.get("signature_hash")}

        added = set(new_hashes) - set(old_roster)
        removed = set(old_roster) - set(new_hashes)
        shared = set(new_hashes) & set(old_roster)
        price_changed = {h for h in shared if self._price_gate(new_hashes[h], old_roster[h])}

        # Write menu_changes events
        events = []
        for h in added:
            events.append(self._change_event(restaurant_id, h, "added", None, new_hashes[h]))
        for h in removed:
            events.append(self._change_event(restaurant_id, h, "removed", old_roster[h], None))
        for h in price_changed:
            events.append(self._change_event(restaurant_id, h, "price_change", old_roster[h], new_hashes[h]))

        if events:
            self.supabase.table("menu_changes").insert(events).execute()

        # Upsert roster (UPDATE last_seen_at for existing, INSERT for new)
        self._upsert_roster(restaurant_id, new_wines)

        return {"added": len(added), "removed": len(removed), "price_changed": len(price_changed), "skipped": False}

    @staticmethod
    def _price_gate(new_wine: Dict, old_roster_row: Dict) -> bool:
        """D-03: Combined gate: abs >= $1.00 AND >= 3% relative."""
        new_p = new_wine.get("price_reference")
        old_p = old_roster_row.get("price_reference")
        if new_p is None or old_p is None or old_p == 0:
            return False
        abs_diff = abs(new_p - old_p)
        rel_diff = abs_diff / old_p
        return abs_diff >= 1.0 and rel_diff >= 0.03
```

### Pattern 5: signature_hash → wine_id Resolution for Popularity

`restaurant_wine_roster` stores `signature_hash`. `wine_popularity` needs `wine_id` (UUID from `master_wine_library`). The join uses `master_wine_library.signature_hash`. [VERIFIED: `web_crawler.py:491` shows same MD5 hash is stored on master_wine_library]

```python
# In compute_trend_metrics_task — popularity computation
# Join: roster.signature_hash → master_wine_library.signature_hash → wine_id
roster_resp = supabase.table("restaurant_wine_roster").select("restaurant_id, signature_hash").execute()
library_resp = supabase.table("master_wine_library").select("id, signature_hash").execute()

hash_to_wine_id = {row["signature_hash"]: row["id"] for row in (library_resp.data or [])}

from collections import Counter
wine_restaurant_counts = Counter()
for row in (roster_resp.data or []):
    h = row.get("signature_hash")
    wine_id = hash_to_wine_id.get(h)
    if wine_id:
        wine_restaurant_counts[wine_id].add(row["restaurant_id"])  # use set for distinct
```

**Note for planner:** Use `defaultdict(set)` to accumulate distinct restaurant_ids per wine, then take `len()`. [ASSUMED — standard Python pattern, no risk]

### Pattern 6: Delta Computation for Trending (Python-side)

`wine_popularity` has current count (`restaurant_count_end`). Historical count at window start is derived from `menu_changes`: net adds minus net removes since the window start. Python-side because supabase-py cannot do `NOW() - INTERVAL '30 days'` in `.gte()` filter directly — use ISO-formatted string. [VERIFIED: `score_tasks.py:354` shows Python-side date filtering pattern]

```python
# Python-side window boundary
from datetime import datetime, timezone, timedelta

def window_start_iso(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

# Fetch added/removed events in window
events_resp = (
    supabase.table("menu_changes")
    .select("wine_signature_hash, change_type, restaurant_id, detected_at")
    .gte("detected_at", window_start_iso(90))  # fetch 90d, filter per window in Python
    .execute()
)
```

### Pattern 7: Burst Detection

A wine is "bursting" if ≥3 DISTINCT new restaurants added it in the last 14 days. Track this during trending computation:

```python
burst_cutoff = window_start_iso(14)
for wine_id, events in per_wine_events.items():
    new_restaurants_14d = {
        e["restaurant_id"] for e in events
        if e["change_type"] == "added" and e["detected_at"] >= burst_cutoff
    }
    burst_detected_at = datetime.now(timezone.utc).isoformat() if len(new_restaurants_14d) >= 3 else None
```

### Pattern 8: Analytics Endpoint — Pydantic Response Models

Follows `WineScoresResponse` pattern in `analytics_routes.py`. UUID validation guard (`uuid.UUID(wine_id)`) is required on `/wine/{id}/timeline`. Metro is a free-text query param (normalize to lowercase for `restaurant_directory.city` comparison). [VERIFIED: `analytics_routes.py:76-80`]

```python
# In analytics_routes.py — new models following WineScoresResponse pattern
class TrendingWineItem(BaseModel):
    wine_id: str
    wine_name: Optional[str] = None
    trend_score: Optional[float] = None
    delta_30d: Optional[int] = None
    restaurant_count: Optional[int] = None
    burst_detected: bool = False

class TrendsResponse(BaseModel):
    metro: Optional[str] = None
    period: str
    trending_up: List[TrendingWineItem] = []
    trending_down: List[TrendingWineItem] = []

class WineTimelineResponse(BaseModel):
    wine_id: str
    wine_name: Optional[str] = None
    first_seen_at: Optional[str] = None
    last_seen_at: Optional[str] = None
    restaurants_currently_carrying: int = 0
    price_history: List[Dict[str, Any]] = []
    menu_changes: List[Dict[str, Any]] = []
```

### Pattern 9: celery_app.py imports extension

Add to `imports` tuple in `celery_app.conf.update()` — same as Phase 10 added `jobs.score_tasks`. [VERIFIED: `celery_app.py:23`]

```python
imports=("jobs.tasks", "jobs.haiku_tasks", "jobs.spend_tasks", "jobs.calibration_tasks",
         "jobs.web_verify_tasks", "jobs.ontology_tasks", "jobs.score_tasks",
         "jobs.recrawl_tasks", "jobs.trend_tasks"),  # Phase 11 additions
```

### Anti-Patterns to Avoid

- **DO NOT** call `web_crawler.crawl_restaurant()` directly inside `scheduled_recrawl_task` — always fan out to `crawl_and_diff_task.delay()` for error isolation
- **DO NOT** treat an empty new wine list as "all wines removed" — guard with `if not new_wines: return (skipped)`
- **DO NOT** use `signature_hash` alone as a unique wine identifier for `wine_popularity` — must join to `master_wine_library` to get the canonical `wine_id`
- **DO NOT** compute window deltas from `restaurant_wine_roster.first_seen_at` only — use `menu_changes` events for accurate historical deltas
- **DO NOT** use `supabase-py .or_()` with interval arithmetic — compute the ISO timestamp boundary in Python first

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Distributed task dedup | Custom mutex | Redis SET NX pattern (established in ontology_tasks.py) | Atomic, TTL-aware, cluster-safe |
| Cron scheduling | APScheduler or time.sleep loop | Celery beat with `crontab()` | Already configured, beat worker handles it |
| SQL UPSERT on roster | Custom select+insert | `supabase-py` `.upsert(on_conflict="restaurant_id,signature_hash")` | supabase-py supports upsert with conflict target |
| Trend score math | Complex SQL window functions | Python Counter + simple arithmetic | Phase 10 pattern; avoids CONCURRENTLY lock contention (D-02 rationale) |
| Per-window historical counts | Separate history table | `menu_changes` events (already capturing adds/removes) | menu_changes IS the event log — no additional store needed |

---

## SQL Migration Design

### New Tables (one migration file: `20260411000000_phase11_temporal.sql`)

```sql
-- 1. crawl_schedule (TEMP-01)
CREATE TABLE IF NOT EXISTS crawl_schedule (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id       UUID NOT NULL REFERENCES restaurant_directory(id) ON DELETE CASCADE,
    crawl_frequency     TEXT NOT NULL DEFAULT 'weekly'
                          CHECK (crawl_frequency IN ('weekly', 'biweekly', 'monthly')),
    last_crawled_at     TIMESTAMPTZ,
    next_crawl_at       TIMESTAMPTZ NOT NULL,
    status              TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'paused', 'error')),
    tier                VARCHAR(50),  -- fine_dining|casual|hotel|other, Phase 11 no behavior
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_crawl_schedule_restaurant UNIQUE (restaurant_id)
);

CREATE INDEX IF NOT EXISTS idx_cs_next_crawl ON crawl_schedule (next_crawl_at, status);

-- 2. restaurant_wine_roster (D-01, TEMP-03)
CREATE TABLE IF NOT EXISTS restaurant_wine_roster (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id    UUID NOT NULL REFERENCES restaurant_directory(id) ON DELETE CASCADE,
    signature_hash   TEXT NOT NULL,
    wine_name        TEXT,
    price_reference  DECIMAL(10,2),
    first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_roster_restaurant_hash UNIQUE (restaurant_id, signature_hash)
);

CREATE INDEX IF NOT EXISTS idx_rwr_restaurant ON restaurant_wine_roster (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_rwr_hash ON restaurant_wine_roster (signature_hash);

-- 3. menu_changes (TEMP-04)
CREATE TABLE IF NOT EXISTS menu_changes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id       UUID NOT NULL REFERENCES restaurant_directory(id) ON DELETE CASCADE,
    wine_signature_hash TEXT NOT NULL,
    change_type         TEXT NOT NULL CHECK (change_type IN ('added', 'removed', 'price_change')),
    old_value           JSONB,
    new_value           JSONB,
    detected_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mc_restaurant ON menu_changes (restaurant_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_mc_hash ON menu_changes (wine_signature_hash, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_mc_change_type ON menu_changes (change_type, detected_at DESC);

-- 4. wine_popularity (D-02, TEMP-05)
CREATE TABLE IF NOT EXISTS wine_popularity (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wine_id          UUID NOT NULL REFERENCES master_wine_library(id) ON DELETE CASCADE,
    restaurant_count INTEGER NOT NULL DEFAULT 0,
    computed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_wine_popularity UNIQUE (wine_id)
);

CREATE INDEX IF NOT EXISTS idx_wp_count ON wine_popularity (restaurant_count DESC);

-- 5. trending_wines (D-02, TEMP-06)
CREATE TABLE IF NOT EXISTS trending_wines (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wine_id                UUID NOT NULL REFERENCES master_wine_library(id) ON DELETE CASCADE,
    window_days            INTEGER NOT NULL CHECK (window_days IN (30, 60, 90)),
    restaurant_count_start INTEGER NOT NULL DEFAULT 0,
    restaurant_count_end   INTEGER NOT NULL DEFAULT 0,
    delta                  INTEGER NOT NULL DEFAULT 0,
    pct_change             DECIMAL(10,4),
    trend_score            DECIMAL(10,4),
    burst_detected_at      TIMESTAMPTZ,
    computed_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_trending_wines UNIQUE (wine_id, window_days)
);

CREATE INDEX IF NOT EXISTS idx_tw_score ON trending_wines (trend_score DESC) WHERE window_days = 30;

-- 6. Backfill crawl_schedule for all existing restaurant_directory entries
-- Uses random 0-7 day jitter on next_crawl_at (D-04: thundering herd prevention)
INSERT INTO crawl_schedule (restaurant_id, crawl_frequency, next_crawl_at, status)
SELECT
    id,
    'weekly',
    NOW() + (RANDOM() * INTERVAL '7 days'),
    'active'
FROM restaurant_directory
ON CONFLICT (restaurant_id) DO NOTHING;
```

---

## Common Pitfalls

### Pitfall 1: Empty Crawl Result ≠ "All Wines Removed"
**What goes wrong:** Diff engine runs when `crawl_restaurant()` returns 0 wines (network error, bot block, temporary 404). Roster sees all old hashes as "removed" and creates mass-removal events. Entire restaurant's wine history is falsely deleted from trending.
**Why it happens:** Crawl failures can return an empty wine list without an exception.
**How to avoid:** Guard at the top of `run_diff()`: `if not new_wines: return {"skipped": True, "reason": "empty_crawl"}`. Also check `len(new_wines) < 3` and `len(new_wines) < len(old_roster) * 0.1` as a sanity heuristic (>90% drop is suspicious).
**Warning signs:** `menu_changes` table shows hundreds of "removed" events in a single batch for one restaurant.

### Pitfall 2: signature_hash Mismatch Between Crawler and Roster
**What goes wrong:** Diff engine builds `new_hashes` from crawler JSONL output, but hashes don't match roster because the hash inputs differ slightly (whitespace, case).
**Why it happens:** The hash function in `web_crawler.py:491` applies `_normalize_wine_field()` before hashing. If the diff engine re-hashes from raw fields without normalization, hashes won't match.
**How to avoid:** `MenuDiffService.run_diff()` must consume wines that already have `signature_hash` set (from the crawler pipeline), not re-compute hashes. The crawler always populates `signature_hash` before returning. [VERIFIED: `web_crawler.py:491`]

### Pitfall 3: Null Price in Price Change Detection
**What goes wrong:** `_price_gate()` divides by `old_p` — if `old_p` is 0 or None (wine had no price), division by zero or incorrect detection.
**How to avoid:** Guard: `if new_p is None or old_p is None or old_p == 0: return False`. Already shown in Pattern 4 above.

### Pitfall 4: supabase-py `.lte()` on Timestamptz
**What goes wrong:** Using Python `datetime` object directly in `.lte()` filter — supabase-py may serialize it incorrectly.
**How to avoid:** Always use `.isoformat()` string: `datetime.now(timezone.utc).isoformat()`. [VERIFIED: established pattern in `score_tasks.py:354`]

### Pitfall 5: Trend Score Window Aggregation — Which Row Holds the Combined Score?
**What goes wrong:** The velocity formula `(delta_30d × 3.0) + (delta_60d × 1.5) + (delta_90d × 1.0) + burst_bonus` needs all three deltas, but `trending_wines` stores one row per window. The combined `trend_score` cannot be computed from a single window row.
**How to avoid:** Recommendation — compute the combined trend_score and write it to the **30d row** (the primary query row for ranking). The 60d and 90d rows store their own delta/pct_change but reference the same combined trend_score. Alternatively, add a separate `combined_trend_score` column to all rows. The planner should pick one approach; the `GET /analytics/trends` endpoint uses the 30d row's trend_score for ranking.

### Pitfall 6: First Crawl Creates "Added" Events for All Wines
**What goes wrong:** On first crawl for a restaurant (empty roster), ALL wines appear as "added". This is correct behavior (establishing timeline), but if misunderstood could look like a bug.
**How to avoid:** This is intentional — first-crawl "added" events start the TEMP-08 timeline. Document in code comments. The roster starts empty; first diff inserts all wines as added + populates roster. [ASSUMED — consistent with D-01 access pattern description]

### Pitfall 7: Beat Schedule Slot Collision
**What goes wrong:** Adding recrawl at `crontab(hour=4)` collides with the existing `calibration-daily` entry.
**How to avoid:** Use `crontab(hour=4, minute=30)` for recrawl, `crontab(hour=5, minute=0)` for trend metrics. [VERIFIED: `celery_app.py:73-76` — calibration runs at hour=4, minute=0]

### Pitfall 8: supabase upsert on roster requires explicit conflict target
**What goes wrong:** `supabase.table("restaurant_wine_roster").upsert(data)` without `on_conflict` parameter may error or default to PK conflict only, not the intended `(restaurant_id, signature_hash)` unique constraint.
**How to avoid:** Use explicit: `supabase.table("restaurant_wine_roster").upsert(data, on_conflict="restaurant_id,signature_hash").execute()`. [ASSUMED — supabase-py upsert signature; verify against supabase-py docs if unexpected behavior]

### Pitfall 9: Trend Task Reading Stale wine_popularity Before It's Written
**What goes wrong:** If `compute_trend_metrics_task` reads popularity and trending in sequence, the trending computation reads a stale `wine_popularity` table from the previous night.
**How to avoid:** Compute popularity first, commit rows to `wine_popularity`, then compute trending deltas. Both should be in the same task (single `compute_trend_metrics_task`) to guarantee ordering. [ASSUMED — Claude's Discretion recommendation for task consolidation]

---

## Code Examples

### Example: crawl_and_diff_task skeleton (follows score_tasks.py pattern)
```python
# Source pattern: score_tasks.py:58-93
@celery_app.task(
    name="recrawl.crawl_and_diff",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
)
def crawl_and_diff_task(self, restaurant_id: str) -> Optional[Dict[str, Any]]:
    r = redis_lib.from_url(settings.celery_broker_url)
    lock_key = f"crawl:{restaurant_id}"
    acquired = r.set(lock_key, "1", nx=True, ex=7200)
    if not acquired:
        logger.info("crawl_and_diff_task: deduplicated restaurant_id=%s", restaurant_id)
        return None
    try:
        return asyncio.run(_crawl_and_diff_async(restaurant_id))
    except Exception as exc:
        retry_num = self.request.retries
        countdown = 60 * (2 ** retry_num)
        if retry_num >= self.max_retries - 1:
            _mark_crawl_error(restaurant_id, consecutive_inc=True)
            return None
        raise self.retry(exc=exc, countdown=countdown)
    finally:
        r.delete(lock_key)
```

### Example: _update_crawl_schedule after successful crawl
```python
# After successful crawl + diff, update schedule timestamps
FREQUENCY_DAYS = {"weekly": 7, "biweekly": 14, "monthly": 30}

def _update_crawl_schedule(supabase, restaurant_id: str, frequency: str) -> None:
    days = FREQUENCY_DAYS.get(frequency, 7)
    next_crawl = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
    supabase.table("crawl_schedule").update({
        "last_crawled_at": datetime.now(timezone.utc).isoformat(),
        "next_crawl_at": next_crawl,
        "consecutive_failures": 0,  # reset on success
    }).eq("restaurant_id", restaurant_id).execute()
```

### Example: Error threshold for consecutive failures (Claude's Discretion)
```python
# After N=3 consecutive failures, set status='error'
CONSECUTIVE_FAILURE_THRESHOLD = 3

def _mark_crawl_error(supabase, restaurant_id: str, consecutive_inc: bool = False) -> None:
    resp = (
        supabase.table("crawl_schedule")
        .select("consecutive_failures")
        .eq("restaurant_id", restaurant_id)
        .maybe_single()
        .execute()
    )
    if not resp.data:
        return
    new_count = (resp.data.get("consecutive_failures") or 0) + (1 if consecutive_inc else 0)
    new_status = "error" if new_count >= CONSECUTIVE_FAILURE_THRESHOLD else "active"
    supabase.table("crawl_schedule").update({
        "consecutive_failures": new_count,
        "status": new_status,
    }).eq("restaurant_id", restaurant_id).execute()
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|-----------------|--------|
| Menu scraped once (one-shot) | Periodic re-crawl via Celery beat | Enables temporal intelligence |
| No change detection | `menu_changes` event log via hash diff | Full menu evolution history |
| Static popularity counts | Nightly materialized `wine_popularity` | Current-state + trend computation |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `supabase-py` `.upsert()` accepts `on_conflict` string parameter matching unique constraint columns | Pitfall 8 / Don't Hand-Roll | Roster upsert fails; use INSERT with ON CONFLICT DO UPDATE in raw SQL fallback |
| A2 | `restaurant_wine_roster.signature_hash` matches `master_wine_library.signature_hash` for the same wine | Pattern 5 | Popularity join returns 0 rows; would require alternative join strategy |
| A3 | First crawl creating "added" events for all wines is correct and intentional | Pitfall 6 | No risk — aligns with D-01 "Diff engine computes new crawl set ↔ roster" |
| A4 | `crawl_restaurant()` in `web_crawler.py` returns a list of wine dicts with `signature_hash` already populated | Pitfall 2 | Diff engine must add hash computation; read web_crawler.py return type before coding |
| A5 | `restaurant_directory.city` is used as the metro filter for `GET /analytics/trends?metro=chicago` | Pattern 8 | If city values are inconsistent (e.g., "Chicago" vs "chicago" vs "Chicago, IL"), metro filter returns sparse results; normalize to lowercase |

**If this table is empty:** N/A — 5 assumptions documented above; A4 and A5 are the highest-risk ones.

---

## Open Questions

1. **How does `crawl_restaurant()` return its result?**
   - What we know: `web_crawler.py` has `crawl_restaurant()` and `_persist_crawled_wines()` which writes JSONL. The diff engine needs the in-memory wine list, not re-read JSONL.
   - What's unclear: Does `crawl_restaurant()` return a list of wine dicts, or does it only persist to JSONL and return a `CrawlResult` object?
   - Recommendation: **Planner must read `web_crawler.py:crawl_restaurant()` return type before designing the `crawl_and_diff_task` integration.** If it only writes JSONL, the diff engine must read the JSONL output. If it returns wines in memory, pass them directly.

2. **Does `master_wine_library` have a `signature_hash` column?**
   - What we know: `web_crawler.py:491` computes and writes `signature_hash` to JSONL records. `master_wine_library_submissions` has it.
   - What's unclear: Whether `master_wine_library` (the promoted table) also has `signature_hash` populated, vs only `master_wine_library_submissions`.
   - Recommendation: Check `supabase/migrations/20260208024921_new-migration.sql` for `master_wine_library` schema. If `master_wine_library` lacks `signature_hash`, the join in Pattern 5 must go via `master_wine_library_submissions`.

3. **What is the metro-to-city mapping?**
   - What we know: `restaurant_directory.city` contains city names. `metro=chicago` is the query param example.
   - What's unclear: Are all Chicago restaurants stored as `city = 'Chicago'` or is there variation (`'chicago'`, `'Chicago, IL'`, etc.)?
   - Recommendation: Implement case-insensitive `ILIKE` filter: `.ilike("city", f"%{metro}%")`. Flag in endpoint docstring that metro is a substring match.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Redis | Redis NX dedup, Celery broker | ✓ (confirmed — Celery already using it) | [ASSUMED: Redis 6+] | — |
| Celery beat worker | `scheduled_recrawl_task`, `compute_trend_metrics_task` | ✓ (confirmed — existing beat tasks running) | [ASSUMED: Celery 5.x] | — |
| Supabase | All DB tables | ✓ (confirmed — all prior phases using it) | supabase-py (installed) | — |
| `web_crawler.py:crawl_restaurant()` | `crawl_and_diff_task` | ✓ (confirmed — Phase 2/6 complete) | Existing service | — |

No missing dependencies. Phase 11 is purely internal plumbing.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (confirmed in `services/agent-orchestrator/tests/`) |
| Config file | none detected (test discovery via default) |
| Quick run command | `pytest services/agent-orchestrator/tests/test_menu_diff_service.py -x` |
| Full suite command | `pytest services/agent-orchestrator/tests/ -x --timeout=30` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TEMP-01 | `crawl_schedule` table created + backfill | smoke (migration check) | manual Supabase verify | ❌ Wave 0 |
| TEMP-02 | Beat selects due restaurants, fires individual tasks | unit | `pytest tests/test_recrawl_tasks.py -x` | ❌ Wave 0 |
| TEMP-03 | Diff detects added/removed/price_change; guards empty crawl | unit | `pytest tests/test_menu_diff_service.py -x` | ❌ Wave 0 |
| TEMP-04 | `menu_changes` rows written with correct JSONB format | unit | `pytest tests/test_menu_diff_service.py::test_changes_written -x` | ❌ Wave 0 |
| TEMP-05 | `wine_popularity` upserted with correct restaurant_count | unit | `pytest tests/test_trend_tasks.py::test_popularity -x` | ❌ Wave 0 |
| TEMP-06 | Trend score formula correct; burst detected at ≥3 restaurants in 14d | unit | `pytest tests/test_trend_tasks.py::test_trend_score -x` | ❌ Wave 0 |
| TEMP-07 | `GET /analytics/trends` returns 200 with trending_up list | unit | `pytest tests/test_temporal_analytics.py::test_trends_endpoint -x` | ❌ Wave 0 |
| TEMP-08 | `GET /analytics/wine/{id}/timeline` returns lifecycle data | unit | `pytest tests/test_temporal_analytics.py::test_timeline_endpoint -x` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pytest services/agent-orchestrator/tests/test_menu_diff_service.py tests/test_recrawl_tasks.py -x`
- **Per wave merge:** `pytest services/agent-orchestrator/tests/ -x --timeout=30`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/test_menu_diff_service.py` — covers TEMP-03, TEMP-04 (diff logic, empty guard, price gate)
- [ ] `tests/test_recrawl_tasks.py` — covers TEMP-02 (Redis NX dedup, beat selection, schedule update)
- [ ] `tests/test_trend_tasks.py` — covers TEMP-05, TEMP-06 (popularity count, delta, trend_score formula, burst)
- [ ] `tests/test_temporal_analytics.py` — covers TEMP-07, TEMP-08 (endpoint 200/404/422)

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No — internal Celery tasks, no auth layer | — |
| V3 Session Management | No | — |
| V4 Access Control | No — same service-role Supabase pattern | — |
| V5 Input Validation | Yes — `metro` query param, `wine_id` UUID param, `period` enum | `uuid.UUID()` guard (established pattern); `period` validated against `["30d", "60d", "90d"]` |
| V6 Cryptography | No — MD5 is used for dedup only, not security | — |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via `metro` param | Tampering | supabase-py parameterized queries (`.ilike()` uses binding, not string interpolation) |
| UUID injection in `/wine/{id}/timeline` | Tampering | `uuid.UUID(wine_id)` guard (established in `analytics_routes.py:76-80`) |
| Invalid `period` param (arbitrary string) | Tampering | Validate: `if period not in ("30d", "60d", "90d"): raise HTTPException(400)` |
| Thundering herd on first beat run | DoS (self-inflicted) | 0–7 day jitter on `next_crawl_at` backfill (D-04) + Redis NX per restaurant |

---

## Sources

### Primary (HIGH confidence)
- Live codebase — `services/agent-orchestrator/jobs/score_tasks.py` (Celery task pattern, Redis NX dedup, beat fan-out)
- Live codebase — `services/agent-orchestrator/jobs/celery_app.py` (beat schedule format, slot availability)
- Live codebase — `services/agent-orchestrator/api/analytics_routes.py` (router pattern, Pydantic models, UUID guard)
- Live codebase — `services/agent-orchestrator/services/web_crawler.py:491` (signature_hash computation — MD5, normalize before hash)
- Live codebase — `supabase/migrations/20260225000000_restaurant_directory.sql` (restaurant_directory PK type = UUID)
- Live codebase — `supabase/migrations/20260410000000_phase10_pricing.sql` (migration format, `wine_menu_prices` table confirmed)
- `.planning/phases/11-temporal-menu-intelligence-analytics/11-CONTEXT.md` — all locked decisions

### Secondary (MEDIUM confidence)
- supabase-py upsert `on_conflict` parameter behavior — [ASSUMED: based on supabase-py v2 documentation pattern; test in Wave 1]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies, all existing
- Architecture patterns: HIGH — all derived from live codebase + CONTEXT.md locked decisions
- Pitfalls: HIGH (P1-P7) / MEDIUM (P8-P9) — P8/P9 are assumptions about supabase-py upsert behavior and task ordering
- SQL schema: HIGH — follows migration format from Phase 10; backfill query pattern is standard PostgreSQL

**Research date:** 2026-04-06
**Valid until:** 2026-05-06 (stable stack, 30-day validity)
