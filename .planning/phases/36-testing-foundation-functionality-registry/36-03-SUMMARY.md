---
phase: 36-testing-foundation-functionality-registry
plan: 03
subsystem: testing
tags: [synthetic-tenant, sim-prefix, TFND-05, TFND-06, CI-annotations, e2e-prod]

requires:
  - phase: 36-testing-foundation-functionality-registry
    provides: RUBRIC + registry (36-01); inventory + scorecard (36-02)
provides:
  - SYNTHETIC-TENANT.md sim-* convention with E2E_TABLES gap + Phase 37 teardown gate (TFND-06)
  - Comment-only TFND-05 annotations on ci.yml + e2e-prod.yml (no job behavior change)
  - Operator-first testing README + checklists naming stub
affects:
  - Phase 37 synthetic generator + teardown expansion
  - Phases 39–43 checklists and breadth suites
  - Phase 42 weekly AI eval workflow (placeholder only)

tech-stack:
  added: []
  patterns:
    - Comment-only CI annotation (no second E2E workflow; no PYTEST_RUNNING)
    - Operator quickstart scorecard-first before inventory
    - schedule-present / capability-unverified honesty until wave XML lands

key-files:
  created:
    - .planning/testing/SYNTHETIC-TENANT.md
    - .planning/testing/README.md
    - .planning/testing/checklists/README.md
  modified:
    - .github/workflows/ci.yml
    - .github/workflows/e2e-prod.yml

key-decisions:
  - "Embedded verbatim 8-table E2E_TABLES + Table D gap; Phase 37 must expand teardown before multi-archetype seed"
  - "TFND-05 = schedule-present / capability-unverified; secrets present? no as of 2026-07-27; not green CI"
  - "ci.yml / e2e-prod.yml edits are comments only — cron 0 2 * * * unchanged; no testing-campaign.yml"

patterns-established:
  - "Pattern: extend conftest_prod / setup_e2e_anchor by reference; never delete e2e-test-restaurant"
  - "Pattern: RLS seed checklist requires restaurants sim-* + URA + Auth user; service-role ≠ user-path proof"
  - "Pattern: checklists named g{N}-{slug}-manual.md; ownership 39/40/43"

requirements-completed: [TFND-06, TFND-05]

duration: 1min
completed: 2026-07-27
---

# Phase 36 Plan 03: Synthetic Tenant + CI Annotations + README Summary

**Locked `sim-*` synthetic-tenant convention (TFND-06) with RLS seed checklist and E2E_TABLES teardown gap, plus comment-only TFND-05 CI annotations and an operator-first testing README.**

## Performance

- **Duration:** ~1 min
- **Started:** 2026-07-27T20:06:27Z
- **Completed:** 2026-07-27T20:07:32Z
- **Tasks:** 2/2
- **Files modified:** 5 (3 created, 2 comment-only workflow edits)

## Accomplishments

- Documented `sim-*` isolation extending Phase 25: coexistence with `e2e-test-restaurant` (NEVER deleted), RLS seed checklist (restaurants + URA + Auth user), verbatim 8-table `E2E_TABLES`, Table D gap coverage, Phase 37 hard gate before multi-archetype seed
- Annotated `ci.yml` / `e2e-prod.yml` with TFND-05 intent only — cron `0 2 * * *` intact; Phase 42 placeholder; no second E2E workflow; no `PYTEST_RUNNING`
- Shipped operator front door README (scorecard → registry → checklists) + `checklists/README.md` naming contract; CI honesty = schedule-present / capability-unverified + Black/`studio_routes.py`

## Task Commits

Each task was committed atomically:

1. **Task 1: Write SYNTHETIC-TENANT.md convention** - `c79e947` (docs)
2. **Task 2: Annotate CI workflows + write operator README + checklists stub** - `283c7dd` (docs)

**Plan metadata:** `da0bbe8` (docs: complete plan)

## Files Created/Modified

- `.planning/testing/SYNTHETIC-TENANT.md` — TFND-06 convention (prefixes, RLS checklist, E2E_TABLES, gap table, anti-patterns)
- `.planning/testing/README.md` — Operator quickstart-first index + CI honesty banner
- `.planning/testing/checklists/README.md` — `g{N}-{slug}-manual.md` naming + phase ownership
- `.github/workflows/ci.yml` — TFND-05 comment block + unit/integration on-push job comments (behavior unchanged)
- `.github/workflows/e2e-prod.yml` — TFND-05 / D-24 / D-25 / capability-unverified header comments (cron unchanged)

## Decisions Made

- Embed current `E2E_TABLES` verbatim and map registry Table D domains to `none|partial|full` teardown coverage so Phase 37 cannot widen seed without expanding sweep tables
- Keep TFND-05 honesty aligned with 36-02 scorecard: secrets present? no as of 2026-07-27; do not treat wiring as green CI
- Comment-only workflow edits; forbid inventing `testing-campaign.yml`

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required by this plan. Ops restore of `e2e-prod` GitHub Actions secrets remains a pre-existing ops action (documented as capability-unverified).

## Next Phase Readiness

- Phase 36 complete after this plan's metadata commit + verification
- Phase 37 can implement generator + teardown expansion against `SYNTHETIC-TENANT.md` (must expand table registry first)
- Checklists directory IA reserved for 39/40/43

## Known Stubs

- `.planning/testing/checklists/` — naming README only; per-group `g{N}-{slug}-manual.md` files intentionally deferred to Phases 39–43 (plan scope)

## Self-Check: PASSED

- FOUND: `.planning/testing/SYNTHETIC-TENANT.md`
- FOUND: `.planning/testing/README.md`
- FOUND: `.planning/testing/checklists/README.md`
- FOUND: `c79e947` (Task 1)
- FOUND: `283c7dd` (Task 2)
