---
phase: 09-wine-ontology-taxonomy-cross-validation
plan: "04"
subsystem: celery-task-pipeline
tags: [ontology, celery, redis-dedup, pipeline-wiring]
dependency_graph:
  requires: ["09-03"]
  provides: ["ontology.validate_wine Celery task", "pipeline: haiku→web_verify→ontology"]
  affects: ["jobs/celery_app.py", "jobs/web_verify_tasks.py", "jobs/haiku_tasks.py"]
tech_stack:
  added: []
  patterns: ["Redis NX dedup lock", "late import circular-dep avoidance", "non-fatal try/except trigger chain"]
key_files:
  created:
    - services/agent-orchestrator/jobs/ontology_tasks.py
  modified:
    - services/agent-orchestrator/jobs/celery_app.py
    - services/agent-orchestrator/jobs/web_verify_tasks.py
    - services/agent-orchestrator/jobs/haiku_tasks.py
decisions:
  - "Late import of OntologyValidationService inside _validate_sync to prevent circular imports (celery_app → ontology_tasks → OntologyValidationService)"
  - "Ontology trigger in web_verify_tasks is non-fatal (try/except) — web verification already complete, ontology failure must not roll it back"
  - "Haiku else-branch triggers ontology directly; inner try/except isolates from outer web_verify error handling"
  - "Redis NX TTL=3600 dedup prevents double-validation when both primary (web_verify) and fallback (haiku) paths fire for same wine_id within 1 hour"
metrics:
  duration: "~5 minutes"
  completed: "2026-04-06"
  tasks_completed: 2
  files_modified: 4
---

# Phase 9 Plan 04: Ontology Celery Task + Pipeline Wiring Summary

**One-liner:** Celery `ontology.validate_wine` task with Redis NX dedup, wired as primary path from `web_verify_tasks` and fallback path from `haiku_tasks`.

## Tasks Completed

| # | Task | Status | Files |
|---|------|--------|-------|
| 1 | Create `ontology_tasks.py` — Celery task with Redis NX dedup | DONE | `jobs/ontology_tasks.py` (new) |
| 2 | Patch `celery_app.py` + `web_verify_tasks.py` + `haiku_tasks.py` | DONE | 3 files patched |

## What Was Built

### Task 1 — `ontology_tasks.py`

New Celery task file implementing:
- Task name: `"ontology.validate_wine"` — registered via `@celery_app.task`
- Redis NX dedup: `r.set(f"wine:ontology:{wine_id}", "1", nx=True, ex=3600)` — prevents double-validation within 1 hour
- Retry policy: `max_retries=3`, countdown `60→120→240s` (matching `web_verify_tasks.py`)
- `finally: r.delete(lock_key)` — always releases lock regardless of outcome
- `_validate_sync()` with late import of `OntologyValidationService` to avoid circular imports
- Calls `service.run_ontology_validation(wine_id)` and returns structured dict

### Task 2 — Three Patches

**Patch 1 — `celery_app.py`:**
Added `"jobs.ontology_tasks"` to the `imports=` tuple so Celery workers auto-discover the task on startup.

**Patch 2 — `web_verify_tasks.py`:**
Added ontology trigger block at end of `_verify_async`, after the `logger.info("_verify_async: wine_id=%s complete ...")` line and before the final `return` dict:
```python
# ONTO-05: Trigger ontology cross-validation after web verification (primary path)
try:
    from jobs.ontology_tasks import ontology_validate_task
    ontology_validate_task.delay(wine_id)
    ...
except Exception as exc:
    logger.warning(...)
```

**Patch 3 — `haiku_tasks.py`:**
Added `else` branch inside the existing `try` block for the web_verify trigger. When `_should_web_verify` returns `False`, ontology is triggered directly (fallback path):
```python
else:
    # Web verify skipped — trigger ontology directly (fallback path)
    try:
        from jobs.ontology_tasks import ontology_validate_task
        ontology_validate_task.delay(wine_id)
        ...
    except Exception as onto_exc:
        logger.warning(...)
```

## Pipeline Chain After This Plan

```
Vision extraction (Pass 1)
        ↓
Haiku enrichment (haiku_tasks._enrich_async)
        ↓
   _should_web_verify?
   /              \
 YES               NO (fallback path)
  ↓                    ↓
web_verify_task    ontology_validate_task.delay()
  ↓
ontology_validate_task.delay()  (primary path)
  ↓
OntologyValidationService.run_ontology_validation()
```

## Deviations from Plan

None — plan executed exactly as written.

## Verification Results

```
ontology_tasks.py: OK
OK: jobs/celery_app.py
OK: jobs/web_verify_tasks.py
OK: jobs/haiku_tasks.py
All patch validations PASSED
```

All 4 files pass `py_compile`. All grep assertions confirmed:
- `name="ontology.validate_wine"` present in ontology_tasks.py
- `wine:ontology:{wine_id}` Redis lock key present
- `max_retries=3` present
- `r.delete(lock_key)` in finally block
- `OntologyValidationService` and `run_ontology_validation` present
- `jobs.ontology_tasks` in celery_app.py imports tuple
- `ontology_validate_task.delay` in both web_verify_tasks.py and haiku_tasks.py
- `web verify skipped — fallback path` comment in haiku_tasks.py

## Self-Check: PASSED

- `services/agent-orchestrator/jobs/ontology_tasks.py` — EXISTS
- `celery_app.py` patch — VERIFIED (`jobs.ontology_tasks` present)
- `web_verify_tasks.py` patch — VERIFIED (`ontology_validate_task.delay` present)
- `haiku_tasks.py` patch — VERIFIED (`ontology_validate_task.delay` + `fallback path` present)
