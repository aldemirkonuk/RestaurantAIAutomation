---
phase: 36-testing-foundation-functionality-registry
verified: 2026-07-27T20:10:11Z
status: passed
score: 6/6 must-haves verified
overrides_applied: 0
gaps: []
deferred: []
human_verification: []
---

# Phase 36: Testing Foundation & Functionality Registry Verification Report

**Phase Goal:** Create the shared skeleton every later testing phase writes into: what the functionality groups are, how coverage is scored, what tests already exist, and where results live. After this phase, "how tested is X?" has a single canonical answer.

**Verified:** 2026-07-27T20:10:11Z  
**Status:** passed  
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

Roadmap success criteria (contract) plus plan must-haves that refine them. SUMMARY claims were not trusted — counts and greps run against live files.

| # | Truth | Status | Evidence |
| --- | ------- | ---------- | -------------- |
| 1 | `.planning/testing/FUNCTIONALITY-REGISTRY.md` exists: 11 groups; every Nest module, web route, orchestrator agent, and DB domain mapped to exactly one primary | ✓ VERIFIED | 11 locked group names present; Nest dirs 34/34 in Table A; App.tsx `path=` 39/39 in Table B; agents `*.py` 26/26 in Table C; Table D 11 domain buckets; collision rules + contested surfaces + `/sim` Phase 38 row + `RecurringOrders` orphan |
| 2 | T0–T4 rubric locked (T0 untested … T4 ground-truth/golden) with Agent Level mirror and promote-past-T1 guard | ✓ VERIFIED | `.planning/testing/RUBRIC.md` — locked definition strings; Level mirror table; Evidence standards require inventory+CI jobs; forbid promote past T1 without `passes?=yes` or waiver; Agent Level ≠ automatic T-level |
| 3 | Existing-test inventory complete: every Jest/Vitest/Playwright/pytest file catalogued (group, runs?, passes?) — kept as-is | ✓ VERIFIED | `EXISTING-TEST-INVENTORY.md`: 142 data rows; find floors met (gateway 41/41, web src 30, e2e 4, orch 67); 0 missing paths; header `group\|path\|runner\|layer\|ci_job\|runs?\|passes?\|notes`; locked `N-shortname` slugs only; `passes?=yes` claims = 0; stale-suspect on `test_golden_path_e2e 2.py` |
| 4 | `TESTING-SCORECARD.md` initialized with baseline score + evidence per group | ✓ VERIFIED | Exactly 11 data rows; scores T0/T1? only (no T4); Evidence cites inventory paths; Gaps include `CI green unverified` + UX traps for groups 1,2,3,8,11; Consistency note reconciles 10 Nest modules; CI/E2E honesty block |
| 5 | GitHub Actions: unit + integration on push; nightly E2E scheduled (Phase 25 patterns, no fork) | ✓ VERIFIED | `ci.yml` TFND-05 comment block maps `test-typescript`/`test-python`/`test-e2e` + points to `e2e-prod.yml` cron `0 2 * * *`; jobs still present; `e2e-prod.yml` retains cron + Phase 42/D-24/`capability-unverified` comments; no `testing-campaign.yml`; no `PYTEST_RUNNING` |
| 6 | Synthetic tenant convention: `sim-*` prefix, RLS-safe seeding, idempotent teardown (extends Phase 25) | ✓ VERIFIED | `SYNTHETIC-TENANT.md`: `SIM_ID_PREFIX`/`SIM_ROW_PREFIX`; seed checklist (restaurants `sim-*` + URA + Auth user + service-role seed/teardown only); all 8 `E2E_TABLES` match `conftest_prod.py`; gap vs Table D + Phase 37 expand-before-multi-archetype gate; NEVER delete `e2e-test-restaurant`; NEVER raise in teardown |

**Score:** 6/6 truths verified

### Plan must-have refinements (all verified)

