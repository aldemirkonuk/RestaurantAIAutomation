---
phase: 37-synthetic-restaurant-engine
plan: 01
subsystem: testing
tags: [synth, snapshots, uuid5, recipes, nyquist, datasets]

requires:
  - phase: 36-testing-foundation-functionality-registry
    provides: "sim-* tenant convention + teardown hard-gate before multi-archetype seed"
provides:
  - "scripts.synth package (ids, recipes, snapshots, write_set stubs)"
  - "Five frozen menu snapshots under datasets/sim/menus/"
  - "Five archetype recipes with configurable opening_stock"
  - "Wave 0 Nyquist test_synth_*.py scaffolds (wave-1 green)"
affects:
  - 37-02 atomic seed + oracle
  - 37-03 teardown gate + CLI
  - 38-simpos (consumes seeded menus)

tech-stack:
  added: []
  patterns:
    - "UUID5 restaurants.id + sim-{archetype} slug (never string PK)"
    - "SOTA hybrid: generate=replay frozen JSON; refresh=explicit"
    - "JSON archetype recipes (no PyYAML); opening_stock knobs on disk"

key-files:
  created:
    - scripts/synth/ids.py
    - scripts/synth/recipes.py
    - scripts/synth/snapshots.py
    - scripts/synth/write_set.py
    - datasets/sim/manifest.json
    - datasets/sim/archetypes/bistro.json
    - datasets/sim/menus/bistro.json
    - services/agent-orchestrator/tests/test_synth_write_set_gate.py
    - services/agent-orchestrator/tests/test_synth_recipes.py
    - services/agent-orchestrator/tests/test_synth_snapshots.py
  modified:
    - services/agent-orchestrator/tests/conftest.py

key-decisions:
  - "Five named recipes only (no parameter-skin variants in v1)"
  - "turkish-clone bootstrapped from Avli PDF via pdftotext (menu_quality=partial)"
  - "Sell prices copied from source only; never invented (D-04)"

patterns-established:
  - "Pattern: load_snapshot is offline-only; refresh_snapshot is the sole network/crawl entrypoint"
  - "Pattern: SYNTH_WRITE_SET == TEARDOWN_TABLES constant list in scripts/synth/write_set.py"

requirements-completed: [SYNTH-01, SYNTH-02, SYNTH-05]

duration: 4min
completed: 2026-07-27
---

# Phase 37 Plan 01: Snapshots + Archetype Recipes Summary

