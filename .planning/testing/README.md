# Testing Campaign — Operator Front Door

**Phase 36** locked the documentation skeleton for the Testing Campaign (Phases 36–43). Start here — not in the inventory.

## Operator quickstart

1. Open [`TESTING-SCORECARD.md`](./TESTING-SCORECARD.md) — 11-row board
2. Pick a group → open that section in [`FUNCTIONALITY-REGISTRY.md`](./FUNCTIONALITY-REGISTRY.md)
3. For manual work → [`checklists/`](./checklists/) (stub now; filled in Phases 39–40 / 43)
4. For score fights → [`RUBRIC.md`](./RUBRIC.md) + inventory evidence paths — **do not browse inventory first**

Status oracle for ✅/⚠️/❌ before writing checklist steps: [`.planning/UX_PATHS_CATALOG.md`](../UX_PATHS_CATALOG.md).

---

## Artifact index

| File | TFND | Purpose |
|------|------|---------|
| [`FUNCTIONALITY-REGISTRY.md`](./FUNCTIONALITY-REGISTRY.md) | 01 | 11 locked groups + surface → group maps |
| [`RUBRIC.md`](./RUBRIC.md) | 02 | T0–T4 definitions + promotion evidence standards |
| [`EXISTING-TEST-INVENTORY.md`](./EXISTING-TEST-INVENTORY.md) | 03 | Catalog of existing automated tests (agent-facing) |
| [`TESTING-SCORECARD.md`](./TESTING-SCORECARD.md) | 04 | 11-row maturity board + Gaps |
| [`SYNTHETIC-TENANT.md`](./SYNTHETIC-TENANT.md) | 06 | `sim-*` isolation convention (extends Phase 25) |

Manual checklist naming: [`checklists/README.md`](./checklists/README.md).

---

## How to update scores

Follow the RUBRIC promotion protocol:

1. Add or change evidence rows in [`EXISTING-TEST-INVENTORY.md`](./EXISTING-TEST-INVENTORY.md) (paths + `runs?` / `passes?`).
2. Apply [`RUBRIC.md`](./RUBRIC.md) evidence standards — cite inventory paths **and** CI job names; never promote on file-count alone.
3. Update the matching row in [`TESTING-SCORECARD.md`](./TESTING-SCORECARD.md) (score, Evidence, Gaps, date).
4. **Do not promote past T1** until inventory `passes?=yes` **or** an explicit waiver is recorded in Gaps.

---

## CI proof links + honesty banner (C1 + H5)

| Workflow | Jobs / schedule | Role |
|----------|-----------------|------|
| [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) | `test-typescript`, `test-python`, `test-e2e` | Unit + integration on push; local Playwright smoke |
| [`.github/workflows/e2e-prod.yml`](../../.github/workflows/e2e-prod.yml) | cron `0 2 * * *` | Nightly cloud production E2E (Phase 25) |

**Do not treat TFND-05 as green CI.** Black debt on `services/agent-orchestrator/api/studio_routes.py` as of **2026-07-27** may keep `main` red (Lint Python / Run Black). Downstream test jobs are not a trustworthy green signal until lint is green.

**Nightly secrets status (names only, never values):** **secrets present? no as of 2026-07-27** (premortem / scorecard baseline from `gh run view` on a recent `e2e-prod` run — empty `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `E2E_TEST_EMAIL`, `E2E_TEST_PASSWORD`, etc.). No durable `test-results/` wave XML observed → TFND-05 = **schedule-present / capability-unverified** until one wave XML lands.

TFND-05 = wiring documented; `main` may still be red; **do not promote scores from green-wishful thinking**.

---

## Out of scope (later phases)

| Phase | Owns |
|-------|------|
| 37 | Synthetic restaurant generator + teardown table expansion |
| 38 | SimPOS / control panel |
| 39–40 | Breadth suites + filled checklists (g1–7, g9) |
| 41 | Truth / ground-truth oracles |
| 42 | AI eval weekly workflow (separate from `e2e-prod.yml`) |
| 43 | Scanner / admin / journey overlays + final manual pass |