| Source | Refinement | Status |
|--------|------------|--------|
| 36-01 | Contested surfaces: receiving door / contacts / compliance_agent; suite owner = primary | ✓ |
| 36-01 | Registry ↔ RUBRIC + UX_PATHS_CATALOG cross-links; Nest tokens `pos-hub`/`inventory-ledger`/`ux-optimizer` | ✓ |
| 36-02 | Inventory honesty: TFND-05 ≠ green CI; Black/`studio_routes.py`; stale-suspect excluded from T1 | ✓ |
| 36-02 | Scorecard Nest sample reconcile (auth…common) | ✓ |
| 36-03 | README Operator quickstart first; artifact index TFND-01..06; checklists `g{N}-{slug}-manual.md` stub only | ✓ |
| 36-03 | SYNTHETIC-TENANT ↔ `conftest_prod.py` / `E2E_TABLES` / `inventory_stock` | ✓ |

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | ----------- | ------- | ------- |
| `.planning/testing/RUBRIC.md` | T0–T4 + Level mirror + evidence | ✓ VERIFIED | Substantive (~50 lines); wired from registry/scorecard/README |
| `.planning/testing/FUNCTIONALITY-REGISTRY.md` | 11-group surface map | ✓ VERIFIED | Tables A–D + contested + watchlist; not a stub |
| `.planning/testing/EXISTING-TEST-INVENTORY.md` | Full test catalog | ✓ VERIFIED | 142 rows; Methodology + Known anomalies |
| `.planning/testing/TESTING-SCORECARD.md` | 11-row baseline | ✓ VERIFIED | T1 protocol + honesty + UX Gaps |
| `.planning/testing/SYNTHETIC-TENANT.md` | sim-* convention | ✓ VERIFIED | RLS checklist + E2E_TABLES gap + Phase 37 gate |
| `.planning/testing/README.md` | Operator front door | ✓ VERIFIED | Quickstart before artifact table |
| `.planning/testing/checklists/README.md` | Naming contract | ✓ VERIFIED | No premature `g*-manual.md` files (0 found) |
| `.github/workflows/ci.yml` | TFND-05 annotations | ✓ VERIFIED | Comment-only; jobs unchanged in intent |
| `.github/workflows/e2e-prod.yml` | Nightly + Phase 42 placeholder | ✓ VERIFIED | Cron intact; capability-unverified |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| FUNCTIONALITY-REGISTRY.md | RUBRIC.md | “how tested is X?” maturity | ✓ WIRED | Explicit RUBRIC.md links in Purpose |
| FUNCTIONALITY-REGISTRY.md | apps/api-gateway/src/ | Nest Table A | ✓ WIRED | All 34 dirs named; pos-hub/inventory-ledger/ux-optimizer present |
| FUNCTIONALITY-REGISTRY.md | UX_PATHS_CATALOG.md | Manual pathway watchlist | ✓ WIRED | Catalog cite + §20/§E/§18/§3 |
| TESTING-SCORECARD.md | RUBRIC.md | Legend | ✓ WIRED | Header legend link |
| TESTING-SCORECARD.md | EXISTING-TEST-INVENTORY.md | Evidence paths | ✓ WIRED | Evidence column filenames |
| TESTING-SCORECARD.md | FUNCTIONALITY-REGISTRY.md | Ownership reconcile | ✓ WIRED | Consistency table |
| EXISTING-TEST-INVENTORY.md | ci.yml / e2e-prod.yml | ci_job membership | ✓ WIRED | Methodology + ci_job column values |
| SYNTHETIC-TENANT.md | conftest_prod.py | E2E_TABLES / extend pattern | ✓ WIRED | Verbatim 8-table list matches source |
| README.md | e2e-prod.yml + UX_PATHS_CATALOG | Honesty + status oracle | ✓ WIRED | CI banner + catalog link |
| ci.yml | test-typescript / test-python | TFND-05 block | ✓ WIRED | Lines 3–9 + job comments |

### Data-Flow Trace (Level 4)

Documentation phase — no runtime UI/API data path. Trace is **doc → filesystem corpus**:

