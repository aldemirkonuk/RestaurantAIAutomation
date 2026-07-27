# Phase 36: Testing Foundation & Functionality Registry - Pattern Map

**Mapped:** 2026-07-27
**Files analyzed:** 9
**Analogs found:** 9 / 9

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `.planning/testing/FUNCTIONALITY-REGISTRY.md` | config | transform | `.planning/ROADMAP.md` (Testing Campaign groups) + `36-RESEARCH.md` Surface Map A–D | exact |
| `.planning/testing/RUBRIC.md` | config | transform | `.planning/PROJECT.md` (Agent Level 0–4) + ROADMAP Phase 36 success criteria | role-match |
| `.planning/testing/EXISTING-TEST-INVENTORY.md` | config | batch | `36-RESEARCH.md` corpus snapshot + `.planning/phases/25-*/25-VALIDATION.md` req→test map | exact |
| `.planning/testing/TESTING-SCORECARD.md` | config | transform | `36-RESEARCH.md` scorecard row template + ROADMAP Phase 36 SC #4 | exact |
| `.planning/testing/SYNTHETIC-TENANT.md` | config | CRUD | `services/agent-orchestrator/tests/e2e/conftest_prod.py` + `scripts/setup_e2e_anchor.py` | exact |
| `.planning/testing/README.md` | config | request-response | `36-RESEARCH.md` “Proposed `.planning/testing/` Artifact Shapes” + sketches README index style | role-match |
| `.github/workflows/ci.yml` | config | request-response | `.github/workflows/ci.yml` itself (annotate in place) | exact |
| `.github/workflows/e2e-prod.yml` | config | event-driven | `.github/workflows/e2e-prod.yml` + `25-07-PLAN.md` workflow contract | exact |
| `scripts/testing/check-inventory-coverage.sh` (optional) | utility | batch | `scripts/health-check.sh` + `services/agent-orchestrator/scripts/cascading_report.py` | partial |

## Pattern Assignments

### `.planning/testing/FUNCTIONALITY-REGISTRY.md` (config, transform)

**Analog:** `.planning/ROADMAP.md` (lines 467–478 group seed) + `36-RESEARCH.md` Surface Map §§A–D

**Imports / front-matter pattern** — mirror ROADMAP campaign header + REQUIREMENTS TFND IDs:

```markdown
# Functionality Registry

**Purpose:** Canonical answer to “how tested is X?” — every surface maps to exactly one of 11 groups.
**Requirements:** TFND-01, TFND-03 (cross-link inventory)
**Locked groups:** ROADMAP Testing Campaign seed (D-09)
```

**Core mapping pattern** (copy structure from RESEARCH, not invent new buckets):

From `36-RESEARCH.md` Surface Map A (Nest modules):

```markdown
| Module (`apps/api-gateway/src/`) | Specs (count) | Primary group |
|---------------------------------|---------------|---------------|
| `auth` | 1 | 1 Identity & Access |
| `inventory` | 1 | 3 Inventory Operations |
| `common` | 5 | 11 Platform & Agent Infrastructure |
```

**Collision rules** (Pattern 1 from RESEARCH — must appear verbatim in registry):

```markdown
1. Prefer user-facing workflow group for pages/routes.
2. Prefer write-domain group for Nest modules / DB tables.
3. Prefer group 11 for shared infra (`common/`, `database/`, idempotency, outbox, saga, DLQ, health, admin).
4. Prefer group 1 for auth/guards/org/team/profile/settings.
5. Mobile → map for completeness, mark campaign-deferred.
6. Cross-cuts: one primary + `also_touches:` note — never two primaries (D-10).
```

**Group seed text** (copy from ROADMAP / CONTEXT D-09 — do not rename groups):

