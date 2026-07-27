# Phase 36 PREMORTEM — Testing Foundation & Functionality Registry

**Assumed date:** ~2026-09-15 (6–8 weeks after 2026-07-27 lock)  
**Premise:** Phase 36 is marked complete; Phases 37–43 are stalled, scoring is untrusted, or the skeleton is ignored.  
**Inputs:** `36-CONTEXT.md`, `36-RESEARCH.md`, `36-01..03-PLAN.md`, `36-VALIDATION.md`, ROADMAP Testing Campaign, REQUIREMENTS TFND-01..06, `.github/workflows/ci.yml`, `e2e-prod.yml`, live spot-checks (2026-07-27).

---

## 1. Premortem scenario

By mid-September the Testing Campaign is thrashing: Phase 37 generators seed cloud tenants that leave orphans and fail under real JWT/RLS; Phases 39–40 “hit T2” by citing inventory file counts while push CI stays red on Black and nightly `e2e-prod.yml` never produces JUnit; Phase 41 cannot trust a ground-truth ledger because `sim-*` teardown only knew the eight Phase-25 `E2E_TABLES`; Phase 42 weekly evals were never hooked because Phase 36 only left a comment; Phase 43 scorecard is political theater. Root cause is not “we forgot to write tests” — it is that Phase 36 shipped **canonical-looking docs that were incomplete, optimistic, or decoupled from a broken cloud CI substrate**, so every later phase built on a false answer to “how tested is X?”

---

## 2. Failure modes

### CRITICAL

