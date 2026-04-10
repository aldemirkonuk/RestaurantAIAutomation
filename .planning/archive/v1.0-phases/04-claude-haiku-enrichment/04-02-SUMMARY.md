---
plan: 04-02
phase: 04-claude-haiku-enrichment
status: complete
completed: 2026-04-04
---

# Plan 04-02 Summary: Celery Task + Route Wiring

## What Was Built

- `services/agent-orchestrator/jobs/haiku_tasks.py` — `haiku_enrich_task` registered as `"haiku.enrich_wine"` with `max_retries=3`, `autoretry_for=(Exception,)`, exponential countdown 60/120/240s (D-04). Calls `HaikuEnrichmentService.enrich()` via `asyncio.run()`, persists results to `master_wine_library` with `enrichment_source="haiku"` and `ai_enriched=True` (HAIKU-05).
- `services/agent-orchestrator/jobs/celery_app.py` — `imports` tuple updated to `("jobs.tasks", "jobs.haiku_tasks")` so worker picks up `haiku_enrich_task` on startup.
- `services/agent-orchestrator/api/onboarding_routes.py` — Added `_needs_enrichment()` helper and wired `haiku_enrich_task.delay()` after Supabase insert. Enrichment queued only for wines missing region/country/grape_variety (HAIKU-01). Response returned before tasks queue (non-blocking, HAIKU-03).

## Key Decisions

- D-01 honored: trigger in route handler, extractor untouched
- D-04 honored: 60/120/240s countdown, silent termination after exhaustion
- Retry path (UUID error fallback) skips enrichment queuing — edge case, primary path sufficient

## Commits

- `17fcd86` feat(04-02): add haiku_enrich_task Celery task and update celery_app imports
- `52822e7` feat(04-02): wire haiku_enrich_task.delay() into onboarding_routes POST /extract

## key-files.created

- services/agent-orchestrator/jobs/haiku_tasks.py
- services/agent-orchestrator/api/onboarding_routes.py (modified)
- services/agent-orchestrator/jobs/celery_app.py (modified)
