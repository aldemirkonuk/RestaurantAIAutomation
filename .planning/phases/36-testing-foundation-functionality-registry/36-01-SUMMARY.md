---
phase: 36-testing-foundation-functionality-registry
plan: 01
subsystem: testing
tags: [rubric, functionality-registry, T0-T4, TFND-01, TFND-02]

requires:
  - phase: 36-testing-foundation-functionality-registry
    provides: CONTEXT D-09..D-16 locked decisions + RESEARCH surface map A–D
provides:
  - Standalone T0–T4 scoring rubric (TFND-02)
  - Canonical 11-group FUNCTIONALITY-REGISTRY with Nest/web/agent/DB maps (TFND-01)
affects:
  - 36-02 (inventory + scorecard)
  - 36-03 (CI annotations + synthetic tenant)
  - Phases 37–43 Testing Campaign suites and checklists

tech-stack:
  added: []
  patterns:
    - Primary-group mapping with also_touches secondary notes (D-10)
    - T0–T4 maturity contract with Agent Level explanatory mirror only
    - manual_pass canonicalization for dual routes + Phase 38 reserved surfaces

key-files:
  created:
    - .planning/testing/RUBRIC.md
    - .planning/testing/FUNCTIONALITY-REGISTRY.md
  modified: []

key-decisions:
  - "Standalone RUBRIC.md (not embedded in scorecard) per Claude discretion"
  - "Phase 38 sim control panel reserved at /sim (not /admin/sim), primary group 4, also_touches 11"
  - "Receiving door / contacts / compliance_agent suite owner = registry primary (5 / 5 / 11)"
  - "__init__.py mapped under group 11 as package init (not a scored agent)"

patterns-established:
  - "Pattern: every surface → exactly one primary + optional also_touches"
  - "Pattern: promote-past-T1 forbidden until passes?=yes or Gaps waiver"
  - "Pattern: mobile mapped but campaign-deferred"

requirements-completed: [TFND-02, TFND-01]

duration: 2min
completed: 2026-07-27
---

# Phase 36 Plan 01: Testing Foundation Rubric & Registry Summary

**Standalone T0–T4 RUBRIC.md plus an 11-group FUNCTIONALITY-REGISTRY that maps every Nest module, App.tsx route, orchestrator agent, and DB domain to exactly one primary group.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-07-27T19:59:49Z
- **Completed:** 2026-07-27T20:01:47Z
- **Tasks:** 2/2
- **Files modified:** 2 created

## Accomplishments

- Locked TFND-02 scoring contract with D-12..D-16 definitions, Agent Level mirror, evidence standards, and promote-past-T1 guard
- Locked TFND-01 registry: 34 Nest dirs, 39 App.tsx paths, 26 agent `.py` files, 11 DB domain buckets — each with one primary
- Documented contested surfaces, manual pathway watchlist (UX_PATHS_CATALOG), and Phase 38 `/sim` reserved row

## Task Commits

Each task was committed atomically:

1. **Task 1: Write standalone T0–T4 RUBRIC.md** - `302e404` (docs)
2. **Task 2: Write FUNCTIONALITY-REGISTRY.md with full surface map** - `098ea2f` (docs)

**Plan metadata:** _(final docs commit after this SUMMARY)_

## Files Created/Modified

- `.planning/testing/RUBRIC.md` — T0–T4 definitions, Level mirror, evidence/promotion rules
- `.planning/testing/FUNCTIONALITY-REGISTRY.md` — 11 groups, mapping rules, Tables A–D, contested surfaces, watchlist

## Decisions Made

- Rubric lives as standalone `.planning/testing/RUBRIC.md` (not a scorecard section)
- Reserved Phase 38 control-panel path = `/sim` (prefer over `/admin/sim`); primary **4**, `also_touches: 11`
- Contested suite owners follow primary: receiving door → 5, contacts → 5, compliance_agent → 11
- `__init__.py` included in Table C under group 11 so `ls agents/*.py` (26) matches registry coverage

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Reverted erroneous ROADMAP Phase 999.1 progress line**
- **Found during:** State/roadmap update after Task 2
- **Issue:** `gsd-tools roadmap update-plan-progress 36` incorrectly set Phase 999.1 (`Guest Profiles…`) to `**Plans:** 1/3 plans executed`
- **Fix:** Restored Phase 999.1 to `**Plans:** 0 plans`; set Phase 36 header to `**Plans**: 1/3 plans executed`
- **Files modified:** `.planning/ROADMAP.md`
- **Verification:** `rg '999.1|Plans.: 1/3' .planning/ROADMAP.md`
- **Committed in:** final docs commit

**Total deviations:** 1 auto-fixed (Rule 1)
**Impact on plan:** Correctness-only; no scope creep.

## Issues Encountered

None

## User Setup Required

None — documentation-only plan.

## Next Plan Ready

**36-02** — EXISTING-TEST-INVENTORY.md + TESTING-SCORECARD.md baseline (depends on this registry/rubric).

## Known Stubs

None that block TFND-01/TFND-02. Intentional future stubs (not blocking this plan):

- `EXISTING-TEST-INVENTORY.md` / `TESTING-SCORECARD.md` linked as future (Plan 36-02)
- `/sim` reserved row with status `planned — Phase 38` (no UI invented)
- Placeholder routes `/wine-agent` / `/wineagent` mapped as real App.tsx surfaces (product placeholders, not registry stubs)

## Self-Check: PASSED

- FOUND: `.planning/testing/RUBRIC.md`
- FOUND: `.planning/testing/FUNCTIONALITY-REGISTRY.md`
- FOUND: commit `302e404`
- FOUND: commit `098ea2f`
- Acceptance greps (T0–T4, 11 groups, Nest dir loop, agent count, manual_pass, Phase 38 `/sim`, contested surfaces, UX_PATHS_CATALOG, RUBRIC.md, database.types.ts) — all passed at execution time