#### C1 — Nightly cloud E2E skeleton is a paper tiger (empty secrets)
- **How it manifests:** TFND-05 / D-22–D-24 declared satisfied because `cron: '0 2 * * *'` exists and comments mention unit/integration. In reality `e2e-prod.yml` has been **failure for ≥5 consecutive scheduled runs** (e.g. `30240577056` 2026-07-27). Failed-run env dump shows blank `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `E2E_TEST_EMAIL`, `E2E_TEST_PASSWORD`, `E2E_BASE_URL`, etc.; step warning: *No files were found … `test-results/`*. Phases 37–43 treat “nightly prod E2E” as a working gate; breadth suites never get live-cloud signal; Phase 41/43 ship against a dead harness.
- **Early warning:** `gh run list --workflow=e2e-prod.yml` all red; inventory `ci_job=e2e-prod` + `runs?=yes` while `passes?=unknown` forever; README claims TFND-05 without a secrets-availability note.
- **Mitigate in Phase 36 NOW:** In `36-03` README + `TESTING-SCORECARD` honesty block (and `SYNTHETIC-TENANT.md` CI section): **require explicit “secrets present? yes/no as of &lt;date&gt;”** from a `gh run view` env check (names only, never values). Mark TFND-05 as **schedule-present / capability-unverified** until one wave XML lands. Do **not** change job behavior in Phase 36 — but do not let “annotated cron” equal “working nightly.”
- **Defer:** Restoring GitHub secrets / fixing wave failures → ops + Phase 25 maintenance / early Phase 37 gate (blocking for live seed).

#### C2 — `sim-*` teardown contract under-specified relative to schema (orphan production pollution)
- **How it manifests:** Phase 37 implements generator against `SYNTHETIC-TENANT.md`; teardown copies `conftest_prod.py` `E2E_TABLES` (only **8** tables: `inventory_stock`, `notification_deliveries`, `notification_logs`, `order_interactions`, `calendar_events`, `pos_webhook_logs`, `system_audit_log`, `master_wine_library_submissions`). Migrations show **~152 `CREATE TABLE` statements**. Sim restaurants write ledger/sales/procurement/analytics rows never swept → production Supabase fills with `sim-%` orphans; Phase 41 oracle diffs polluted; Sentry `sim-orphan` noise ignored; eventually someone deletes wrong rows or the `e2e-test-restaurant` anchor by accident.
- **Early warning:** Convention doc says “expandable registry” but lists no **minimum table domains** or “Phase 37 blocker checklist”; executor closes TFND-06 on grep `sim-` alone (`36-03` verify).
- **Mitigate in Phase 36 NOW:** In `36-03` Task 1, require `SYNTHETIC-TENANT.md` to include: (1) copy of current `E2E_TABLES` from `conftest_prod.py:251-260`; (2) explicit gap statement that domain buckets in registry Table D (inventory, POS, procurement, analytics, …) are **out of current teardown**; (3) Phase 37 **must** expand teardown before first multi-archetype seed; (4) never delete `e2e-test-restaurant` (already planned). Optional: link registry DB domains → “teardown coverage: none|partial|full.”
- **Defer:** Actual `E2E_TABLES` code expansion + generator (Phase 37) — correct per RESEARCH Open Q3.

#### C3 — Score inflation: T1 from `runs?=yes` + `passes?=unknown`
- **How it manifests:** `36-02` protocol: any inventory path with `runs?=yes` → baseline **T1** even if `passes?=unknown`. Corpus is large (41 Jest + 30 Vitest + 4 Playwright + 67 pytest including 6 `wave_*.py`) while **22 Nest modules have zero specs** and main `ci.yml` is red on Black (`studio_routes.py`, run `30299009969`). Phases 39–40 “promote to T2” from a fictional T1 floor; groups look healthier than Identity/Catalog Nest surfaces that are empty.
- **Early warning:** Scorecard rows all T1; zero T0; evidence cites Phase 25 waves that never produce XML; `passes?` column never leaves `unknown`.
- **Mitigate in Phase 36 NOW:** Amend `36-02` Task 2: T1 requires `runs?=yes` **and** either (a) local collect/listTests + documented smoke that the file is loadable, or (b) label score as **`T1?` / provisional** with mandatory Gaps text “CI green unverified.” Prefer keeping numeric T0/T1 but **forbid promoting past T1 in later phases** until `passes?` is yes or explicitly waived. Rubric evidence standards already say “never promote on file-count” — scorecard must mirror that for baseline.
- **Defer:** Actually greening CI / proving wave passes (post-36 ops or Phase 39 entry criteria).

---

### HIGH

#### H1 — Registry / inventory group divergence (parallel Wave 1)
- **How it manifests:** `36-01` and `36-02` both `depends_on: []`, wave 1. Inventory assigns groups from RESEARCH draft while registry executor changes edge cases (`contacts`→5, `receiving`→5, `mobile`→9 deferred, `websocket`→9). Phases 39–40 pick “groups 1–4” and miss suites; duplicate ownership fights; scorecard evidence paths disagree with registry.
- **Early warning:** Same path has different `group` in inventory vs registry; Nest module count in registry ≠ `ls apps/api-gateway/src` dirs.
- **Mitigate in Phase 36 NOW:** Soft-block: `36-02` Task 2 (scorecard) `depends_on: [36-01]`; inventory Task 1 must state “group column must match `FUNCTIONALITY-REGISTRY.md` primary; if registry not landed yet, freeze to RESEARCH §A–C and **reconcile in scorecard task**.” Add verify: sample 10 Nest modules — inventory group == registry primary.
- **Defer:** Full automated consistency script (`check-inventory-coverage.sh`) — optional Wave 0 nice-to-have.

#### H2 — Incomplete surface map (verify only samples modules)
- **How it manifests:** `36-01` Task 2 verify loops a **subset** of Nest modules; App.tsx routes / agents / DB domains rely on RESEARCH tables. Missed routes (new auth pages, receiving, admin) or agents leave “how tested is X?” unanswered. Phase 43 final scorecard cannot close because surfaces were never owned.
- **Early warning:** Registry Nest rows &lt; top-level dirs under `apps/api-gateway/src/`; agent rows ≠ `ls agents/*.py` (26 today); DB domain note cites `database.types.ts` despite anti-pattern.
- **Mitigate in Phase 36 NOW:** Expand Task 2 `<automated>` to: every top-level Nest dir (except noise) appears; `wc -l` agents mapped ≥ agent file count; assert migrations-not-types sentence present (already in acceptance). Spot-check `App.tsx` `path=` count vs Table B rows.
- **Defer:** Auto-generating registry from AST — out of scope.

#### H3 — RLS / JWT path not exercised by convention (service-role ≠ proof)
- **How it manifests:** Docs mention `user_restaurant_access` (good; migrations `20260708170000_p4_tenant_rls_policies.sql`, `20260514200000_phase33_ura_membership.sql`). Phase 37 seeds with service role only; Phase 39 Identity suites “pass” without membership rows; real user JWT 403s. Campaign locks D-07 cloud stack — local mocks hide this.
- **Early warning:** `SYNTHETIC-TENANT.md` mentions RLS but no **required seed row checklist** (restaurant + URA + auth user); inventory marks Nest auth specs as group-1 T1 without JWT E2E.
- **Mitigate in Phase 36 NOW:** In `SYNTHETIC-TENANT.md`, add a mandatory seed checklist: `restaurants` row `id=sim-*`, `user_restaurant_access` membership, Auth user used for `prod_jwt`-style grant, service-role only for seed/teardown. One-line: “Group 1 T2+ later phases must include JWT path.”
- **Defer:** Implementing seed helpers (Phase 37).

#### H4 — Cross-cut ownership poison (receiving / contacts / compliance)
- **How it manifests:** RESEARCH A2/A3: `/receiving/:orderId/door` → group **5** (also_touches 3); `contacts` → 5 (also_touches 6); `compliance_agent` → 11 (also_touches 5). Phase 39 Inventory breadth skips door receipt; Phase 40 Procurement owns it poorly; dual suites or none.
- **Early warning:** Scorecard Gaps omit receiving; Phase 39 plan assumes inventory owns stock-in.
- **Mitigate in Phase 36 NOW:** Registry must flag **campaign ownership** rows: “Phase 39/40 suite owner = primary group”; receiving/contacts/compliance called out in a short “Contested surfaces” section (CONTEXT asked for more edge-case docs).
- **Defer:** Re-litigating group taxonomy (locked D-09 — do not rename groups).

#### H5 — Push CI remains red; “unit+integration on push” is unreachable
- **How it manifests:** `ci.yml` `needs: [lint-typescript]` / lint-python gate means Black failure (`studio_routes.py`) blocks or shadows confidence in `test-typescript` / `test-python`. Phase 36 comments-only per plan — correct scope — but later phases assume green push signal.
- **Early warning:** Five recent `ci.yml` main pushes all `failure` (spot-check 2026-07-27).
- **Mitigate in Phase 36 NOW:** Already planned honesty line — strengthen to: “**Do not treat TFND-05 as green CI**; Black debt on `studio_routes.py` as of 2026-07-27; test jobs may not be trustworthy until lint green.” Link `gh run` id.
- **Defer:** Black/ESLint/ruff fixes (explicitly out of Phase 36; fix when it blocks Phase 39 entry).

---

### MEDIUM

#### M1 — Stale / duplicate tests treated as coverage
- **How it manifests:** `services/agent-orchestrator/tests/test_golden_path_e2e 2.py` (+ `__pycache__` twin) marked `stale-suspect` in inventory but still counted in group summaries → perceived maturity for Platform (11).
- **Early warning:** Anomalies section missing or summary counts include stale-suspect without discount.
- **Mitigate NOW:** `36-02` summary: exclude `stale-suspect` from “evidence eligible for T1.”
- **Defer:** Delete/rename duplicate file (D-05 keep-as-is — fix later).

#### M2 — Local Playwright conflated with cloud prod E2E
- **How it manifests:** `ci.yml` `test-e2e` (local) vs `e2e-prod.yml` (cloud). Inventory mis-tags `prod-smoke.spec.ts` or waves; Phase 43 invents second paradigm (violates D-24) or skips cloud journeys.
- **Early warning:** README / CI comments omit “test-e2e ≠ e2e-prod.”
- **Mitigate NOW:** Already in `36-03` comment block — enforce both files get the distinction; inventory layer `e2e` vs `prod_e2e` required (Pattern 3).
- **Defer:** Unifying runners.

#### M3 — Rubric T3/T4 / Agent Level mirror confuses promoters
- **How it manifests:** Executors equate agent Level 3 hardening tests with group T3; promote Inventory to T3 from chaos tests while Nest `inventory-ledger` is 0 specs. Phase 41 thinks T4 is optional narrative.
- **Early warning:** Baseline rows with T2/T3; Level mirror used as scoring rule instead of locked T definitions.
- **Mitigate NOW:** `RUBRIC.md` Evidence: “Agent Level ≠ automatic T-level; T4 unreachable in Phase 36; holistic group score still needs multi-tier evidence for T2+.”
- **Defer:** Rubric UX polish.

#### M4 — Packages / shared UI have zero tests and no registry home
- **How it manifests:** RESEARCH: `packages/*` tests = 0. Shared `@wineops/ui` regressions attributed nowhere; Phase 43 journeys flake without ownership.
- **Early warning:** Registry silent on `packages/`.
- **Mitigate NOW:** One registry subsection: shared packages → primary **11** (or owning consumer group) + `also_touches`; inventory anomalies already note 0 package tests.
- **Defer:** Writing package tests.

#### M5 — Validation stays `nyquist_compliant: false` / Wave 0 unchecked
- **How it manifests:** `36-VALIDATION.md` draft; greps pass once; no sampling after edits; docs drift mid-campaign.
- **Early warning:** Frontmatter never flipped; scorecard updated without inventory.
- **Mitigate NOW:** Execute-phase must close VALIDATION sign-off; README “How to update scores” already planned — keep strict.
- **Defer:** Continuous doc lint in CI.

---

### LOW

#### L1 — Mobile mapped but campaign-deferred forgotten
- **How it manifests:** Someone plans mobile suites in 39–43 despite D-02; or Identity scorecard dinged for mobile gaps.
- **Mitigate NOW:** `campaign-deferred` already required in `36-01` — keep visible on scorecard Gaps for group 9/1.
- **Defer:** Mobile campaign.

#### L2 — Phase 42 placeholder comment never becomes a workflow
- **How it manifests:** Expected — D-25. Failure only if Phase 42 assumes Phase 36 built eval CI.
- **Mitigate NOW:** Placeholder comment only (planned). Scorecard/README: “eval workflow = Phase 42.”
- **Defer:** Weekly eval workflow (42).

#### L3 — Job rename / comment-only churn
- **How it manifests:** Cosmetic YAML noise; low risk if behavior unchanged.
- **Mitigate NOW:** Forbid behavioral CI changes (already FORBIDDEN in `36-03`).
- **Defer:** n/a.

---

## 3. Must-fix before execute

Plan/doc deltas only — do not expand Phase 36 into CI repair or generator code.

1. **`36-03` / scorecard / README — cloud E2E capability honesty (C1):** Require documenting that recent `e2e-prod` runs show **missing Supabase/E2E secrets** and no `test-results/` artifacts (cite run id). TFND-05 = annotated schedule + push jobs exist; **not** “nightly E2E is healthy.”
2. **`36-03` SYNTHETIC-TENANT — teardown gap table (C2):** Embed current 8-table `E2E_TABLES` list + explicit Phase 37 expansion gate tied to registry DB domains.
3. **`36-02` scorecard — provisional T1 rule (C3):** Do not award clean T1 solely from `runs?=yes` + `passes?=unknown` without Gaps labeling provisional / CI-unverified; exclude `stale-suspect` from T1 evidence (M1).
4. **`36-02` ↔ `36-01` consistency (H1):** Scorecard task depends on registry; inventory groups reconciled to registry primaries before baseline freeze.
5. **`36-01` verify completeness (H2):** Automate full Nest top-level dir coverage + agent file count floor (not subset loop only).
6. **Contested surfaces section (H4):** receiving door, contacts, compliance_agent ownership called out for Phase 39/40 suite owners.

If any of C1–C3 ship without the above, Phase 36 “complete” actively misleads 37–43.

---

## 4. Watch during execute

- [ ] `.planning/testing/` five TFND files + README all cross-link (`RUBRIC`, registry, inventory, scorecard, `SYNTHETIC-TENANT`)
- [ ] Exactly 11 scorecard data rows; **no T4**; mostly T0/T1; Gaps non-empty for zero-spec Nest modules
- [ ] Inventory floors: ≥41 gateway `*.spec.ts`, ≥30 web `src` tests, ≥4 `apps/web/e2e`, ≥60 orchestrator test paths; duplicate golden path → `stale-suspect`
- [ ] Nest registry rows cover all `apps/api-gateway/src/*/` modules including zero-spec list (organizations, wines, menus, inventory-ledger, …)
- [ ] `database.types.ts` anti-pattern stated; DB domains migration-derived
- [ ] `sim-*` + `e2e-test-restaurant` coexistence; `user_restaurant_access`; NEVER raise; no `PYTEST_RUNNING` in `e2e-prod.yml`
- [ ] CI diffs **comment-only**; no `testing-campaign.yml`; cron `0 2 * * *` unchanged
- [ ] Honesty: main CI Black-red + e2e-prod secrets/capability status dated
- [ ] No test source rewrites (D-05); `git status` clean outside `.planning/testing/` + workflow comments
- [ ] `36-VALIDATION.md` greps green; nyquist sign-off updated after execute

---

## 5. Acceptable risks

Leave alone in Phase 36 (documented, not fixed):

- **Black / ruff / eslint debt** keeping `ci.yml` red (`studio_routes.py`) — do not expand scope to “fix CI.”
- **Empty or broken GitHub secrets** for e2e-prod — document only; restoring secrets is ops, not TFND docs.
- **Not expanding `E2E_TABLES` in code** — document gap; implement in Phase 37.
- **Not deleting/renaming** `test_golden_path_e2e 2.py` or reworking failing tests (D-05).
- **Not implementing** generator, SimPOS, breadth suites, analytics truth, AI evals, Playwright journeys (37–43).
- **Mobile testing deferred** (D-02) — map + mark only.
- **pytest marker filtering** (`-m unit/integration`) not added to CI — comment that markers exist unfiltered.
- **Agent Level ↔ T mirror nuance (A1)** — definitions of T0–T4 locked; mirror is explanatory.
- **Receiving primary = Procurement (5)** as locked research default — document contested; do not reopen D-09 group list.
- **Comment-only TFND-05** without new workflow (D-24) — correct; risk is honesty, not missing YAML file.

---

## Spot-check evidence (2026-07-27)

| Check | Result |
|-------|--------|
| Test corpus | 41 api-gateway `*.spec.ts`, 30 web Vitest, 4 Playwright e2e, 67 orchestrator `test_*.py`/`wave_*.py`, 6 `wave_*.py` |
| Nest modules w/ 0 specs | 22 (incl. wines, menus, organizations, inventory-ledger, toast, …) |
| Phase 25 harness | Present: `conftest_prod.py`, `setup_e2e_anchor.py`, `cascading_report.py` |
| `E2E_TABLES` | 8 tables only (`conftest_prod.py:251-260`) |
| `ci.yml` | Recent main runs **failure** — Black would reformat `studio_routes.py` |
| `e2e-prod.yml` | Schedule intact; recent scheduled runs **failure**; Supabase/E2E secrets empty in log env; no wave XML artifacts |
| Duplicate test | `test_golden_path_e2e 2.py` still on disk |
| Types vs migrations | `database.types.ts` ~249 lines / sparse Tables; ~152 `CREATE TABLE` across migrations |

---

## PREMORTEM COMPLETE