```467:478:.planning/ROADMAP.md
**Functionality groups (registry seed — finalized in Phase 36):**
1. Identity & Access — auth, registration, verification, invites, memberships/roles, orgs/chains/locations, profile, settings
2. Catalog & Extraction — wine library, submissions, menu import (scan/CSV/manual), extraction pipeline, enrichment, ontology, studio
3. Inventory Operations — stock, ledger, storage locations, counts/corrections, ghost inventory, shrinkage
4. POS & Sales Ingestion — pos-hub adapters, webhooks, checks, wine detection, sale→stock pipeline
...
11. Platform & Agent Infrastructure — BaseAgent guarantees, sagas, DLQ, idempotency, health, observability, admin
```

**DB domain source-of-truth anti-pattern:** Prefer migration-derived domains (RESEARCH §D), not `packages/database/src/types/database.types.ts` (~8 tables vs ~130 migrations).

---

### `.planning/testing/RUBRIC.md` (config, transform)

**Analog:** `.planning/PROJECT.md` Agent Level language + ROADMAP Phase 36 success criterion #2

**Core Level mirror** (PROJECT.md — agent maturity vocabulary to reuse):

```117:121:.planning/PROJECT.md
**v2.0 motivation:** 24 agents exist but all are Level 0-1 (prototype quality). BaseAgent already provides Level 3 infrastructure (circuit breaker, retry, backpressure, metrics, health checks, graceful shutdown). Gap to Level 4 is 6 additions to BaseAgent + per-agent bug fixes and hardening.

**Agent system architecture:**
- `services/agent-orchestrator/core/base_agent.py` — BaseAgent with circuit breaker, retry, backpressure, lifecycle management (already Level 3)
```

**Locked T0–T4 definitions** (ROADMAP success criteria — copy verbatim):

```495:495:.planning/ROADMAP.md
  2. T0–T4 rubric defined: T0 untested · T1 smoke (happy path runs) · T2 contract (happy + key errors + assertions on outputs) · T3 resilient (idempotency/concurrency/failure modes) · T4 ground-truth verified (asserted against simulator oracle or golden dataset)
```

**Mirror table pattern** (from RESEARCH Pattern 4 — use as RUBRIC body):

```markdown
| Test maturity | Meaning (locked) | Agent Level analogue |
|---------------|------------------|----------------------|
| T0 | Untested | Level 0 — prototype / absent proof |
| T1 | Smoke — happy path runs | Level 1 — basic path works |
| T2 | Contract — happy + key errors + output assertions | Level 2 — behavioral correctness |
| T3 | Resilient — idempotency / concurrency / failure modes | Level 3–4 infra guarantees |
| T4 | Ground-truth / golden-set verified | Beyond agent Level — simulator oracle / golden sets |
```

**Evidence standards section:** Require scorecard promotions to cite inventory paths + CI job names; never promote on file-count alone (Pitfall 2).

---

### `.planning/testing/EXISTING-TEST-INVENTORY.md` (config, batch)

**Analog:** `36-RESEARCH.md` “Existing Test Corpus Snapshot” + `25-VALIDATION.md` Phase Requirements → Test Map

**Table column pattern** (RESEARCH Pattern 3 — locked recommendation):

```markdown
| group | path | runner | layer | ci_job | runs? | passes? | notes |
|-------|------|--------|-------|--------|-------|---------|-------|
| 3-inventory | apps/api-gateway/src/inventory/inventory.service.spec.ts | jest | unit | test-typescript | yes | unknown | |
| 4-pos | services/agent-orchestrator/tests/e2e/wave_d_toast_pipeline.py | pytest | prod_e2e | e2e-prod | yes | unknown | Phase 25 Wave D |
```

**Honesty protocol** (copy into Methodology section):

- `runs?=yes` only if a named CI job invokes that runner on push or schedule
- `passes?` default `unknown` unless green run artifact or local green evidence from this phase
- Never claim CI green — main recently fails Black (`studio_routes.py`)

**Corpus buckets to enumerate** (RESEARCH snapshot — checklist for completeness):

| Bucket | Count | CI membership |
|--------|-------|---------------|
| api-gateway `*.spec.ts` | 41 | `test-typescript` |
| web `src/**/*.test.*` | 30 | `test-typescript` |
| web `e2e/*.spec.ts` | 4 | `test-e2e` (+ Wave F via e2e-prod) |
| orchestrator `tests/test_*.py` + helpers | ~61 | `test-python` |
| Phase 25 `wave_*.py` | 6 | `e2e-prod` only |

