# Phase 37 Plan Check — Synthetic Restaurant Engine

**Checked:** 2026-07-27  
**Plans verified:** 37-01, 37-02, 37-03 (3 plans / 3 waves)  
**Verdict:** **ISSUES FOUND** — 2 blocker(s), 5 warning(s)

Plans cover SYNTH-01..05 and D-01..D-19 in structure, but two gaps will prevent a clean hard-gate / research-resolution pass before execution.

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
| Strict write-set ↔ teardown before multi-archetype `--apply` | PARTIAL | List equality planned; **library sweep underspecified** |
| Never delete `e2e-test-restaurant` | YES | 37-03 T1 |
| Auth personas + staff ≠ manager | YES (unit + secrets-gated prod_e2e) | 37-02 T2, 37-03 T3 — D-17 |
| Phase 38 SimPOS out of scope | YES | Explicit OUT OF SCOPE in 37-02/03 |

---

## Dimension results

| # | Dimension | Result |
|---|-----------|--------|
| 1 | Requirement coverage | ✅ PASS — SYNTH-01..05 in frontmatter + concrete tasks |
| 2 | Task completeness | ✅ PASS — all `auto` tasks have files/action/verify/done; TDD where required |
| 3 | Dependency correctness | ✅ PASS — `[]` → `37-01` → `37-01+37-02`; waves 1/2/3 match |
| 4 | Key links planned | ❌ FAIL — teardown omit for `master_wine_library*` (see B2) |
| 5 | Scope sanity | ⚠️ WARN — 37-01 ~31 files; 37-03 has 4 tasks |
| 6 | Verification derivation | ✅ PASS — user-observable must_haves + Nyquist map |
| 7 | Context compliance | ✅ PASS — D-01..D-19 mapped; deferred SimPOS excluded; skins skipped = discretion |
| 7b | Scope reduction | ✅ PASS — no silent v1/stub of locked decisions (stubs are wave-scaffolds only) |
| 7c | Architectural tier | ✅ PASS — seed/oracle DB+RPC; Auth Admin backend; role proof Nest/JWT |
| 8 | Nyquist compliance | ✅ PASS — VALIDATION.md present; all auto tasks have `<automated>`; Wave 0 scaffolds in 37-01 T1; sampling OK |
| 9 | Cross-plan data contracts | ⚠️ WARN — write_set always includes library; seed “if used”; teardown order incomplete |
| 10 | CLAUDE.md compliance | ⏭️ SKIPPED (no root CLAUDE.md) |
| 11 | Research resolution | ❌ FAIL — Open Questions not marked RESOLVED |
| 12 | Pattern compliance | ⚠️ WARN — analogs cited in context; `oracle.py` missing from PATTERNS File Classification |

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
| D-11/D-12 write-set gate | 03-T1 (+ 01 stub) | **GAP — see B2** |
| D-13 shared teardown; never e2e; never-raise | 03-T1 | OK intent; library sweep gap |
| D-14 CLI + API | 03-T2 | OK |
| D-15 pnpm → Python module | 03-T2 | OK |
| D-16 dry-run default / `--apply` | 03-T2 | OK |
| D-17 role isolation | 02-T2, 03-T3 | OK (prod_e2e secrets-gated) |
| D-18 owner+manager+staff | 02-T2 | OK |
| D-19 env secrets | 02-T2 `env.example` | OK |

---

## Blockers (must fix)

### B1. [research_resolution] RESEARCH.md Open Questions not resolved

- **Plan:** null (phase artifact)
- **Dimension:** research_resolution
- **Severity:** blocker
- **Description:** `37-RESEARCH.md` has `## Open Questions` without `(RESOLVED)` and no per-question `RESOLVED` markers. Questions still listed as open at Metadata §Open Questions (DSN vs RPC; Turkish URL; master_wine_library policy; e2e anchor presence).
- **Fix:** Update RESEARCH to `## Open Questions (RESOLVED)` reflecting plan locks:
  1. Prefer `seed_sim_restaurant()` SECURITY DEFINER RPC (37-02); optional `DATABASE_URL` path secondary.
  2. Turkish clone = Avli Taverna Lincoln Park (37-01).
  3. Provisional `master_wine_library` (+ submissions) **are** in write-set when inserted; teardown deletes only sim-tagged / deterministic sim wine_ids (see B2).
  4. Teardown always hard-guards `e2e-test-restaurant` whether or not row is present.

### B2. [key_links_planned / context_compliance] Teardown write-set incomplete for library tables

- **Plan:** 37-03
- **Task:** 1
- **Dimension:** key_links_planned (also D-11/D-12/D-13)
- **Severity:** blocker
- **Description:** `SYNTH_WRITE_SET` (37-01) includes `master_wine_library` and `master_wine_library_submissions`, and the D-11 gate requires list equality — but 37-03 interfaces specify FK-safe delete order as only:

  `facts → runs → inventory → menu_items → menus → ura → restaurants → org_members → organizations`

  Missing: `master_wine_library_submissions`, `master_wine_library`, and naming consistency (`restaurant_menus` vs `menus`). Gate can go green while teardown leaves library orphans (RESEARCH A5 / Open Q3) — undermines the SYNTHETIC-TENANT hard gate before multi-archetype `--apply`.