| Artifact | “Data” variable | Source | Produces real data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| EXISTING-TEST-INVENTORY | inventory rows | `find` corpus on disk | Yes — 0 missing vs find | ✓ FLOWING |
| FUNCTIONALITY-REGISTRY Table A/B/C | surface maps | Nest dirs / App.tsx / agents/*.py | Yes — 34/39/26 complete | ✓ FLOWING |
| TESTING-SCORECARD Evidence | cited paths | inventory filenames | Yes (see Warning: one cross-group cite) | ✓ FLOWING |
| SYNTHETIC-TENANT E2E_TABLES | 8 table names | conftest_prod.py:251–260 | Exact match | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| All TFND artifacts exist | `test -f` on 7 paths under `.planning/testing/` | all OK | ✓ PASS |
| Nest/route/agent completeness | Python compare dirs/App.tsx/agents vs registry | 0 missing | ✓ PASS |
| Inventory completeness | Python compare find lists vs inventory | 0 missing; 142 rows | ✓ PASS |
| E2E_TABLES parity | Extract from conftest vs SYNTHETIC-TENANT | 8/8 present | ✓ PASS |
| No second E2E workflow / no PYTEST_RUNNING | file/env greps | absent | ✓ PASS |
| Full suite green | (not required Phase 36) | skipped — honesty docs say capability-unverified | ? SKIP |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| TFND-01 | 36-01 | Registry maps every module/page/agent/DB domain to one of 11 groups | ✓ SATISFIED | FUNCTIONALITY-REGISTRY.md Tables A–D; completeness script 0 missing |
| TFND-02 | 36-01 | T0–T4 rubric + Agent Level mirror | ✓ SATISFIED | RUBRIC.md locked defs + mirror + evidence standards |
| TFND-03 | 36-02 | Existing-test inventory (group, runs?, passes?) kept as-is | ✓ SATISFIED | EXISTING-TEST-INVENTORY.md 142 rows; 0 missing files; tests not reworked |
| TFND-04 | 36-02 | TESTING-SCORECARD baseline score + evidence | ✓ SATISFIED | 11 rows; Evidence + Gaps + Next phase |
| TFND-05 | 36-03 | Unit+integration on push; E2E nightly (extend Phase 25) | ✓ SATISFIED | ci.yml + e2e-prod.yml annotations; schedule-present / capability-unverified honesty (not green-CI claim) |
| TFND-06 | 36-03 | sim-* isolation, RLS-safe seed, idempotent teardown | ✓ SATISFIED | SYNTHETIC-TENANT.md checklist + teardown gap + Phase 37 gate |

**Orphaned requirements:** none — REQUIREMENTS.md Phase 36 lists TFND-01..06; all six appear in plan frontmatter (01→01/02, 02→03/04, 03→05/06).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| TESTING-SCORECARD.md | Group 1 Evidence | Cites `Header.userMenu.test.tsx` while inventory maps that path to `8-analytics` | ⚠️ Warning | Group 1 still has valid Evidence (`auth-profile.spec.ts`, `Profile.test.tsx`); Nest reconcile sample unaffected. Prefer cite only same-slug inventory paths next edit. |
| RUBRIC.md | Related links | Still labels scorecard/inventory as “(future)” though files exist | ℹ️ Info | Cosmetic doc drift; cross-links elsewhere are live |
| FUNCTIONALITY-REGISTRY.md | `/wine-agent`, `/wineagent` | PlaceholderPage routes | ℹ️ Info | Accurately mapped to group 10; not an incomplete registry |

No TODO/FIXME stubs, no hollow return stubs, no `passes?=yes` inflation, no second workflow fork.

### Human Verification Required

None. Completeness of maps and inventory was verified programmatically against the live tree. Contested-surface *judgment* is documented and locked (suite owner = primary); reopening it is product preference, not a missing deliverable.

### Gaps Summary

No actionable gaps. Phase goal achieved: a single canonical path exists for “how tested is X?” (registry → rubric → scorecard/inventory → README), with CI skeleton annotated honestly and `sim-*` convention locked for Phase 37+.

---

_Verified: 2026-07-27T20:10:11Z_  
_Verifier: Claude (gsd-verifier)_
