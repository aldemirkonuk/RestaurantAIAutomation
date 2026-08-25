---
phase: 25-production-e2e-test-suite
plan: "07"
subsystem: ci-e2e
tags: [github-actions, ci-cd, e2e-testing, cascading-report, playwright, sentry]
dependency_graph:
  requires: [25-03, 25-04, 25-05, 25-06]
  provides: [e2e-prod.yml, cascading_report.py, report_generator-wave-field]
  affects: [.github/workflows/, services/agent-orchestrator/scripts/, services/agent-orchestrator/tests/e2e/]
tech_stack:
  added: [actions/upload-artifact@v4, actions/github-script@v7]
  patterns: [continue-all-waves, background-process-parallelism, cascading-failure-analysis, deploy-gate, synthetic-xml-guard]
key_files:
  created:
    - .github/workflows/e2e-prod.yml
    - services/agent-orchestrator/scripts/cascading_report.py
  modified:
    - services/agent-orchestrator/tests/e2e/report_generator.py
    - .planning/ROADMAP.md
decisions:
  - "Background process parallelism (& + wait) for Waves B+C — produces separate wave_b.xml/wave_c.xml for precise cascading attribution (M-02 fix)"
  - "PYTEST_RUNNING intentionally never set in e2e-prod.yml — main.py disables Sentry when set; TRIGGERED_BY_DEPLOY used instead for deploy-gate signal"
  - "sentry_sdk.flush(2) in deploy-gate Sentry step — required for short-lived CI processes (L-01)"
  - "Synthetic wave_f.xml written when Playwright crashes before producing JUnit output (M-03)"
  - "cascading_report.py uses frozenset keys in SUGGESTED_FIXES for O(1) cluster lookup"
metrics:
  duration: "~20 minutes"
  completed: "2026-05-02"
  tasks_completed: 3
  tasks_total: 3
  files_created: 3
  files_modified: 2
---

# Phase 25 Plan 07: GitHub Actions CI + Cascading Report Summary

**One-liner:** GitHub Actions nightly+deploy e2e-prod.yml wiring all 7 waves with cascading root-cause reporter and Sentry deploy gate.

## What Was Built

### Task 1: `.github/workflows/e2e-prod.yml`

Created the production E2E CI workflow with:

- **Dual trigger:** Nightly cron `0 2 * * *` (D-12 observability) + `workflow_dispatch` with `triggered_by_deploy` input (D-13 deploy gate)
- **Continue-all-waves:** Every wave step uses `|| true` so the job never fails mid-run (D-15) — 11 `|| true` instances across all wave steps
- **Wave execution order (D-17 dependency graph):** A → [B+C concurrent] → D → E → G → F → report
- **Waves B+C concurrent:** Run as background shell processes (`&` + `wait`) with separate `wave_b.xml` / `wave_c.xml` outputs (M-02 fix)
- **Hard timeout:** `timeout-minutes: 15` on the job (TEST-PROD-10)
- **JUnit XML artifacts:** All 7 wave XML files uploaded via `actions/upload-artifact@v4` retained 30 days (TEST-PROD-08)
- **Deploy gate:** `check_failures` step inspects all wave XMLs; on failure + `triggered_by_deploy == true`: fires Sentry alert with `sentry_sdk.flush(2)` (L-01) and posts PR comment via `actions/github-script@v7`
- **Synthetic wave_f.xml guard:** If Playwright crashes before producing output, writes a synthetic failure JUnit XML so the cascading report always has wave F data (M-03)
- **PYTEST_RUNNING never set** — setting it disables Sentry in the FastAPI app's `main.py`; `TRIGGERED_BY_DEPLOY` signals blocking mode instead

### Task 2: `cascading_report.py` + `report_generator.py` extension

**`services/agent-orchestrator/scripts/cascading_report.py`** (new):
- `WAVE_DEPS` graph encodes D-17: `B→[A]`, `C→[B]`, `D→[A,B]`, `G→[E]`; A, E, F independent
- `SUGGESTED_FIXES` dict with `frozenset` keys covers all common failure cluster patterns (D-16): A-only, B-only, A+B, A+B+C, A+B+D, E-only, G-only, E+G, F-only; falls back to `FALLBACK_FIX`
- `collect_wave_results()` reads all 7 `wave_*.xml` files; handles missing XMLs as "missing" status
- `determine_root_causes()` clusters failures by identifying root waves (no failed deps) and their dependents
- Writes `cascading_report.json` (machine-readable for CI/Sentry) + `cascading_report.md` (human-readable for PR comments)
- CLI: `python scripts/cascading_report.py --results-dir <dir> --output-dir <dir>`

