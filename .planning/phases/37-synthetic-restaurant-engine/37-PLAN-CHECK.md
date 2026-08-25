# Phase 37 Plan Check — Synthetic Restaurant Engine

**Checked:** 2026-07-27 (re-verify after revision)  
**Plans verified:** 37-01, 37-02, 37-03 (3 plans / 3 waves)  
**Verdict:** **PLAN CHECK PASSED** — 0 blocker(s), 4 residual warning(s) (non-blocking)

Prior blockers (B1 research resolution, B2 library teardown) are **cleared**. Plans are ready for `/gsd-execute-phase 37`.

---

## Prior blocker confirmation

| ID | Prior issue | Status | Evidence |
|----|-------------|--------|----------|
| B1 | RESEARCH Open Questions not RESOLVED | **FIXED** | `37-RESEARCH.md` → `## Open Questions (RESOLVED)`; Q1–Q4 each marked **RESOLVED** (RPC preferred; Avli Turkish; library always in write-set + sim-filtered teardown; e2e hard-guard always). Metadata §Open Questions echoes RESOLVED. |
| B2 | Teardown omitted `master_wine_library*` | **FIXED** | `37-03` interfaces DELETE_ORDER steps 6–7 include `master_wine_library_submissions` then `master_wine_library` (sim-filtered only); Task 1 behavior/action/done require handlers for every `SYNTH_WRITE_SET` table; `restaurant_menus` naming locked; tests assert handler coverage. |

Also closed from prior warnings (no longer issues):

| Prior | Status | Evidence |
|-------|--------|----------|
| W5 `oracle.py` missing from PATTERNS | **FIXED** | PATTERNS File Classification + dedicated `oracle.py` section |
| W6 library “if used” vs always-in-write-set | **FIXED** | 37-01 always includes library; 37-02 “library ALWAYS written — W6 lock”; 37-03 teardown always handles library |

---

## Goal-backward summary

| Phase outcome (ROADMAP / CONTEXT) | Covered? | Where |
|-----------------------------------|----------|-------|
| Parameterized profile (cuisine, size, wine depth, sales, price tier, rhythm) | YES | 37-01 T2 — SYNTH-01 |
| Real menus via hybrid snapshots; generate = replay; refresh explicit | YES | 37-01 T3 — SYNTH-02 / D-01 |
| Seed org/restaurant/team/menu/opening inventory | YES (code + dry-run; live `--apply` secrets-gated) | 37-02 T2–T3 — SYNTH-03 |
| Dedicated `sim_ground_truth*` oracle, atomic fail-closed | YES | 37-02 T1/T3 — SYNTH-04 / D-08..D-10 |
| ≥5 archetypes (fine dining, bistro, bar, cafe, Turkish) | YES | 37-01 T2–T3 — SYNTH-05 |
| UUID5 `restaurants.id` + `slug` `sim-*` (not string PKs) | YES | 37-01 ids.py + 37-02/03 contracts |
| Strict write-set ↔ teardown before multi-archetype `--apply` | YES | 37-01 write_set + 37-03 T1 (list equality **and** handlers, including library*) |
| Never delete `e2e-test-restaurant` | YES | 37-03 T1 |
| Auth personas + staff ≠ manager | YES (unit + secrets-gated prod_e2e) | 37-02 T2, 37-03 T3 — D-17 |
| Phase 38 SimPOS out of scope | YES | Explicit OUT OF SCOPE in 37-02/03 |

---

## Dimension results

