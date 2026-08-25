---
status: complete  # added 2026-07-31: work was done, the field was missing
quick_task: 260402-kj0
phase: quick
plan: 260402-kj0
subsystem: scripts/testing
tags: [e2e, crawl, harness, gemini-flash, phase-2, wine-extraction]
requirements: [E2E-01, E2E-02, E2E-03]
dependency_graph:
  requires: [services/agent-orchestrator/services/web_crawler.py]
  provides: [scripts/e2e_crawl_harness.py, scripts/e2e_restaurants.json, REPORT.md]
  affects: [datasets/restaurant_menus/]
tech_stack:
  added: []
  patterns: [asyncio, argparse, importlib dry-run, content_hash dedup proxy]
key_files:
  created:
    - scripts/e2e_crawl_harness.py
    - scripts/e2e_restaurants.json
    - REPORT.md
  modified: []
decisions:
  - "Dedup without Supabase uses content_hash equality between two crawls as proxy; supabase_client=None is fail-open so hash comparison is the correct gate"
  - "Dry-run mode (no GOOGLE_API_KEY) skips network, validates logic only, produces REPORT.md with NO MENU rows so CI always gets a report artifact"
  - "price_bottle in SCORED_FIELDS maps to price key in crawled JSONL — normalised inside score_completeness, not by renaming the constant"
metrics:
  duration_minutes: 3
  completed_date: "2026-04-02"
  tasks_completed: 2
  tasks_total: 2
  files_created: 3
  files_modified: 0
---

# Quick Task 260402-kj0 Summary: Phase 2 E2E Crawl Test Harness

**One-liner:** Self-contained async harness that crawls real restaurant URLs via WebCrawlerService, scores wine field completeness across six fields, validates JSONL schema, confirms dedup via content_hash proxy, and writes a structured REPORT.md.

## What Was Built

### scripts/e2e_crawl_harness.py

Six core functions:

| Function | Purpose |
|---|---|
| `score_completeness(wines)` | Per-record field completeness across SCORED_FIELDS; maps price_bottle → price |
| `validate_schema(wine)` | Checks master_wine_library_submissions required keys; returns violation strings |
| `find_jsonl_for_restaurant(name, dir)` | Slug-matches JSONL files for a restaurant in datasets/restaurant_menus/ |
| `read_jsonl(paths)` | Flat-reads multiple JSONL files; skips malformed lines with warning |
| `write_report(results, threshold, path)` | Writes REPORT.md with summary table, overall stats, per-restaurant sample wines |
| `run_crawl(restaurants, threshold, path)` | Async orchestrator: crawl → count → score → dedup → validate → report |

Entry point via `argparse`: `--config`, `--output`, `--pass-threshold`.

Dry-run mode activates automatically when `GOOGLE_API_KEY` is absent. No network requests are made; all logic assertions still validate. REPORT.md is written with NO MENU rows so a report artifact always exists.

### scripts/e2e_restaurants.json

Three real wine-forward restaurants as the default runtime-editable test set:
- Alinea (https://www.alinearestaurant.com)
- Eleven Madison Park (https://www.elevenmadisonpark.com)
- The French Laundry (https://www.thomaskeller.com/tfl)

### REPORT.md (generated)

Generated at project root on each run. Contains: ISO timestamp, pass threshold, summary table (Restaurant / Wines / Completeness / Dedup / Schema Violations / Result), Overall aggregate section, Per-Restaurant detail with sample wine tables.

## Tasks Completed

| Task | Description | Commit |
|---|---|---|
| 1 | Create e2e_restaurants.json + e2e_crawl_harness.py with all 6 functions | 0998d0e |
| 2 | Run harness (dry-run), verify logic assertions, generate REPORT.md | 740b748 |

## Verification

- `python3 scripts/e2e_crawl_harness.py --help` exits 0, no ImportError
- Logic assertions pass without network:
  - `score_completeness([]) == 0.0`
  - `score_completeness([{all_fields_present}]) == 1.0`
  - `validate_schema(valid_record) == []`
  - `validate_schema(missing_wine_name)` returns non-empty list
- REPORT.md exists at project root and contains "Phase 2 E2E Crawl Report" and summary table header

## Deviations from Plan

None — plan executed exactly as written.

## How to Run Live

```bash
export GOOGLE_API_KEY=<your-key>
python3 scripts/e2e_crawl_harness.py \
  --config scripts/e2e_restaurants.json \
  --output REPORT.md \
  --pass-threshold 0.80
```

Expected outputs when live:
- REPORT.md with per-restaurant completeness %, dedup status, schema violations
- JSONL files in datasets/restaurant_menus/ named `YYYYMMDD_<slug>.jsonl`
- stdout: `E2E complete. Report: REPORT.md` + `Overall: PASS` or `FAIL`

Pass bar: >= 80% aggregate field completeness AND 0 dedup failures AND 0 schema violations.

## Known Stubs

None. The harness is fully wired to WebCrawlerService. Dry-run mode is intentional behaviour, not a stub — it validates logic without network and produces a real report artifact.

## Self-Check: PASSED

- scripts/e2e_crawl_harness.py: FOUND
- scripts/e2e_restaurants.json: FOUND
- REPORT.md: FOUND
- Commit 0998d0e: FOUND
- Commit 740b748: FOUND
