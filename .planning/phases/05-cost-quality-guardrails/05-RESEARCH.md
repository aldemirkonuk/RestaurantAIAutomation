# Phase 5: Cost & Quality Guardrails — Research

**Researched:** 2026-04-04
**Domain:** API spend tracking, Celery beat scheduling, FastAPI route patterns, Supabase migrations
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Central `SpendLogger` service (`services/spend_logger.py`). All API-calling services invoke it after each API call: `SpendLogger.log(provider, model, input_tokens, output_tokens, cost_usd, restaurant_id=None)`. Single place for all Supabase `api_spend` inserts — no duplicated insert logic across files. Services covered: `claude_vision_extractor.py`, `haiku_enrichment_service.py`, `vlm_extraction_service.py` (Gemini).
- **D-02:** Celery beat task runs **hourly**. Query: `SELECT SUM(cost_usd) FROM api_spend WHERE provider = X AND timestamp >= start_of_month`. If ≥ 80% of cap ($40 Claude / $16 Gemini), send email alert via `email_client.py` to `MANAGER_EMAIL`. Alert is **idempotent** — store last alerted month+threshold in a Supabase config row; do not re-alert until next calendar month.
- **D-03:** Pre-flight cap check in `onboarding_routes.py` **before** calling the extractor. Query `api_spend` for cumulative spend for `restaurant_id` in current month. If sum + estimated cost of this request (page_count × $0.05/page) > $2.00, reject with HTTP 402 and send alert to `MANAGER_EMAIL`. No mid-extraction abort logic needed — simple, clean.
- **D-04:** Full read + correct loop in a new `quality_routes.py`:
  - `GET /api/v1/quality/review-queue` — returns wines from `master_wine_library_submissions` where `needs_review = true` OR `auto_blocked = true`, ordered by completeness_score ASC (worst first).
  - `PATCH /api/v1/quality/review-queue/{submission_id}` — accepts corrected field values. On correction: update submission row, compute per-field delta vs extracted value, log to a `field_corrections` table (field_name, original_value, corrected_value, submission_id). If `auto_blocked = true` and correction raises completeness ≥ 0.5: unblock and promote to `master_wine_library`. Per-field acceptance rate is derived from `field_corrections`.
- **D-05:** Two completeness thresholds — no wine passes through silently:
  - `completeness < 0.5` → `needs_review = true` (already implemented in Phase 1; surfaced in queue)
  - `completeness < 0.3` → `auto_blocked = true` (new flag; wine stored in submissions but NOT promoted to `master_wine_library` automatically — requires human PATCH approval)
  - `completeness ≥ 0.5` → normal promotion path (no change from current behavior)

### Claude's Discretion

- `api_spend` table schema column names (follow REQUIREMENTS.md COST-01 spec exactly)
- `field_corrections` table schema (create migration; minimal: submission_id, field_name, original_value, corrected_value, corrected_at, corrected_by)
- `auto_blocked` column migration (add to `master_wine_library_submissions`)
- Alert deduplication storage (a single-row Supabase config or key-value table is fine)
- Celery beat schedule registration (follow existing celery_app.py pattern)
- Cost estimate for pre-flight check ($0.05/page × page_count is a safe upper bound)

### Deferred Ideas (OUT OF SCOPE)

- Secondary AI verification pass (Haiku cross-checking suspicious fields) — revisit after QUAL-02 acceptance rate data is available
- Human-gated persistence for ALL wines (not just < 0.3) — v2 concern
- Real-time spend dashboard — COST-01 monthly query is sufficient for now
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| COST-01 | Monthly API spend tracked per provider (anthropic, google) in Supabase `api_spend` table | SpendLogger service + migration for api_spend table; Supabase insert pattern confirmed in existing code |
| COST-02 | Monthly soft cap: $50 Claude / $20 Gemini — alerts sent to MANAGER_EMAIL at 80% threshold | Celery beat hourly pattern confirmed in celery_app.py; email_client.py async send_email() confirmed |
| COST-03 | Per-restaurant cost cap: if single restaurant extraction exceeds $2.00, stop and alert | Pre-flight check in onboarding_routes.py before extractor call; HTTP 402 response pattern researched |
| QUAL-01 | Human review queue: wines with completeness < 0.5 surfaced in dashboard for correction | GET + PATCH endpoints in new quality_routes.py; `needs_review` flag already set in Phase 1 |
| QUAL-02 | Extraction accuracy tracked: per-field acceptance rate from human corrections | field_corrections table migration + PATCH handler computes delta per field |
</phase_requirements>

