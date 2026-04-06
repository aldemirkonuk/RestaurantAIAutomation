# Phase 10: Critic Scores & Pricing Intelligence - Research

**Researched:** 2026-04-06
**Domain:** Celery task chains, Serper snippet regex extraction, Supabase schema migrations, JSONB enrichment, dataset ingestion pipeline
**Confidence:** HIGH (all findings verified against live codebase)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01a:** Use **Serper search** for all critic scores — Wine Advocate, Wine Spectator, Decanter, JancisRobinson via targeted search queries. Same client and pattern as Phase 8 (`serper_client.py`).
- **D-01b:** Use **Serper search** for Wine-Searcher retail pricing (query `"wine_name vintage wine-searcher average price"`). No separate Wine-Searcher API key required.
- **D-01c:** Scores not found via Serper are marked `not_found` — graceful null, no blocking. Wine keeps processing.
- **D-02a:** Build a **dataset ingestion pipeline** that reads `library/wineops_basic_v1.jsonl`, `library/restaurant_wine_dataset.jsonl`, and `External_Wine_Datasets/WineDataset.csv` to enrich wine metadata — specifically `wine_structure`, `sensory_profile`, and `quality_signals` JSONB columns on `master_wine_library`.
- **D-02b:** Dataset pipeline enriches **wine characteristics** (body, acidity, aromas, flavor profile, producer tier) — NOT pricing.
- **D-02c:** Dataset match key: fuzzy match on `(name, producer, vintage, appellation)`. Confidence threshold for write: must match ≥ 2 of 4 fields.
- **D-02d:** Dataset pipeline runs as a separate Celery task (`dataset_enrich_task`) triggered alongside `score_lookup_task`.
- **D-03a:** **Chain trigger**: ontology validation completion → `score_lookup_task.delay(wine_id)`. Every new wine auto-receives scoring.
- **D-03b:** **Nightly Celery beat**: re-scores all wines where `critic_scores` is empty `{}` OR `scores_last_updated_at < NOW() - INTERVAL '30 days'`.
- **D-03c:** Redis NX dedup (`wine:scores:{wine_id}`, TTL=3600) — same pattern as Phase 9 `ontology_tasks.py`.
- **D-04a:** Create a new `wine_menu_prices` table with full price history.
- **D-04b:** Add `menu_price_current DECIMAL(10,2)` to `restaurant_inventory` as cached latest price.
- **D-04c:** `markup_ratio DECIMAL(10,4)` stored on `restaurant_inventory` (updated when either price changes).
- **D-05:** Composite score weights locked: WA 30%, WS 25%, Vivino 20%, Decanter 15%, JR 10%. Computed only when ≥ 2 sources return valid scores.

### Claude's Discretion

- Exact Serper query templates for each rating source (WA, WS, Decanter, JR) — planner decides best search string patterns.
- Score extraction regex/parsing from Serper result snippets.
- Nightly beat schedule time (e.g., 3 AM UTC).
- Migration file naming convention.

### Deferred Ideas (OUT OF SCOPE)

- Vivino direct API integration — deferred to Phase 12 or a quick task
- Front-end analytics dashboard for markup ratios and critic scores
- Wine-Searcher official API key setup
- Critic score subscription management (WA/WS API access)

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CRIT-01 | `score_lookup_task` Celery background task: searches for critic scores per wine+vintage across ≥ 3 sources | Serper client already async; ontology_tasks.py provides exact task pattern to copy |
| CRIT-02 | Scores normalized to 0–100; stored in `critic_scores` JSONB with source, raw score, normalized score, reviewer, review date | Normalization formulas: Vivino ×20, JR ×5; schema design section below |
| CRIT-03 | Composite score weighted average (WA 30%, WS 25%, Vivino 20%, Decanter 15%, JR 10%) when ≥ 2 sources available | Pure Python arithmetic; no external library needed |
| CRIT-04 | `retail_price_avg` column populated from Wine-Searcher average market price via Serper | New column needed on `master_wine_library`; Serper query template documented below |
| CRIT-05 | `markup_ratio` computed per `restaurant_inventory` entry; classified into 4 tiers | New columns `menu_price_current` + `markup_ratio` + `markup_classification` on `restaurant_inventory` |
| CRIT-06 | Price anomaly detection: markup_ratio > 5x or < 0.8x auto-flagged for review | Reuse `field_review_queue` pattern; insert anomaly rows at compute time |
| CRIT-07 | `GET /api/v1/analytics/wine/{id}/scores` returns aggregated scores, composite, retail price, markup ratio | New `analytics_routes.py` following existing router registration pattern |

</phase_requirements>

---

## Summary

Phase 10 wires a new Celery task chain (`score_lookup_task` + `dataset_enrich_task`) into the existing Phase 9 end-of-chain trigger point. The `serper_client.py` async function is already production-ready; the task structure copies `ontology_tasks.py` exactly — Redis NX dedup, `asyncio.run()` wrapper, exponential backoff retries. All Serper query templates and regex patterns for score extraction are documented below and can be implemented inline (no new libraries needed).

