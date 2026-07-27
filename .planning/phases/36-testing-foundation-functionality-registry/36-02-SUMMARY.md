---
phase: 36-testing-foundation-functionality-registry
plan: 02
subsystem: testing
tags: [test-inventory, scorecard, TFND-03, TFND-04, T1?, stale-suspect]

requires:
  - phase: 36-testing-foundation-functionality-registry
    provides: RUBRIC.md + FUNCTIONALITY-REGISTRY.md (36-01)
provides:
  - Full EXISTING-TEST-INVENTORY.md catalog (TFND-03 / D-05)
  - TESTING-SCORECARD.md baseline with provisional T1? protocol (TFND-04 / D-17)
affects:
  - 36-03 (CI annotations + synthetic tenant + README)
  - Phases 39–43 breadth suites and checklists
  - Score promotions citing inventory paths + CI jobs

tech-stack:
  added: []
  patterns:
    - Locked N-shortname inventory group slugs only
    - Provisional T1? + Gaps "CI green unverified" when passes?=unknown
    - stale-suspect excluded from T1-eligible evidence
    - Operator-visible UX traps seeded in Gaps for groups 1/2/3/8/11

key-files:
  created:
    - .planning/testing/EXISTING-TEST-INVENTORY.md
    - .planning/testing/TESTING-SCORECARD.md
  modified: []

key-decisions:
  - "All groups with runs?=yes but passes?=unknown scored T1? (no loadable-smoke artifact this phase); group 10-ai = T0"
  - "Inventory groups reconciled to registry Table A primaries (10 Nest module sample — all match)"
  - "e2e-prod secrets present? no as of 2026-07-27; TFND-05 = schedule-present / capability-unverified"

patterns-established:
  - "Pattern: inventory honesty columns (runs?/passes?/stale-suspect) drive scorecard Evidence"
  - "Pattern: Gaps mix missing-test + operator UX traps for manual-pass foresight"
  - "Pattern: do not promote past T1 until passes?=yes or explicit waiver"

requirements-completed: [TFND-03, TFND-04]

duration: 2min
completed: 2026-07-27
---

# Phase 36 Plan 02: Existing Test Inventory & Scorecard Summary

**Honest catalog of 142 existing automated tests (locked N-shortname groups) plus an 11-row TESTING-SCORECARD baseline using provisional T1? rules, UX Gaps seeds, and CI/E2E capability honesty.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-07-27T20:03:16Z
- **Completed:** 2026-07-27T20:04:52Z
- **Tasks:** 2/2
- **Files modified:** 2 created

## Accomplishments

- Catalogued every Jest (41), Vitest (30), Playwright (4), and pytest/wave (67) file with required columns; `passes?` default unknown; one `stale-suspect` duplicate golden-path file
- Initialized scorecard: 10× T1? + 1× T0 (AI); zero T4; Gaps include `CI green unverified` and operator UX traps for groups 1, 2, 3, 8, 11
- Reconciled inventory group slugs to FUNCTIONALITY-REGISTRY Nest primaries (auth/wines/inventory/pos-hub/procurement/contacts/communications/calendar/analytics/common)

## Task Commits

Each task was committed atomically:

1. **Task 1: Build EXISTING-TEST-INVENTORY.md for all runners** - `01f6ecf` (docs)
2. **Task 2: Initialize TESTING-SCORECARD.md baseline** - `824aeb8` (docs)

**Plan metadata:** _(see final docs commit after this SUMMARY)_

## Files Created/Modified

- `.planning/testing/EXISTING-TEST-INVENTORY.md` — methodology, summary counts, 142-row table, known anomalies
- `.planning/testing/TESTING-SCORECARD.md` — scoring protocol, 11-row baseline, consistency note, CI/E2E honesty block

## Decisions Made

- Scored provisional **T1?** (not clean T1) because this phase did not record loadable-smoke/`passes?=yes` artifacts
- Cited Black failure on `studio_routes.py` (run `30299009969`) and empty e2e-prod secrets (run `30240577056`) — TFND-05 ≠ green CI
- Excluded `test_golden_path_e2e 2.py` from T1 evidence (stale-suspect)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Needed

None.

## Next Phase Readiness

- Inventory + scorecard ready for 36-03 (CI annotations, synthetic tenant, testing README)
- Breadth phases 39–43 own Gaps / promotions; promote past T1 only with `passes?=yes` or waiver

## Known Stubs

None — documentation-only deliverables; no UI stubs introduced.

## Self-Check: PASSED

- FOUND: `.planning/testing/EXISTING-TEST-INVENTORY.md`
- FOUND: `.planning/testing/TESTING-SCORECARD.md`
- FOUND: commit `01f6ecf`
- FOUND: commit `824aeb8`