---

## Summary

Phase 5 adds two orthogonal layers on top of the existing pipeline: financial guardrails (spend logging + cap enforcement) and quality governance (human review queue). Both are primarily "plumbing" phases — they connect existing services with new persistence and alerting logic rather than introducing new AI capabilities.

The financial layer centers on a new `SpendLogger` service that all three API-calling services must call after each response. The service inserts a row into a new `api_spend` Supabase table. A Celery beat task (hourly) aggregates monthly totals and sends alerts via the existing `email_client.py` when providers approach their caps. The per-restaurant cap is enforced synchronously in `onboarding_routes.py` as a pre-flight query before the extractor is invoked.

The quality layer builds on the `needs_review` flag already written to `master_wine_library_submissions` by `claude_vision_extractor.py`. Phase 5 adds: (1) an `auto_blocked` flag for wines below 0.3 completeness, preventing promotion to `master_wine_library`; (2) a GET endpoint to surface the review queue; (3) a PATCH endpoint for human correction that logs field-level deltas to a new `field_corrections` table; and (4) promotion logic that unblocks auto-blocked wines when a correction lifts completeness to ≥ 0.5.

**Primary recommendation:** Implement in two waves — Wave 1: SpendLogger service + three migrations + Celery beat task + pre-flight check. Wave 2: quality_routes.py (GET + PATCH) + auto_blocked gate in onboarding_routes.py.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| supabase-py | 2.x (installed) | Supabase inserts + queries | Already used throughout the codebase |
| celery | 5.x (installed) | Beat schedule + task registration | Already configured in celery_app.py |
| fastapi | 0.x (installed) | New quality_routes.py router | Already used for all routers |
| pydantic | 2.x (installed) | Request/response models for PATCH | Already used throughout |
| aiosmtplib | installed | Async SMTP for cap alerts | Already used in email_client.py |

### No New Dependencies Required
All libraries for Phase 5 are already installed. The implementation is pure integration of existing services via new service files, migrations, and route handlers.

**Installation:** None — all dependencies already present in `services/agent-orchestrator/requirements.txt`.

---

## Architecture Patterns

### Recommended Project Structure (Phase 5 additions)

```
services/agent-orchestrator/
├── services/
│   └── spend_logger.py          # NEW — central SpendLogger service (D-01)
├── jobs/
│   ├── celery_app.py            # MODIFY — add "spend.monthly_cap_check" to beat_schedule
│   └── spend_tasks.py           # NEW — monthly_cap_check_task Celery beat task (D-02)
├── api/
│   ├── onboarding_routes.py     # MODIFY — pre-flight cap check + auto_blocked flag (D-03, D-05)
│   ├── quality_routes.py        # NEW — GET + PATCH review queue (D-04)
│   └── main.py                  # MODIFY — register quality_router
├── services/
│   ├── claude_vision_extractor.py   # MODIFY — call SpendLogger.log() per page
│   ├── haiku_enrichment_service.py  # MODIFY — call SpendLogger.log() after enrichment
│   └── vlm_extraction_service.py   # MODIFY — call SpendLogger.log() in extract_from_image/text
└── supabase/migrations/
    ├── 20260404000000_api_spend.sql              # NEW
    ├── 20260404000001_auto_blocked_column.sql    # NEW
    └── 20260404000002_field_corrections.sql      # NEW
```

### Pattern 1: SpendLogger Service (Singleton, Sync Supabase Insert)

The SpendLogger must be callable from both sync and async contexts (Celery tasks are sync; API handlers are async). Use a simple synchronous Supabase insert since the supabase-py client already uses sync I/O internally.

```python
# services/spend_logger.py — canonical pattern (follows existing sync Supabase calls)
from datetime import datetime, timezone
from config.settings import get_settings
from supabase import create_client

class SpendLogger:
    def log(
        self,
        provider: str,          # "anthropic" | "google"
        model: str,             # "claude-haiku-4-5-20251001" | "gemini-2.5-flash"
        input_tokens: int,
        output_tokens: int,
        cost_usd: float,
        restaurant_id: str = None,
    ) -> None:
        settings = get_settings()
        if not settings.supabase_url or not settings.supabase_key:
            return  # no-op if Supabase not configured
        supabase = create_client(settings.supabase_url, settings.supabase_key)
        supabase.table("api_spend").insert({
            "provider": provider,
            "model": model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost_usd": cost_usd,
            "restaurant_id": restaurant_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }).execute()

_spend_logger = None
def get_spend_logger() -> SpendLogger:
    global _spend_logger
    if _spend_logger is None:
        _spend_logger = SpendLogger()
    return _spend_logger
```