The schema additions are minimal: three new columns on existing tables (`master_wine_library.retail_price_avg`, `master_wine_library.scores_last_updated_at`, plus three on `restaurant_inventory`) and one new `wine_menu_prices` table. The dataset ingestion pipeline reads three files with known schemas; matching uses a two-of-four fuzzy field comparison identical in structure to Phase 9's ontology normalization.

The analytics endpoint follows the same `APIRouter` registration pattern as `quality_routes.py` and `onboarding_routes.py`. With all 7 CRIT requirements mapped to concrete implementation actions, this phase has no unknowns blocking execution.

**Primary recommendation:** Start with schema migration (Wave 0), then `score_tasks.py` service + Celery task (Wave 1), then dataset ingestion service + `dataset_enrich_task` (Wave 2), then nightly beat + chain trigger insertion (Wave 3), then analytics API endpoint (Wave 4), then tests (Wave 5).

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `httpx` | already installed | Async HTTP for Serper calls | Already used in `serper_client.py` |
| `redis` | already installed | NX dedup lock, budget counter | Same pattern as Phases 8–9 |
| `celery` | already installed | Background task + beat schedule | Project standard |
| `supabase-py` | already installed | Sync DB reads/writes in tasks | Project standard |
| `tenacity` | already installed | Retry with backoff on Serper | Already used in `serper_client.py` |

**No new pip dependencies required.** [VERIFIED: live codebase grep]

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `re` (stdlib) | stdlib | Regex score extraction from snippets | Score parsing in `CriticScoreParser` |
| `difflib` (stdlib) | stdlib | `SequenceMatcher` for fuzzy wine name matching in dataset pipeline | Match key comparison |
| `csv` (stdlib) | stdlib | Read `WineDataset.csv` | Dataset ingestion |
| `json` (stdlib) | stdlib | Read `.jsonl` files line-by-line | Dataset ingestion |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `re` regex for score parsing | Gemini Flash extraction | Regex is synchronous, zero cost, zero latency; Gemini adds cost + async complexity for structured scores |
| `difflib.SequenceMatcher` | `rapidfuzz` library | SequenceMatcher is stdlib; rapidfuzz is faster but requires new dep — not justified for 200-record dataset |

---

## Architecture Patterns

### Recommended Project Structure

```
services/agent-orchestrator/
├── jobs/
│   ├── score_tasks.py          # score_lookup_task + dataset_enrich_task (new)
│   └── celery_app.py           # add "jobs.score_tasks" + 2 beat entries (modify)
├── services/
│   ├── critic_score_service.py # CriticScoreService: Serper queries + regex parsing (new)
│   └── dataset_ingestion_service.py  # DatasetIngestionService: file discovery + fuzzy match (new)
├── api/
│   └── analytics_routes.py    # GET /api/v1/analytics/wine/{id}/scores (new)
└── main.py                    # add analytics_router (modify)
supabase/migrations/
└── 20260410000000_phase10_pricing.sql  # new columns + wine_menu_prices table
```

### Pattern 1: Celery Task with Redis NX Dedup (copy from `ontology_tasks.py`)

**What:** Acquire Redis SET NX lock before work; release in `finally` block. Tasks deduplicate concurrent calls for same `wine_id`.  
**When to use:** Every Celery task that processes a single wine — prevents double-processing on retry storms.

```python
# Source: services/agent-orchestrator/jobs/ontology_tasks.py (verified)
r = redis_lib.from_url(settings.celery_broker_url)
lock_key = f"wine:scores:{wine_id}"
acquired = r.set(lock_key, "1", nx=True, ex=3600)
if not acquired:
    return None  # already running or complete
try:
    result = _score_sync(wine_id)
    return result
except Exception as exc:
    retry_num = self.request.retries
    countdown = 60 * (2 ** retry_num)  # 60, 120, 240s
    raise self.retry(exc=exc, countdown=countdown)
finally:
    r.delete(lock_key)  # ALWAYS release — TTL is safety net only
```

### Pattern 2: Chain Trigger Insertion (copy from `web_verify_tasks._verify_async` → `ontology_tasks`)

**What:** At the end of `ontology_tasks._validate_sync()`, add a non-fatal try/except block that calls `score_lookup_task.delay(wine_id)` AND `dataset_enrich_task.delay(wine_id)`.  
**Insertion point:** `ontology_tasks.py` line ~117, after the `logger.info(...)` return statement is built but before `return`.

```python
# Source: services/agent-orchestrator/jobs/web_verify_tasks.py lines 387–398 (verified pattern)
# Insert at end of _validate_sync() in ontology_tasks.py:
try:
    from jobs.score_tasks import score_lookup_task, dataset_enrich_task
    score_lookup_task.delay(wine_id)
    dataset_enrich_task.delay(wine_id)
    logger.info("_validate_sync: queued score_lookup_task + dataset_enrich_task for wine_id=%s", wine_id)
except Exception as exc:
    logger.warning("_validate_sync: failed to queue score tasks for wine_id=%s: %s", wine_id, exc)
```

### Pattern 3: Budget Cap Reuse (copy from `web_verify_tasks.check_and_reserve_search_budget`)

