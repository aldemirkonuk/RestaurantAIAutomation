---
phase: 01-claude-vision-extraction-service
plan: 02
subsystem: api-layer
tags: [fastapi, endpoint, supabase, pydantic, tdd]
requires:
  - 01-01-SUMMARY.md (ClaudeVisionExtractor core engine)
provides:
  - POST /api/v1/onboarding/extract endpoint
  - Supabase bulk-insert persistence for extracted wines
affects:
  - services/agent-orchestrator/api/onboarding_routes.py
  - services/agent-orchestrator/main.py
tech-stack:
  added:
    - fastapi (app + APIRouter)
    - httpx.ASGITransport (test client for starlette 0.35 / httpx 0.28)
  patterns:
    - TDD (RED/GREEN) with async pytest + httpx.ASGITransport
    - Lazy Supabase singleton via Settings class
    - UUID fallback for submitted_by column type ambiguity (migration 013 vs 015)
key-files:
  created:
    - services/agent-orchestrator/api/__init__.py
    - services/agent-orchestrator/api/onboarding_routes.py
    - services/agent-orchestrator/config/__init__.py
    - services/agent-orchestrator/config/settings.py
    - services/agent-orchestrator/main.py
    - services/agent-orchestrator/services/__init__.py
    - services/agent-orchestrator/tests/test_onboarding_extract_endpoint.py
  modified: []
decisions:
  - httpx.ASGITransport used instead of starlette TestClient (starlette 0.35 + httpx 0.28 incompatible via keyword arg)
  - get_supabase_client() wraps settings import in try/except (no settings available in test env)
  - config/settings.py created as minimal lazy-init settings module (not in original plan)
metrics:
  duration: "247 seconds"
  completed: "2026-04-01"
  tasks_completed: 1
  files_created: 7
requirements:
  - CLVS-05
  - CLVS-06
---

# Phase 01 Plan 02: API Endpoint + Supabase Persistence Summary

**One-liner:** POST /api/v1/onboarding/extract wired to ClaudeVisionExtractor with Supabase bulk-insert, signature hashing, and HTTP 207/422/503 status codes.

## Objective

Wire the ClaudeVisionExtractor (built in Plan 01) into the FastAPI layer with a POST endpoint, input validation, and Supabase persistence of extracted wines.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | MenuScanRequest model + POST /extract endpoint (TDD) | `06c7f51` | api/onboarding_routes.py, main.py, config/settings.py, test_onboarding_extract_endpoint.py |

## What Was Built

### POST /api/v1/onboarding/extract

- Accepts `restaurant_id` + `images[]` (base64, one per page)
- Validates: missing restaurant_id → 422, pdf_base64 → 422, empty images → 422
- Calls `get_claude_vision_extractor().extract_menu(request.images)` (async)
- On `RuntimeError` (all pages fail) → 503
- On partial failure (page_errors + wines) → 207
- On success (all pages) → 200
- Response body: `{scan_session_id, total_wines, total_cost_usd, wines[], pages_processed, needs_review_count, page_errors[]}`

### Supabase Persistence

Each extracted wine is inserted into `master_wine_library_submissions` with:
- `restaurant_id` from request
- `submitted_by`: "claude_vision" (with fallback to None on UUID column type error)
- `payload`: wine fields + scan_session_id + extraction_source + cost + completeness_score + needs_review
- `signature_hash`: SHA-256 of `wine_name-producer-vintage` (lowercase)
- `status`: "pending_review"

### Supporting Files

- `main.py`: FastAPI app with `onboarding_router` registered + `/health` endpoint
- `config/settings.py`: Lazy Settings class with Supabase client init from env vars
- `services/__init__.py`: Package init for clean imports

## Test Results

```
16/16 tests pass (10 extractor + 6 endpoint)

tests/test_claude_vision_extractor.py::test_completeness_all_fields PASSED
tests/test_claude_vision_extractor.py::test_completeness_half_fields PASSED
tests/test_claude_vision_extractor.py::test_completeness_empty_wine PASSED
tests/test_claude_vision_extractor.py::test_needs_review_threshold_strict_less_than PASSED
tests/test_claude_vision_extractor.py::test_parse_raw_json PASSED
tests/test_claude_vision_extractor.py::test_parse_json_fence PASSED
tests/test_claude_vision_extractor.py::test_parse_garbage PASSED
tests/test_claude_vision_extractor.py::test_extract_menu_returns_extraction_result PASSED
tests/test_claude_vision_extractor.py::test_extract_menu_fires_one_call_per_page PASSED
tests/test_claude_vision_extractor.py::test_cost_formula_per_page PASSED
tests/test_onboarding_extract_endpoint.py::test_extract_missing_restaurant_id PASSED
tests/test_onboarding_extract_endpoint.py::test_extract_pdf_base64_rejected PASSED
tests/test_onboarding_extract_endpoint.py::test_extract_empty_images_rejected PASSED
tests/test_onboarding_extract_endpoint.py::test_extract_success_200 PASSED
tests/test_onboarding_extract_endpoint.py::test_extract_partial_failure_207 PASSED
tests/test_onboarding_extract_endpoint.py::test_extract_all_pages_fail_503 PASSED
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] starlette 0.35 + httpx 0.28 TestClient incompatibility**
- **Found during:** Task 1 (TDD GREEN step)
- **Issue:** `starlette.testclient.TestClient` passes `app=` keyword to `httpx.Client.__init__()`, which no longer accepts it in httpx 0.28
- **Fix:** Replaced all `TestClient(main.app)` with `httpx.AsyncClient(transport=httpx.ASGITransport(app=app), ...)` pattern; converted tests to `async def` with `@pytest.mark.asyncio`
- **Files modified:** `tests/test_onboarding_extract_endpoint.py`
- **Commit:** `06c7f51`

**2. [Rule 2 - Missing critical] config/settings.py not in original plan**
- **Found during:** Task 1 (implementing `get_supabase_client()`)
- **Issue:** `get_supabase_client()` needed to import from `config.settings` but no settings module existed
- **Fix:** Created minimal `config/settings.py` with lazy Supabase client init from env vars; `get_supabase_client()` wraps import in try/except to return None in test environments
- **Files created:** `config/__init__.py`, `config/settings.py`
- **Commit:** `06c7f51`

**3. [Rule 2 - Missing critical] services/__init__.py missing**
- **Found during:** Task 1 (imports)
- **Issue:** `services/` directory had no `__init__.py`, causing import errors for `from services.claude_vision_extractor import ...`
- **Fix:** Created `services/__init__.py`
- **Files created:** `services/__init__.py`
- **Commit:** `06c7f51`

## Supabase submitted_by Column Note

The plan documents migration 013 vs 015 ambiguity (TEXT vs UUID column type for `submitted_by`). The implementation handles this gracefully:
1. First attempts insert with `submitted_by="claude_vision"` (TEXT)
2. On "invalid input syntax for type uuid" error: retries with `submitted_by=None`
3. All other errors are logged as warnings and execution continues

## Known Stubs

None. All wiring is complete — ClaudeVisionExtractor is called, results are returned, and Supabase inserts are attempted (skipped if client is None in test/dev env).

## Self-Check: PASSED

Files exist:
- FOUND: services/agent-orchestrator/api/onboarding_routes.py
- FOUND: services/agent-orchestrator/main.py
- FOUND: services/agent-orchestrator/config/settings.py
- FOUND: services/agent-orchestrator/tests/test_onboarding_extract_endpoint.py

Commits exist:
- FOUND: 06c7f51 (feat(01-claude-vision-extraction-service-02): add MenuScanRequest + POST /extract endpoint)

Test results: 16/16 passed
