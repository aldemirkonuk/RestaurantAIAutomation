---
phase: 37
slug: synthetic-restaurant-engine
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-27
---

# Phase 37 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Sourced from `37-RESEARCH.md` Validation Architecture.
> `workflow.nyquist_validation: true` in `.planning/config.json`.

**Wave estimate:** ~3 waves — (1) snapshots + recipes, (2) seed + oracle + auth, (3) teardown gate + CLI/API.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.4.4 (+ pytest-asyncio) |
| **Config file** | `services/agent-orchestrator/pytest.ini` |
| **Quick run command** | `cd services/agent-orchestrator && pytest tests/test_synth_write_set_gate.py tests/test_synth_recipes.py -q` |
| **Full suite command** | `cd services/agent-orchestrator && pytest tests/test_synth_*.py -q` |
| **Cloud / role isolation** | `cd services/agent-orchestrator && pytest tests/e2e/test_synth_role_isolation.py -m prod_e2e -q` (requires SIM_* + Supabase secrets) |
| **Nest (optional)** | `pnpm --filter api-gateway test -- --testPathPattern=synth` — only if Nest wrappers land (not required) |
| **Estimated runtime** | ~30–60s unit suite; cloud role isolation gated by secrets |

---

## Sampling Rate

- **After every task commit:** quick synth unit tests for the wave just touched
- **After every plan wave:** full `pytest tests/test_synth_*.py -q`
- **Before `/gsd-verify-work`:** full synth suite green + dry-run generate for all 5 archetypes; `--apply` only with secrets + write-set gate green
- **Max feedback latency (unit):** ~60 seconds

---

## Feedback Continuity

Phase 37 **implements** the seed/teardown expansion that Phase 36 documented only.

| Upstream artifact | Continuity rule |
|-------------------|-----------------|
| `.planning/testing/SYNTHETIC-TENANT.md` | Hard gate: expand teardown to cover generator write-set **before** first multi-archetype cloud `--apply`. Never delete `e2e-test-restaurant`. Extend `conftest_prod.py` — do not fork a second harness. |
| Phase 36 TFND-06 / D-11–D-13 (CONTEXT) | Write-set ↔ teardown equality is a **blocking** verify before multi-archetype seed (`test_synth_write_set_gate.py`). Teardown never raises; Sentry `sim-orphan`. |
| Phase 36 `E2E_TABLES` gap | Current 8-table `E2E_TABLES` is insufficient; Phase 37 `SYNTH_WRITE_SET` / shared `scripts/synth/teardown.py` must equal generator tables (orgs, restaurants, URA, menus, inventory, `sim_ground_truth_*`, …). |
| ID strategy note | SYNTHETIC-TENANT conceptual `sim-*` id text → live schema uses **UUID5** `restaurants.id` + **`slug LIKE 'sim-%'`** for teardown resolution (see `37-RESEARCH.md`). |

Sampling continuity: no 3 consecutive tasks without an automated verify command from the map below.

---

## Secure Isolation Notes

| Concern | Control | Verify |
|---------|---------|--------|
| **SIM_* secrets** | `SIM_OWNER_EMAIL`/`PASSWORD`, `SIM_MANAGER_*`, `SIM_STAFF_*` (env / GH Actions only). Names in `.env.example`; **never commit values**. | Grep CI/logs for password/`eyJ` patterns; dry-run dumps must not include credentials |
| **Auth personas (D-17)** | Three **distinct** Auth users; URA role per `sim-*` restaurant. Not one shared login with flipped roles. | `test_synth_auth_personas.py` + `test_synth_role_isolation.py` (staff JWT → 403 on manager routes) |
| **JWT / password hygiene** | Never log JWTs or passwords; never write JWT to disk / JUnit. Reuse `prod_jwt` session pattern. | SYNTHETIC-TENANT anti-patterns still in force |
| **Service-role vs RLS proof** | Service-role for seed/teardown only; user-path assertions use password-grant JWT. | Role isolation test must use staff JWT, not service role |
| **Teardown scope** | Delete sim restaurant subtree + oracle + URA only; **do not delete** shared SIM_* Auth users or `e2e-test-restaurant`. | `test_synth_teardown_safety.py` |
| **Admin API** | Thin `/api/v1/admin/synth/*` requires `X-Admin-Key`; default body `apply: false`. | `test_synth_cli_defaults.py` (+ API wrapper tests if present) |
| **Oracle spoofing** | No anon/client write to `sim_ground_truth_*`; seed via service-role / SECURITY DEFINER TX. | Schema RLS enabled; unit atomic-seed tests |