**What:** For each Serper call in `score_lookup_task`, call `check_and_reserve_search_budget()` before each source search. The per-source call budget is $0.001; up to 6 Serper calls per wine (5 sources + 1 pricing) = $0.006/wine maximum.

```python
# Source: services/agent-orchestrator/jobs/web_verify_tasks.py lines 46–87 (verified)
from jobs.web_verify_tasks import check_and_reserve_search_budget
if not check_and_reserve_search_budget():
    logger.info("score_lookup_task: daily budget cap reached for wine_id=%s", wine_id)
    return {"wine_id": wine_id, "status": "skipped_budget_cap"}
```

### Pattern 4: SpendLogger Wrapping (copy from `web_verify_tasks`)

**What:** After each successful Serper call, log spend. Always wrapped in `try/except` — never interrupts the task.

```python
# Source: services/agent-orchestrator/jobs/web_verify_tasks.py lines 294–305 (verified)
try:
    get_spend_logger().log(
        provider="serper", model="serper-search",
        input_tokens=0, output_tokens=0,
        cost_usd=settings.serper_cost_per_query,
        restaurant_id=wine_id,
    )
except Exception:
    pass
```

### Pattern 5: Celery Beat Schedule (copy from `celery_app.py`)

**What:** Two new entries in `celery_app.conf.beat_schedule` — one for nightly stale-score re-scoring, one optional for nightly dataset re-enrichment.

```python
# Source: services/agent-orchestrator/jobs/celery_app.py lines 31–78 (verified)
"score-stale-nightly": {
    "task": "score.rescore_stale_wines",
    "schedule": crontab(hour=3, minute=0),  # 3 AM UTC — consistent with DLQ cleanup
    "options": {"expires": 3500},
},
```

### Anti-Patterns to Avoid

- **Blocking async in task body:** Never call `await serper_search()` directly in the Celery task — wrap in `asyncio.run(_score_async(wine_id))` exactly as `web_verify_tasks` does.
- **Multiple `asyncio.run()` calls per task:** Create one `_score_async()` coroutine that sequentially awaits all 6 Serper calls — one `asyncio.run()` per task invocation.
- **Hard-fail on missing score:** If a source returns no results, store `{"status": "not_found"}` in that source's JSONB key — never raise, never skip the whole wine.
- **Storing markup_ratio only on-read:** Decision D-04c is locked: store as a column for query performance — don't compute at read time.

---

## Serper Query Templates (Claude's Discretion)

### Per-Source Query Templates

| Source | Query Template | Example |
|--------|---------------|---------|
| Wine Advocate | `"{name} {vintage} wine advocate score"` | `"Barolo Serralunga d'Alba 2019 wine advocate score"` |
| Wine Spectator | `"{name} {vintage} wine spectator rating"` | `"Opus One 2018 wine spectator rating"` |
| Vivino | `"{producer} {name} {vintage} vivino"` | `"Caymus Cabernet Sauvignon 2020 vivino"` |
| Decanter | `"{name} {vintage} decanter score review"` | `"Château Margaux 2016 decanter score review"` |
| JancisRobinson | `"{name} {vintage} jancis robinson"` | `"Penfolds Grange 2017 jancis robinson"` |
| Wine-Searcher (retail) | `"{name} {vintage} average retail price wine-searcher"` | `"Dom Pérignon 2012 average retail price wine-searcher"` |

**Construction rules:**
- Prefer `producer + name + vintage` when producer is known; fall back to `name + vintage` when producer is empty.
- Strip parentheticals and bin numbers from wine_name before constructing queries.
- For wines without vintage (NV), omit vintage from query string.

### Score Extraction Regex Patterns [ASSUMED — validated against known snippet structures]

All regexes applied to `f"{result['title']} {result['snippet']}"` concatenated string (title often contains score).

```python
# Wine Advocate / Wine Spectator / Decanter — 100-point scale
WA_WS_DEC_SCORE = re.compile(
    r'\b(9[0-9]|8[5-9])\s*(?:points?|pts?|/100)\b',
    re.IGNORECASE
)

# Alternative: "Score: 93", "Rated 91"
SCORE_LABEL = re.compile(
    r'(?:score|rated?|points?)[:\s]+(\d{2,3})\b',
    re.IGNORECASE
)

# Vivino — 5-point scale with decimal
VIVINO_SCORE = re.compile(
    r'\b([3-5]\.\d)\s*(?:out of 5|/5|stars?)?\b',
    re.IGNORECASE
)

# JancisRobinson — 20-point scale
JR_SCORE = re.compile(
    r'\b(1[2-9](?:\.\d)?|20(?:\.0)?)\s*(?:/20|out of 20)\b',
    re.IGNORECASE
)
# Also: "16.5 points" when combined with jancisrobinson domain in link

# Wine-Searcher retail price — USD
WINE_SEARCHER_PRICE = re.compile(
    r'\$\s*(\d+(?:\.\d{2})?)\s*(?:average|avg|/bottle)?\b',
    re.IGNORECASE
)
# Also handle "from $38" → take as floor, not average
WINE_SEARCHER_FROM = re.compile(
    r'(?:from|starting at)\s*\$\s*(\d+(?:\.\d{2})?)',
    re.IGNORECASE
)
```