**Important:** SpendLogger.log() must never raise — wrap in try/except and log warning on failure. A spend logging failure must not interrupt the extraction pipeline.

### Pattern 2: Celery Beat Task Registration (follows existing celery_app.py pattern)

```python
# jobs/celery_app.py — add to beat_schedule (confirmed working pattern)
"spend-monthly-cap-check": {
    "task": "spend.monthly_cap_check",
    "schedule": crontab(minute=0),  # Every hour at minute 0
    "options": {"expires": 3500},
},
```

```python
# jobs/spend_tasks.py — follows haiku_tasks.py pattern exactly
@celery_app.task(name="spend.monthly_cap_check")
def monthly_cap_check_task() -> dict:
    return asyncio.run(_monthly_cap_check_async())
```

Add `"jobs.spend_tasks"` to `celery_app.conf.update(imports=(...))`.

### Pattern 3: Pre-flight Cap Check (synchronous query before extractor call)

The pre-flight check must run before `extractor.extract_menu()` is called. The check is a synchronous Supabase query inside the async FastAPI handler (the supabase-py client is sync; this is the existing pattern throughout the codebase).

```python
# onboarding_routes.py — insert BEFORE extractor.extract_menu() call
from datetime import datetime, timezone

def _get_month_start() -> str:
    now = datetime.now(timezone.utc)
    return datetime(now.year, now.month, 1, tzinfo=timezone.utc).isoformat()

def _preflight_cap_check(supabase, restaurant_id: str, page_count: int) -> None:
    """Raises HTTPException(402) if this request would breach the $2.00 cap."""
    estimated_cost = page_count * 0.05
    resp = (
        supabase.table("api_spend")
        .select("cost_usd")
        .eq("restaurant_id", restaurant_id)
        .gte("timestamp", _get_month_start())
        .execute()
    )
    existing_spend = sum(r["cost_usd"] for r in (resp.data or []))
    if existing_spend + estimated_cost > 2.00:
        # Fire alert email (fire-and-forget)
        asyncio.create_task(_send_cap_alert_email(restaurant_id, existing_spend, estimated_cost))
        raise HTTPException(
            status_code=402,
            detail=f"Restaurant cap exceeded: ${existing_spend:.4f} spent + ${estimated_cost:.4f} estimated > $2.00"
        )
```

**Critical:** `asyncio.create_task()` for the alert email requires an active event loop — this works correctly inside an async FastAPI route handler.

### Pattern 4: HTTP 402 Response

HTTP 402 (Payment Required) is the correct status for "spending cap exceeded." FastAPI `HTTPException(status_code=402)` works out of the box — no special configuration needed.

### Pattern 5: Idempotent Monthly Alert Deduplication

Store deduplication state in a `spend_alert_state` table (single-row config pattern). The beat task checks: if `last_alerted_month == current_month AND last_alerted_provider == provider AND last_alerted_threshold == "80pct"` → skip. Reset on month rollover.

Alternatively: use a simple JSONB config row in an existing `app_config` table (if one exists) or create a minimal `spend_alert_state` table. The CONTEXT.md explicitly leaves this as Claude's discretion — a single-row table is the cleanest approach.

```sql
-- spend_alert_state table (2 rows max: one per provider)
CREATE TABLE IF NOT EXISTS spend_alert_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(50) UNIQUE NOT NULL,
    last_alert_month VARCHAR(7),  -- "2026-04" format
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Pattern 6: Quality Routes — GET Review Queue

```python
# api/quality_routes.py
from fastapi import APIRouter
router = APIRouter(prefix="/api/v1/quality", tags=["quality"])

@router.get("/review-queue")
async def get_review_queue():
    supabase = get_supabase_client()
    resp = (
        supabase.table("master_wine_library_submissions")
        .select("*")
        .or_("needs_review.eq.true,auto_blocked.eq.true")
        .order("completeness_score", desc=False)  # worst first
        .execute()
    )
    return {"items": resp.data or [], "count": len(resp.data or [])}