---

## Per-Task Verification Map

Task IDs are planning estimates for ~3 waves (adjust when PLAN.md lands). Threat refs map to RESEARCH Security Domain patterns.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 37-01-01 | 01 | 1 | SYNTH-01 | — | N/A | unit | `cd services/agent-orchestrator && pytest tests/test_synth_recipes.py -q` | ❌ W0 | ⬜ pending |
| 37-01-02 | 01 | 1 | SYNTH-02 | — | No network on generate | unit | `cd services/agent-orchestrator && pytest tests/test_synth_snapshots.py -q` | ❌ W0 | ⬜ pending |
| 37-01-03 | 01 | 1 | SYNTH-02 | — | Snapshot schema only | unit | `cd services/agent-orchestrator && pytest tests/test_synth_snapshot_schema.py -q` | ❌ W0 | ⬜ pending |
| 37-01-04 | 01 | 1 | SYNTH-05 | — | ≥5 recipes + snapshots | unit | `cd services/agent-orchestrator && pytest tests/test_synth_archetypes_present.py -q` | ❌ W0 | ⬜ pending |
| 37-02-01 | 02 | 2 | SYNTH-03 | T-seed | Dry-run lists write-set | unit | `cd services/agent-orchestrator && pytest tests/test_synth_seed_plan.py -q` | ❌ W0 | ⬜ pending |
| 37-02-02 | 02 | 2 | SYNTH-03 | T-priv | Distinct owner/manager/staff URA | unit | `cd services/agent-orchestrator && pytest tests/test_synth_auth_personas.py -q` | ❌ W0 | ⬜ pending |
| 37-02-03 | 02 | 2 | SYNTH-04 | T-oracle | Fact types present | unit | `cd services/agent-orchestrator && pytest tests/test_synth_oracle_schema.py -q` | ❌ W0 | ⬜ pending |
| 37-02-04 | 02 | 2 | SYNTH-04 | T-oracle | Oracle fail → TX rollback | unit/integration | `cd services/agent-orchestrator && pytest tests/test_synth_atomic_seed.py -q` | ❌ W0 | ⬜ pending |
| 37-03-01 | 03 | 3 | D-11 / D-12 | T-orphan | Write-set == teardown | unit | `cd services/agent-orchestrator && pytest tests/test_synth_write_set_gate.py -q` | ❌ W0 | ⬜ pending |
| 37-03-02 | 03 | 3 | D-13 | T-orphan | Never-raise; skip e2e anchor | unit | `cd services/agent-orchestrator && pytest tests/test_synth_teardown_safety.py -q` | ❌ W0 | ⬜ pending |
| 37-03-03 | 03 | 3 | D-16 | T-wipe | Default dry-run | unit | `cd services/agent-orchestrator && pytest tests/test_synth_cli_defaults.py -q` | ❌ W0 | ⬜ pending |
| 37-03-04 | 03 | 3 | D-17 | T-priv | Staff JWT ≠ manager | integration | `cd services/agent-orchestrator && pytest tests/e2e/test_synth_role_isolation.py -m prod_e2e -q` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

### Requirements → verify commands (summary)

| Req ID | Behavior | Automated Command |
|--------|----------|-------------------|
| **SYNTH-01** | Recipe defaults + overrides → full profile (cuisine, size, wine-program depth, sales volume, price tier, ordering rhythm) | `pytest tests/test_synth_recipes.py -q` |
| **SYNTH-02** | Generate replays frozen snapshots only (no live crawl); refresh schema under `datasets/sim/` | `pytest tests/test_synth_snapshots.py tests/test_synth_snapshot_schema.py -q` |
| **SYNTH-03** | Dry-run seed plan covers org/restaurant/team/menu/inventory; three distinct personas | `pytest tests/test_synth_seed_plan.py tests/test_synth_auth_personas.py -q` |
| **SYNTH-04** | Oracle fact types + fail-closed atomic seed | `pytest tests/test_synth_oracle_schema.py tests/test_synth_atomic_seed.py -q` |
| **SYNTH-05** | ≥5 distinct archetypes with mapped snapshots | `pytest tests/test_synth_archetypes_present.py -q` |
| **D-11 gate** | Multi-archetype `--apply` refused if write-set ≠ teardown | `pytest tests/test_synth_write_set_gate.py -q` |
| **D-13** | Teardown never raises; never deletes e2e anchor | `pytest tests/test_synth_teardown_safety.py -q` |
| **D-16** | CLI/API default dry-run | `pytest tests/test_synth_cli_defaults.py -q` |
| **D-17** | Staff JWT cannot call manager-gated path | `pytest tests/e2e/test_synth_role_isolation.py -m prod_e2e -q` |