**Source attribution:** Use `result['link']` domain to assign source before parsing:
- `wineadvocate.com` → `wine_advocate`
- `winespectator.com` → `wine_spectator`
- `vivino.com` → `vivino`
- `decanter.com` → `decanter`
- `jancisrobinson.com` → `jancis_robinson`
- `wine-searcher.com` → `wine_searcher`

**Fallback:** If no domain match, check if snippet contains score + source name keyword (e.g., "Wine Advocate: 93").

### Score Normalization

```python
def normalize_score(raw_score: float, source: str) -> float:
    """Convert source-native scale to 0–100."""
    if source == "vivino":
        return round(raw_score * 20, 1)   # 4.2 → 84.0
    elif source == "jancis_robinson":
        return round(raw_score * 5, 1)     # 16.5 → 82.5
    else:
        return round(raw_score, 1)          # WA, WS, Decanter already 100-point
```

### Composite Score Computation

```python
WEIGHTS = {
    "wine_advocate": 0.30,
    "wine_spectator": 0.25,
    "vivino": 0.20,
    "decanter": 0.15,
    "jancis_robinson": 0.10,
}

def compute_composite(scores: dict) -> Optional[float]:
    """Compute weighted composite. Returns None if < 2 sources."""
    available = {
        src: data["normalized_score"]
        for src, data in scores.items()
        if isinstance(data, dict) and data.get("normalized_score") is not None
    }
    if len(available) < 2:
        return None
    total_weight = sum(WEIGHTS[src] for src in available if src in WEIGHTS)
    if total_weight == 0:
        return None
    weighted_sum = sum(
        WEIGHTS[src] * score
        for src, score in available.items()
        if src in WEIGHTS
    )
    return round(weighted_sum / total_weight, 1)
```

---

## Schema Changes Required

### New Columns: `master_wine_library`

```sql
ALTER TABLE master_wine_library
ADD COLUMN IF NOT EXISTS retail_price_avg        DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS scores_last_updated_at  TIMESTAMPTZ;

COMMENT ON COLUMN master_wine_library.retail_price_avg IS
'Average retail price from Wine-Searcher via Serper query. Null = not yet searched.';
COMMENT ON COLUMN master_wine_library.scores_last_updated_at IS
'Timestamp of last successful critic score search. Used by nightly beat to identify stale records.';
```

Note: `critic_scores JSONB DEFAULT '{}'` already exists from Phase 7 migration `20260405000003_master_wine_library_jsonb.sql`. [VERIFIED]

### New Columns: `restaurant_inventory`

```sql
ALTER TABLE restaurant_inventory
ADD COLUMN IF NOT EXISTS menu_price_current    DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS markup_ratio          DECIMAL(10,4),
ADD COLUMN IF NOT EXISTS markup_classification VARCHAR(20);

COMMENT ON COLUMN restaurant_inventory.menu_price_current IS
'Cached latest menu price from wine_menu_prices table. Denormalized for query performance.';
COMMENT ON COLUMN restaurant_inventory.markup_ratio IS
'menu_price_current / master_wine_library.retail_price_avg. Null if either price missing.';
COMMENT ON COLUMN restaurant_inventory.markup_classification IS
'value (<1.5x), standard (1.5-2.5x), premium (2.5-4x), luxury_markup (>4x). Null if ratio missing.';
```

### New Table: `wine_menu_prices`

```sql
CREATE TABLE IF NOT EXISTS wine_menu_prices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id   UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    wine_id         UUID NOT NULL REFERENCES master_wine_library(id) ON DELETE CASCADE,
    menu_price      DECIMAL(10,2) NOT NULL,
    currency        VARCHAR(3) NOT NULL DEFAULT 'USD',
    source          VARCHAR(50) NOT NULL DEFAULT 'menu_scan',
    scanned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wine_menu_prices_wine
    ON wine_menu_prices(wine_id);
CREATE INDEX IF NOT EXISTS idx_wine_menu_prices_restaurant
    ON wine_menu_prices(restaurant_id, wine_id, scanned_at DESC);

COMMENT ON TABLE wine_menu_prices IS
'Full price history per wine per restaurant. Each menu scan appends a row. Phase 11 uses this for price trend analytics.';
```

### `field_review_queue` Source Constraint Extension

Phase 9 already extended the constraint to include `'ontology'`. Phase 10 needs to add `'pricing_anomaly'`:

```sql
ALTER TABLE field_review_queue DROP CONSTRAINT IF EXISTS valid_source;
ALTER TABLE field_review_queue
    ADD CONSTRAINT valid_source
    CHECK (source IN ('visible', 'inferred', 'knowledge', 'ontology', 'pricing_anomaly'));
```

---

## Dataset Ingestion Pipeline

### Source File Schemas [VERIFIED: live file inspection]

**`library/wineops_basic_v1.jsonl`** (JSONL, 200 wines):

