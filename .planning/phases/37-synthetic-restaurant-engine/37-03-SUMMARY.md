---
phase: 37-synthetic-restaurant-engine
plan: 03
subsystem: testing
tags: [synth, teardown, write-set-gate, cli, fastapi, role-isolation, nyquist]

requires:
  - phase: 37-synthetic-restaurant-engine
    provides: "recipes/snapshots (37-01) + atomic seed/oracle/personas (37-02)"
provides:
  - "scripts/synth/teardown.py shared FK-safe sim teardown + handler coverage gate"
  - "CLI + pnpm synth:* + thin FastAPI admin synth routes (dry-run default)"
  - "prod_e2e staff≠manager role isolation test (secrets-gated)"
affects:
  - 38-simpos (consumes seeded menus; no SimPOS here)
  - 41 analytics KPI asserts against oracle after teardown-safe multi-seed

tech-stack:
  added: []
  patterns:
    - "SYNTH_WRITE_SET == TEARDOWN_TABLES + TEARDOWN_HANDLERS coverage gate before --apply"
    - "Never-raise teardown_sim with Sentry sim-orphan; e2e anchor hard-guard; users NO-OP"
    - "CLI/API dry-run default; mutations require --apply / apply:true"

key-files:
  created:
    - scripts/synth/teardown.py
    - scripts/synth/cli.py
    - services/agent-orchestrator/api/synth_routes.py
    - services/agent-orchestrator/tests/test_synth_routes.py
  modified:
    - scripts/synth/seed.py
    - scripts/synth/__main__.py
    - package.json
    - services/agent-orchestrator/main.py
    - services/agent-orchestrator/tests/e2e/conftest_prod.py
    - services/agent-orchestrator/tests/test_synth_write_set_gate.py
    - services/agent-orchestrator/tests/test_synth_teardown_safety.py
    - services/agent-orchestrator/tests/test_synth_cli_defaults.py
    - services/agent-orchestrator/tests/e2e/test_synth_role_isolation.py
    - .planning/testing/SYNTHETIC-TENANT.md

key-decisions:
  - "Always gate apply=True (single- and multi-archetype) via assert_teardown_coverage"
  - "Library teardown is sim-filtered only (wine ids + enrichment_source=sim); never wholesale wipe"
  - "Strip literal pnpm '--' from CLI argv so root pnpm synth:* works"

patterns-established:
  - "Pattern: TEARDOWN_HANDLERS cover every SYNTH_WRITE_SET table including users NO-OP"
  - "Pattern: conftest_prod imports teardown_sim — one registry (D-13)"
  - "Pattern: thin FastAPI wrappers patch apply_seed/teardown_sim at api.synth_routes"

requirements-completed: [SYNTH-03, SYNTH-05]

duration: 5min
completed: 2026-07-27
---

# Phase 37 Plan 03: Teardown Gate + CLI/API Summary

**Ops surface closed: shared write-set↔teardown handlers (incl. sim-filtered library), dry-run CLI/API with `--apply` gate, and secrets-gated staff≠manager role isolation — five-archetype dry-run generate verified.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-27T21:06:32Z
- **Completed:** 2026-07-27T21:11:26Z
- **Tasks:** 4 (Task 4 human-verify auto-approved in YOLO mode)
- **Files modified:** 15+

## Accomplishments

- Shipped `teardown_sim` with FK-safe `DELETE_ORDER`, one handler per `SYNTH_WRITE_SET` table (`restaurant_menus` naming; `master_wine_library*` sim-filtered; `users` NO-OP)
- Multi/single-archetype `--apply` refused unless `assert_teardown_coverage()` green; `conftest_prod` imports shared module (no forked list)
- Root `pnpm synth:{refresh,generate,teardown}` + FastAPI `POST /api/v1/admin/synth/*` (X-Admin-Key; `apply` defaults false)
- Full unit suite `pytest tests/test_synth_*.py` — **54 passed**; role isolation present (skipped when SIM_* secrets absent)

## Task Commits

Each task was committed atomically (TDD RED→GREEN where applicable):

