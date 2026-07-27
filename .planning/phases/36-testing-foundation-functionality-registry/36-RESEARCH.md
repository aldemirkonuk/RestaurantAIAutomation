# Phase 36: Testing Foundation & Functionality Registry - Research

**Researched:** 2026-07-27 (FORCE REFRESH — live inventory + plan-gap pass)
**Domain:** Testing campaign skeleton — functionality registry, T0–T4 rubric, test inventory, scorecard, CI wiring, `sim-*` tenant convention
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: Testing Campaign is the foundation for Waves 2–6 — pause agent-wave hardening until Phases 36–43 complete
- D-02: Scope = entire program (web, api-gateway, agent-orchestrator, database); mobile deferred
- D-03: Breadth-first — every group reaches scored bar, then deepen
- D-04: Pass bar = T0–T4 maturity score per functionality group (mirrors agent Level system)
- D-05: Existing tests kept and built around — inventory only in this phase, do not rework
- D-06: Test types in campaign = unit + integration + E2E + structured manual checklists
- D-07: Environment = cloud stack (Vercel + Railway + Supabase Cloud); CI = GitHub Actions
- D-08: Execution = agent-led; user does manual pathway passes with prepared checklists

- D-09: Exactly **11** broad functionality groups crossing app boundaries (see CONTEXT seed table)
- D-10: Every api-gateway module, web page/route, orchestrator agent, and database domain maps to **exactly one** group
- D-11: Registry lives at `.planning/testing/FUNCTIONALITY-REGISTRY.md`

- D-12: T0 = untested
- D-13: T1 = smoke (happy path runs)
- D-14: T2 = contract (happy + key errors + assertions on outputs)
- D-15: T3 = resilient (idempotency / concurrency / failure modes)
- D-16: T4 = ground-truth verified (simulator oracle or golden dataset)
- D-17: Scorecard lives at `.planning/testing/TESTING-SCORECARD.md` with baseline score + evidence links per group