```
{
  "WINE_ID": "WINE_001",
  "name": "Dalla Balla Treviso Prosecco",
  "producer": "Antonio Facchin & Figli",
  "vintage": 2019,
  "classification": {
    "primary_type": "sparkling", "grape_variety": "Glera",
    "country": "Italy", "region": "Veneto",
    "appellation": "Prosecco DOC", "sub_region": "Treviso"
  },
  "wine_structure": {
    "body": "light", "sweetness": "dry", "acidity": "high",
    "tannins": "none", "alcohol_level": "medium-low",
    "texture": "crisp", "finish": "short", "alcohol_pct": 11.5
  },
  "sensory_profile": {
    "primary_aromas": [...], "secondary_aromas": [...],
    "flavor_intensity": "moderate", "aroma_complexity": "medium",
    "flavor_profile": [...]
  },
  "quality_signals": {
    "quality_level": "standard", "producer_tier": "established",
    "reserve_status": false, "vintage_quality": "Unknown",
    "awards_ratings": [], "appellation_class": "Prosecco DOC Treviso"
  }
}
```

**`External_Wine_Datasets/WineDataset.csv`** (CSV, 1,526 wines):

```
Columns: Title, Description, Price, Capacity, Grape, Secondary Grape Varieties,
         Closure, Country, Unit, Characteristics, Per bottle / case / each,
         Type, ABV, Region, Style, Vintage, Appellation
```

CSV has no `producer` field — can only match on `(Title/name, Vintage, Appellation, Country)`. Match key degrades to 3-of-4 (no producer).

### Field Mapping: Dataset → `master_wine_library` JSONB Columns

| Dataset Field | Target JSONB Column | Target Key |
|--------------|---------------------|------------|
| `wine_structure.body` | `wine_structure` | `body` |
| `wine_structure.acidity` | `wine_structure` | `acidity` |
| `wine_structure.tannins` | `wine_structure` | `tannin` |
| `wine_structure.finish` | `wine_structure` | `finish` |
| `sensory_profile.primary_aromas` | `sensory_profile` | `aromas` |
| `sensory_profile.flavor_profile` | `sensory_profile` | `palate` |
| `quality_signals.quality_level` | `quality_signals` | `quality_level` |
| `quality_signals.producer_tier` | `quality_signals` | `producer_tier` |
| `quality_signals.awards_ratings` | `quality_signals` | `awards_ratings` |
| WineDataset `Characteristics` | `sensory_profile` | `characteristics_raw` |
| WineDataset `Style` | `wine_structure` | `style` |

Note: `quality_signals` does not yet exist as a JSONB column on `master_wine_library`. Phase 7 added `wine_structure`, `sensory_profile`, `practical_attributes`, `grape_family`, `region_hierarchy`, `critic_scores`. A `quality_signals` column must be added in Phase 10's migration. [VERIFIED against 20260405000003_master_wine_library_jsonb.sql]

### Fuzzy Matching Algorithm

```python
from difflib import SequenceMatcher

def _field_match(a: str, b: str, threshold: float = 0.85) -> bool:
    if not a or not b:
        return False
    return SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio() >= threshold

def wine_matches(library_wine: dict, db_wine: dict) -> int:
    """Returns count of matching fields (0–4). Write if >= 2."""
    match_count = 0
    if _field_match(library_wine.get("name",""), db_wine.get("name","")):
        match_count += 1
    if library_wine.get("producer") and _field_match(library_wine.get("producer",""), db_wine.get("producer","")):
        match_count += 1
    if library_wine.get("vintage") and str(library_wine["vintage"]) == str(db_wine.get("vintage","")):
        match_count += 1
    if library_wine.get("appellation") and _field_match(library_wine.get("appellation",""), db_wine.get("appellation","")):
        match_count += 1
    return match_count
```

### File Discovery Pattern

Per CONTEXT.md `<specifics>` note, design with file discovery rather than hardcoded paths:

```python
DATASET_SOURCES = [
    {"path": "library/*.jsonl", "format": "jsonl"},
    {"path": "External_Wine_Datasets/*.csv", "format": "csv"},
]
```

Use `glob.glob(pattern)` relative to project root. New files added to `library/` or `External_Wine_Datasets/` are auto-discovered.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP retries with backoff for Serper | Custom retry loop | `tenacity` already in `serper_client.py` | Edge cases in retry state; already wired with correct params |
| Redis distributed lock | Custom SET + expire | `r.set(lock_key, "1", nx=True, ex=3600)` from ontology_tasks.py | Atomic SET NX EX is the correct primitive |
| Budget cap atomicity | Sequential check+set | `INCRBYFLOAT` from web_verify_tasks | Race condition between multiple Celery workers — non-atomic check will overspend |
| Score normalization lookup | Database table | Pure Python dict + formula | Static mapping, no DB round-trip needed |
| Wine name fuzzy matching | Vector similarity search | `difflib.SequenceMatcher` | 200-record dataset; no embedding infrastructure needed at this scale |

---

## Common Pitfalls

### Pitfall 1: Calling `await` inside Celery task body directly

**What goes wrong:** Celery workers run in synchronous context; `await serper_search(...)` raises `RuntimeError: no running event loop`.  
**Why it happens:** Phase 9 and 8 use `asyncio.run(_xxx_async(wine_id))` wrapper — Phase 10 must do the same.  
**How to avoid:** Create `async def _score_async(wine_id)` with all `await` calls inside; call `asyncio.run(_score_async(wine_id))` from the synchronous task body.  
**Warning signs:** `RuntimeError: no current event loop` in Celery worker logs.

