# Phase 4: Claude Haiku Enrichment — Context

**Gathered:** 2026-04-03
**Status:** Ready for planning

<domain>
## Phase Boundary

After Phase 1 (Claude Vision extraction) stores wines to `master_wine_library_submissions`, wines
missing region/country/grape_variety are queued for async Haiku enrichment via Celery. A new
`haiku_enrichment_service.py` calls `claude-haiku-4-5` with wine_name + vintage and returns
region, country, grape_variety, producer_bio. The Celery task is queued from the
`POST /api/v1/onboarding/extract` route handler (not from the extractor service). Results are
stored in `master_wine_library` with `enrichment_source = "haiku"`. This phase delivers
`haiku_enrichment_service.py`, a new Celery task, a DB migration for `producer_bio`, and wires
the trigger into `onboarding_routes.py`.
</domain>

<decisions>
## Implementation Decisions

### Trigger Point
- **D-01:** Enrichment is queued from the **`POST /api/v1/onboarding/extract` route handler**
  (in `onboarding_routes.py`), after extraction returns. The extractor service
  (`claude_vision_extractor.py`) stays pure — it has no knowledge of Celery tasks.
- **D-02:** The route handler inspects extracted wines, identifies those with missing
  region/country/grape_variety, and calls `haiku_enrich_task.delay(wine_id, wine_name, vintage)`
  for each qualifying wine. This happens after the extraction response is assembled but before
  returning to the client (non-blocking — `.delay()` is fire-and-forget).

### producer_bio Field
- **D-03:** Add a Supabase migration: `ALTER TABLE master_wine_library ADD COLUMN producer_bio TEXT`.
  Haiku returns producer_bio as part of enrichment; it is stored alongside region/country/grape_variety.
  HAIKU-02 compliance requires this column to exist.

### Failure Behavior
- **D-04:** Celery task uses `autoretry_for=(Exception,)` with `max_retries=3` and exponential
  `countdown` (60s, 120s, 240s). After retries are exhausted, log the failure at WARNING level
  and allow the task to terminate silently — wine stays unenriched. No user-visible error.
  Matches the existing DLQ exponential backoff pattern in `jobs/tasks.py`.

### Dedup Check Scope
- **D-05:** Check **both** tables before calling Haiku:
  1. `master_wine_library_submissions` — did Claude Vision already return all 3 fields filled for
     this submission? If region + country + grape_variety are all non-null in the submission row,
     skip enrichment (extraction was complete).
  2. `master_wine_library` — does an approved master record exist with wine_name match AND all 3
     fields filled? If yes, skip enrichment (wine already in library with full data).
  Only call Haiku if both checks return "incomplete". Two DB queries per candidate wine.

### Claude's Discretion
- Exact Haiku prompt design (given wine_name + vintage, infer region/country/grape_variety/producer_bio)
- Pydantic response model for enrichment output
- Celery task name convention (follow existing: `"haiku.enrich_wine"` pattern)
- Whether to store enrichment cost per-wine (no requirement, but consistent with Phase 1 pattern)
- asyncio vs sync Haiku call inside Celery task (use `asyncio.run()` matching existing task pattern)
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Celery Infrastructure (Patterns to Follow)
- `services/agent-orchestrator/jobs/celery_app.py` — Celery app config, broker/backend settings,
  task imports convention
- `services/agent-orchestrator/jobs/tasks.py` — Established task patterns: `asyncio.run()` wrapper,
  `@celery_app.task(name="x.y")` naming, exponential backoff via DLQ pattern

### Integration Points
- `services/agent-orchestrator/api/onboarding_routes.py` — Where enrichment trigger gets wired.
  Inspect existing master_wine_library_submissions insert pattern (lines ~120–143) to understand
  where to insert `.delay()` calls
- `services/agent-orchestrator/api/scan_routes.py` — `_queue_enrichment_if_needed()` helper
  (lines 32–72): existing pattern for queueing background work after extraction — replicate shape

### Database Schema
- `supabase/migrations/20260208024921_new-migration.sql` — `master_wine_library` schema (lines 65–95):
  region, country, grape_variety, enrichment_source columns already exist. producer_bio does NOT —
  needs migration
- `supabase/migrations/20260208030000_wine_specific_tables.sql` — `master_wine_library_submissions`
  schema — check what fields Claude Vision populates for the dedup check

### Phase 1 Context (Patterns to Follow)
- `.planning/phases/01-claude-vision-extraction-service/01-CONTEXT.md` — Hard fail philosophy,
  cost tracking pattern, separation of concerns. Phase 4 is background so failure behavior differs,
  but cost transparency applies if we track enrichment cost.

### Requirements
- `.planning/REQUIREMENTS.md` — HAIKU-01 through HAIKU-05 acceptance criteria (authoritative spec)
- `.planning/PROJECT.md` — Key Decisions table, Core Value constraint ($0.50/restaurant target)
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `jobs/celery_app.py` — `celery_app` instance ready for import; new task just needs to import it
- `jobs/tasks.py` — `asyncio.run()` + async helper pattern is the established pattern for all tasks
- `config/settings.py` — `anthropic_api_key` already present (used by Phase 1 extractor)
- `_queue_enrichment_if_needed()` in scan_routes.py — existing pattern for checking conditions
  and queuing a background task with Supabase insert; Haiku task follows a simpler version of this

### Established Patterns
- Task naming: `"resource.action"` (e.g., `"haiku.enrich_wine"`)
- Celery tasks wrap async implementations: `def task(): return asyncio.run(_async_impl())`
- Supabase client: `create_client(settings.supabase_url, settings.supabase_key)` — same as tasks.py
- Anthropic client: `anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)` — from Phase 1

### Integration Points
- `onboarding_routes.py` POST /onboarding/extract handler — after `.execute()` on submissions insert,
  iterate wines and call `haiku_enrich_task.delay(...)` for candidates
- `jobs/celery_app.py` `imports=("jobs.tasks",)` line — needs updating to also import
  `"jobs.haiku_tasks"` (or add new task to existing tasks.py if preferred)
</code_context>

<specifics>
## Specific References

- Haiku model: `claude-haiku-4-5-20251001` (current Haiku 4.5 model ID per environment)
- Celery broker already running (Redis): confirmed by existing `celery_broker_url` in settings
- Retry pattern: match DLQ — `DLQ_BASE_DELAY_SECONDS = 60`, multiplier 2 → 60s / 120s / 240s
- The Celery task should accept: `wine_id` (UUID string), `wine_name` (str), `vintage` (str | None)
- enrichment_source value to store: `"haiku"` (exact string, per HAIKU-05)
- Enrichment writes to `master_wine_library` (not submissions) — confirmed by HAIKU-05
</specifics>

<deferred>
## Deferred Ideas

- Track per-enrichment cost (Haiku tokens → USD) — not required by HAIKU-01–05, but consistent
  with Phase 1's cost tracking philosophy. Could add in a follow-up task.
- Enrichment queue table for visibility (like the existing enrichment_queue) — the Celery task
  approach is sufficient for Phase 4; a dedicated visibility table is a future operations concern.
- Bulk enrichment endpoint (re-enrich all unenriched wines for a restaurant) — out of scope, own phase.
</deferred>

---
*Phase: 04-claude-haiku-enrichment*
*Context gathered: 2026-04-03 via discuss-phase*
