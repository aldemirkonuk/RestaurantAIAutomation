---
phase: 12-extensive-research-agent
plan: "03"
subsystem: research-agent
tags: [api, fastapi, research, metrics, conflicts, celery-dispatch]
dependency_graph:
  requires:
    - "Phase 12 Plan 01: research_agent_helpers.py, DB migrations (research_runs, research_run_stats, evidence_citations)"
    - "Phase 12 Plan 02: research_agent_task Celery task in jobs/research_tasks.py"
    - "Phase 05 Plan 02: quality_routes.py pattern (APIRouter, _get_supabase, Pydantic models)"
  provides:
    - "GET /api/v1/research/metrics: all 5 metric categories in single JSON response"
    - "GET /api/v1/research/runs: paginated run history with per-run summary stats"
    - "GET /api/v1/research/conflicts: wines with unresolved conflict_candidates entries"
    - "POST /api/v1/research/trigger: dispatch research_agent_task.delay() for eligible records"
    - "research_router mounted in main.py at /api/v1/research"
  affects:
    - "services/agent-orchestrator/main.py (research_router registered)"
    - "Phase 12 observability: metrics endpoint makes research agent output visible"
tech_stack:
  added:
    - "services/agent-orchestrator/api/research_routes.py (new, 526 lines)"
  patterns:
    - "Python-side aggregation for metrics (no window functions via Supabase REST API)"
    - "Empty-table safe: all metrics return zeros when no runs exist"
    - "Fail-open DB queries: individual table failures log errors but don't cascade"
    - "_safe_div() + _percentile_50() pure helpers for metric computation"
key_files:
  created:
    - "services/agent-orchestrator/api/research_routes.py"
  modified:
    - "services/agent-orchestrator/main.py"
decisions:
  - "Wrote all 4 endpoints in single file pass (optimization over strict 2-task split) — Task 2 then only modified main.py"
  - "Python-side aggregation chosen over RPC (no pre-created research_metrics_snapshot RPC function)"
  - "batch_size Field(le=100) enforces T-12-10 at Pydantic layer — no runtime check needed"
  - "T-12-11: 429 guard checks research_runs.status='running' count before any dispatch"
  - "Conflicts endpoint pulls wine_name/vintage from field_confidence JSONB rather than joining payload"
metrics:
  duration_minutes: 2
  completed_date: "2026-04-06"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 1
---

# Phase 12 Plan 03: Research API — 4 Endpoints

**One-liner:** 4 FastAPI endpoints exposing all Phase 12 research metrics, paginated run history, conflict queue, and manual trigger — with T-12-10/T-12-11 threat mitigations and empty-table safe Python aggregations.

---

## What Was Built

### Task 1: `api/research_routes.py` — all 4 endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/research/metrics` | GET | All 5 metric categories: gap_closure, quality, evidence_hygiene, throughput_cost, safety |
| `/api/v1/research/runs` | GET | Paginated run history (limit/offset, ordered by started_at DESC) |
| `/api/v1/research/conflicts` | GET | Wines with non-null, non-empty conflict_candidates JSONB |
| `/api/v1/research/trigger` | POST | Dispatch research_agent_task.delay() for one or a batch of eligible records |

**Metrics endpoint — 5 categories:**

| Category | Metrics |
|----------|---------|
| gap_closure | null_rate_before/after (AVG), fields_filled_p50, time_to_fill_p50_hours |
| quality | promotion_rate, human_override_rate, conflict_rate, source_tier_mix (A/B/C %) |
| evidence_hygiene | citation_completeness, independent_corroboration_rate, fetch_verify_pass_rate |
| throughput_cost | records_processed_per_day, cost_per_filled_field, attempts_per_filled_field |
| safety | pii_policy_flags (SUM), regression_rate (always 0.0) |

Queries: 4 separate Supabase table reads (research_run_stats, evidence_citations, research_runs, field_corrections). All Python-side aggregation.

**Trigger endpoint — two dispatch modes:**
1. `submission_id` provided → single `research_agent_task.delay(submission_id)` call
2. No `submission_id` → query up to `batch_size` eligible records (`last_research_run_at IS NULL` first, then stale past 7-day cooldown) → dispatch each

### Task 2: `main.py` — router registration

```python
from api.research_routes import research_router
app.include_router(research_router)
```

Mounted at `/api/v1/research` (prefix set in `research_routes.py`).

---

## Verification Results

```
python3 -c "import ast; ast.parse(open('services/agent-orchestrator/api/research_routes.py').read()); print('SYNTAX OK')"
→ SYNTAX OK

python3 -c "import ast; ast.parse(open('services/agent-orchestrator/main.py').read()); print('main OK')"
→ main OK

python3 -c "from api.research_routes import research_router; print('Import OK:', research_router.prefix)"
→ Import OK: /api/v1/research

Routes: ['/api/v1/research/metrics', '/api/v1/research/runs', '/api/v1/research/conflicts', '/api/v1/research/trigger']

ResearchMetricsResponse fields: ['gap_closure', 'quality', 'evidence_hygiene', 'throughput_cost', 'safety', 'computed_at']
Missing metric fields: NONE

grep "research_router" services/agent-orchestrator/main.py
→ from api.research_routes import research_router
→ app.include_router(research_router)
```

All plan verification criteria pass.

---

## Deviations from Plan

### Optimization (Minor)

**1. [Optimization] Wrote all 4 endpoints in single file pass**
- **Found during:** Task 1 implementation
- **Rationale:** The full endpoint set (metrics + runs + conflicts + trigger) is a cohesive module; splitting into two file writes would require re-opening the same file. All task verification criteria are met.
- **Impact:** Task 2 only required modifying main.py (no second edit to research_routes.py). This is a minor execution efficiency, not a behavior change.
- **Files affected:** `services/agent-orchestrator/api/research_routes.py`

---

## Known Stubs

None. All 4 endpoints query live Supabase tables. Empty tables return zero/empty responses (not stubs — correct behavior for a freshly deployed system with no runs yet).

---

## Threat Surface Scan

| Flag | File | Description |
|------|------|-------------|
| threat_flag: Elevation | `research_routes.py::trigger_research` | T-12-10 mitigated: `batch_size = Field(le=100)` Pydantic constraint |
| threat_flag: DoS | `research_routes.py::trigger_research` | T-12-11 mitigated: 429 returned if `research_runs.status='running'` count > 0 |
| threat_flag: Info Disclosure | `research_routes.py::get_research_conflicts` | T-12-12 accepted: snippets are wine data, not PII; conflicts endpoint is admin-facing |

All 3 threats are in the plan's threat model — no new unmodeled surfaces.

---

## Commits

| Task | Commit | Message |
|------|--------|---------|
| Task 1: research_routes.py | `f74c0b5` | feat(12-03): create research_routes.py with all 4 research API endpoints |
| Task 2: main.py registration | `360a696` | feat(12-03): register research_router in main.py at /api/v1/research |

---

## Self-Check: PASSED

- [x] `services/agent-orchestrator/api/research_routes.py` — exists (526 lines)
- [x] `services/agent-orchestrator/main.py` — contains `research_router` import + `include_router`
- [x] Commit `f74c0b5` — exists
- [x] Commit `360a696` — exists
- [x] All 4 routes present: `/metrics`, `/runs`, `/conflicts`, `/trigger`
- [x] `ResearchMetricsResponse` has all 5 required keys
- [x] `research_router` import from `services/agent-orchestrator/` succeeds
- [x] Both files pass `python3 ast.parse` syntax check