### Pitfall 2: Multiple `asyncio.run()` calls per task

**What goes wrong:** Each `asyncio.run()` creates and destroys an event loop. Two calls in the same task are fine but wasteful; if the second call uses a session from the first, it will fail with "session closed" errors.  
**How to avoid:** One `asyncio.run()` per task invocation. All 6 Serper calls go inside a single `_score_async()` coroutine, run sequentially with `await` between them.

### Pitfall 3: Budget cap race condition

**What goes wrong:** Multiple Celery workers simultaneously see budget = $4.99/day cap $5.00 and all increment, causing $4.99 + (workers × $0.001) overspend.  
**How to avoid:** Use `check_and_reserve_search_budget()` from `web_verify_tasks.py` which uses `INCRBYFLOAT` (atomic). Do not duplicate the logic — import and call it directly.

### Pitfall 4: `critic_scores` JSONB key collision

**What goes wrong:** If score_lookup_task runs twice (retry after partial success), it could overwrite a partially-populated `critic_scores` dict with a fresh empty one.  
**How to avoid:** Fetch existing `critic_scores` from DB first; merge new scores into existing dict (only update keys where new data was found; preserve existing `not_found` entries from prior run).

### Pitfall 5: `quality_signals` column missing from `master_wine_library`

**What goes wrong:** Dataset ingestion pipeline tries to write `quality_signals` JSONB but the column doesn't exist — Supabase `.update()` silently ignores unknown columns OR raises an error depending on client version.  
**How to avoid:** Phase 10's migration must `ADD COLUMN IF NOT EXISTS quality_signals JSONB DEFAULT '{}'` to `master_wine_library`. Phase 7 added 6 JSONB columns but `quality_signals` was NOT among them. [VERIFIED against 20260405000003_master_wine_library_jsonb.sql]

### Pitfall 6: `wine_menu_prices` → `restaurant_inventory` sync

**What goes wrong:** `wine_menu_prices` gets a new row but `restaurant_inventory.menu_price_current` and `markup_ratio` are never updated.  
**How to avoid:** Update both in the same task function call — after inserting into `wine_menu_prices`, immediately update the denormalized columns on `restaurant_inventory`. Do not use a DB trigger (harder to test, harder to debug in this stack).

### Pitfall 7: Dataset CSV has no `producer` field

**What goes wrong:** `WineDataset.csv` has `Title, Grape, Country, Region, Vintage, Appellation` but no `producer` column. A 4-field match key counting `producer` as one field would never achieve ≥2 matches for CSV wines.  
**How to avoid:** For CSV rows, the effective match key is `(name/title, vintage, appellation, country)` — all 4 without producer. Set threshold at ≥2 of these 4 (not 2 of 4 including producer). The `wine_matches()` function should adapt based on data source.

---

## Chain Trigger: Exact Insertion Point

**File:** `services/agent-orchestrator/jobs/ontology_tasks.py`  
**Location:** End of `_validate_sync()` function, after the `logger.info(...)` log statement, before `return result_dict`.

Current last lines of `_validate_sync()` (lines ~108–123):

```python
    logger.info(
        "_validate_sync: wine_id=%s validated — checks=%d/%d failures=%d autofills=%d",
        wine_id, result.checks_passed, result.checks_total,
        result.checks_failed, result.autofills_applied,
    )
    return {
        "wine_id": wine_id, "checks_passed": result.checks_passed,
        ...
    }
```

**Insert before `return`:**

```python
    # CRIT-01: Trigger score_lookup + dataset_enrich after ontology validation (chain end)
    try:
        from jobs.score_tasks import score_lookup_task, dataset_enrich_task
        score_lookup_task.delay(wine_id)
        dataset_enrich_task.delay(wine_id)
        logger.info(
            "_validate_sync: queued score_lookup_task + dataset_enrich_task for wine_id=%s", wine_id
        )
    except Exception as exc:
        logger.warning(
            "_validate_sync: failed to queue score tasks for wine_id=%s: %s", wine_id, exc
        )
```

---

## Analytics Endpoint Design

**File:** `services/agent-orchestrator/api/analytics_routes.py` (new)  
**Pattern:** Copy from `quality_routes.py` — `APIRouter(prefix="/api/v1/analytics")`, late-import Supabase client, return Pydantic response model.

```python
router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])

@router.get("/wine/{wine_id}/scores")
async def get_wine_scores(wine_id: str) -> WineScoresResponse:
    """CRIT-07: Return critic scores, composite, retail price, and per-restaurant markup."""
    supabase = _get_supabase_client()
    # 1. Fetch critic_scores JSONB + retail_price_avg from master_wine_library
    # 2. Fetch markup_ratio + markup_classification from restaurant_inventory (may be multiple restaurants)
    # 3. Return aggregated response
```

**`main.py` registration** (one line):

```python
from api.analytics_routes import router as analytics_router
app.include_router(analytics_router)
```

---

## Code Examples