| # | Dimension | Result |
|---|-----------|--------|
| 1 | Requirement coverage | ✅ PASS — SYNTH-01..05 in frontmatter + concrete tasks |
| 2 | Task completeness | ✅ PASS — all `auto` tasks have files/action/verify/done; TDD where required; checkpoint OK |
| 3 | Dependency correctness | ✅ PASS — `[]` → `37-01` → `37-01+37-02`; waves 1/2/3 match |
| 4 | Key links planned | ✅ PASS — library teardown + gate + CLI/API + conftest wiring specified |
| 5 | Scope sanity | ⚠️ WARN — 37-01 ~31 files (Wave 0 intentional); 37-03 has 4 tasks |
| 6 | Verification derivation | ✅ PASS — user-observable must_haves + Nyquist map |
| 7 | Context compliance | ✅ PASS — D-01..D-19 mapped; deferred SimPOS excluded; skins skipped = discretion |
| 7b | Scope reduction | ✅ PASS — no silent reduction of locked decisions (wave stubs / discretion only) |
| 7c | Architectural tier | ✅ PASS — seed/oracle DB+RPC; Auth Admin backend; role proof Nest/JWT |
| 8 | Nyquist compliance | ✅ PASS — VALIDATION.md present; all auto tasks have `<automated>`; Wave 0 in 37-01 T1 |
| 9 | Cross-plan data contracts | ✅ PASS — library always in write-set + seed + sim-filtered teardown |
| 10 | CLAUDE.md compliance | ⏭️ SKIPPED (no root CLAUDE.md) |
| 11 | Research resolution | ✅ PASS — `## Open Questions (RESOLVED)` with inline locks |
| 12 | Pattern compliance | ✅ PASS — analogs cited; `oracle.py` classified; shared teardown pattern documented |

### Dimension 8 detail

| Task | Plan | Wave | Automated Command | Status |
|------|------|------|-------------------|--------|
| T1 Wave 0 + write_set | 01 | 1 | `pytest tests/test_synth_write_set_gate.py` | ✅ |
| T2 recipes | 01 | 1 | `pytest tests/test_synth_recipes.py tests/test_synth_archetypes_present.py` | ✅ |
| T3 snapshots | 01 | 1 | `pytest …snapshots…schema…recipes…archetypes…write_set…` | ✅ |
| T1 oracle | 02 | 2 | `pytest tests/test_synth_oracle_schema.py` | ✅ |
| T2 personas + plan | 02 | 2 | `pytest tests/test_synth_seed_plan.py tests/test_synth_auth_personas.py` | ✅ |
| T3 atomic seed | 02 | 2 | `pytest …oracle…seed…auth…atomic…` | ✅ |
| T1 teardown gate | 03 | 3 | `pytest tests/test_synth_write_set_gate.py tests/test_synth_teardown_safety.py` | ✅ |
| T2 CLI/API | 03 | 3 | `pytest tests/test_synth_cli_defaults.py tests/test_synth_routes.py` | ✅ |
| T3 role + suite | 03 | 3 | `pytest tests/test_synth_*.py` | ✅ |
| T4 human dry-run | 03 | 3 | checkpoint (manual) | ✅ N/A |

Sampling: each wave has 3 auto tasks, all with `<automated>` → ✅  
Wave 0: all VALIDATION.md files created in 37-01 T1 → ✅  
Watch-mode / full Playwright suite as verify → none → ✅  
Overall Nyquist: ✅ PASS

---

## Coverage matrix

| Requirement | Plans | Tasks | Verify | Status |
|-------------|-------|-------|--------|--------|
| SYNTH-01 | 01 | T2 | `test_synth_recipes.py` | COVERED |
| SYNTH-02 | 01 | T3 | `test_synth_snapshots.py` + `test_synth_snapshot_schema.py` | COVERED |
| SYNTH-03 | 02, 03 | 02-T2/T3, 03-T2 | `test_synth_seed_plan.py` + `test_synth_auth_personas.py` | COVERED |
| SYNTH-04 | 02 | T1/T3 | `test_synth_oracle_schema.py` + `test_synth_atomic_seed.py` | COVERED |
| SYNTH-05 | 01, 03 | 01-T2/T3, 03-T4 | `test_synth_archetypes_present.py` + dry-run checkpoint | COVERED |