- **Fix:** In 37-03 Task 1 `<action>` / `<behavior>` / `<done>`:
  1. Expand delete order to cover **every** `SYNTH_WRITE_SET` table (except Auth/`users` NO-OP).
  2. Specify safe library filter (e.g. `metadata source=sim` / UUID5 wine ids under `sim.wine.*`) — never delete non-sim library rows.
  3. Extend `test_synth_teardown_safety.py` to assert each write-set table has a teardown handler / order entry (not only e2e-skip + never-raise).
  4. Align naming: always `restaurant_menus` (not `menus`).

---

## Warnings (should fix)

### W1. [scope_sanity] Plan 37-01 ~31 `files_modified`

- Task 1 alone lists ~18 files (Wave 0 scaffolds). Threshold warn/blocker territory.
- **Fix (optional):** Split Wave 0 scaffolds into `37-00` or keep as-is with executor note that most files are empty tests + JSON data.

### W2. [scope_sanity] Plan 37-03 has 4 tasks (3 auto + 1 checkpoint)

- At warning threshold (4). Acceptable; do not add more auto work to this plan.

### W3. [context_compliance] D-17 live RLS proof is secrets-skippable

- Documented in VALIDATION + 37-03 must_haves. Correct for missing secrets; do **not** claim RLS proof from service-role.
- **Fix:** Keep skip message mandatory; if secrets present in execute env, treat prod_e2e green as required for phase verify.

### W4. [requirement_coverage] SYNTH-05 / ROADMAP “live” vs dry-run gate

- Phase checkpoint requires dry-run for all 5; multi-archetype `--apply` is manual-only / optional single-archetype apply.
- Acceptable given secrets + D-11 gate; clarify in SUCCESS that “live archetypes” = recipes+snapshots+seed path ready, with cloud multi-seed when secrets+gate green.

### W5. [pattern_compliance] `scripts/synth/oracle.py` not in PATTERNS File Classification

- Plans reference RESEARCH schema; add `oracle.py` row (analog: RESEARCH Ground-truth schema / migration SECURITY DEFINER) for completeness.

### W6. [cross_plan_data_contracts] Library membership inconsistency

- 37-01 always lists library tables; 37-02 says “(+ submissions if used)”. Lock one rule: if seed may insert provisional wines, they stay in write-set **and** teardown (B2); if seed never inserts library, remove from both lists.

---

## Structured issues

```yaml
issues:
  - plan: null
    dimension: research_resolution
    severity: blocker
    description: >
      37-RESEARCH.md ## Open Questions lacks (RESOLVED) and inline RESOLVED
      markers (DSN vs RPC, Turkish URL, master_wine_library policy, e2e anchor).
    fix_hint: >
      Mark ## Open Questions (RESOLVED) with plan locks: RPC preferred,
      Avli Turkish, sim-filtered library teardown, e2e never-delete guard.

  - plan: "37-03"
    dimension: key_links_planned
    severity: blocker
    task: 1
    description: >
      Teardown FK order omits master_wine_library(+submissions) while
      SYNTH_WRITE_SET includes them; D-11 gate can pass with orphan library rows.
    fix_hint: >
      Expand teardown order + sim-only library filter; assert handlers cover
      full write-set; use restaurant_menus naming consistently.

  - plan: "37-01"
    dimension: scope_sanity
    severity: warning
    description: "Plan 01 has ~31 files_modified (Wave 0 + datasets inflate count)."
    metrics:
      tasks: 3
      files: 31
    fix_hint: "Optional Wave 0 split; otherwise execute with awareness of scaffold volume."

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
    fix_hint: "Clarify success language; optionally require one --apply when secrets present."

  - plan: "37-02"
    dimension: pattern_compliance
    severity: warning
    description: "oracle.py not listed in PATTERNS.md File Classification."
    fix_hint: "Add oracle.py analog row pointing at RESEARCH schema / migration pattern."

  - plan: "37-01"
    dimension: cross_plan_data_contracts
    severity: warning
    description: "write_set always includes library tables; seed says 'if used'."
    fix_hint: "Lock single policy across 01–03 (include+teardown vs exclude from both)."
```

---

## What already looks strong (do not regress)

- UUID5 + `sim-{archetype}` slug (not string PKs) — explicit in 37-01
- Atomic fail-closed seed+oracle via SECURITY DEFINER RPC — 37-02 T3
- Strict `--apply` gate wiring — 37-03 T1/T2
- Never delete `e2e-test-restaurant`; SIM_* Auth users durable — 37-03
- Snapshot replay default; refresh separate — 37-01/03
- SimPOS / Phase 38 explicitly excluded
- Full Nyquist Wave 0 + per-task `<automated>` verify
- Wave deps acyclic and consistent with ROADMAP

---

## Recommendation

**2 blocker(s) require revision.** Return to planner:

1. Resolve RESEARCH Open Questions (mark RESOLVED with plan decisions).
2. Complete 37-03 teardown write-set for `master_wine_library*` (sim-filtered) + test assertion + naming alignment.

After those two fixes (and optional W5/W6 tidy), re-run plan check → expect **PLAN CHECK PASSED**.

**Do not run `/gsd-execute-phase 37` until blockers cleared.**