---

## Wave 0 Requirements

Create before or with first implementation wave (all ❌ today):

- [ ] `services/agent-orchestrator/tests/test_synth_write_set_gate.py` — D-11/D-12
- [ ] `services/agent-orchestrator/tests/test_synth_recipes.py` — SYNTH-01
- [ ] `services/agent-orchestrator/tests/test_synth_snapshots.py` — SYNTH-02 replay / no-network
- [ ] `services/agent-orchestrator/tests/test_synth_snapshot_schema.py` — SYNTH-02 refresh schema
- [ ] `services/agent-orchestrator/tests/test_synth_seed_plan.py` — SYNTH-03 dry-run plan
- [ ] `services/agent-orchestrator/tests/test_synth_auth_personas.py` — SYNTH-03 / D-17 mapping
- [ ] `services/agent-orchestrator/tests/test_synth_oracle_schema.py` — SYNTH-04 fact types
- [ ] `services/agent-orchestrator/tests/test_synth_atomic_seed.py` — D-10 fail-closed (mocked conn / sqlite OK)
- [ ] `services/agent-orchestrator/tests/test_synth_archetypes_present.py` — SYNTH-05
- [ ] `services/agent-orchestrator/tests/test_synth_teardown_safety.py` — never-raise + anchor guard
- [ ] `services/agent-orchestrator/tests/test_synth_cli_defaults.py` — D-16
- [ ] `services/agent-orchestrator/tests/e2e/test_synth_role_isolation.py` — D-17 (secrets-gated)
- [ ] `scripts/synth/write_set.py` — shared `SYNTH_WRITE_SET` imported by tests + CLI + conftest
- [ ] Migration for `sim_ground_truth_runs` / `sim_ground_truth_facts` (impl wave; schema tests may use SQL fixtures)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual / Gated | Test Instructions |
|----------|-------------|--------------------|-------------------|
| Multi-archetype cloud `--apply` | SYNTH-03..05 | Needs service-role + SIM_* secrets + gate green | `pnpm synth:generate -- --archetype all --apply` only after `test_synth_write_set_gate` green; confirm 5 `slug LIKE 'sim-%'` restaurants + oracle runs |
| Explicit snapshot refresh crawl | SYNTH-02 | Needs crawl API keys; not CI default | `pnpm synth:refresh -- --archetype turkish-clone`; inspect `datasets/sim/menus/*.json` |
| Staff cannot enter manager account | D-17 | Live Auth + Nest stack | Log in as SIM_STAFF; hit manager invite/listMembers → expect 403; confirm separate SIM_MANAGER credentials work |
| Teardown leaves e2e anchor + Auth users | D-13 | Cloud destructive path | `pnpm synth:teardown`; assert `e2e-test-restaurant` still present; SIM_* Auth users still exist |

---

## Phase Gate Checklist

- [ ] All SYNTH-01..05 have automated verify commands above
- [ ] Write-set ↔ teardown gate green before any multi-archetype `--apply`
- [ ] Dry-run generate succeeds for all 5 archetypes
- [ ] Full `pytest tests/test_synth_*.py -q` green
- [ ] Role isolation either green (`prod_e2e`) or explicitly deferred with secrets caveat (do not claim RLS proof from service-role)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING test/module references
- [ ] No watch-mode flags in verify commands
- [ ] Feedback Continuity rules from SYNTHETIC-TENANT.md honored
- [ ] `nyquist_compliant: true` set in frontmatter after execution proves map green

**Approval:** pending

---

*Phase: 37 — Synthetic Restaurant Engine*
*Validation drafted: 2026-07-27*