```

**Supabase `.or_()` filter syntax:** The `or_` method in supabase-py accepts a comma-separated string of PostgREST filter conditions. Verified pattern from existing codebase usage: `.or_("needs_review.eq.true,auto_blocked.eq.true")`.

### Pattern 7: Quality Routes — PATCH Correction + Promotion

The PATCH endpoint must:
1. Load the existing submission row (to compute field-level deltas)
2. Apply corrections to the submission row
3. Recompute completeness_score
4. Log each changed field to `field_corrections`
5. If `auto_blocked = true` AND new completeness ≥ 0.5: unblock AND promote to `master_wine_library`

Promotion to `master_wine_library` must follow the same upsert pattern used by `haiku_tasks.py` (update by submission id, or insert if not yet in the library).

### Pattern 8: auto_blocked Gate in onboarding_routes.py

After `extract_menu()` returns, before persisting, check each wine's completeness_score:

```python
# After compute_completeness (already done by extractor)
wine["auto_blocked"] = wine.get("completeness_score", 0.0) < 0.3
```

The `auto_blocked` flag is stored in the submission payload AND as a top-level column on `master_wine_library_submissions` (requires migration). The existing `needs_review` flag logic (completeness < 0.5) is unchanged.

### Anti-Patterns to Avoid

- **Raising inside SpendLogger:** A spend logging failure must never crash the extraction pipeline. Wrap all Supabase calls in SpendLogger in try/except.
- **Mid-extraction abort for cost:** D-03 explicitly says "no mid-extraction abort logic needed." Do the pre-flight check; if it passes, run to completion.
- **Separate Supabase clients per SpendLogger call:** Create the Supabase client once per `log()` call (the existing pattern) or cache it in the singleton. The existing codebase creates clients per-call — follow that pattern for consistency.
- **Using asyncio.create_task() in Celery tasks:** Celery tasks run in a sync context via `asyncio.run()`. Never use `create_task()` inside a Celery task — use `asyncio.run()` for the async helper.
- **asyncio.create_task() without active event loop in onboarding_routes.py:** The FastAPI route handler is async, so `create_task()` is safe there. But guard with try/except in case the loop is not running (shouldn't happen in production, but defensive coding matters here).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Email sending | Custom SMTP logic | `email_client.py` `send_email()` | Already production-ready with retry, HTML templates, mock mode |
| Supabase inserts | Raw psycopg2 / SQL | `supabase.table().insert()` | Consistent with all existing code; handles auth automatically |
| Celery beat schedule | Custom cron daemon | `celery_app.conf.beat_schedule` | Already configured and running |
| Monthly date range | Manual date math | `datetime(year, month, 1, tzinfo=utc)` | Simple, correct, no extra library |
| Field diff computation | Fuzzy matching | Simple `!=` comparison per field | Corrections are structured JSON — exact equality is correct |

**Key insight:** Every infrastructure component needed for Phase 5 already exists in the codebase. This phase is entirely about wiring, not building infrastructure.

---

## Common Pitfalls

### Pitfall 1: SpendLogger Called in async Context Without await
**What goes wrong:** The `SpendLogger.log()` method is sync (supabase-py is sync). Calling it with `await` raises a TypeError. Not calling it correctly from an async context causes blocking.
**Why it happens:** Developer assumes the Supabase client is async because the route handlers are async.
**How to avoid:** Call `SpendLogger.log()` synchronously from both async handlers and Celery tasks. The supabase-py sync client is safe to call from an async function (it blocks, but the insert is fast < 50ms). For production scale, move to background task; for MVP, sync call is acceptable.
**Warning signs:** `TypeError: object bool can't be used in 'await' expression` at runtime.

### Pitfall 2: Supabase `.or_()` Filter Syntax Errors
**What goes wrong:** The review queue GET endpoint returns 0 results or throws a Supabase PostgREST error.
**Why it happens:** supabase-py `.or_()` requires PostgREST syntax — not Python-style arguments.
**How to avoid:** Use `.or_("needs_review.eq.true,auto_blocked.eq.true")` — the string format, not keyword args. Test with a direct Supabase SQL query first.
**Warning signs:** Empty result set when submissions with `needs_review=true` exist in the table.