1. **Task 1: Shared teardown + write-set equality gate** — `ecc7fe1` (test) → `2dd6d99` (feat)
2. **Task 2: CLI + pnpm scripts + thin FastAPI admin API** — `df33c5d` (test) → `58b99fd` (feat)
3. **Task 3: Role isolation + full synth suite** — `e3dc0e7` (feat)
4. **Task 4: Operator dry-run + gate confirmation** — auto-approved (YOLO); follow-up `693c40e` (fix pnpm `--` argv)

**Plan metadata:** (this commit)

## Files Created/Modified

- `scripts/synth/teardown.py` — shared registry, gate, never-raise teardown
- `scripts/synth/cli.py` / `__main__.py` — refresh|generate|teardown argparse
- `scripts/synth/seed.py` — `apply=True` runs coverage gate
- `services/agent-orchestrator/api/synth_routes.py` + `main.py` — admin routes
- `package.json` — `synth:refresh|generate|teardown`
- `conftest_prod.py` — calls `teardown_sim` after e2e sweep
- Nyquist tests: write_set_gate, teardown_safety, cli_defaults, routes, role_isolation
- `.planning/testing/SYNTHETIC-TENANT.md` — Phase 37 UUID5+slug + shared teardown note

## Decisions Made

- Prefer always requiring write-set↔handler equality on any `--apply` (safer than multi-only)
- Role isolation hits Nest `GET /restaurants/:id/team/members` (manager-gated `listMembers`)
- Cloud multi-archetype `--apply` left for ops when secrets + gate green (not run in this plan)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] pnpm forwards literal `--` into CLI argv**
- **Found during:** Task 4 dry-run verify
- **Issue:** `pnpm synth:generate -- --archetype all` became `python3 -m scripts.synth generate -- --archetype all` → argparse exit 2
- **Fix:** Strip lone `--` from `sys.argv` / passed argv in `cli.main()`
- **Files modified:** `scripts/synth/cli.py`
- **Verification:** dry-run returned `archetype_count=5`, `dry_run=true` for all five ids; gate pytest green
- **Committed in:** `693c40e`

---

**Total deviations:** 1 auto-fixed (Rule 3)
**Impact on plan:** Required for documented how-to-verify command; no scope creep.

## Issues Encountered

None beyond the pnpm argv separator (auto-fixed).

## User Setup Required

Cloud multi-seed / role-isolation green path needs existing ops secrets (documented in plan `user_setup`):

- `ADMIN_API_KEY`, `SIM_STAFF_*`, `SIM_MANAGER_*`, Supabase URL + keys, `API_GATEWAY_URL`
- Optional: `pnpm synth:generate -- --archetype bistro --apply` then `pnpm synth:teardown -- --apply` only when secrets present

## Checkpoint: Task 4 (human-verify) — AUTO-APPROVED

**Mode:** YOLO / auto-mode (orchestrator instruction)

| Step | Result |
|------|--------|
| 1. `pnpm synth:generate -- --archetype all` (no `--apply`) | ✅ dry-run plans for fine-dining, bistro, high-volume-bar, cafe, turkish-clone |
| 2. `pytest tests/test_synth_write_set_gate.py -q` | ✅ 7 passed |
| 3. Optional cloud `--apply` | ⏭️ skipped (secrets not assumed present) |

⚡ Auto-approved: synth CLI dry-run + write-set gate green.

## Known Stubs

None that block plan goals. Role isolation skips with explicit missing-env message when secrets absent (intentional — not a pass claim).

## Threat Flags

None beyond plan `<threat_model>` (admin X-Admin-Key routes already registered; same pattern as health_routes).

## Next Phase Readiness

- Phase 37 plans 01–03 complete — factory ready for Phase 38 SimPOS to consume seeded menus
- Do **not** multi-archetype `--apply` if gate ever goes red; single-archetype cloud apply when secrets ready

## Self-Check: PASSED

- FOUND: `.planning/phases/37-synthetic-restaurant-engine/37-03-SUMMARY.md`
- FOUND: `scripts/synth/teardown.py`, `scripts/synth/cli.py`, `api/synth_routes.py`
- FOUND commits: `ecc7fe1`, `2dd6d99`, `df33c5d`, `58b99fd`, `e3dc0e7`, `693c40e`, `0a2aca4`
- FOUND: 54/54 `test_synth_*.py` green; dry-run 5 archetypes
- FOUND: STATE.md position + ROADMAP Progress 3/3 Complete