| Decision | Implementing plan/task | Status |
|----------|------------------------|--------|
| D-01 snapshot replay / explicit refresh | 01-T3, 03-T2 | OK |
| D-02 Phase 2 URL pack base | 01 interfaces + T3 JSONL bootstrap | OK (Siena optional sixth skipped = discretion) |
| D-03 partial menu_quality | 01-T3 | OK |
| D-04 never invent sell prices | 01-T3, 02 must_haves | OK |
| D-05 ≥5 named recipes | 01-T2 | OK |
| D-06 URL→archetype mapping | 01 interfaces locked | OK |
| D-07 opening stock config | 01-T2 | OK |
| D-08 dedicated oracle tables | 02-T1 | OK |
| D-09 bulletproof fact types | 02-T1 (6 fact_types) | OK |
| D-10 atomic fail-closed | 02-T3 | OK |
| D-11/D-12 write-set gate | 03-T1 (+ 01 constants) | OK — equality + handlers incl. library* |
| D-13 shared teardown; never e2e; never-raise | 03-T1 | OK — sim-filtered library; e2e hard-guard |
| D-14 CLI + API | 03-T2 | OK |
| D-15 pnpm → Python module | 03-T2 | OK |
| D-16 dry-run default / `--apply` | 03-T2 | OK |
| D-17 role isolation | 02-T2, 03-T3 | OK (prod_e2e secrets-gated) |
| D-18 owner+manager+staff | 02-T2 | OK |
| D-19 env secrets | 02-T2 `env.example` | OK |

---

## Blockers (must fix)

**None.**

---

## Residual warnings (non-blocking)

### W1. [scope_sanity] Plan 37-01 ~31 `files_modified`

- Wave 0 scaffolds inflate count; plan notes this as intentional Nyquist continuity.
- **Action:** Execute with awareness; split only if executor context overflows.

### W2. [scope_sanity] Plan 37-03 has 4 tasks (3 auto + 1 checkpoint)

- At warning threshold. Acceptable; do not add more auto work.

### W3. [context_compliance] D-17 live RLS proof is secrets-skippable

- Documented in VALIDATION + 37-03 must_haves. Correct when secrets absent.
- **Action:** If secrets present in execute env, treat prod_e2e green as required for phase verify.

### W4. [requirement_coverage] SYNTH-05 / ROADMAP “live” vs dry-run gate

- Checkpoint requires dry-run for all 5; multi-archetype `--apply` is gated/manual.
- Clarified in 37-03 must_haves: “live” = recipes+snapshots+seed path ready; cloud multi-seed when secrets+gate green.

---

## Structured issues

```yaml
issues: []
# Residual warnings (non-blocking) retained for executor awareness:
warnings:
  - plan: "37-01"
    dimension: scope_sanity
    severity: warning
    description: "Plan 01 has ~31 files_modified (Wave 0 + datasets inflate count)."
    metrics:
      tasks: 3
      files: 31
    fix_hint: "Optional Wave 0 split only if context overflows; otherwise proceed."

  - plan: "37-03"
    dimension: scope_sanity
    severity: warning
    description: "Plan 03 has 4 tasks (warning threshold)."
    metrics:
      tasks: 4
    fix_hint: "Do not add more auto tasks; checkpoint is fine."

  - plan: "37-03"
    dimension: context_compliance
    severity: warning
    task: 3
    description: "D-17 prod_e2e may skip without secrets — documented but weakens live RLS proof."
    fix_hint: "Require green prod_e2e when SIM_* + Supabase secrets exist in execute env."

  - plan: null
    dimension: requirement_coverage
    severity: warning
    description: >
      Multi-archetype cloud --apply is manual-only; SYNTH-05 'live' satisfied
      primarily by recipes/snapshots/dry-run unless secrets present.
    fix_hint: "Keep success language as clarified in 37-03 must_haves."
```

---

## What already looks strong (do not regress)

- UUID5 + `sim-{archetype}` slug (not string PKs) — explicit in 37-01
- Atomic fail-closed seed+oracle via SECURITY DEFINER RPC — 37-02 T3
- Strict `--apply` gate + full write-set handlers incl. `master_wine_library*` — 37-03 T1
- Never delete `e2e-test-restaurant`; SIM_* Auth users durable; sim-filtered library deletes — 37-03
- Snapshot replay default; refresh separate — 37-01/03
- SimPOS / Phase 38 explicitly excluded
- Full Nyquist Wave 0 + per-task `<automated>` verify
- Wave deps acyclic and consistent with ROADMAP
- RESEARCH open questions fully RESOLVED

---

## Recommendation

**PLAN CHECK PASSED.** No blockers remain.

Safe to run `/gsd-execute-phase 37`. Residual warnings are executor awareness only (scope volume, secrets-gated D-17, dry-run vs cloud live).
