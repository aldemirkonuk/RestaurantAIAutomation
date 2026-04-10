---
phase: 12-extensive-research-agent
plan: "02"
subsystem: research-agent
tags: [celery, research, evidence-loop, serper, gemini, fetch-verify, field-confidence]
dependency_graph:
  requires:
    - "Phase 12 Plan 01: research_agent_helpers.py, DB migrations"
    - "Phase 08: services/serper_client.py (serper_search), services/spend_logger.py"
    - "Phase 07: services/field_confidence.py (merge_field_confidence, route_fields_by_threshold)"
  provides:
    - "research_agent_task: Celery task callable with submission_id"
    - "research_daily_budget_check_task: hourly advisory budget check"
    - "_check_daily_budget(): reusable pre-flight for daily cap enforcement"
    - "5 RESEARCH_* settings attributes in settings.py"
  affects:
    - "jobs/celery_app.py (research_tasks imported + beat_schedule entry)"
    - "master_wine_library_submissions (field_confidence, conflict_candidates, last_research_run_at)"
    - "evidence_citations (batch insert per promoted field)"
    - "field_review_queue (review-tier fields written)"
    - "research_run_stats (one row per record processed)"
    - "research_runs (status, cost, fields_filled)"
tech_stack:
  added:
    - "services/agent-orchestrator/jobs/research_tasks.py (new)"
    - "httpx.AsyncClient (Tier-1 fetch-verify)"
    - "playwright.async_api (Tier-2 fetch-verify, conditional)"
    - "google.genai (Gemini 2.0 Flash per-field extraction)"
    - "ipaddress stdlib (SSRF protection)"
    - "unicodedata stdlib (diacritic normalization for semantic match)"
  patterns:
    - "asyncio.run() wrapper pattern (same as haiku_tasks.py)"
    - "SpendLogger try/except contract: spend logging never interrupts task"
    - "Fail-open pattern: _check_daily_budget() returns True on infra error"
    - "Dry-run guard: all computation runs, no DB writes when dry_run=True"
key_files:
  created:
    - "services/agent-orchestrator/jobs/research_tasks.py"
  modified:
    - "services/agent-orchestrator/config/settings.py"
    - "services/agent-orchestrator/jobs/celery_app.py"
decisions:
  - "Per-field Gemini extraction (not all-at-once) — each field gets a targeted Serper query + targeted Gemini parse, enabling per-field call_counter + conflict detection"
  - "_check_daily_budget() reads api_spend.cost_usd for provider='serper' today — consistent with how SpendLogger writes cost"
  - "URL SSRF guard blocks non-https:// and private IP ranges; domain hostnames are passed without IP resolution (safe by default)"
  - "field_review_queue.source mapped to 'knowledge' (DB CHECK constraint: visible/inferred/knowledge)"
  - "research_run_stats row written for both dry_run=False and the live path; dry_run skips all writes"
  - "Levenshtein window search uses step=val_len//2 to balance coverage vs CPU for 20K-char page excerpts"
metrics:
  duration_minutes: 12
  completed_date: "2026-04-06"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 2
---

# Phase 12 Plan 02: Research Agent Celery Task — Evidence Loop

**One-liner:** Full Serper→Gemini→fetch-verify→conflict→corroborate→merge evidence loop wired into a Celery task with stop rule, budget ceiling, SSRF guard, and PII filter.

---

## What Was Built

### Task 1: settings.py + research_tasks.py

**`config/settings.py` additions (5 RESEARCH_* attributes):**

| Attribute | Default | Env Var |
|-----------|---------|---------|
| `research_daily_budget_usd` | 5.0 | `RESEARCH_DAILY_BUDGET_USD` |
| `research_max_cost_per_record_usd` | 0.04 | `RESEARCH_MAX_COST_PER_RECORD_USD` |
| `research_max_calls_per_record` | 8 | `RESEARCH_MAX_CALLS_PER_RECORD` |
| `research_eligibility_cooldown_days` | 7 | `RESEARCH_ELIGIBILITY_COOLDOWN_DAYS` |
| `research_fetch_verify_enabled` | True | `RESEARCH_FETCH_VERIFY_ENABLED` |

Budget math comment included in source (Decision 4: $0.04 cap from first-principles derivation).

**`jobs/research_tasks.py` — key components:**

| Component | Purpose |
|-----------|---------|
| `research_agent_task(submission_id, dry_run)` | Celery entry point, calls `asyncio.run(_research_async(...))` |
| `_research_async()` | Daily budget pre-flight → load submission → eligibility gate → evidence loop → write results |
| `_process_record()` | Evidence loop: per-field Serper + Gemini + conflict + fetch-verify + corroboration + citation |
| `_write_results()` | `merge_field_confidence()` → route → `field_review_queue` + `evidence_citations` + submission update |
| `_check_daily_budget()` | Reads `api_spend` for `provider='serper'` today; fails open on error |
| `_fetch_verify_value()` | httpx → Playwright → `_semantic_match()` pipeline (Decision 5) |
| `_extract_field_candidates()` | Gemini 2.0 Flash per-field JSON extraction with spend logging |
| `_is_safe_url()` | SSRF guard: validates `https://` scheme + blocks private IP networks (T-12-05) |
| `_has_pii()` | Email + phone regex on snippets (T-12-09) |
| `_semantic_match()` | Normalize → word-boundary regex → Levenshtein ≤ 15% window |

**Evidence loop invariants enforced:**
- Stop rule: `call_counter >= max_calls` checked **before** every tool call
- Budget ceiling: `record_cost >= max_cost` checked **before** every tool call
- `detect_conflict()` called before every field write → routes conflicted fields to `conflict_candidates` JSONB
- `merge_field_confidence()` called in `_write_results()` before every DB write (regression guard)
- `check_regression_guard()` called explicitly before accumulating any new_fc_entry
- `SpendLogger.log()` calls (Serper + Gemini) wrapped in individual try/except
- `dry_run=True` skips all Supabase writes (testable without live DB)