### Pitfall 3: auto_blocked Column Not on master_wine_library_submissions
**What goes wrong:** `onboarding_routes.py` tries to insert `auto_blocked=True` into the submission row, but the column doesn't exist in the DB yet.
**Why it happens:** Migration written but not applied, or column added to payload dict but not to the table schema.
**How to avoid:** Run the migration (`ALTER TABLE master_wine_library_submissions ADD COLUMN IF NOT EXISTS auto_blocked BOOLEAN DEFAULT FALSE`) before deploying the code change. Migration must be Wave 1.
**Warning signs:** Supabase PostgREST error: `column "auto_blocked" of relation "master_wine_library_submissions" does not exist`.

### Pitfall 4: Monthly Cap Check Uses UTC vs Local Timezone Mismatch
**What goes wrong:** The beat task fires at midnight UTC, but the month boundary in the query uses local time, causing alert deduplication to fail at month rollover.
**Why it happens:** `datetime.utcnow()` vs `datetime.now()` confusion; the Celery config already sets `timezone="UTC"`.
**How to avoid:** Always use `datetime.now(timezone.utc)` for all timestamps. The `api_spend.timestamp` column must be `TIMESTAMPTZ` (not `TIMESTAMP`). The month-start calculation must use UTC.
**Warning signs:** Duplicate alert emails on the 1st of each month.

### Pitfall 5: alert_deduplication Row Not Initialized
**What goes wrong:** The monthly cap check task tries to query `spend_alert_state` for the current month but the row doesn't exist yet → upsert logic must handle INSERT on first run.
**Why it happens:** New table, no seed data.
**How to avoid:** Use Supabase `.upsert()` with `on_conflict="provider"` when updating alert state. On first run, the row is created; subsequent runs update it.
**Warning signs:** `KeyError` or empty result when querying `spend_alert_state`.

### Pitfall 6: PATCH Promotion Logic — Completeness Recomputation
**What goes wrong:** The PATCH endpoint receives corrected fields, but recomputes completeness using the wrong field set (e.g., only the corrected fields, not the full merged wine record).
**Why it happens:** Developer applies corrections to a partial dict instead of merging with the existing submission payload.
**How to avoid:** Load the full submission payload from Supabase first, merge corrections on top, then call `compute_completeness()` on the merged dict. The `compute_completeness` function is already defined in `claude_vision_extractor.py` and can be imported.
**Warning signs:** `auto_blocked` wines never get promoted even when corrections are complete.

### Pitfall 7: email_client.py Requires Instantiation — Not a Singleton
**What goes wrong:** Code calls `email_client.send_email()` as a module-level function, but `EmailClient` is a class that requires instantiation with SMTP credentials.
**Why it happens:** Developer sees `email_client.py` and assumes a module-level `send_email()` function exists.
**How to avoid:** Instantiate `EmailClient(backend="gmail", gmail_user=settings.gmail_user, gmail_password=settings.gmail_password)`. The settings object must have `gmail_user` and `gmail_password` attributes (or equivalent). Check `config/settings.py` — these may need to be added as new env vars (`GMAIL_USER`, `GMAIL_PASSWORD`). Alternatively, use `mock_mode=True` for testing.
**Warning signs:** `AttributeError: module 'services.email_client' has no attribute 'send_email'`.

---

## Code Examples

### api_spend Table Migration

```sql
-- supabase/migrations/20260404000000_api_spend.sql
CREATE TABLE IF NOT EXISTS api_spend (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(50) NOT NULL,          -- "anthropic" | "google"
    model VARCHAR(100) NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd DECIMAL(10,6) NOT NULL,
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE SET NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_spend_provider_timestamp
    ON api_spend(provider, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_api_spend_restaurant_timestamp
    ON api_spend(restaurant_id, timestamp DESC)
    WHERE restaurant_id IS NOT NULL;
```

### auto_blocked Column Migration

```sql
-- supabase/migrations/20260404000001_auto_blocked_column.sql
ALTER TABLE master_wine_library_submissions
    ADD COLUMN IF NOT EXISTS auto_blocked BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN master_wine_library_submissions.auto_blocked IS
    'True when completeness_score < 0.3. Wine held in submissions; NOT promoted to master_wine_library until human PATCH approval.';

CREATE INDEX IF NOT EXISTS idx_submissions_review_queue
    ON master_wine_library_submissions(completeness_score ASC)
    WHERE needs_review = TRUE OR auto_blocked = TRUE;
```

### field_corrections Table Migration

