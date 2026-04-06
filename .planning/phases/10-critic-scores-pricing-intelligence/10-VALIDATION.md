---
phase: 10
slug: critic-scores-pricing-intelligence
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-06
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.x |
| **Config file** | `services/agent-orchestrator/pytest.ini` or inline |
| **Quick run command** | `cd services/agent-orchestrator && python -m pytest tests/test_score_lookup.py tests/test_dataset_enrich.py -x -q` |
| **Full suite command** | `cd services/agent-orchestrator && python -m pytest tests/ -x -q` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `python -m pytest tests/test_score_lookup.py tests/test_dataset_enrich.py -x -q`
- **After Wave 3 (full integration):** Run full suite

---

## Nyquist Dimensions

### Dimension 1: Unit coverage
- `test_score_normalization.py` — normalize_score() for each source (WA 100-pt, Vivino 5-pt, JR 20-pt, Decanter 100-pt, WS 100-pt)
- `test_composite_score.py` — composite weight formula, ≥2 source gate, single-source returns None
- `test_markup_ratio.py` — markup_ratio computation + classification tiers + anomaly detection thresholds

### Dimension 2: Integration coverage
- `test_score_lookup_task.py` — Redis NX dedup, chain trigger from ontology, retry behavior
- `test_dataset_enrich_task.py` — fuzzy match logic, non-destructive write guard, JSONB field mapping

### Dimension 3: Schema coverage
- Migration runs without error on clean DB
- `wine_menu_prices` table created with FK constraints
- `retail_price_avg`, `quality_signals`, `menu_price_current`, `markup_ratio` columns added
- `markup_classification` VARCHAR column present

### Dimension 4: API coverage
- `GET /api/v1/analytics/wine/{id}/scores` returns 200 with `critic_scores`, `composite`, `retail_price_avg`, `markup_ratio`
- Returns 404 for unknown wine_id
- Returns partial response (null fields) when scores not yet populated

### Dimension 5: Boundary conditions
- Wine with 0 sources → no composite score, `critic_scores = {}`
- Wine with 1 source → no composite, individual score stored
- `retail_price_avg = NULL` → `markup_ratio = NULL`, no anomaly flag
- `menu_price_current = NULL` → `markup_ratio = NULL`
- `markup_ratio > 5.0` → anomaly flagged in `field_review_queue`
- `markup_ratio < 0.8` → anomaly flagged in `field_review_queue`

### Dimension 6: Dataset ingestion
- Fuzzy match confidence threshold: ≥2 of 4 fields (name, vintage, appellation, country)
- Non-destructive: existing non-empty JSONB fields are NOT overwritten
- CSV ingestion handles missing `producer` field gracefully (3-field match)

### Dimension 7: Budget/governance
- Score lookup task checks daily budget cap before each Serper call
- Nightly beat skips wines with `scores_last_updated_at > NOW() - INTERVAL '30 days'`

### Dimension 8: Validation architecture
- Tests cover happy path + all 5 boundary conditions in Dimension 5
- Mocks: Supabase client, Redis, Serper HTTP calls