**Layer inference** — use `pytest.ini` markers:

```7:12:services/agent-orchestrator/pytest.ini
markers =
    slow: marks tests as slow (deselect with '-m "not slow"')
    integration: marks tests as integration tests
    unit: marks tests as unit tests
    e2e: marks tests as end-to-end integration tests requiring Supabase connection
    prod_e2e: marks tests as production E2E tests requiring live Railway + Supabase credentials
```

**Req→map style** (from Phase 25 VALIDATION — useful for inventory methodology / summary tables):

```39:52:.planning/phases/25-production-e2e-test-suite/25-VALIDATION.md
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TEST-PROD-01 | All `/api/v1/` endpoints return expected status codes with valid JWT | integration | `pytest tests/e2e/wave_a_api_contracts.py -x` | ❌ Wave 0 |
...
| TEST-PROD-12 | Create-and-teardown with permanent anchor + idempotent upserts | infra | Session teardown fixture in `conftest_prod.py` | ❌ Wave 0 |
```

**Known anomalies to document:** duplicate `test_golden_path_e2e 2.py`; unrouted `RecurringOrders.tsx` (group 5 orphan UI); many Nest modules with 0 specs.

---

### `.planning/testing/TESTING-SCORECARD.md` (config, transform)

**Analog:** `36-RESEARCH.md` scorecard row template + ROADMAP Phase 36 SC #4 / Phase 43 JRNY-05

**Core row pattern:**

```markdown
| # | Group | Score | Evidence | Gaps | Next phase |
|---|-------|-------|----------|------|------------|
| 3 | Inventory Operations | T1 | inventory.service.spec.ts; test_inventory_engine_*; Wave D | No concurrency suite | Phase 39 |
```

**Baseline expectation** (CONTEXT): mostly T0/T1 until breadth passes — that is correct and useful.