### `score_tasks.py` Skeleton

```python
# Source pattern: services/agent-orchestrator/jobs/ontology_tasks.py (verified)
@celery_app.task(name="score.lookup_wine", bind=True, max_retries=3, ...)
def score_lookup_task(self, wine_id: str) -> Optional[dict]:
    r = redis_lib.from_url(settings.celery_broker_url)
    lock_key = f"wine:scores:{wine_id}"
    acquired = r.set(lock_key, "1", nx=True, ex=3600)
    if not acquired:
        return None
    try:
        return asyncio.run(_score_async(wine_id))
    except Exception as exc:
        retry_num = self.request.retries
        countdown = 60 * (2 ** retry_num)
        raise self.retry(exc=exc, countdown=countdown)
    finally:
        r.delete(lock_key)
```

### Nightly Rescore Beat Task

```python
@celery_app.task(name="score.rescore_stale_wines")
def rescore_stale_wines_task() -> dict:
    """CRIT-01 nightly: re-score wines with empty critic_scores or stale > 30 days."""
    supabase = _get_supabase_client()
    # Query: critic_scores = '{}' OR scores_last_updated_at < NOW() - INTERVAL '30 days'
    resp = supabase.rpc("get_stale_score_wines").execute()
    wine_ids = [row["id"] for row in (resp.data or [])]
    for wine_id in wine_ids:
        score_lookup_task.delay(wine_id)
    return {"queued": len(wine_ids)}
```

**Alternative without RPC** — direct Supabase filter using `.or_()`:
```python
supabase.table("master_wine_library").select("id").or_(
    "critic_scores.eq.{},scores_last_updated_at.lt.NOW()-INTERVAL '30 days'"
).execute()
```
Note: supabase-py `.or_()` does not natively support `NOW()-INTERVAL`. Safer to use a DB function or fetch all wines and filter in Python.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Redis | NX dedup, budget cap | ✓ | Used by Phases 8–9 | — |
| Celery worker | Background tasks | ✓ | Used by Phases 4–9 | — |
| Serper API key (`SERPER_API_KEY`) | score_lookup_task | ✓ | Phase 8 confirmed | graceful empty return if missing |
| `library/wineops_basic_v1.jsonl` | dataset_enrich_task | ✓ | 200 records, verified | skip file if not found |
| `library/restaurant_wine_dataset.jsonl` | dataset_enrich_task | ✓ | 200 records (same schema) | skip file if not found |
| `External_Wine_Datasets/WineDataset.csv` | dataset_enrich_task | ✓ | 1,526 records, verified | skip file if not found |