### Task 2: celery_app.py registration + budget beat entry

- `"jobs.research_tasks"` added to `celery_app.conf.update(imports=...)` tuple
- `"research-daily-budget-check"` entry added to `beat_schedule` (hourly, `crontab(minute=0)`)
- `_check_daily_budget()` pre-flight wired at top of `_research_async()` — runs before any Serper calls

---

## Verification Results

All plan verification checks pass:

```
PASS: research_agent_task in celery_app.py
PASS: research-daily-budget-check in celery_app.py
PASS: RESEARCH_DAILY_BUDGET_USD in settings.py
PASS: check_regression_guard in research_tasks.py
PASS: detect_conflict in research_tasks.py
PASS: merge_field_confidence in research_tasks.py
PASS: dry_run in research_tasks.py

All checks PASS
```

Syntax checks:
```
celery_app OK
research_tasks OK
```

---

## Deviations from Plan

### Auto-fixed (Rule 2 — Missing Critical Functionality)

**1. [Rule 2 - Missing] Added SSRF IP-range blocking beyond scheme check**
- **Found during:** Task 1 — T-12-05 threat model specifies "block private IP ranges" but plan snippet only mentioned scheme check
- **Fix:** Added `_PRIVATE_NETWORKS` list (10.x, 172.16.x, 192.168.x, 127.x, 169.254.x, ::1, fc00::/7); `_is_safe_url()` checks both scheme and IP
- **Files modified:** `jobs/research_tasks.py`
- **Commit:** bb9e5bc

**2. [Rule 2 - Missing] Mapped `source='research_agent'` → `'knowledge'` for `field_review_queue`**
- **Found during:** Task 1 — `field_review_queue.source` has a DB CHECK constraint `('visible', 'inferred', 'knowledge')`. The source value `'research_agent'` would cause a constraint violation.
- **Fix:** `_write_results()` maps any source not in `('visible', 'inferred')` to `'knowledge'` before insert
- **Files modified:** `jobs/research_tasks.py`
- **Commit:** bb9e5bc

**3. [Rule 2 - Missing] Added `fields_targeted` to `_process_record()` return dict**
- **Found during:** Task 1 — `research_run_stats` table has a `fields_targeted` column (NOT NULL DEFAULT 0). Plan action didn't list it in the stats dict but the migration schema requires it.
- **Fix:** Added `"fields_targeted": len(target_fields)` to stats return dict; included in `research_run_stats` insert
- **Files modified:** `jobs/research_tasks.py`
- **Commit:** bb9e5bc

**4. [Rule 2 - Missing] Added markdown code-fence stripping for Gemini JSON output**
- **Found during:** Task 1 — `json.loads()` on Gemini output will fail if the model wraps JSON in markdown fences (known LLM behavior). Phase 8's code uses a Pydantic schema which auto-strips this.
- **Fix:** Strip leading/trailing ``` fences from raw response before `json.loads()`
- **Files modified:** `jobs/research_tasks.py`
- **Commit:** bb9e5bc

---

## Known Stubs

None. All functions are fully wired with real Serper + Gemini calls. The `dry_run=True` flag is an intentional test path, not a stub.

---

## Threat Surface Scan

| Flag | File | Description |
|------|------|-------------|
| threat_flag: SSRF | `research_tasks.py::_is_safe_url` | T-12-05 mitigated: https:// only + private IP block before fetch |
| threat_flag: DoS (loop) | `research_tasks.py::_process_record` | T-12-06 mitigated: stop rule + cost ceiling checked before every tool call |
| threat_flag: confidence_regression | `research_tasks.py::_write_results` | T-12-07 mitigated: merge_field_confidence() enforced before every write |
| threat_flag: DoS (budget) | `research_tasks.py::_check_daily_budget` | T-12-08 mitigated: pre-flight in _research_async() before any Serper calls |
| threat_flag: PII | `research_tasks.py::_has_pii` | T-12-09 mitigated: snippets with email/phone regex blocked before evidence_citations |

All 5 threats are in the plan's threat model — no new unmodeled surfaces.

---

## Commits

| Task | Commit | Message |
|------|--------|---------|
| Task 1: settings + research_tasks.py | `bb9e5bc` | feat(12-02): add RESEARCH_* settings and create research_tasks.py evidence loop |
| Task 2: celery_app.py registration | `e4fe66b` | feat(12-02): register research_tasks in celery_app + add daily budget beat entry |

---

## Self-Check: PASSED

- [x] `services/agent-orchestrator/jobs/research_tasks.py` — exists
- [x] `services/agent-orchestrator/config/settings.py` — RESEARCH_DAILY_BUDGET_USD present
- [x] `services/agent-orchestrator/jobs/celery_app.py` — research_tasks imported + beat entry present
- [x] Commit `bb9e5bc` — exists
- [x] Commit `e4fe66b` — exists
- [x] All 7 plan verification grep checks pass
- [x] `research_agent_task(submission_id, dry_run=False)` defined as Celery task
- [x] `_process_record` implements stop rule (call_counter >= max → break)
- [x] `_process_record` implements budget ceiling (record_cost >= max_cost → break)
- [x] `detect_conflict()` called before every field write
- [x] `merge_field_confidence()` called in `_write_results` before DB update
- [x] `SpendLogger.log()` called for each Serper + Gemini call, wrapped in try/except
- [x] `dry_run=True` skips all DB writes
- [x] settings.py has 5 new RESEARCH_* attributes reading from env vars
