---
phase: 37-synthetic-restaurant-engine
plan: 02
subsystem: testing
tags: [synth, oracle, seed, auth, personas, atomic-tx, nyquist]

requires:
  - phase: 37-synthetic-restaurant-engine
    provides: "recipes, snapshots, UUID5 ids, SYNTH_WRITE_SET under scripts/synth + datasets/sim"
provides:
  - "sim_ground_truth_runs/facts migration + seed_sim_restaurant SECURITY DEFINER RPC"
  - "scripts/synth/{oracle,seed,auth_personas}.py"
  - "Wave-2 Nyquist suite green (oracle/seed/personas/atomic)"
affects:
  - 37-03 teardown gate + CLI --apply
  - 38-simpos (consumes seeded menus/inventory)
  - 41 analytics KPI asserts against oracle

tech-stack:
  added: []
  patterns:
    - "SECURITY DEFINER seed_sim_restaurant(jsonb) as primary fail-closed TX"
    - "execute_atomic_seed secondary DATABASE_URL path (same payload)"
    - "Three distinct SIM_* Auth personas + URA roles; never log passwords/JWTs"

key-files:
  created:
    - supabase/migrations/20260727230000_sim_ground_truth.sql
    - scripts/synth/oracle.py
    - scripts/synth/seed.py
    - scripts/synth/auth_personas.py
  modified:
    - env.example
    - services/agent-orchestrator/tests/test_synth_oracle_schema.py
    - services/agent-orchestrator/tests/test_synth_seed_plan.py
    - services/agent-orchestrator/tests/test_synth_auth_personas.py
    - services/agent-orchestrator/tests/test_synth_atomic_seed.py

key-decisions:
  - "RPC seed_sim_restaurant is primary; psycopg2 execute_atomic_seed is secondary/test path"
  - "Provisional master_wine_library always planned with uuid5 sim.wine.* + enrichment_source=sim"
  - "Sell prices and menu_price facts copied from snapshot only"

patterns-established:
  - "Pattern: dry-run build_seed_plan → payload → RPC/TX; apply=False default"
  - "Pattern: oracle facts last inside TX so failure rolls back live rows"

requirements-completed: [SYNTH-03, SYNTH-04]

duration: 5min
completed: 2026-07-27
---

# Phase 37 Plan 02: Atomic Seed + Oracle + Auth Personas Summary

**Fail-closed cloud seed: `sim_ground_truth*` oracle schema, three SIM_* Auth personas with URA roles, and atomic `seed_sim_restaurant` RPC so live rows never orphan without oracle facts.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-27T20:59:10Z
- **Completed:** 2026-07-27T21:04:28Z
- **Tasks:** 3 (each with TDD RED→GREEN commits)
- **Files modified:** 9

## Accomplishments

- Migrated `sim_ground_truth_runs` + `sim_ground_truth_facts` with RLS (no anon write) and callable `seed_sim_restaurant` SECURITY DEFINER
- Dry-run `build_seed_plan` covers org/restaurant/URA×3/menu/inventory/provisional library/oracle ⊆ `SYNTH_WRITE_SET`
- `ensure_personas` creates three distinct Auth users (idempotent 422) + `public.users` mirrors; env names documented in `env.example`
- Unit-proven atomic rollback: oracle failure → `ROLLBACK` (no committed restaurant/menu)

## Task Commits

Each task was committed atomically (TDD RED then GREEN):

1. **Task 1: Oracle migration + fact builders** — `ba4e0c8` (test) → `b8276a0` (feat)
2. **Task 2: Auth personas + dry-run seed plan** — `c574f26` (test) → `0605a0d` (feat)
3. **Task 3: Fail-closed atomic seed + oracle** — `3b6967f` (test) → `9cdb912` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `supabase/migrations/20260727230000_sim_ground_truth.sql` — oracle tables + RLS + full `seed_sim_restaurant`
- `scripts/synth/oracle.py` — `build_run_row` / `build_facts` (six fact types)
- `scripts/synth/seed.py` — `build_seed_plan` / `apply_seed` / `execute_atomic_seed`
- `scripts/synth/auth_personas.py` — `ensure_personas` / `PERSONA_ROLES` / `required_env`
- `env.example` — `SIM_OWNER_*` / `SIM_MANAGER_*` / `SIM_STAFF_*` names only
- `services/agent-orchestrator/tests/test_synth_*.py` — Wave 2 Nyquist (17 tests)

## Decisions Made

- Prefer RPC `seed_sim_restaurant` for cloud apply; `DATABASE_URL` + `execute_atomic_seed` is secondary and unit-testable
- Always plan provisional `master_wine_library` (+ submissions) with deterministic `sim.wine.*` UUID5
- Inventory uses `restaurant_inventory.stock_live` only; slug must be `sim-*` (hard refuse e2e anchor)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Auth persona httpx Client mocks initially assumed context-manager usage; tests adjusted to match direct `httpx.Client()` (no product change)

## Known Stubs

- `scripts/synth/__main__.py` — CLI still lands in 37-03 (intentional)
- Multi-archetype `--apply` gate / teardown sweep — 37-03 (intentional)
- Live cloud migration apply + real SIM_* secrets — operator/USER-SETUP (not required for unit green)

## Threat Flags

None beyond plan threat model — RLS on, SECURITY DEFINER + service_role GRANT, no anon write policies, slug `sim-%` guard in RPC.

## User Setup Required

Cloud `--apply` (37-03+) needs service-role + three distinct SIM_* Auth secrets (names in `env.example`). Values never committed.

## Next Phase Readiness

- Ready for **37-03**: teardown write-set equality gate, CLI dry-run/`--apply`, role isolation E2E
- Do not multi-archetype cloud `--apply` until 37-03 gate green
- SimPOS (38) can consume seeded menus once cloud seed is gated

## Verification

```text
cd services/agent-orchestrator && pytest \
  tests/test_synth_oracle_schema.py \
  tests/test_synth_seed_plan.py \
  tests/test_synth_auth_personas.py \
  tests/test_synth_atomic_seed.py -q
→ 17 passed
```

## Self-Check: PASSED

- FOUND: `supabase/migrations/20260727230000_sim_ground_truth.sql`
- FOUND: `scripts/synth/{oracle,seed,auth_personas}.py`
- FOUND: commits `ba4e0c8`, `b8276a0`, `c574f26`, `0605a0d`, `3b6967f`, `9cdb912`

---
*Phase: 37-synthetic-restaurant-engine*
*Completed: 2026-07-27*