```sql
-- supabase/migrations/20260404000002_field_corrections.sql
CREATE TABLE IF NOT EXISTS field_corrections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID NOT NULL REFERENCES master_wine_library_submissions(id) ON DELETE CASCADE,
    field_name VARCHAR(100) NOT NULL,
    original_value TEXT,
    corrected_value TEXT,
    corrected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    corrected_by VARCHAR(255)   -- user identifier, nullable for anonymous review
);

CREATE INDEX IF NOT EXISTS idx_field_corrections_submission
    ON field_corrections(submission_id);
CREATE INDEX IF NOT EXISTS idx_field_corrections_field
    ON field_corrections(field_name);

-- Acceptance rate query (QUAL-02):
-- SELECT field_name,
--        COUNT(*) FILTER (WHERE corrected_value IS NOT NULL) AS corrections,
--        COUNT(*) AS total
-- FROM field_corrections GROUP BY field_name;
```

### spend_alert_state Table (alert deduplication)

```sql
-- Include in 20260404000000_api_spend.sql or separate migration
CREATE TABLE IF NOT EXISTS spend_alert_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(50) UNIQUE NOT NULL,
    last_alert_month VARCHAR(7),   -- "2026-04" ISO year-month
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed rows (idempotent)
INSERT INTO spend_alert_state (provider, last_alert_month)
    VALUES ('anthropic', NULL), ('google', NULL)
    ON CONFLICT (provider) DO NOTHING;
```

### Settings Additions Required

`config/settings.py` currently lacks `MANAGER_EMAIL` and email credentials. The planner must add:

```python
# Add to Settings.__init__()
self.manager_email: Optional[str] = os.getenv("MANAGER_EMAIL")
self.gmail_user: Optional[str] = os.getenv("GMAIL_USER")
self.gmail_password: Optional[str] = os.getenv("GMAIL_PASSWORD")
self.celery_broker_url: str = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
self.celery_backend_url: str = os.getenv("CELERY_BACKEND_URL", "redis://localhost:6379/1")
```

Note: `celery_broker_url` and `celery_backend_url` are already used in `celery_app.py` via `Settings()` — they may already exist in settings. MANAGER_EMAIL and gmail credentials are new additions.

### SpendLogger Call Site Pattern (claude_vision_extractor.py)

The SpendLogger call goes inside `extract_page()`, after the cost computation (line ~230), after the response is received:

```python
# After cost_usd = (...) computation in extract_page()
try:
    from services.spend_logger import get_spend_logger
    get_spend_logger().log(
        provider="anthropic",
        model=MODEL_ID,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cost_usd=cost_usd,
        restaurant_id=None,  # not available at page level — passed from above if needed
    )
except Exception as e:
    logger.warning(f"SpendLogger failed for page {page_index}: {e}")
```

**restaurant_id propagation:** `extract_page()` does not currently receive `restaurant_id`. Two options: (1) add `restaurant_id: Optional[str] = None` parameter to `extract_page()` and `extract_menu()`, propagating from the caller; (2) log without restaurant_id at page level, log with restaurant_id once in `onboarding_routes.py` after the full extraction. Option 2 is cleaner — the onboarding route knows the restaurant_id and can call SpendLogger once for the full session cost.

**Recommended call site for claude_vision_extractor.py:** Log in `onboarding_routes.py` after extraction, not inside `extract_page()`. This keeps `claude_vision_extractor.py` pure and avoids threading restaurant_id through the extractor.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No spend tracking | Central SpendLogger + api_spend table | Phase 5 | Enables cost cap enforcement and monthly alerting |
| needs_review only (binary) | Two-tier: needs_review (0.5) + auto_blocked (0.3) | Phase 5 | Prevents low-quality wines from entering master library silently |
| No correction tracking | field_corrections table + PATCH endpoint | Phase 5 | Enables per-field acceptance rate (QUAL-02) |

---

## Open Questions

1. **master_wine_library_submissions schema**
   - What we know: The table is used in `onboarding_routes.py` and referenced in CONTEXT.md. It has `id`, `restaurant_id`, `submitted_by`, `payload`, `signature_hash`, `status`, `created_at` columns based on code inspection.
   - What's unclear: The exact migration for `master_wine_library_submissions` is NOT found in any of the Supabase migration files (checked all 17 files). The table was likely created inline via the Supabase dashboard or is defined elsewhere.
   - Recommendation: The planner should add a `CREATE TABLE IF NOT EXISTS master_wine_library_submissions` to the Wave 0 task OR verify the table definition via Supabase dashboard before writing migrations that `ALTER` it. The `auto_blocked` column migration uses `ADD COLUMN IF NOT EXISTS` which is safe either way.

