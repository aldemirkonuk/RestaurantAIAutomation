# Quick Task 260407-q0y: Summary

**Date:** 2026-04-07  
**Status:** Complete

## Changes

### 1. Citation input always visible (`FieldCell.tsx`)
- Removed `showCitation` state + "Add citation" toggle button
- Citation URL `<input type="url">` is now always rendered while editing
- Paste works immediately without clicking a button first

### 2. `winemaking_details` JSONB added to Haiku (`haiku_enrichment_service.py`)
- New field in `EnrichmentResult` dataclass: `winemaking_details`
- Prompt now asks Haiku for `production_method` (e.g. "Metodo Classico", "Charmat"), `lees_contact_months`, `fermentation`, `oak_aging`, `harvest`
- `winemaking_details` added to `JSONB_ENRICHMENT_KEYS` in `field_confidence.py` → auto-persisted by `haiku_tasks.py` to Supabase `master_wine_library_submissions`

### 3. Stale test fixes (`test_haiku_tasks.py`, `test_haiku_enrichment_service.py`)
- `_make_enrichment_result()` helpers updated to use `field_confidence` dict format
- Assertions updated to match current `EnrichmentResult` API (no flat `region=` kwargs)
- `assert_called_once_with` → `assert_called_with` (table called twice: read + write)
- All 7 tests passing

## Files Changed
- `apps/web/src/pages/studio/FieldCell.tsx`
- `services/agent-orchestrator/services/haiku_enrichment_service.py`
- `services/agent-orchestrator/services/field_confidence.py`
- `services/agent-orchestrator/tests/test_haiku_tasks.py`
- `services/agent-orchestrator/tests/test_haiku_enrichment_service.py`
