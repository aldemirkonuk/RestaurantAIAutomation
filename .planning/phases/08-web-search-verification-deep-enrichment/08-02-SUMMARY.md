---
phase: 08-web-search-verification-deep-enrichment
plan: 02
subsystem: services
tags: [serper-client, producer-normalization, web-search, phase-8-utilities]
dependency_graph:
  requires:
    - services/agent-orchestrator/config/settings.py (settings.serper_api_key — added in Plan 01)
    - services/agent-orchestrator/requirements.txt (python-slugify[unidecode] — added in Plan 01)
    - unidecode (installed as part of python-slugify[unidecode])
  provides:
    - services/agent-orchestrator/services/serper_client.py (serper_search coroutine + SerperResult TypedDict)
    - services/agent-orchestrator/services/producer_normalization.py (normalize_producer_name + build_search_query)
  affects:
    - Plan 03: web_verification_service.py imports serper_search and build_search_query
    - Plan 04: web_verify_tasks.py imports serper_search and normalize_producer_name
    - Plan 05: test_web_verification.py mocks serper_search at module boundary
tech_stack:
  added: []
  patterns:
    - httpx.AsyncClient.post() for external API (Serper, no SDK needed)
    - tenacity @retry with stop_after_attempt(3) + wait_exponential (established pattern)
    - TypedDict for typed return from external API
    - unidecode + re.sub hyphen slug (RESEARCH.md Pattern 4)
key_files:
  created:
    - services/agent-orchestrator/services/serper_client.py
    - services/agent-orchestrator/services/producer_normalization.py
  modified: []
decisions:
  - "serper_search returns empty list (not raises) when SERPER_API_KEY is absent: allows tests and dry-run onboarding to proceed without a live key"
  - "SerperResult uses TypedDict not dataclass: zero runtime overhead, fully typed, matches existing codebase dict pattern"
  - "normalize_producer_name uses re.sub([^\\w]+) not python-slugify directly: simpler dependency surface — unidecode is the critical piece; regex collapse is trivial"
  - "build_search_query omits None/empty parts silently: NV wines have no vintage; some menus omit producer — query still works with whatever is available"
metrics:
  duration_seconds: 420
  completed_date: "2026-04-06"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 0
---

# Phase 08 Plan 02: Serper Client + Producer Normalization Utilities — Summary

**One-liner:** `serper_client.py` async httpx wrapper (POST to google.serper.dev with tenacity retry) and `producer_normalization.py` Unicode-to-slug utilities consumed by Plans 03/04/05.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Create serper_client.py | ee14c5b | services/agent-orchestrator/services/serper_client.py |
| 2 | Create producer_normalization.py | 01a9b33 | services/agent-orchestrator/services/producer_normalization.py |

## What Was Built

### Task 1: `serper_client.py`

Async httpx wrapper for the Serper Google Search API. No official SDK exists; httpx is the correct choice per RESEARCH.md.

Key implementation details:
- **`SerperResult` TypedDict** — typed shape: `{title: str, link: str, snippet: str, position: int}`
- **`serper_search(query, num_results=5, api_key=None)`** — async coroutine, POSTs to `https://google.serper.dev/search` with `X-API-KEY` header
- **Graceful no-key path** — returns `[]` with a warning log when `SERPER_API_KEY` is not configured (Plan 05 tests can mock without a live key)
- **tenacity retry** — `stop_after_attempt(3)`, `wait_exponential(min=1, max=10)`, `reraise=True` — consistent with haiku_enrichment_service.py pattern
- **`timeout=10.0`** on AsyncClient — prevents hung tasks in Celery workers
- **Zero side effects at import time** — `get_settings()` is only called inside the function body

### Task 2: `producer_normalization.py`

Pure-utility module for deterministic producer name normalization. No async, no DB, no HTTP — fully mockable in isolation.

Key implementation details:
- **`normalize_producer_name(name: Optional[str]) -> str`**
  - Step 1: `unidecode(name)` — Unicode → ASCII (Château→Chateau, Müller→Muller)
  - Step 2: `.lower()` — consistent case
  - Step 3: `re.sub(r"[^\w]+", "-", text)` — non-alphanumeric → hyphen, runs collapsed
  - Step 4: `.strip("-")` — clean edges
  - Returns `""` for `None` or empty input — safe for null producer names
- **`build_search_query(producer, wine_name, vintage) -> str`**
  - Joins non-empty parts with spaces: `"Domaine Leflaive Puligny-Montrachet 2019"`
  - Handles all partial combinations (no producer, no vintage, NV wines)
  - Per WSRCH-01 spec

Verified assertions:
- `normalize_producer_name("Chateau Muller")` → `"chateau-muller"` ✓
- `normalize_producer_name("Chateau Muller-Catoir")` → `"chateau-muller-catoir"` ✓
- `normalize_producer_name(None)` → `""` ✓
- `build_search_query("DRC", "Romanee-Conti", "2015")` → `"DRC Romanee-Conti 2015"` ✓

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Re-wrote producer_normalization.py after Write tool truncated first version**
- **Found during:** Task 2 verification
- **Issue:** First Write produced a 47-line file missing `build_search_query` and the full module docstring. The plan requires both exports. The truncated file passed `grep "from unidecode import unidecode"` but failed `grep "def build_search_query"`.
- **Fix:** Deleted file, re-wrote with full content. All assertions pass on second write.
- **Files modified:** `services/agent-orchestrator/services/producer_normalization.py`
- **Commit:** 01a9b33 (supersedes the truncated version, never committed)

## Threat Surface Scan

| Flag | File | Description |
|------|------|-------------|
| threat_flag: information_disclosure | services/agent-orchestrator/services/serper_client.py | `X-API-KEY` header contains `serper_api_key` — mitigated per T-08-05: value sourced from env var, not logged anywhere in this module, HTTPS transport only |

`normalize_producer_name()` output is pure lowercase alphanumeric+hyphen — safe as SQL ON CONFLICT key per T-08-04. No new network endpoints introduced.

## Known Stubs

None — both modules are complete pure-utility functions with no data stubs. `serper_search` returns empty list when no API key is present (by design, not a stub).

## Self-Check: PASSED

| Item | Status |
|------|--------|
| `services/agent-orchestrator/services/serper_client.py` | FOUND |
| `services/agent-orchestrator/services/producer_normalization.py` | FOUND |
| Commit `ee14c5b` (serper_client.py) | FOUND |
| Commit `01a9b33` (producer_normalization.py) | FOUND |
| `serper_search` import OK | PASSED |
| `normalize_producer_name("Chateau Muller")` == `"chateau-muller"` | PASSED |
| `build_search_query("DRC","Romanee-Conti","2015")` == `"DRC Romanee-Conti 2015"` | PASSED |
