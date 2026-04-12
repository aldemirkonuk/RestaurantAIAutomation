---
phase: 04-claude-haiku-enrichment
plan: "01"
subsystem: api
tags: [anthropic, haiku, enrichment, supabase, celery, async]

# Dependency graph
requires:
  - phase: 01-claude-vision-extraction-service
    provides: master_wine_library_submissions table + claude_api_key in settings
  - phase: 02-gemini-flash-crawler
    provides: master_wine_library table with region/country/grape_variety columns
provides:
  - HaikuEnrichmentService class with enrich(wine_id, wine_name, vintage) method
  - EnrichmentResult dataclass (wine_id, region, country, grape_variety, producer_bio, enrichment_source="haiku")
  - Two-table dedup check against master_wine_library_submissions + master_wine_library
  - DB migration: producer_bio TEXT column on master_wine_library (idempotent, IF NOT EXISTS)
  - 5 unit tests with mocked Anthropic + Supabase (no live API calls)
affects:
  - 04-02: Celery task wrapping this service
  - 04-03: onboarding_routes.py enrichment trigger

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AsyncAnthropic client via _get_anthropic() factory method — consistent with Phase 1 pattern"
    - "Two-table dedup guard before any API call — check submissions then master library"
    - "ValueError on malformed JSON — lets Celery retry (D-04 pattern)"
    - "dataclass with default field for enrichment_source='haiku'"

key-files:
  created:
    - services/agent-orchestrator/services/haiku_enrichment_service.py
    - services/agent-orchestrator/tests/test_haiku_enrichment_service.py
    - supabase/migrations/20260403000000_add_producer_bio.sql
  modified: []

key-decisions:
  - "HaikuEnrichmentService._get_anthropic() and _get_supabase() as factory methods — makes them patchable in tests without module-level mocking"
  - "Dedup skips if EITHER table has all 3 fields — submissions first (cheaper lookup), then master library (ilike match)"
  - "ValueError raised on non-JSON Haiku response — caller (Celery task in Plan 02) handles retry logic per D-04"
  - "markdown code fence stripping handles ```json prefix in Haiku responses"

patterns-established:
  - "Service tests use patch.object on factory methods (_get_anthropic, _get_supabase) for isolation"
  - "AsyncMock for async Anthropic client; MagicMock for response.content[0].text"

requirements-completed: [HAIKU-01, HAIKU-02, HAIKU-04, HAIKU-05]

# Metrics
duration: 15min
completed: 2026-04-03
---

# Phase 4 Plan 01: HaikuEnrichmentService — Core Extraction Brain Summary

**AsyncAnthropic-based wine enrichment service with two-table dedup check, returning region/country/grape_variety/producer_bio via claude-haiku-4-5-20251001**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-03T23:30:00Z
- **Completed:** 2026-04-03T23:46:48Z
- **Tasks:** 2 (Task 1 TDD: 3 commits; Task 2: 1 commit)
- **Files modified:** 3

## Accomplishments

- HaikuEnrichmentService.enrich() with D-05 two-table dedup: checks master_wine_library_submissions then master_wine_library before calling Haiku
- EnrichmentResult dataclass with 5 fields including producer_bio and enrichment_source="haiku"
- 5 unit tests pass with fully mocked Anthropic + Supabase (no live API calls required)
- DB migration adds producer_bio TEXT column to master_wine_library (idempotent, IF NOT EXISTS)

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Failing tests for HaikuEnrichmentService** - `b87cdb8` (test)
2. **Task 1 (GREEN): HaikuEnrichmentService implementation** - `735ec59` (feat)
3. **Task 2: DB migration — add producer_bio to master_wine_library** - `f697b38` (chore)

_TDD task has RED + GREEN commits. No refactor needed._

## Files Created/Modified

- `services/agent-orchestrator/services/haiku_enrichment_service.py` — HaikuEnrichmentService class + EnrichmentResult dataclass; model=claude-haiku-4-5-20251001; two-table dedup; ValueError on malformed JSON
- `services/agent-orchestrator/tests/test_haiku_enrichment_service.py` — 5 unit tests (HAIKU-01 through HAIKU-05); fully mocked, no live calls
- `supabase/migrations/20260403000000_add_producer_bio.sql` — idempotent ALTER TABLE with COMMENT

## Decisions Made

- `_get_anthropic()` and `_get_supabase()` as factory methods (not module-level singletons) — makes both patchable in tests without complex module mock setup
- Dedup checks submissions table first (exact ID match, cheaper) then master library (ilike name match, broader)
- ValueError on malformed JSON response ensures Celery retry works correctly per D-04
- Markdown code fence stripping (`\`\`\`json`) handles common Haiku formatting before JSON parse

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required. Service reads `CLAUDE_API_KEY` and Supabase credentials from existing settings.

## Next Phase Readiness

- HaikuEnrichmentService is fully testable and ready for Plan 02 (Celery task wrapper)
- Plan 02 will wrap `service.enrich()` with `asyncio.run()` + exponential backoff retry
- DB migration (`20260403000000_add_producer_bio.sql`) must be applied to Supabase before Plan 03 wires the trigger

---
*Phase: 04-claude-haiku-enrichment*
*Completed: 2026-04-03*