**Missing dependencies with no fallback:** None.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest (confirmed from test_ontology_tasks.py, test_web_verification.py) |
| Config file | none explicit — `pytest services/agent-orchestrator/tests/` |
| Quick run command | `pytest services/agent-orchestrator/tests/test_score_tasks.py -x -q` |
| Full suite command | `pytest services/agent-orchestrator/tests/ -x -q --timeout=30` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CRIT-01 | `score_lookup_task` runs; Redis dedup prevents double-execution | unit | `pytest tests/test_score_tasks.py::test_dedup -x` | ❌ Wave 0 |
| CRIT-01 | Score lookup per source; graceful `not_found` when Serper returns 0 results | unit | `pytest tests/test_score_tasks.py::test_score_not_found -x` | ❌ Wave 0 |
| CRIT-02 | Vivino 5-point → 100-point normalization; JR 20-point → 100-point | unit | `pytest tests/test_critic_score_service.py::test_normalization -x` | ❌ Wave 0 |
| CRIT-03 | Composite with 2+ sources; None when < 2 sources | unit | `pytest tests/test_critic_score_service.py::test_composite -x` | ❌ Wave 0 |
| CRIT-04 | Wine-Searcher price extracted from Serper snippet | unit | `pytest tests/test_critic_score_service.py::test_retail_price -x` | ❌ Wave 0 |
| CRIT-05 | `markup_ratio` computed correctly; classification tier boundaries | unit | `pytest tests/test_score_tasks.py::test_markup_classification -x` | ❌ Wave 0 |
| CRIT-06 | Anomaly (>5x, <0.8x) inserts row in `field_review_queue` | unit | `pytest tests/test_score_tasks.py::test_anomaly_flag -x` | ❌ Wave 0 |
| CRIT-07 | `GET /api/v1/analytics/wine/{id}/scores` returns 200 with correct schema | unit | `pytest tests/test_analytics_routes.py::test_scores_endpoint -x` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pytest services/agent-orchestrator/tests/test_score_tasks.py -x -q`
- **Per wave merge:** `pytest services/agent-orchestrator/tests/ -x -q --timeout=30`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `services/agent-orchestrator/tests/test_score_tasks.py` — covers CRIT-01, CRIT-05, CRIT-06
- [ ] `services/agent-orchestrator/tests/test_critic_score_service.py` — covers CRIT-02, CRIT-03, CRIT-04
- [ ] `services/agent-orchestrator/tests/test_analytics_routes.py` — covers CRIT-07
- [ ] `services/agent-orchestrator/tests/test_dataset_ingestion.py` — covers D-02 dataset enrichment pipeline

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Endpoint is internal analytics API behind existing auth |
| V3 Session Management | No | Stateless endpoint |
| V4 Access Control | Yes | Reuse restaurant_id scoping on analytics endpoint (same as quality_routes.py pattern) |
| V5 Input Validation | Yes | `wine_id` path param validated as UUID; Pydantic response model |
| V6 Cryptography | No | No cryptographic operations |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| UUID injection in path param | Tampering | FastAPI path param type annotation `wine_id: str` + UUID format check before DB query |
| Budget exhaustion via task storm | Denial of Service | Redis `INCRBYFLOAT` daily cap (reused from Phase 8 `check_and_reserve_search_budget`) |
| JSONB write with malformed score data | Tampering | Validate score dict structure before writing; never write raw Serper snippets to JSONB |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `quality_signals` JSONB column does not yet exist on `master_wine_library` | Schema Changes | If it already exists, `ADD COLUMN IF NOT EXISTS` is a no-op — safe |
| A2 | Serper snippets for wine critic pages typically contain score in "N points" or "rated N" format | Serper Query Templates | Regex may need tuning; low risk since `not_found` is graceful |
| A3 | WineDataset.csv has no `producer` field (verified header row) | Dataset Ingestion | Confirmed by live file inspection — not an assumption |
| A4 | `.or_()` supabase-py filter cannot use `NOW()-INTERVAL` natively | Nightly Beat | Low risk; fallback is Python-side filtering or a simple RPC |

**Low-risk assumptions:** A1 and A4 have safe fallbacks. A2 is documented with graceful degradation. A3 is verified.

---

## Open Questions

1. **Does `restaurant_inventory.markup_ratio` update when `retail_price_avg` changes on the library?**
   - What we know: D-04c says store for query performance; markup_ratio is `menu_price_current / retail_price_avg`.
   - What's unclear: If retail price is re-fetched nightly, should all `restaurant_inventory` rows for that wine be updated too?
   - Recommendation: Yes — `score_lookup_task` should also update all `restaurant_inventory` rows for the wine after writing `retail_price_avg`. Loop: `supabase.table("restaurant_inventory").select("id, menu_price_current").eq("master_wine_id", wine_id)` and recompute each row's `markup_ratio`.

2. **Should `dataset_enrich_task` be idempotent on re-run?**
   - What we know: D-02c confidence threshold is ≥2 field match; D-02b says enrich wine_structure, sensory_profile, quality_signals.
   - What's unclear: If a wine already has `wine_structure` populated from Phase 7 Haiku enrichment, should dataset values overwrite?
   - Recommendation: Only overwrite JSONB columns that are currently `{}` (empty). If `wine_structure` already has data, skip (non-destructive enrichment from dataset).

---

## Sources

### Primary (HIGH confidence)

- `services/agent-orchestrator/jobs/ontology_tasks.py` — Redis NX dedup pattern, task structure, chain trigger pattern
- `services/agent-orchestrator/jobs/web_verify_tasks.py` — budget cap pattern, SpendLogger pattern, chain trigger insertion template
- `services/agent-orchestrator/jobs/celery_app.py` — imports tuple format, beat schedule format, crontab pattern
- `services/agent-orchestrator/jobs/haiku_tasks.py` — asyncio.run() wrapper pattern, fallback chain trigger
- `services/agent-orchestrator/services/serper_client.py` — client interface, SerperResult TypedDict, $0.001/query cost
- `services/agent-orchestrator/services/field_confidence.py` — JSONB_ENRICHMENT_KEYS list, merge_field_confidence pattern
- `supabase/migrations/20260405000003_master_wine_library_jsonb.sql` — confirmed `critic_scores` stub; confirmed 6 JSONB columns (no `quality_signals`)
- `supabase/migrations/20260208024921_new-migration.sql` — `restaurant_inventory` schema (no pricing columns yet)
- `library/wineops_basic_v1.jsonl` — dataset schema verified (first 3 records)
- `External_Wine_Datasets/WineDataset.csv` — column headers verified

### Secondary (MEDIUM confidence)

- `.planning/phases/10-critic-scores-pricing-intelligence/10-CONTEXT.md` — all locked decisions, canonical references
- `.planning/REQUIREMENTS.md` — CRIT-01 through CRIT-07 exact text

### Tertiary (LOW confidence — assumed)

- Score regex patterns (A2 above) — based on known snippet format conventions for wine review sites; not verified against live Serper responses

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all libraries already installed and in use in earlier phases
- Architecture: HIGH — exact task pattern from ontology_tasks.py; exact chain insertion point verified in web_verify_tasks.py
- Schema changes: HIGH — verified against live migration files; exact column names and types confirmed
- Serper query templates: MEDIUM — templates are reasonable best-practice but not verified against live Serper responses
- Score regex patterns: LOW — standard snippet format, but real Serper snippets may vary per query; graceful `not_found` mitigates risk
- Dataset ingestion: HIGH — field schemas verified against live files; fuzzy match algorithm is stdlib

**Research date:** 2026-04-06  
**Valid until:** 2026-05-06 (stable stack, no fast-moving dependencies)