**Scoring rule** (RESEARCH Open Question #2 resolution): Score the **group** holistically; T1 if any automated happy-path exists in any tier; do not average Nest/page/agent coverage blindly.

**Cross-links required:** Legend → `RUBRIC.md`; Evidence → `EXISTING-TEST-INVENTORY.md` paths; Gaps → later phase IDs (39–43).

**REQUIREMENTS acceptance target** (JRNY-05 is later; Phase 36 only initializes):

```410:410:.planning/REQUIREMENTS.md
- [ ] **JRNY-05**: Final scorecard: all 11 groups ≥ T2, Analytics T4; sub-T2 gaps promoted to backlog
```

---

### `.planning/testing/SYNTHETIC-TENANT.md` (config, CRUD)

**Analog:** `services/agent-orchestrator/tests/e2e/conftest_prod.py` + `services/agent-orchestrator/scripts/setup_e2e_anchor.py`

**Header / anti-pattern block** (copy tone from conftest_prod docstring):

```1:20:services/agent-orchestrator/tests/e2e/conftest_prod.py
"""
Production E2E Fixtures — conftest_prod.py
============================================
...
CRITICAL ANTI-PATTERNS (do NOT do these):
  - NEVER set the pytest sentinel env var — disables Sentry in FastAPI app (main.py:27)
  - NEVER write JWT to disk, JUnit XML, or logs
  - NEVER raise in teardown (D-04)
  - NEVER use function scope for prod_jwt (causes 401 on expiry between waves)
"""
```

**Permanent anchor coexistence** (document — do not delete or fork):

```48:69:services/agent-orchestrator/scripts/setup_e2e_anchor.py
def create_e2e_restaurant(supabase_url: str, service_role_key: str) -> None:
    """Upsert the permanent e2e-test-restaurant anchor record.

    D-02: This record is NEVER deleted — it is the anchor for all e2e test writes.
    ...
    """
    ...
    payload = {
        "id": "e2e-test-restaurant",
        "name": "E2E Test Restaurant (DO NOT DELETE — Phase 25 anchor)",
        "slug": "e2e-test-restaurant",
    }
```

**Teardown contract to extend for `sim-*`** (document conceptual extension; code changes deferred to Phase 37):

```217:287:services/agent-orchestrator/tests/e2e/conftest_prod.py
@pytest.fixture(scope="session", autouse=True)
def teardown_e2e_records(prod_supabase, e2e_created_ids):
    """Session teardown: delete all e2e records from production DB (D-03, D-04, TEST-PROD-12).
    ...
    CRITICAL: NEVER raise. All teardown failures go to Sentry with e2e-orphan:true.
    The anchor record (id='e2e-test-restaurant') is NEVER deleted.
    """
    yield  # Tests run here
    ...
    E2E_TABLES = [
        "inventory_stock",
        "notification_deliveries",
        "notification_logs",
        "order_interactions",
        "calendar_events",
        "pos_webhook_logs",
        "system_audit_log",
        "master_wine_library_submissions",
    ]
    for table in E2E_TABLES:
        try:
            (
                prod_supabase.table(table)
                .delete()
                .eq("restaurant_id", "e2e-test-restaurant")
                .like("id", "e2e-%")
                .execute()
            )
        except Exception as exc:
            failed_deletes.append(...)
    # Step 3: Report orphans to Sentry (D-04 — NEVER raise)
```

**Convention constants** (RESEARCH Pattern 2 — put in SYNTHETIC-TENANT.md):

```python
SIM_ID_PREFIX = "sim-"              # restaurant.id / restaurant_id
SIM_ROW_PREFIX = "sim-"             # deterministic row ids (parallel to e2e-%)
E2E_ANCHOR = "e2e-test-restaurant"  # NEVER deleted; coexistence OK
# Teardown: DELETE WHERE restaurant_id LIKE 'sim-%' AND id LIKE 'sim-%'
# Failures → Sentry tag sim-orphan / e2e-orphan — NEVER raise
```

**JWT auth pattern** (document for sim users — reuse, don't reinvent):

```124:169:services/agent-orchestrator/tests/e2e/conftest_prod.py
@pytest.fixture(scope="session")
async def prod_jwt() -> str:
    """Acquire a real Supabase JWT once per CI session (D-07, TEST-PROD-12).
    Calls POST /auth/v1/token?grant_type=password with the e2e service account.
    ...
    return access_token  # Never log this value
```

**RLS membership requirement** — cite Phase 33 URA as authoritative membership:

```1:2:supabase/migrations/20260514200000_phase33_ura_membership.sql
-- Phase 33 URA-01: Activate user_restaurant_access as authoritative membership table
-- Per CONTEXT.md D-01: user_restaurant_access is the canonical restaurant membership source.
```

Document that sim JWT paths must seed `user_restaurant_access` rows; service-role seed/teardown ≠ user-path proof.

**Phase boundary line:** “Convention locked here (TFND-06); generator + teardown code expansion implemented in Phase 37.”

---

### `.planning/testing/README.md` (config, request-response)

**Analog:** `36-RESEARCH.md` §§Proposed Artifact Shapes + sketches README index style

**Index pattern:**

```markdown
# Testing Campaign Artifacts

| File | TFND | Purpose |
|------|------|---------|
| FUNCTIONALITY-REGISTRY.md | 01 | Surface → group map |
| RUBRIC.md | 02 | T0–T4 definitions |
| EXISTING-TEST-INVENTORY.md | 03 | Every test file |
| TESTING-SCORECARD.md | 04 | Living scores |
| SYNTHETIC-TENANT.md | 06 | sim-* isolation |

## How to update scores
1. Add/change evidence in inventory
2. Apply RUBRIC evidence standards
3. Update scorecard row + date
4. Link next phase owning the gap

## CI proof links
- Push unit/integration: `.github/workflows/ci.yml` (`test-typescript`, `test-python`)
- Local Playwright: `test-e2e` (not cloud prod)
- Nightly cloud E2E: `.github/workflows/e2e-prod.yml` (`cron: '0 2 * * *'`)
```

**Note CI honesty:** Optional one-liner that main CI may be red on Black — do not treat skeleton docs as “CI fixed.”

---

### `.github/workflows/ci.yml` (config, request-response)

**Analog:** `.github/workflows/ci.yml` itself — annotate, do not fork (D-24 / RESEARCH CI recommendation)

**Existing unit/integration jobs to clarify with comments** (do not change behavioral steps unless required):

```103:127:.github/workflows/ci.yml
  # Test TypeScript/React code
  test-typescript:
    name: Test TypeScript
    runs-on: ubuntu-latest
    needs: [lint-typescript]
    steps:
      ...
      - name: Run tests
        # Vitest auto-detects CI and runs once; jest runs once by default.
        run: pnpm run test
```

```156:182:.github/workflows/ci.yml
  # Test Python code
  test-python:
    name: Test Python
    ...
      - name: Run tests
        run: |
          cd services/agent-orchestrator
          pytest tests/ -v --cov=. --cov-report=xml
```

**Recommended annotation block** (RESEARCH CI skeleton — header or job comments only):

```yaml
# TFND-05 (Phase 36 Testing Campaign):
# test-typescript  → unit + integration (Jest api-gateway + Vitest web via turbo)
# test-python      → unit + integration (pytest; markers exist in pytest.ini but not filtered today)
# test-e2e         → local Playwright smoke (NOT cloud prod E2E)
# Cloud nightly E2E remains .github/workflows/e2e-prod.yml (schedule: 0 2 * * *)
```

**Anti-pattern:** Do not create `testing-campaign.yml`. Do not filter `-m unit/integration` unless planner explicitly accepts CI behavior change risk. Do not fix Black/ESLint debt in this phase.

---

### `.github/workflows/e2e-prod.yml` (config, event-driven)

**Analog:** `.github/workflows/e2e-prod.yml` + `25-07-PLAN.md` workflow contract

**Header pattern already present — extend with Phase 42 placeholder only:**

```1:19:.github/workflows/e2e-prod.yml
# .github/workflows/e2e-prod.yml
# Production E2E Test Suite — Phase 25
# =====================================
# Nightly cron (observability) + deploy-triggered blocking gate.
#
# D-12: Nightly 02:00 UTC — observability only
# D-13: workflow_dispatch from Vercel deploy hook — blocking gate
# D-15: Continue-all-waves — all 7 waves run regardless of failures
# D-19: Full suite in < 10 minutes — timeout-minutes: 15 hard cap
#
# CRITICAL: PYTEST_RUNNING is NEVER set here.
...
on:
  schedule:
    - cron: '0 2 * * *'    # D-12: nightly 02:00 UTC
```

**Add comment only (D-25):**

```yaml
# Phase 42 will add a separate weekly AI eval workflow — do not implement here (D-25 / TFND-05).
# Testing Campaign (Phases 36–43) reuses this workflow; do not invent a second prod E2E paradigm (D-24).
```

**must_haves from 25-07-PLAN** (preserve — Phase 36 must not break):

```22:28:.planning/phases/25-production-e2e-test-suite/25-07-PLAN.md
    - "e2e-prod.yml runs nightly at 02:00 UTC (D-12) and on workflow_dispatch triggered by Vercel deploy hook (D-13)"
    - "e2e-prod.yml NEVER sets PYTEST_RUNNING in the environment (would disable Sentry)"
    - "All 7 wave results are exported as JUnit XML files and uploaded as GitHub Actions artifacts (TEST-PROD-08)"
    - "e2e-prod.yml has timeout-minutes: 15 hard cap"
```

**Leave untouched:** wave steps, cascading_report invocation, deploy-gate Sentry/PR comment, secrets env block, `deploy.yml` post-audit trigger.

---

### `scripts/testing/check-inventory-coverage.sh` (utility, batch) — OPTIONAL

**Analog:** `scripts/health-check.sh` (simple bash status script) + `cascading_report.py` (post-suite aggregator)

**When to create:** Only if greps in `36-VALIDATION.md` are insufficient for TFND-03 completeness. RESEARCH marks this nice-to-have.

**Core pattern from health-check.sh** (exit-friendly echo status, no deps):

```3:13:scripts/health-check.sh
echo "🔍 WineOps AI Health Check"
echo "=========================="

# Test PostgreSQL
echo -n "PostgreSQL: "
if docker exec wineops-postgres pg_isready -U wineops > /dev/null 2>&1; then
    echo "✅ Running"
else
    echo "❌ Not responding"
fi
```

**Intended behavior:** Diff `find` of `*.spec.ts` / `*.test.*` / `test_*.py` / `e2e/*.spec.ts` against paths listed in `EXISTING-TEST-INVENTORY.md`; exit non-zero on missing rows. Prefer plain `rg`/`comm` over new runtime deps.

**If skipped:** Document in README that TFND-03 completeness is verified via `find` + inventory path diff during execution (VALIDATION Architecture).

---

## Shared Patterns

### Phase 25 production isolation (extend, don't fork)
**Source:** `services/agent-orchestrator/tests/e2e/conftest_prod.py`, `scripts/setup_e2e_anchor.py`
**Apply to:** `SYNTHETIC-TENANT.md`; later Phase 37 generator

- Permanent anchor `e2e-test-restaurant` NEVER deleted
- Deterministic ID prefixes (`e2e-*` today → `sim-*` for campaign)
- Service-role client for seed/teardown; JWT for user-scoped assertions
- Teardown NEVER raises; orphans → Sentry tags
- NEVER set `PYTEST_RUNNING` in prod E2E CI
- NEVER log JWT

### Documentation-first campaign artifacts
**Source:** `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md` TFND-01..06, `36-RESEARCH.md`
**Apply to:** All `.planning/testing/*.md` files

- Markdown tables as the contract (registry / inventory / scorecard)
- Cross-link TFND IDs in headers
- Prefer split files over mega-doc (D-11, D-17 locked paths)
- Standalone `RUBRIC.md` (discretion recommendation)

### Honest CI labeling
**Source:** `.github/workflows/ci.yml`, `e2e-prod.yml`
**Apply to:** TFND-05 annotations + inventory `runs?`/`passes?` columns

- Push = unit/integration (+ local Playwright)
- Nightly = cloud prod E2E via existing `e2e-prod.yml`
- `passes?=unknown` until proven; do not claim green while Black fails

### Primary-group collision rules
**Source:** `36-RESEARCH.md` Architecture Pattern 1
**Apply to:** `FUNCTIONALITY-REGISTRY.md` and inventory `group` column

- Exactly one primary (D-10)
- `also_touches:` for cross-cuts
- Mobile mapped but campaign-deferred

### Validation greps (Nyquist)
**Source:** `36-VALIDATION.md` / RESEARCH Validation Architecture
**Apply to:** Plan acceptance criteria

```bash
rg 'T0|T1|T2|T3|T4' .planning/testing/RUBRIC.md
rg 'sim-\*' .planning/testing/SYNTHETIC-TENANT.md
rg 'cron:|pnpm run test|pytest' .github/workflows/{ci,e2e-prod}.yml
```

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| — | — | — | All nine planned files have role-match or exact analogs. Optional inventory script is partial-match only (no existing inventory-diff script). |

## Metadata

**Analog search scope:**
- `.planning/` (ROADMAP, REQUIREMENTS, PROJECT, Phase 25 docs, Phase 36 RESEARCH/VALIDATION)
- `.github/workflows/` (`ci.yml`, `e2e-prod.yml`, `deploy.yml` awareness)
- `services/agent-orchestrator/tests/e2e/` (`conftest_prod.py`, waves)
- `services/agent-orchestrator/scripts/` (`setup_e2e_anchor.py`, `cascading_report.py`)
- `services/agent-orchestrator/pytest.ini`
- `supabase/migrations/` (URA membership)
- `scripts/health-check.sh`
- `.planning/testing/` — **absent** (Wave 0 create)

**Files scanned:** ~25 primary analogs + workflow/migration excerpts
**Pattern extraction date:** 2026-07-27
**`.planning/testing/` exists:** no — create directory with six markdown artifacts