**Deterministic synth data plane: UUID5/sim-* helpers, five archetype recipes with opening_stock, and offline-replay menu snapshots under datasets/sim/**

## Performance

- **Duration:** 4 min
- **Started:** 2026-07-27T20:54:19Z
- **Completed:** 2026-07-27T20:57:37Z
- **Tasks:** 3
- **Files modified:** 30+

## Accomplishments

- Shipped `scripts/synth/` package: `ids` (UUID5 + `sim-*` slugs), `write_set` gate constants, `recipes` loader/overrides, `snapshots` replay/bootstrap/refresh split
- Committed five named archetype recipes and five frozen menu snapshots + `manifest.json` sha256 pack
- Wave 0 Nyquist scaffolds present for entire phase; wave-1 suite (14 tests) green

## Task Commits

Each task was committed atomically:

1. **Task 1: Wave 0 Nyquist scaffolds + package skeleton** - `83ae845` (feat)
2. **Task 2: Archetype recipes + opening stock + profile overrides** - `f49c851` (feat)
3. **Task 3: Frozen menu snapshots + replay/refresh split** - `51e7a94` (feat)

**Plan metadata:** `c3613ad` (docs: complete plan)

## Files Created/Modified

- `scripts/synth/ids.py` — `sim_restaurant_id` / `sim_org_id` / `sim_slug` / `SIM_NS`
- `scripts/synth/write_set.py` — `SYNTH_WRITE_SET` == `TEARDOWN_TABLES` + gate helper
- `scripts/synth/recipes.py` — `load_recipe` / `apply_overrides` / `list_archetypes` / `RestaurantProfile`
- `scripts/synth/snapshots.py` — `load_snapshot` / `bootstrap_from_jsonl` / `refresh_snapshot` / `compute_menu_quality`
- `datasets/sim/archetypes/*.json` — five recipes with D-07 `opening_stock`
- `datasets/sim/menus/*.json` — frozen SKU envelopes (JSONL replay + Avli PDF for turkish-clone)
- `datasets/sim/manifest.json` — pack_version + per-menu sha256
- `services/agent-orchestrator/tests/conftest.py` — monorepo root on `sys.path`
- `services/agent-orchestrator/tests/test_synth_*.py` — Wave 0 scaffolds; wave-2/3 skip until 37-02/03

## Decisions Made

- Locked five named presets only (D-05/D-06 discretion) — no parameter-skin variants
- turkish-clone = Avli Taverna Lincoln Park PDF best-effort extract; `menu_quality=partial` (D-03)
- Prices mapped from source fields only (`price_reference`→`bottle_price`, `price_glass`→`by_glass_price`); null stays null (D-04)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Avli two-column PDF parser initially matched cocktails**
- **Found during:** Task 3 (Frozen menu snapshots)
- **Issue:** First `pdftotext` parse returned 3 junk/cocktail rows; LIBATIONS header is spaced (`L I B A T I O N S`)
- **Fix:** Two-column `finditer` extract + cut on spaced LIBATIONS / form-feed; skip carafe/bleed fragments
- **Files modified:** `scripts/synth/snapshots.py`, regenerated `datasets/sim/menus/turkish-clone.json`
- **Verification:** 22 real wine SKUs including ASSYRTIKO/XINOMAVRO; wave-1 suite green
- **Committed in:** `51e7a94`

**Total deviations:** 1 auto-fixed (Rule 1)
**Impact on plan:** Correctness-only; no scope creep. Seed/oracle/CLI remain stubs for later plans.

## Issues Encountered

None beyond the Avli parser fix above.

## Known Stubs

- `scripts/synth/__main__.py` — CLI placeholder ("lands in 37-03"); intentional
- `test_synth_seed_plan.py`, `test_synth_auth_personas.py`, `test_synth_oracle_schema.py`, `test_synth_atomic_seed.py` — `pytest.skip` Wave 2 / 37-02
- `test_synth_teardown_safety.py`, `test_synth_cli_defaults.py` — `pytest.skip` Wave 3 / 37-03
- `tests/e2e/test_synth_role_isolation.py` — `@pytest.mark.prod_e2e` skip until 37-03
- `refresh_snapshot` live crawl is best-effort (falls back to JSONL/PDF bootstrap when keys missing) — intentional for CI

## User Setup Required

None - no external service configuration required for plan 01 (offline replay). Refresh crawl keys optional for operators.

## Next Phase Readiness

- Ready for **37-02**: atomic seed + `sim_ground_truth*` oracle + Auth personas (consume recipes/snapshots/ids/write_set)
- Write-set constant list ready for 37-03 teardown equality gate
- Do not cloud `--apply` multi-archetype until 37-03 gate green

## Verification

```text
pytest tests/test_synth_recipes.py tests/test_synth_snapshots.py \
  tests/test_synth_snapshot_schema.py tests/test_synth_archetypes_present.py \
  tests/test_synth_write_set_gate.py -q
→ 14 passed
```

## Self-Check: PASSED

- FOUND: `scripts/synth/{ids,recipes,snapshots,write_set}.py`
- FOUND: `datasets/sim/menus/*.json` (5) + `archetypes/*.json` (5) + `manifest.json`
- FOUND: commits `83ae845`, `f49c851`, `51e7a94`

---
*Phase: 37-synthetic-restaurant-engine*
*Completed: 2026-07-27*