- D-18: Prefix `sim-*` for synthetic restaurant_id (extends Phase 25 `e2e-test-restaurant` pattern)
- D-19: RLS-safe seeding required
- D-20: Idempotent teardown required
- D-21: Document the convention in `.planning/testing/` (name at Claude's discretion)

- D-22: Unit + integration suites run on push
- D-23: Nightly E2E workflow scheduled — reuse Phase 25 `.github/workflows/e2e-prod.yml` patterns
- D-24: Do not invent a second production E2E paradigm; extend/wire existing Phase 25 harness
- D-25: Weekly AI evals are Phase 42 — Phase 36 only needs skeleton hooks / placeholders; do not implement eval runners here

### Claude's Discretion
- Exact inventory file format (table columns beyond group / path / runs? / passes?)
- Whether T0–T4 rubric is a standalone `.planning/testing/RUBRIC.md` or a section of the registry/scorecard
- How deeply to probe "runs?/passes?" for existing tests in CI vs local-only (document honestly; do not claim green without evidence)
- Whether CI skeleton is a new workflow file, edits to `ci.yml` + schedule on `e2e-prod.yml`, or both
- Mapping edge cases (shared utilities, cross-cutting modules) — pick a primary group + note secondary references
- Directory layout under `.planning/testing/` beyond the two mandated files

### Deferred Ideas (OUT OF SCOPE)
- Synthetic restaurant generator, ground-truth ledger — Phase 37
- SimPOS provider, day simulator, control panel, Railway deploy — Phase 38
- Breadth Pass A/B suites + manual checklists — Phases 39–40
- Analytics truth suite — Phase 41
- AI eval suites + weekly cost-capped runs — Phase 42
- Playwright journeys, scanner/admin verification, user manual passes, final scorecard — Phase 43
- Mobile app testing
- Reworking legacy/stale tests (inventory only; fix later if scorecard flags them)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TFND-01 | `.planning/testing/FUNCTIONALITY-REGISTRY.md` maps every api-gateway module, web page, orchestrator agent, and database domain to exactly one of 11 groups | Surface Map §§A–D + Pattern 1 collision rules; Plan 36-01 Task 2 |
| TFND-02 | T0–T4 coverage rubric defined (mirrors agent Level system) | Locked D-12..16; Pattern 4 Level↔T mirror; standalone `RUBRIC.md` (Plan 36-01 Task 1) |
| TFND-03 | Existing-test inventory: every spec/pytest/Playwright file catalogued (group, runs?, passes?) — kept as-is | Live corpus counts below; honesty protocol; Plan 36-02 Task 1 |
| TFND-04 | `.planning/testing/TESTING-SCORECARD.md` initialized with baseline score + evidence per group | Holistic T0/T1 baseline; Plan 36-02 Task 2 |
| TFND-05 | GitHub Actions: unit + integration on push, E2E nightly (extends Phase 25 e2e-prod.yml) | `ci.yml` + `e2e-prod.yml` already exist; Plan 36-03 comment-only annotations |
| TFND-06 | Synthetic tenant isolation: `sim-*` restaurant_id, RLS-safe seeding, idempotent teardown | Extend `conftest_prod.py` / `setup_e2e_anchor.py`; Plan 36-03 `SYNTHETIC-TENANT.md` |
</phase_requirements>

## Summary

Phase 36 is a **documentation + light CI annotation** phase, not a test-writing or CI-debt phase. Deliverables live under `.planning/testing/` (not yet created — verified absent 2026-07-27) plus comment-only edits to existing workflows. Plans **36-01..03 already exist** and remain aligned with CONTEXT; this refresh re-verifies the live corpus and flags execution-time honesty gaps the plans partially understate.

**Live corpus (2026-07-27 re-inventory):** **41** Nest `*.spec.ts`, **30** Vitest under `apps/web/src`, **4** Playwright `apps/web/e2e/*.spec.ts`, **67** pytest modules (`test_*.py` + `wave_*.py`) including duplicate `test_golden_path_e2e 2.py` and 6 Phase 25 `wave_*.py` files. Nest top-level modules: **34** dirs (incl. `__tests__`). Orchestrator agents: **25** (excl. `__init__.py`). Migration-derived tables: **~152** unique `CREATE TABLE` names — `packages/database/src/types/database.types.ts` still lists only ~8 public tables and must **not** drive DB domain mapping. [VERIFIED: find/grep/ls 2026-07-27]

**CI honesty (stronger than prior research):** Push CI (`ci.yml`) fails on Black (`studio_routes.py` would reformat) — latest main run `30299009969`. Nightly `e2e-prod.yml` is scheduled (`0 2 * * *`) but **currently red before waves run**: latest scheduled run `30240577056` failed at “Install frontend dependencies”; env dump shows empty `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD` / `E2E_BASE_URL` / `RABBITMQ_URL` (and related secrets). Inventory must keep `passes?=unknown` (or `no` only with documented evidence); TFND-05 is satisfied by **workflow existence + schedule**, not by green runs. [VERIFIED: `gh run view` 2026-07-27]

**Primary recommendation:** Execute plans 36-01 → 36-02 → 36-03 as written. Create five artifacts + README under `.planning/testing/`; annotate `ci.yml` / `e2e-prod.yml` comments only (no second workflow). In scorecard/README honesty notes, call out **both** Black-red push CI **and** red/secret-incomplete nightly E2E — do not claim green. Attribute `__tests__/*.spec.ts` rows to owning groups (ledger→3, one-tap→9, events→7, calendar/dashboard→7/8).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Functionality registry (TFND-01) | CDN / Static (repo docs) | — | Planning artifact in git; no runtime owner |
| T0–T4 rubric (TFND-02) | CDN / Static (repo docs) | — | Scoring contract for Phases 37–43 |
| Existing-test inventory (TFND-03) | CDN / Static (repo docs) | API / Backend + Browser | Catalog across Jest/Vitest/pytest/Playwright |
| Scorecard baseline (TFND-04) | CDN / Static (repo docs) | — | Living scoreboard updated by later phases |
| Unit + integration on push (TFND-05) | API / Backend + Browser | GitHub Actions | `test-typescript` + `test-python` in `ci.yml` |
| Nightly E2E (TFND-05) | API / Backend + Browser | Database / Storage | `e2e-prod.yml` → Railway + Vercel + Supabase |
| `sim-*` tenant convention (TFND-06) | Database / Storage | API / Backend | restaurant_id + RLS + service-role seed/teardown |
| Surface mapping inputs | API / Backend + Browser + Database | — | Modules/pages/agents/tables = registry payload |

## Project Constraints (from CLAUDE.md)

No `CLAUDE.md` at repo root. [VERIFIED: path missing 2026-07-27]

Relevant project constraints that still bind planning/execution:

| Source | Directive |
|--------|-----------|
| `.cursor/skills/reasoning-and-planning-protocol/SKILL.md` | Decompose → solve → verify → synthesize; flag confidence &lt; 0.8 |
| `.planning/config.json` | `workflow.nyquist_validation: true` — Validation Architecture required |
| `.planning/STATE.md` | Phase 36 planned (3 plans); next = execute; CI cleanup deferred (ruff/black/eslint) |
| Phase 25 / `e2e-prod.yml` | Never set `PYTEST_RUNNING` in prod E2E; never raise in teardown; no staging-only campaign E2E (D-07/D-24) |
| Plans 36-01..03 | Locked task shapes — research flags gaps vs plans; does not replace them |

## Standard Stack

### Core (already in repo — Phase 36 adds no new runtime deps)

| Library / Tool | Version | Purpose | Why Standard |
|----------------|---------|---------|--------------|
| Jest | `^29.7.0` (api-gateway) | NestJS `*.spec.ts` | Existing gateway runner [VERIFIED: apps/api-gateway/package.json] |
| Vitest | `^2.1.9` (web) | Web unit/component tests | Existing frontend runner [VERIFIED: apps/web/package.json] |
| Playwright | `^1.58.0` (web) | Browser E2E (local + prod smoke) | `playwright.config.ts` + `playwright.prod.config.ts` [VERIFIED: apps/web/package.json] |
| pytest | `7.4.4` | Orchestrator unit/integration/E2E | Pinned [VERIFIED: requirements.txt] |
| pytest-asyncio | `0.23.3` | Async agent tests | Pinned; CI warns against unpinned upgrade [VERIFIED: ci.yml + requirements.txt] |
| GitHub Actions | `actions/checkout@v4`, Node 20.x, Python 3.11 | CI | `ci.yml` / `e2e-prod.yml` / `deploy.yml` / `codeql.yml` [VERIFIED] |
| Supabase Auth REST + service role | cloud | JWT + teardown | Phase 25 `conftest_prod.py` [VERIFIED] |

### Supporting

| Artifact / Tool | Version | Purpose | When to Use |
|-----------------|---------|---------|-------------|
| Markdown under `.planning/testing/` | n/a | All TFND deliverables | Phase 36 outputs |
| pytest markers (`unit`, `integration`, `e2e`, `prod_e2e`) | `pytest.ini` | Classify orchestrator tests | Inventory `layer` / `runs?` [VERIFIED: pytest.ini] |
| Codecov upload (Python) | codecov-action@v3 | Coverage artifact | Already in `ci.yml` — do not expand |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Annotate existing `ci.yml` + keep `e2e-prod.yml` | New `testing-campaign.yml` | Violates D-24 — **reject** (Plan 36-03 FORBIDDEN) |
| Standalone `RUBRIC.md` | Embed in scorecard only | Standalone preferred — Plan 36-01 already locks this |
| Split registry / inventory / scorecard | Single mega-file | Split matches D-11/D-17 — keep |

**Installation:** None for Phase 36.

**Version verification:** npm latest jest `30.4.2`, vitest `4.1.10`, `@playwright/test` `1.62.0` (2026-07-27) — **do not upgrade** in this phase. Jest 30 has Nest-relevant coverage/instrumentation changes; stay on repo pins. [VERIFIED: npm view + jestjs.io/docs/upgrading-to-jest30]

## Architecture Patterns

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Phase 36 outputs (.planning/testing/)                                   │
│  REGISTRY ← maps → modules/pages/agents/DB domains                       │
│  RUBRIC (T0–T4) ← scores → SCORECARD                                     │
│  INVENTORY ← catalogues → existing *.spec / test_*.py / Playwright       │
│  SYNTHETIC-TENANT.md ← extends → Phase 25 e2e-test-restaurant            │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          ▼                         ▼                         ▼
   Push CI (ci.yml)          Nightly E2E (e2e-prod.yml)   Cloud data plane
   ├─ Jest api-gateway       ├─ Waves A–G pytest          ├─ Supabase
   ├─ Vitest web             ├─ Playwright prod smoke     ├─ Railway orch.
   ├─ pytest orchestrator    └─ cascading_report.py       └─ Vercel web
   └─ (local) Playwright
         │                         │
         │ currently RED           │ currently RED (install /
         │ (Black)                 │   missing secrets)
         ▼                         ▼
                     Later phases write suites INTO groups
                     (37 sim seed → 38 SimPOS → 39–43 score ↑)
```

### Recommended Project Structure

```
.planning/testing/
├── README.md                      # Index + how to update scores
├── FUNCTIONALITY-REGISTRY.md      # TFND-01 — Plan 36-01
├── RUBRIC.md                      # TFND-02 — Plan 36-01
├── EXISTING-TEST-INVENTORY.md     # TFND-03 — Plan 36-02
├── TESTING-SCORECARD.md           # TFND-04 — Plan 36-02
└── SYNTHETIC-TENANT.md            # TFND-06 — Plan 36-03

# Unchanged (extend by reference):
services/agent-orchestrator/tests/e2e/conftest_prod.py
services/agent-orchestrator/scripts/setup_e2e_anchor.py
.github/workflows/ci.yml           # comment-only TFND-05
.github/workflows/e2e-prod.yml     # nightly + Phase 42 placeholder comment
```

### Pattern 1: Primary-group mapping with secondary notes

**What:** Every surface gets exactly one primary group (D-10). Cross-cuts get `also_touches:` — never a second primary.

**Collision rules (copy into registry):**
1. Prefer the group that owns the **user-facing workflow** for pages/routes.
2. Prefer the group that owns the **write domain** for Nest modules / DB tables.
3. Prefer **Platform & Agent Infrastructure (11)** for shared infra: `common/`, `database/`, idempotency, outbox, saga, DLQ, health, observability, admin.
4. Prefer **Identity & Access (1)** for auth/guards/org/team/profile/settings/user prefs.
5. Mobile (`apps/api-gateway/src/mobile`, `apps/mobile`) — map for completeness, mark **campaign-deferred** (D-02).
6. Cross-cuts: one primary + `also_touches:` note — never two primaries.

**`__tests__` attribution rule (refresh):** Specs under `apps/api-gateway/src/__tests__/` do **not** create a 12th group. Map each file to the owning module’s group:

| `__tests__` file | Owning module | Group |
|------------------|---------------|-------|
| `calendar.service.spec.ts` | calendar | 7 |
| `dashboard.service.spec.ts` | dashboard | 8 |
| `events.controller.spec.ts` / `events.service.spec.ts` | events | 7 |
| `inventory-ledger.service.spec.ts` | inventory-ledger | 3 |
| `one-tap-actions.service.spec.ts` | one-tap-actions | 9 |

### Pattern 2: Extend Phase 25 tenant isolation for `sim-*`

```python
# Source: services/agent-orchestrator/tests/e2e/conftest_prod.py
# Phase 36 documents; Phase 37 implements sim-* variants.

SIM_ID_PREFIX = "sim-"
SIM_ROW_PREFIX = "sim-"
E2E_ANCHOR = "e2e-test-restaurant"  # NEVER deleted; coexistence OK

# Current E2E_TABLES (only 8) — document gap; expand in Phase 37:
# inventory_stock, notification_deliveries, notification_logs,
# order_interactions, calendar_events, pos_webhook_logs,
# system_audit_log, master_wine_library_submissions
```

### Pattern 3: Honest inventory status columns

| Column | Values | Rule |
|--------|--------|------|
| `group` | 1–11 id or slug | Required |
| `path` | repo-relative | Required |
| `runner` | jest / vitest / pytest / playwright | Required |
| `layer` | unit / integration / e2e / prod_e2e / unknown | Path + pytest markers |
| `ci_job` | `test-typescript` / `test-python` / `test-e2e` / `e2e-prod` / none | Workflow membership |
| `runs?` | yes / no / unknown | `yes` only if named CI job invokes that runner |
| `passes?` | yes / no / unknown / stale-suspect | **Default `unknown`.** Never claim yes without green artifact from this phase. Prefer documenting known CI red in notes over inventing `no` for every file. |
| `notes` | free text | Duplicate golden path; unrouted UI; secret gaps |

### Pattern 4: T0–T4 ↔ Agent Level mirror

| Test maturity | Meaning (locked) | Agent Level analogue |
|---------------|------------------|----------------------|
| T0 | Untested | Level 0 — prototype / absent proof |
| T1 | Smoke — happy path runs | Level 1 — basic path works |
| T2 | Contract — happy + key errors + output assertions | Level 2 — behavioral correctness |
| T3 | Resilient — idempotency / concurrency / failure modes | Level 3–4 infra guarantees [CITED: .planning/PROJECT.md] |
| T4 | Ground-truth / golden-set verified | Beyond agent Level — Phase 37+ oracle or Phase 42 goldens |

### Anti-Patterns to Avoid

- **Rewriting or deleting failing tests** — violates D-05.
- **Second prod E2E workflow** — violates D-24.
- **Claiming CI or nightly green** — both currently red [VERIFIED: gh runs].
- **Two primary groups for one surface** — violates D-10.
- **DB domains from `database.types.ts`** — ~8 tables vs ~152 migrations [VERIFIED].
- **Implementing SimPOS / generator / eval runners** — Phases 37–42.
- **Fixing Black / empty E2E secrets / pnpm install in e2e-prod** as Phase 36 scope — document only unless they block writing markdown (they do not).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Prod E2E JWT + teardown | New harness | `conftest_prod.py` + `setup_e2e_anchor.py` | Production-proven |
| Nightly cloud E2E | New workflow | `.github/workflows/e2e-prod.yml` | Cron + waves exist |
| JUnit aggregation | Custom XML | pytest `--junitxml` + `cascading_report.py` | Phase 25 |
| Scoring product | Custom service | Markdown scorecard + rubric | Docs-first campaign |
| Tenant isolation lib | Ad-hoc deletes | Documented `sim-*` + service-role sweeps | RLS / orphan risk |

**Key insight:** Phase 36 value is **canonical answers**, not new test machinery.

## Gaps vs Existing Plans (36-01..03)

Plans already exist and are executable. Refresh findings that executors / plan-checkers should watch:

| Area | Plan assumption | Live evidence | Action |
|------|-----------------|---------------|--------|
| Corpus floors (36-02) | ≈41 / ≈30 / 4 / ≈67 | **41 / 30 / 4 / 67** exact | Floors still valid |
| Nest module list (36-01) | 33 modules + `__tests__` | **34** top-level dirs match plan list | OK — no new top-level Nest module |
| `procurement/documents/` (credits) | Mapped via procurement group 5 | Controllers exist under `procurement/documents/` — **not** a new Nest top-level dir | Registry row stays under `procurement`; inventory rows include document specs under group 5 |
| Specs column (36-01) | Per-module count | In-module counts often **0** while `__tests__` holds 6 specs | Prefer “Specs (in-module + `__tests__` attribution)” or mark `unknown` + inventory owns truth |
| TFND-05 (36-03) | Comment-only; nightly exists | Nightly **scheduled** ✓ but **fails before waves**; several secrets empty in run logs | Keep comment-only scope; strengthen README/scorecard honesty to mention e2e-prod red + secret incompleteness |
| Black debt (36-02/03) | Note Black red | Still red on `studio_routes.py` | Unchanged — out of scope |
| `.planning/testing/` | Created by execution | **Absent** today | Wave 0 = create artifacts (VALIDATION.md still accurate) |
| Wave files | A–E + G | Confirmed 6 `wave_*.py`; F = Playwright `prod-smoke` | OK |

**No plan rewrite required** for corpus/module drift. Optional post-execution tweak: inventory Known Anomalies should list e2e-prod secret emptiness alongside Black.

## Common Pitfalls

### Pitfall 1: Mapping collisions for shared modules
**What goes wrong:** `common/`, `websocket`, analytics-adjacent notifications double-counted.
**How to avoid:** Pattern 1 rules; enumerate every Nest top-level dir, every `App.tsx` `path=`, every `agents/*.py`, every DB domain bucket.
**Warning signs:** Registry row count ≠ surface count; two primaries.

### Pitfall 2: File existence ≠ maturity
**What goes wrong:** Scorecard jumps to T2 because files exist.
**How to avoid:** Holistic T1 only if `runs?=yes` evidence; no T4 in baseline (Plan 36-02); mark duplicate golden path `stale-suspect`.

### Pitfall 3: Confusing local Playwright with cloud nightly
**What goes wrong:** Treat `ci.yml` `test-e2e` as TFND-05 nightly.
**How to avoid:** Inventory separates `test-e2e` (local) vs `e2e-prod` (cloud). `sim-*` targets **cloud** Supabase.

### Pitfall 4: RLS / partial teardown
**What goes wrong:** Seeds work with service role; JWT paths fail; orphans remain.
**How to avoid:** Require `user_restaurant_access` for sim JWT users; document expandable teardown beyond current 8-table `E2E_TABLES`; never delete anchor; orphan → Sentry, never raise.

### Pitfall 5: TFND-05 over-interpreted as “fix CI”
**What goes wrong:** Phase 36 absorbs Black + e2e-prod secret plumbing.
**How to avoid:** Comment-only YAML + honesty notes. Secret/install repair is ops/backlog — not TFND scope.

### Pitfall 6: Missing `__tests__` / document / orphan UI rows
**What goes wrong:** Inventory undercounts Nest coverage; misses `RecurringOrders.deps.test.tsx` (unrouted) or `ReceivingWorkspace.test.tsx` (group 5 receiving).
**How to avoid:** Use live find lists in Plan 36-02 discovery commands; anomalies section required.

## Code Examples

### Inventory row

```markdown
| group | path | runner | layer | ci_job | runs? | passes? | notes |
|-------|------|--------|-------|--------|-------|---------|-------|
| 3-inventory | apps/api-gateway/src/inventory/inventory.service.spec.ts | jest | unit | test-typescript | yes | unknown | |
| 3-inventory | apps/api-gateway/src/__tests__/inventory-ledger.service.spec.ts | jest | unit | test-typescript | yes | unknown | lives in __tests__; owns inventory-ledger |
| 4-pos | services/agent-orchestrator/tests/e2e/wave_d_toast_pipeline.py | pytest | prod_e2e | e2e-prod | yes | unknown | Phase 25 Wave D; nightly currently red |
| 5-procurement | apps/web/src/pages/inventory/command/ReceivingWorkspace.test.tsx | vitest | unit | test-typescript | yes | unknown | receiving loop |
| 11-platform | services/agent-orchestrator/tests/test_golden_path_e2e 2.py | pytest | unknown | test-python | yes | stale-suspect | duplicate filename with space |
```

### Scorecard row

```markdown
| # | Group | Score | Evidence | Gaps | Next phase |
|---|-------|-------|----------|------|------------|
| 3 | Inventory Operations | T1 | inventory.service.spec.ts; __tests__/inventory-ledger…; test_inventory_engine_* | No concurrency suite | Phase 39 |
```

### CI skeleton (Plan 36-03)

```yaml
# TFND-05 (Phase 36 Testing Campaign):
# test-typescript  → unit + integration (Jest api-gateway + Vitest web via turbo/pnpm test)
# test-python      → unit + integration (pytest tests/; markers in pytest.ini not filtered today)
# test-e2e         → local Playwright smoke (NOT cloud prod E2E)
# Cloud nightly E2E remains .github/workflows/e2e-prod.yml (schedule: 0 2 * * *)

# e2e-prod.yml header:
# TFND-05: Nightly cloud E2E skeleton — do not invent a second prod E2E paradigm (D-24).
# Phase 42 will add a separate weekly AI eval workflow — do not implement here (D-25).
```

## State of the Art (this repo)

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Ad-hoc tests per feature | 11-group campaign + T0–T4 scorecard | 2026-07-27 lock | Phase 36 skeleton |
| Permanent `e2e-test-restaurant` only | Coexist with `sim-*` | Phase 36 doc / 37 impl | Multi-archetype oracle |
| Agent Level 0–4 language | Parallel T0–T4 test maturity | Phase 36 | Shared vocabulary |
| Assume nightly green | Document schedule + current red/secret gaps | Refresh 2026-07-27 | Honest `passes?` |

**Deprecated/outdated:**
- `database.types.ts` as DB domain SoT — migrations are authoritative (~152 tables).
- Staging-environment E2E as campaign default — D-07 + Phase 25 locked to cloud.

## Surface Map Draft (for TFND-01 execution)

> Copy into `FUNCTIONALITY-REGISTRY.md`. Specs column = in-module `*.spec.ts` count only; `__tests__` listed separately above.

### A. api-gateway Nest modules → group

| Module (`apps/api-gateway/src/`) | Specs (in-module) | Primary group |
|---------------------------------|-------------------|---------------|
| `auth` | 1 | 1 Identity & Access |
| `organizations` | 0 | 1 |
| `restaurants` | 0 | 1 |
| `team` | 0 | 1 |
| `settings` | 0 | 1 |
| `user-preferences` | 0 | 1 |
| `restaurant-templates` | 0 | 1 |
| `wines` | 0 | 2 Catalog & Extraction |
| `menus` | 0 | 2 |
| `inventory` | 1 | 3 Inventory Operations |
| `inventory-ledger` | 0 (+1 in `__tests__`) | 3 |
| `storage-locations` | 0 | 3 |
| `pos-hub` | 1 | 4 POS & Sales Ingestion |
| `toast` | 0 | 4 |
| `procurement` | 9 (incl. documents/*) | 5 Procurement & Vendors |
| `providers` | 1 | 5 |
| `vendor-catalogue` | 0 | 5 |
| `contacts` | 0 | 5 (also_touches: 6) |
| `communications` | 5 | 6 Communications & Email Intelligence |
| `conversations` | 0 | 6 |
| `calendar` | 1 (+1 in `__tests__`) | 7 Calendar & Scheduling |
| `events` | 0 (+2 in `__tests__`) | 7 |
| `dashboard` | 1 (+1 in `__tests__`) | 8 Analytics, Reports & Insights |
| `reports` | 0 | 8 |
| `analytics` | 8 | 8 |
| `notifications` | 2 | 9 Notifications & Alerts |
| `one-tap-actions` | 0 (+1 in `__tests__`) | 9 |
| `push` | 0 | 9 |
| `websocket` | 0 | 9 (also_touches: 11) |
| `ux-optimizer` | 0 | 10 AI Assistants & Recommendations |
| `mobile` | 0 | 9 (campaign-deferred) |
| `common` | 5 | 11 Platform & Agent Infrastructure |
| `database` | 0 | 11 |
| `__tests__` | 6 | Map per file (see Pattern 1) |

### B. Web routes (`App.tsx`) → group

| Route | Page | Primary group |
|-------|------|---------------|
| `/login` `/register` `/verify-email` `/invite/:code` `/no-access` `/get-started` `/onboarding` | auth/onboarding | 1 |
| `/profile` `/settings` `/services` `/team` `/help` | profile/settings/team | 1 |
| `/wines` `/studio*` | WineLibrary / Studio | 2 |
| `/inventory` `/inventory-legacy` | InventoryCommandPage / Inventory | 3 |
| `/receiving/:orderId/door` | DoorReceipt | 5 (also_touches: 3) |
| `/orders` | Orders | 5 |
| `/providers` `/promotions` | Providers / Promotions | 5 / 6 |
| `/communications` | Communications | 6 |
| `/calendar` `/calendar-classic` | CalendarModular / Calendar | 7 |
| `/` `/reports` `/documents-reports` `/recommendations/catalog` | Dashboard / Reports / Documents / InsightCatalog | 8 |
| `/notifications` | Notifications | 9 |
| `/recommendations` `/sommelier` `/wine-agent*` | Recommendations / SommelierAI | 10 |
| `/admin` `/admin/health` `/dev-sandbox` | Admin* / DevSandbox | 11 |

Orphan UI: `RecurringOrders.tsx` + Vitest — **not routed** → group 5. [VERIFIED: App.tsx]

### C. Orchestrator agents → group (25 agents)

| Agent file | Primary group |
|------------|---------------|
| `book_scraper_agent.py`, `dataset_creator_agent.py`, `menu_analyzer_agent.py`, `visual_verification_agent.py` | 2 |
| `inventory_engine.py`, `ghost_inventory_agent.py`, `shrinkage_detective_agent.py`, `buffer_manager.py`, `inequality_detector.py`, `state_invariant_enforcer.py` | 3 |
| `pos_integration_agent.py` | 4 |
| `procurement_agent.py`, `rfq_agent.py`, `recurring_order_agent.py`, `negotiation_playbook_agent.py`, `auto_pilot_agent.py`, `provider_communication_agent.py` | 5 |
| `email_intel_agent.py`, `email_parsing_agent.py`, `provider_conversation_agent.py` | 6 |
| `calendar_agent.py` | 7 |
| `reporting_agent.py` | 8 |
| `notification_agent.py` | 9 |
| `sommelier_agent.py` | 10 |
| `compliance_agent.py` | 11 (also_touches: 5) |

### D. Database domains (migration-derived) → group

| DB domain | Example tables | Group |
|-----------|----------------|-------|
| Identity / tenancy | `users`, `user_roles`, `user_restaurant_access`, `organizations`, `invite_*`, … | 1 |
| Catalog / wine / studio | `master_wine_library`, `menu_items`, `field_review_queue`, … | 2 |
| Inventory | `restaurant_inventory`, `inventory_*`, `storage_locations`, `shrinkage_alerts` | 3 |
| POS / sales | `sales_events`, `pos_webhook_logs`, `toast_item_mappings`, … | 4 |
| Procurement / vendors | `providers`, `procurement_*`, `vendor_catalogue`, `rfq_requests`, `invoice_scans`, … | 5 |
| Communications | `order_interactions`, `email_prospects`, `restaurant_inbound_addresses`, … | 6 |
| Calendar | `calendar_*`, `events`, `custom_reminders` | 7 |
| Analytics / reports | `generated_reports`, `analytics_cache`, `budgets`, … | 8 |
| Notifications | `notifications`, `push_subscriptions`, `one_tap_actions`, … | 9 |
| AI assistants | `sommelier_conversations`, recommendation tables | 10 |
| Platform | `idempotency_keys`, `outbox`, `saga_state`, `dead_letter_queue`, `decision_log`, … | 11 |

~152 unique CREATE TABLE names across `supabase/migrations/`. [VERIFIED: rg + sort -u]

## Existing Test Corpus Snapshot (TFND-03 input)

| Bucket | Count | CI membership | Notes |
|--------|-------|---------------|-------|
| api-gateway `*.spec.ts` | **41** | `test-typescript` | Includes 6 under `__tests__` + 9 under procurement |
| web `src/**/*.test.*` | **30** | `test-typescript` | Incl. ReceivingWorkspace, RecurringOrders orphan |
| web `e2e/*.spec.ts` | **4** | `test-e2e` (+ prod-smoke also Wave F) | smoke, navigation, studio-flow, prod-smoke |
| orchestrator `test_*.py` + e2e helpers | **61** of 67 | `test-python` | Incl. hardening, golden path, studio, chaos |
| Phase 25 `wave_*.py` | **6** | `e2e-prod` only | A–E + G; F = Playwright |
| packages/* tests | **0** | n/a | Confirmed empty |
| mobile tests | stub | exits 0 | Deferred |
| **Total inventoriable** | **~142** | — | 41+30+4+67 |

**Phase 25 harness (extend, don’t fork):**
- `services/agent-orchestrator/scripts/setup_e2e_anchor.py`
- `services/agent-orchestrator/tests/e2e/conftest_prod.py`
- `services/agent-orchestrator/tests/e2e/wave_{a,b,c,d,e,g}_*.py`
- `services/agent-orchestrator/scripts/cascading_report.py`
- `apps/web/playwright.prod.config.ts`, `apps/web/e2e/prod-smoke.spec.ts`
- `.github/workflows/e2e-prod.yml`

## CI Gap Analysis (TFND-05)

| Requirement | Current state | Gap for Phase 36 |
|-------------|---------------|------------------|
| Unit + integration on push | `test-typescript` (`pnpm test`) + `test-python` (`pytest tests/`) | **Mostly satisfied.** Comment/job clarity only. Markers not filtered. |
| E2E nightly | `cron: '0 2 * * *'` present | **Schedule satisfied.** Runtime red — document honesty, do not fork. |
| Extend Phase 25 | Workflow + conftest exist | README cross-links + Phase 42 placeholder comment |
| Local Playwright on push | `test-e2e` job | Keep; inventory separately |
| Green CI | Black fail on `studio_routes.py` | Out of scope; note in scorecard/README |
| Nightly secrets / install | Empty E2E credentials in run env; fail at `pnpm install` before waves | **Document** in honesty section; secret repair is ops/backlog, not TFND |

`deploy.yml` may trigger `e2e-prod.yml` post-audit — leave untouched.

Workflows present: `ci.yml`, `e2e-prod.yml`, `deploy.yml`, `codeql.yml` — **no** `testing-campaign.yml`. [VERIFIED]

## Proposed `.planning/testing/` Artifact Shapes

Aligned with Plans 36-01..03:

1. **`RUBRIC.md`** — locked T0–T4 strings, Level mirror, evidence/promotion rules
2. **`FUNCTIONALITY-REGISTRY.md`** — 11 groups, mapping rules, Nest/web/agent/DB tables
3. **`EXISTING-TEST-INVENTORY.md`** — methodology + full path table + anomalies
4. **`TESTING-SCORECARD.md`** — 11 rows, mostly T0/T1, no T4, next-phase owners
5. **`SYNTHETIC-TENANT.md`** — `sim-*` + RLS + teardown + Phase 37 deferral
6. **`README.md`** — index + CI proof links + honesty (Black + e2e-prod)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Agent Level ↔ T-maturity mirror (esp. T3≈Level 3–4) is the intended analogy | Rubric | Rubric wording tweak — T0–T4 definitions themselves locked |
| A2 | Receiving door primary = Procurement (5) not Inventory (3) | Surface map | Phase 39/40 suite ownership |
| A3 | `contacts` primary = Procurement (5) | Surface map | Comms attribution |
| A4 | Phase 36 should not fix Black or e2e-prod secrets/install | Pitfalls / CI | If success criteria reinterpreted as “green CI”, scope explodes |
| A5 | Empty secret values in `gh` logs mean secrets unset/unavailable to the workflow (not redacted blanks) | CI Gap | If secrets are set but masked oddly, diagnosis differs — still do not claim nightly green |

## Open Questions (RESOLVED)

1. **Should Phase 36 touch `ci.yml` at all if jobs already run tests?**
   - **RESOLVED:** Comment-only annotations (Plan 36-03); no behavioral CI changes (D-24).

2. **How to score groups with agent tests but zero Nest/page tests?**
   - **RESOLVED:** Holistic group scoring (Plan 36-02) — baseline may be `T1` only when `runs?=yes` **and** loadable smoke is documented, otherwise **`T1?` provisional** with Gaps text `CI green unverified`. Exclude `stale-suspect` from T1-eligible evidence. No promote-past-T1 in later phases until `passes?=yes` or explicit waiver. No T4 in Phase 36 baseline. (Aligned with post-premortem Plan 36-02 C3.)

3. **Expand `E2E_TABLES` teardown list in Phase 36?**
   - **RESOLVED:** Document gap in `SYNTHETIC-TENANT.md` (Plan 36-03); code expansion deferred to Phase 37.

4. **Should Phase 36 fix empty e2e-prod secrets / pnpm install failure?**
   - What we know: Nightly schedule exists; recent runs fail before Wave A; several secrets appear empty in env dump.
   - What's unclear: Whether secrets were never configured vs rotated/lost.
   - Recommendation: **Do not expand Phase 36.** Document in README/scorecard honesty; optional ops follow-up outside TFND. Plans remain correct.
   - **RESOLVED (scope):** Out of Phase 36; honesty note required (`schedule-present / capability-unverified` + secrets yes/no). **OPEN (ops):** Who restores `E2E_TEST_*` / `VERCEL_PRODUCTION_URL` / `RABBITMQ_URL` secrets — human ops, not this phase.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Inventory / CI docs | ✓ | v22.22.2 local (CI 20.x) | CI version is SoT |
| pnpm | TS tests | ✓ | 9.15.9 | — |
| Python | pytest inventory | ✓ | 3.11.0 | — |
| pytest | Orchestrator tests | ✓ | 7.4.4 | — |
| GitHub Actions / `gh` | CI gap verification | ✓ | available | — |
| Supabase cloud credentials | Live `passes?` proof | ✗ this session | — | `passes?=unknown` |
| Railway / Vercel live | Live E2E | ✗ this session | — | Workflow existence ≠ green |
| `.planning/testing/` | Deliverables | ✗ absent | — | Create in Plans 36-01..03 |

**Missing dependencies with no fallback:** None for doc/CI-skeleton work.

**Missing dependencies with fallback:** Credentialed green runs for `passes?` — default `unknown`.

## Validation Architecture

> `workflow.nyquist_validation` is `true` in `.planning/config.json`. [VERIFIED]

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest 29.7 (api-gateway) + Vitest 2.1 (web) + pytest 7.4.4 (orchestrator) + Playwright 1.58 |
| Config file | `apps/api-gateway/package.json#jest`, `apps/web/vitest.config.ts`, `services/agent-orchestrator/pytest.ini`, `apps/web/playwright*.config.ts` |
| Quick run command | Doc greps for TFND artifacts + `pnpm --filter @wineops/api-gateway test -- --listTests` / `pytest --collect-only -q` (&lt; 30s) |
| Full suite command | Confirm all `.planning/testing/` artifacts exist + cross-link; do **not** require full suite green |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TFND-01 | Registry maps all surfaces → one group | doc assertion | `rg` group names + Nest module loop (Plan 36-01 verify) | ❌ Wave 0 |
| TFND-02 | Rubric defines T0–T4 | doc assertion | `rg 'T0|T1|T2|T3|T4' .planning/testing/RUBRIC.md` | ❌ Wave 0 |
| TFND-03 | Every test file catalogued | inventory completeness | Diff `find` vs inventory paths (Plan 36-02 floors) | ❌ Wave 0 |
| TFND-04 | Scorecard 11 rows baseline | doc assertion | `rg -c '^\| [0-9]+ \|' …` expect 11; forbid T4 | ❌ Wave 0 |
| TFND-05 | Push unit/integration + nightly E2E | workflow assertion | `rg 'TFND-05|cron:|pnpm run test|pytest' workflows` | ✅ workflows exist; comments ❌ |
| TFND-06 | `sim-*` convention documented | doc assertion | `rg 'sim-' .planning/testing/SYNTHETIC-TENANT.md` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** Plan verify greps
- **Per wave merge:** All six TFND files exist and cross-link
- **Phase gate:** TFND-01..06 acceptance greps before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `.planning/testing/FUNCTIONALITY-REGISTRY.md` — TFND-01
- [ ] `.planning/testing/RUBRIC.md` — TFND-02
- [ ] `.planning/testing/EXISTING-TEST-INVENTORY.md` — TFND-03
- [ ] `.planning/testing/TESTING-SCORECARD.md` — TFND-04
- [ ] `.planning/testing/SYNTHETIC-TENANT.md` — TFND-06
- [ ] `.planning/testing/README.md` — index
- [ ] Optional: `scripts/testing/check-inventory-coverage.sh`
- [ ] CI comment annotations for TFND-05 (Plan 36-03)

*Wave 0 gaps **are** this phase’s deliverables — matches `36-VALIDATION.md`.*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (tenant JWT) | Supabase Auth REST password grant; never log JWT [VERIFIED: conftest_prod.py] |
| V3 Session Management | yes | Session-scoped JWT; &lt;1h suite budget |
| V4 Access Control | yes | RLS via `user_restaurant_access`; service-role only for seed/teardown |
| V5 Input Validation | yes (ID prefixes) | Enforce `sim-*` / `e2e-*` conventions in docs |
| V6 Cryptography | no | No new crypto in Phase 36 |

### Known Threat Patterns for testing tenants

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Synthetic tenant data leak into real restaurants | Information Disclosure | Distinct `sim-*` IDs; never reuse production UUIDs |
| Incomplete teardown orphans | Tampering / Elevation | Tag sweep + Sentry `sim-orphan` / `e2e-orphan`; never raise |
| Service-role key in client | Information Disclosure | Service role only in CI secrets / server scripts |
| RLS bypass assumptions | Elevation of Privilege | JWT paths need membership rows; service-role ≠ user-path proof |
| CI secret exfiltration via test logs | Information Disclosure | Never write JWT to disk/JUnit/logs |
| Setting `PYTEST_RUNNING` in e2e-prod | Tampering (disables Sentry) | FORBIDDEN — Plan 36-03 high-severity gate |

## Sources

### Primary (HIGH confidence)
- `.planning/phases/36-testing-foundation-functionality-registry/36-CONTEXT.md` — locked decisions
- `.planning/phases/36-testing-foundation-functionality-registry/36-01-PLAN.md` … `36-03-PLAN.md` — existing plans
- `.planning/REQUIREMENTS.md` — TFND-01..06
- `.planning/ROADMAP.md` — Phase 36 success criteria + Testing Campaign
- `.planning/STATE.md` — current focus / next execute
- `.github/workflows/ci.yml`, `e2e-prod.yml` — CI behavior
- Live codebase inventory (find/ls/rg) 2026-07-27 — counts, modules, agents, routes, migrations
- `gh run view` 30299009969 (CI Black) + 30240577056 (e2e-prod install/secrets)
- `services/agent-orchestrator/tests/e2e/conftest_prod.py`, `pytest.ini`
- `.planning/config.json` — nyquist_validation true
- npm view — jest/vitest/playwright latest versions

### Secondary (MEDIUM confidence)
- `.planning/phases/25-production-e2e-test-suite/25-RESEARCH.md` — prior E2E design
- `.planning/PROJECT.md` — agent Level language
- Jest 30 upgrade docs — do-not-upgrade rationale

### Tertiary (LOW confidence)
- Exact root cause of e2e-prod `pnpm install` failure beyond exit code 1 (log truncated) — waves never started regardless
- Whether empty secret env lines mean unset vs masked — treat as non-green either way

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — pins verified in manifests + npm registry
- Architecture: HIGH — CONTEXT + Plans 36-01..03 + Phase 25 harness
- Pitfalls: HIGH — collisions, RLS, stale tests, dual CI red observed
- Scorecard baseline numbers: MEDIUM — until inventory filled at execution
- e2e-prod secret diagnosis: MEDIUM — empty env visible; install fail step known; deep pnpm error LOW

**Research date:** 2026-07-27 (force refresh)
**Prior research:** same day — superseded by this file (live CI/secret honesty + __tests__ attribution + ~152 tables + plan-gap table)
**Valid until:** 2026-08-27 (30 days; re-verify if Nest module tree or workflows change materially)