**`services/agent-orchestrator/tests/e2e/report_generator.py`** (modified):
- Added `_extract_wave_from_nodeid()` static method — maps file name patterns to wave letters A–G
- Added `"wave"` field to each result dict in `_results.append()` call
- All existing logic preserved: `pytest_sessionfinish`, `e2e-report.json` output, `E2EReportGenerator` class

### Task 3: ROADMAP.md Phase 25 Plans section

Added **Plans:** section under Phase 25 Success Criteria listing all 7 plans across 4 execution waves, consistent with the plan execution history.

## Decisions Made

1. **Background process parallelism for B+C over `-n 2`:** Using `&` + `wait` in a single shell step produces two separate pytest processes with separate JUnit XMLs. This is essential for the cascading report to distinguish B vs C failures precisely (M-02 fix). `pytest -n 2` would combine tests into a single process with a single XML.

2. **`PYTEST_RUNNING` never appears as an env var:** The main.py application checks `os.environ.get("PYTEST_RUNNING")` to disable Sentry. If set in e2e-prod.yml, Sentry would be silently disabled in the FastAPI app, making TEST-PROD-09 silent failures invisible. `TRIGGERED_BY_DEPLOY` is used instead to signal CI blocking mode to `conftest_prod.py`.

3. **`sentry_sdk.flush(2)` in the inline Python deploy-gate script:** The CI process is short-lived; without flush, Sentry's background transport may not deliver the event before the process exits. Flush with 2-second timeout ensures the alert reaches Sentry (L-01).

4. **`frozenset` keys in SUGGESTED_FIXES:** Python frozensets are hashable, enabling dict lookups for wave clusters like `frozenset(["A","B"])`. This avoids linear search through cluster combinations.

## Deviations from Plan

### Auto-fixed Issues

None.

### Accepted Divergences

**1. Acceptance criteria check for `-n 2` is stale vs. background process approach**
- **Found during:** Task 1 implementation
- **Details:** The plan's acceptance criteria includes `grep "\-n 2" .github/workflows/e2e-prod.yml` should match. However, the plan's YAML template, must_haves.truths, and the orchestrator's success_criteria all specify "background processes with separate wave_b.xml and wave_c.xml". The background process approach (chosen) is more correct — it gives separate stdout/stderr streams and separate JUnit XMLs. The `-n 2` check appears to be a stale acceptance criterion from an earlier iteration.
- **Resolution:** Background processes implemented as specified in must_haves.truths. The acceptance criteria check for `-n 2` is not satisfied; all other acceptance criteria pass.

**2. `grep "PYTEST_RUNNING" .github/workflows/e2e-prod.yml` returns matches (comments)**
- **Details:** The plan's acceptance criteria says "returns EMPTY". The file includes comments explaining WHY `PYTEST_RUNNING` is not set. These are documentation comments included in the plan's own YAML template. The env var is not set in any `env:` block — only mentioned in comments.
- **Resolution:** The critical constraint is satisfied (PYTEST_RUNNING is not set as an env var). Comments are preserved as documentation.

## Known Stubs

None — all wave steps reference existing test files created in plans 25-03 through 25-06. The cascading report produces output from real wave XML files at runtime.

## Threat Surface Scan

No new network endpoints or auth paths introduced. The e2e-prod.yml accesses:
- GitHub Actions secrets (via `${{ secrets.X }}` — auto-masked by GitHub)
- JUnit XML files written to `test-results/` (local filesystem, no production data)
- Inline `sentry_sdk.capture_message()` — uses DSN from env var, no secrets exposed

No threat flags beyond those already in the plan's threat model.

## Self-Check

### Created files exist:
- `[ -f .github/workflows/e2e-prod.yml ]` → FOUND
- `[ -f services/agent-orchestrator/scripts/cascading_report.py ]` → FOUND

### Commits exist:
- `900c3e4` — feat(25-07): create e2e-prod.yml CI workflow
- `6fe11a1` — feat(25-07): add cascading_report.py and extend report_generator with wave field
- `5843afa` — chore(25-07): update ROADMAP.md Phase 25 with 7 plan entries

## Self-Check: PASSED