2. **MANAGER_EMAIL env var name**
   - What we know: CONTEXT.md references `MANAGER_EMAIL`. The `config/settings.py` currently does NOT have `manager_email` defined.
   - What's unclear: Whether `MANAGER_EMAIL` is already set in `.env` under a different key.
   - Recommendation: The Settings addition task must add `self.manager_email = os.getenv("MANAGER_EMAIL")` and update `.env.example`. The planner should make this a Wave 0 task.

3. **GMAIL credentials in settings**
   - What we know: `email_client.py` accepts `gmail_user` and `gmail_password` at instantiation. Settings does not currently expose these.
   - What's unclear: Whether `GMAIL_USER`/`GMAIL_PASSWORD` are in `.env` already.
   - Recommendation: The spend_tasks.py beat task must instantiate `EmailClient` with credentials from settings. Add `GMAIL_USER` and `GMAIL_PASSWORD` to settings + `.env.example` in Wave 0.

4. **restaurant_id threading into SpendLogger**
   - What we know: D-01 says `SpendLogger.log(..., restaurant_id=None)`. The cleanest call site for Claude Vision is `onboarding_routes.py` (where restaurant_id is known) rather than inside `extract_page()`.
   - What's unclear: Whether the Haiku enrichment task (which runs asynchronously in Celery) has access to restaurant_id. Looking at `haiku_tasks.py`, `haiku_enrich_task` receives `wine_id` (submission UUID) but not `restaurant_id`.
   - Recommendation: For Haiku SpendLogger calls, log with `restaurant_id=None` unless the Celery task is extended to accept restaurant_id. This is acceptable per D-01 which makes restaurant_id optional.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| supabase-py | api_spend inserts, review queue queries | Yes | 2.x (in venv) | None — required |
| celery | Beat task for monthly cap check | Yes | 5.x (in venv) | None — required |
| aiosmtplib | email_client.py async SMTP | Yes | installed (in venv) | None — required |
| Redis | Celery broker/backend | Assumed (used in prod config) | Unknown locally | Configure via env vars |
| fastapi | quality_routes.py router | Yes | installed (in venv) | None — required |

**Missing dependencies with no fallback:** None — all code-level dependencies are present.

**Missing dependencies with fallback:** Redis (for Celery) — not tested locally but configured via environment variables (`CELERY_BROKER_URL`). Beat tasks will not run without Redis, but the rest of the phase (SpendLogger, quality routes) can be tested independently.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest 7.x + pytest-asyncio |
| Config file | `services/agent-orchestrator/pytest.ini` |
| Quick run command | `cd services/agent-orchestrator && python -m pytest tests/ -x -v --ignore=venv --ignore="venv lib 2"` |
| Full suite command | `cd services/agent-orchestrator && python -m pytest tests/ -v --ignore=venv --ignore="venv lib 2"` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| COST-01 | SpendLogger.log() inserts row to api_spend | unit | `pytest tests/test_spend_logger.py -x` | No — Wave 0 |
| COST-01 | SpendLogger.log() is no-op when Supabase not configured | unit | `pytest tests/test_spend_logger.py::test_noop_without_supabase -x` | No — Wave 0 |
| COST-02 | monthly_cap_check_task fires alert at 80% | unit (mock Supabase + mock email) | `pytest tests/test_spend_tasks.py -x` | No — Wave 0 |
| COST-02 | Alert deduplication: no second alert in same month | unit | `pytest tests/test_spend_tasks.py::test_no_duplicate_alert -x` | No — Wave 0 |
| COST-03 | Pre-flight check returns 402 when cap exceeded | unit (mock Supabase) | `pytest tests/test_onboarding_routes.py::test_preflight_cap_exceeded -x` | No — Wave 0 |
| COST-03 | Pre-flight check passes when cap not exceeded | unit | `pytest tests/test_onboarding_routes.py::test_preflight_cap_passes -x` | No — Wave 0 |
| QUAL-01 | GET /api/v1/quality/review-queue returns needs_review wines | unit (mock Supabase) | `pytest tests/test_quality_routes.py::test_get_review_queue -x` | No — Wave 0 |
| QUAL-01 | GET /api/v1/quality/review-queue returns auto_blocked wines | unit | `pytest tests/test_quality_routes.py::test_get_review_queue_auto_blocked -x` | No — Wave 0 |
| QUAL-02 | PATCH /review-queue/{id} logs field_corrections | unit (mock Supabase) | `pytest tests/test_quality_routes.py::test_patch_logs_corrections -x` | No — Wave 0 |
| QUAL-02 | PATCH promotes auto_blocked wine when completeness >= 0.5 after correction | unit | `pytest tests/test_quality_routes.py::test_patch_promotes_auto_blocked -x` | No — Wave 0 |

