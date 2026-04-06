---
phase: 10-critic-scores-pricing-intelligence
plan: "03"
subsystem: dataset-ingestion
tags: [dataset, fuzzy-match, jsonb-enrichment, non-destructive, tdd]
dependency_graph:
  requires:
    - "10-01"  # quality_signals JSONB column must exist on master_wine_library
  provides:
    - DatasetIngestionService
    - wine_matches
    - _field_match
    - discover_datasets
  affects:
    - "10-04"  # dataset_enrich_task imports DatasetIngestionService.enrich_wine
    - "10-05"  # test_dataset_ingestion.py full test suite
tech_stack:
  added: []
  patterns:
    - difflib.SequenceMatcher for fuzzy wine name matching (stdlib, no new dep)
    - glob-based file discovery (DATASET_SOURCES with format metadata)
    - Non-destructive JSONB guard (skip if existing != {} and != None)
key_files:
  created:
    - services/agent-orchestrator/services/dataset_ingestion_service.py
    - services/agent-orchestrator/tests/test_dataset_ingestion_service.py
  modified: []
decisions:
  - "CSV rows have no producer field — wine_matches() skips producer check when library_wine['producer'] is None; 3-field effective key (name, vintage, appellation)"
  - "_build_enrichment_payload detects CSV vs JSONL by checking for 'style' in raw_ws or 'characteristics_raw' in raw_sp — CSV patches pass through as-is; JSONL records go through key-rename mappers"
  - "MIN_MATCH_COUNT=2; MATCH_THRESHOLD=0.85 — matches RESEARCH.md §Dataset Ingestion Pipeline spec"
metrics:
  duration: "2 minutes"
  completed: "2026-04-06"
  tasks_completed: 1
  files_changed: 2
---

# Phase 10 Plan 03: DatasetIngestionService Summary

**One-liner:** Fuzzy-match dataset ingestion service using SequenceMatcher with glob discovery and non-destructive JSONB column writes.

---

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| RED | test_dataset_ingestion_service.py (16 failing tests) | 490927a | services/agent-orchestrator/tests/test_dataset_ingestion_service.py |
| GREEN | DatasetIngestionService implementation | c63780a | services/agent-orchestrator/services/dataset_ingestion_service.py |

---

## What Was Built

`services/agent-orchestrator/services/dataset_ingestion_service.py` — 371 lines.

### Public API

| Export | Signature | Purpose |
|--------|-----------|---------|
| `_field_match` | `(a, b, threshold=0.85) → bool` | Case-insensitive SequenceMatcher ratio >= 0.85; guards on None/empty |
| `wine_matches` | `(library_wine, db_wine) → int` | Count matching fields (0-4); skips producer when None (CSV) |
| `discover_datasets` | `() → list[dict]` | Glob library/*.jsonl + External_Wine_Datasets/*.csv; returns path+format pairs |
| `DatasetIngestionService` | class | Main entry point via `enrich_wine(wine_id)` |
| `MIN_MATCH_COUNT` | `int = 2` | Write threshold |

### Key Design Decisions

**D-02c — Match algorithm:**  
`wine_matches()` checks 4 fields: name, producer, vintage, appellation. For CSV rows (`producer=None`), producer check is skipped — effective 3-of-3 match key. Vintage comparison uses `str()` normalization so `2019 == "2019"`.

**D-02 Non-destructive rule (T-10-07 mitigation):**  
`enrich_wine()` reads existing JSONB column values before writing. Only writes to a column if `existing is None or existing == {} or existing == "{}"`. Phase 7 Haiku enrichment in `wine_structure` is always preserved.

**CSV vs JSONL payload detection:**  
`_build_enrichment_payload()` detects format by checking for `"style"` in `_wine_structure` or `"characteristics_raw"` in `_sensory_profile` (CSV-indicator keys). CSV patches pass through directly; JSONL records go through key-rename mappers (`tannins → tannin`, `primary_aromas → aromas`, `flavor_profile → palate`).

**File discovery pattern:**  
`DATASET_SOURCES` uses `glob` patterns relative to `_PROJECT_ROOT` (4 levels above this file). New files dropped into `library/` or `External_Wine_Datasets/` are auto-discovered without code changes.

---

## Verification Results

### Automated (plan-specified)
```
from services.dataset_ingestion_service import DatasetIngestionService, wine_matches, _field_match
assert _field_match('Barolo', 'barolo') is True       ✅
assert _field_match('', 'Barolo') is False             ✅
assert wine_matches({'name':'Opus One','producer':'Opus One','vintage':2019,'appellation':'Oakville'},
                    {'name':'Opus One','producer':'Opus One','vintage':'2019','appellation':'Oakville'}) == 4  ✅
```

### Acceptance Criteria Checklist
- [x] `dataset_ingestion_service.py` exists
- [x] `class DatasetIngestionService:`
- [x] `def wine_matches(`
- [x] `def _field_match(`
- [x] `def discover_datasets(`
- [x] `def enrich_wine(`
- [x] `_extract_jsonl_records` exists
- [x] `_extract_csv_records` exists
- [x] `DATASET_SOURCES` has 2 entries (library/*.jsonl and External_Wine_Datasets/*.csv)
- [x] `MIN_MATCH_COUNT: int = 2`
- [x] `SequenceMatcher` (difflib stdlib — no new dependencies)
- [x] Non-destructive guard: `existing is None or existing == {}`
- [x] CSV 3-field match: `wine_matches({'name':'X','producer':None,'vintage':2019,'appellation':'Y'}, {'name':'X','vintage':'2019','appellation':'Y'}) >= 2` exits 0
- [x] `_field_match(None, 'Barolo') is False` exits 0

### Unit Tests
All 16 tests pass: `pytest tests/test_dataset_ingestion_service.py — 16 passed in 0.97s`

---

## Deviations from Plan

None — plan executed exactly as written.

The final `_build_enrichment_payload` in the plan already incorporated its own correction note (CSV vs JSONL detection via key presence). Implementation follows the revised version from the plan's action block.

---

## Known Stubs

None. `enrich_wine()` makes real Supabase calls. `discover_datasets()` resolves real filesystem paths. No hardcoded empty values flow to any rendering layer.

---

## Threat Flags

No new threat surface beyond what the plan's threat model covers.

- T-10-07 mitigated: non-destructive JSONB guard implemented (`existing is None or existing == {}`)
- T-10-10 mitigated: every `supabase.table().update()` scoped with `.eq("id", wine_id)`
- T-10-08 accepted: in-memory processing of bounded files (200 JSONL + 1526 CSV rows)
- T-10-09 accepted: dataset paths logged at DEBUG level only

---

## Self-Check

```bash
[ -f "services/agent-orchestrator/services/dataset_ingestion_service.py" ] → FOUND
[ -f "services/agent-orchestrator/tests/test_dataset_ingestion_service.py" ] → FOUND
git log --oneline | grep 490927a → FOUND (RED commit)
git log --oneline | grep c63780a → FOUND (GREEN commit)
```

## Self-Check: PASSED
