---
phase: 36
slug: testing-foundation-functionality-registry
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-27
---

# Phase 36 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Sourced from `36-RESEARCH.md` Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.7 (api-gateway) + Vitest 2.1 (web) + pytest 7.4.4 (orchestrator) + Playwright 1.58 |
| **Config file** | `apps/api-gateway/package.json#jest`, `apps/web/vitest.config.ts`, `services/agent-orchestrator/pytest.ini`, `apps/web/playwright*.config.ts` |
| **Quick run command** | Doc greps for TFND artifacts + `pnpm --filter @wineops/api-gateway test -- --listTests` / `pytest --collect-only -q` when inventory changes |
| **Full suite command** | Confirm all `.planning/testing/` TFND artifacts exist + cross-link; optional `pnpm test` / pytest collect (do not require full suite green — Phase 36 does not fix CI Black debt) |
| **Estimated runtime** | ~30s for doc/inventory checks |

---

## Sampling Rate

- **After every task commit:** Run TFND doc assertion greps for files touched
- **After every plan wave:** Confirm all six TFND deliverables exist and cross-link
- **Before `/gsd-verify-work`:** TFND-01..06 acceptance greps green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 36-01-01 | 01 | 1 | TFND-02 | — | N/A | doc | `rg 'T0|T1|T2|T3|T4|promote' .planning/testing/RUBRIC.md` | ❌ W0 | ⬜ pending |
| 36-01-02 | 01 | 1 | TFND-01 | — | N/A | doc | `rg -n 'manual_pass|Phase 38|/sim|Contested' .planning/testing/FUNCTIONALITY-REGISTRY.md` | ❌ W0 | ⬜ pending |
| 36-02-01 | 02 | 2 | TFND-03 | — | N/A | inventory | Diff find vs inventory + locked `N-shortname` slugs + Vitest floor | ❌ W0 | ⬜ pending |
| 36-02-02 | 02 | 2 | TFND-04 | — | N/A | doc | `rg -n 'T1\\?|CI green unverified|capability-unverified' .planning/testing/TESTING-SCORECARD.md` | ❌ W0 | ⬜ pending |
| 36-03-01 | 03 | 3 | TFND-06 | T-36-01..04 | sim-* isolation; no JWT in logs | doc | `rg -n 'E2E_TABLES|sim-\\*|URA|user_restaurant_access' .planning/testing/SYNTHETIC-TENANT.md` | ❌ W0 | ⬜ pending |
| 36-03-02 | 03 | 3 | TFND-05 | T-36-05 | secrets stay in GH secrets | workflow+doc | `rg -n 'capability-unverified|Operator quickstart|g\\{N\\}' .planning/testing/README.md .planning/testing/checklists/README.md .github/workflows/{ci,e2e-prod}.yml` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `.planning/testing/FUNCTIONALITY-REGISTRY.md` — TFND-01
- [ ] `.planning/testing/RUBRIC.md` — TFND-02
- [ ] `.planning/testing/EXISTING-TEST-INVENTORY.md` — TFND-03
- [ ] `.planning/testing/TESTING-SCORECARD.md` — TFND-04
- [ ] `.planning/testing/SYNTHETIC-TENANT.md` — TFND-06
- [ ] `.planning/testing/README.md` — operator-quickstart-first index
- [ ] `.planning/testing/checklists/README.md` — naming stub `g{N}-{slug}-manual.md`
- [ ] Optional: `scripts/testing/check-inventory-coverage.sh`
- [ ] Optional: CI comment annotations for TFND-05 clarity (workflows already exist; mark capability-unverified)

*Wave 0 = create the documentation/CI annotation artifacts themselves — this phase's deliverables ARE the Wave 0 gaps.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Registry mapping completeness feel | TFND-01 | Judgement on edge-case primary-group assignment | Spot-check 5 shared modules; confirm primary group + secondary note |
| Honest `passes?` column | TFND-03 | Full suite may be red / cloud-gated | Do not claim green without evidence; use `unknown` / `stale` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter after execution

**Approval:** pending