### Sampling Rate

- **Per task commit:** `cd services/agent-orchestrator && python -m pytest tests/test_spend_logger.py tests/test_spend_tasks.py tests/test_quality_routes.py -x --ignore=venv`
- **Per wave merge:** Full suite: `python -m pytest tests/ -v --ignore=venv`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/test_spend_logger.py` — covers COST-01 (SpendLogger unit tests)
- [ ] `tests/test_spend_tasks.py` — covers COST-02 (monthly cap check + dedup)
- [ ] `tests/test_onboarding_routes.py` — covers COST-03 (pre-flight cap check)
- [ ] `tests/test_quality_routes.py` — covers QUAL-01, QUAL-02 (GET + PATCH review queue)

Note: `tests/test_yolo_preview.py` already exists — Phase 5 tests should follow its pattern (pytest fixtures, mock objects for Supabase/email dependencies).

---

## Integration Points Summary

| Integration | From | To | What Changes |
|------------|------|----|--------------|
| SpendLogger call | `claude_vision_extractor.py` or `onboarding_routes.py` | `spend_logger.py` | Add call after extraction completes |
| SpendLogger call | `haiku_enrichment_service.py` | `spend_logger.py` | Add call after Haiku API response |
| SpendLogger call | `vlm_extraction_service.py` | `spend_logger.py` | Add call in `extract_from_image()` and `extract_from_text()` |
| Pre-flight check | `onboarding_routes.py` | `api_spend` Supabase table | Query before extractor.extract_menu() |
| auto_blocked flag | `onboarding_routes.py` | `master_wine_library_submissions` | Set based on completeness_score after extraction |
| Beat task | `celery_app.py` | `spend_tasks.py` | Register "spend.monthly_cap_check" in beat_schedule |
| Quality router | `main.py` | `quality_routes.py` | `app.include_router(quality_router)` |

---

## Sources

### Primary (HIGH confidence)
- Direct code inspection: `services/agent-orchestrator/services/claude_vision_extractor.py` — cost computation pattern confirmed at lines 228–230; needs_review logic at lines 235–237
- Direct code inspection: `services/agent-orchestrator/jobs/celery_app.py` — beat_schedule dict confirmed; `imports=("jobs.tasks", "jobs.haiku_tasks")` pattern confirmed
- Direct code inspection: `services/agent-orchestrator/services/email_client.py` — `EmailClient.send_email()` async method, Gmail + SendGrid backends confirmed
- Direct code inspection: `services/agent-orchestrator/api/onboarding_routes.py` — insertion point for pre-flight check confirmed (before line 100 where `extractor.extract_menu()` is called)
- Direct code inspection: `services/agent-orchestrator/api/main.py` — router registration pattern: `app.include_router(onboarding_router)`, `app.include_router(preview_router)`
- Direct code inspection: `services/agent-orchestrator/jobs/haiku_tasks.py` — `asyncio.run()` + Celery task pattern; `_get_supabase_client()` helper pattern
- Direct code inspection: `supabase/migrations/20260403000000_add_producer_bio.sql` — migration naming convention and `ADD COLUMN IF NOT EXISTS` pattern confirmed
- Direct code inspection: `services/agent-orchestrator/config/settings.py` — `Settings` class confirmed; `manager_email`, `gmail_user`, `gmail_password` NOT currently present

### Secondary (MEDIUM confidence)
- supabase-py `.or_()` filter syntax — confirmed from pattern matching against PostgREST filter documentation conventions and codebase usage

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries confirmed installed in venv
- Architecture: HIGH — all patterns derived from existing working code in the codebase
- Pitfalls: HIGH — derived from direct code inspection of the exact files that will be modified
- Migrations: HIGH — migration naming convention and syntax confirmed from Phase 4 migration

**Research date:** 2026-04-04
**Valid until:** 2026-05-04 (stable stack, 30-day validity)
