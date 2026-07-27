# Phase 36: Testing Foundation & Functionality Registry - Research

**Researched:** 2026-07-27
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
| TFND-01 | `.planning/testing/FUNCTIONALITY-REGISTRY.md` maps every api-gateway module, web page, orchestrator agent, and database domain to exactly one of 11 groups | Surface inventory + recommended primary-group mapping tables below; collision rules under Architecture Patterns |
| TFND-02 | T0–T4 coverage rubric defined (mirrors agent Level system) | Locked D-12..16; Level↔T mapping table; recommend standalone `RUBRIC.md` |
| TFND-03 | Existing-test inventory: every spec/pytest/Playwright file catalogued (group, runs?, passes?) — kept as-is | Counted corpus (~142 files); CI membership matrix; honest `runs?`/`passes?` protocol |
| TFND-04 | `.planning/testing/TESTING-SCORECARD.md` initialized with baseline score + evidence per group | Expected T0/T1 baseline; evidence = inventory links + Phase 25 wave coverage |
| TFND-05 | GitHub Actions: unit + integration on push, E2E nightly (extends Phase 25 e2e-prod.yml) | `ci.yml` already runs TS/Python tests + local Playwright; `e2e-prod.yml` already nightly; gaps = labeling, honesty about red CI, no second paradigm |
| TFND-06 | Synthetic tenant isolation: `sim-*` restaurant_id, RLS-safe seeding, idempotent teardown | Extend `conftest_prod.py` / `setup_e2e_anchor.py` patterns; document in `SYNTHETIC-TENANT.md` |
</phase_requirements>

## Summary

Phase 36 is a **documentation + wiring** phase, not a test-writing phase. The planner should produce artifacts under `.planning/testing/` that later phases (37–43) treat as canonical, plus light CI annotations that make TFND-05 true without inventing a second production E2E stack. The corpus to inventory is already large: **41** NestJS `*.spec.ts` under api-gateway, **30** Vitest files under `apps/web/src`, **4** Playwright specs under `apps/web/e2e`, and **~67** pytest modules under `services/agent-orchestrator/tests` (including 6 Phase 25 `wave_*.py` files + `conftest_prod.py`). [VERIFIED: codebase inventory 2026-07-27]

Phase 25 already solved live-cloud isolation for a permanent `e2e-test-restaurant` anchor with JWT via Supabase Auth REST, service-role teardown, deterministic `e2e-*` IDs, and nightly `e2e-prod.yml`. Phase 36 must **document the `sim-*` extension** of that model (not fork it) and map every surface into the 11 locked groups with explicit collision rules for shared modules.

**Primary recommendation:** Create `.planning/testing/` with five files (`FUNCTIONALITY-REGISTRY.md`, `RUBRIC.md`, `EXISTING-TEST-INVENTORY.md`, `TESTING-SCORECARD.md`, `SYNTHETIC-TENANT.md` + thin `README.md` index); annotate `ci.yml` job names/comments for unit+integration clarity; leave `e2e-prod.yml` schedule intact with a Phase 42 placeholder comment only — do not add a second prod E2E workflow.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Functionality registry (TFND-01) | CDN / Static (repo docs) | — | Planning artifact in git; no runtime owner |
| T0–T4 rubric (TFND-02) | CDN / Static (repo docs) | — | Scoring contract consumed by later phases |
| Existing-test inventory (TFND-03) | CDN / Static (repo docs) | API / Backend + Browser (sources) | Catalog of existing tests across tiers |
| Scorecard baseline (TFND-04) | CDN / Static (repo docs) | — | Living scoreboard updated by Phases 39–43 |
| Unit + integration on push (TFND-05) | API / Backend + Frontend Server + Browser | GitHub Actions | Jest/Vitest/pytest already in `ci.yml` |
| Nightly E2E (TFND-05) | API / Backend + Browser | Database / Storage | Phase 25 `e2e-prod.yml` hits Railway + Vercel + Supabase |
| `sim-*` tenant convention (TFND-06) | Database / Storage | API / Backend | restaurant_id + RLS + service-role seed/teardown |
| Surface mapping inputs | API / Backend + Browser + Database | — | Modules/pages/agents/tables are the registry payload |

## Project Constraints (from CLAUDE.md)

No `CLAUDE.md` at repo root. [VERIFIED: glob 2026-07-27]

Relevant project skills/patterns that still constrain planning:

| Source | Directive |
|--------|-----------|
| `.cursor/skills/reasoning-and-planning-protocol/SKILL.md` | Decompose → solve → verify → synthesize; flag confidence &lt; 0.8 |
| `.planning/config.json` | `workflow.nyquist_validation: true` — include Validation Architecture |
| STATE.md | Pre-existing CI debt (ruff/black/eslint) noted; do not treat current main CI as green without evidence |
| Phase 25 locked patterns | Never set `PYTEST_RUNNING` in prod E2E CI; never raise in teardown; never invent staging-only paradigm for campaign E2E |

## Standard Stack

### Core (already in repo — Phase 36 adds no new runtime deps)

| Library / Tool | Version | Purpose | Why Standard |
|----------------|---------|---------|--------------|
| Jest | `^29.7.0` (api-gateway) | NestJS unit/integration `*.spec.ts` | Existing gateway test runner [VERIFIED: apps/api-gateway/package.json] |
| Vitest | `^2.1.9` (web) | Web unit/component tests | Existing frontend test runner [VERIFIED: apps/web/package.json] |
| Playwright | `^1.58.0` (web) | Browser E2E (local + prod smoke) | Existing; `playwright.config.ts` + `playwright.prod.config.ts` [VERIFIED: apps/web/package.json] |
| pytest | `7.4.4` | Orchestrator unit/integration/E2E | Pinned in requirements.txt [VERIFIED: services/agent-orchestrator/requirements.txt] |
| pytest-asyncio | `0.23.3` | Async agent tests | Pinned; CI comment warns against unpinned upgrade [VERIFIED: ci.yml + requirements.txt] |
| GitHub Actions | `actions/checkout@v4`, Node 20.x, Python 3.11 | CI | Existing `ci.yml` / `e2e-prod.yml` / `deploy.yml` [VERIFIED: workflow files] |
| Supabase Auth REST + service role | cloud | JWT + teardown for tenants | Phase 25 pattern [VERIFIED: conftest_prod.py] |

### Supporting (docs / CI only for Phase 36)

| Artifact / Tool | Version | Purpose | When to Use |
|-----------------|---------|---------|-------------|
| Markdown under `.planning/testing/` | n/a | Registry, rubric, inventory, scorecard, tenant convention | All TFND deliverables |
| `pytest` markers (`unit`, `integration`, `e2e`, `prod_e2e`) | in `pytest.ini` | Classify orchestrator tests | Inventory `runs?` column; optional CI filter later [VERIFIED: pytest.ini] |
| Codecov upload (Python) | codecov-action@v3 | Coverage artifact | Already in `ci.yml` — do not expand in Phase 36 |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Annotate existing `ci.yml` + keep `e2e-prod.yml` | New `testing-campaign.yml` | Violates D-24; duplicates secrets/triggers — reject |
| Embed rubric inside scorecard only | Standalone `RUBRIC.md` | Standalone is linkable from registry + scorecard + later plans — prefer standalone |
| Single mega-registry file | Split registry / inventory / scorecard | Split matches locked paths (D-11, D-17) and reduces merge conflicts |

**Installation:** None required for Phase 36 deliverables.

**Version verification (registry):** jest latest `30.4.2`, vitest latest `4.1.10`, `@playwright/test` latest `1.62.0` on npm (2026-07-27) — **do not upgrade** in this phase; stay on repo pins. [VERIFIED: npm view]

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
                                    │
                                    ▼
                     Later phases write suites INTO groups
                     (37 sim seed → 38 SimPOS → 39–43 score ↑)
```

### Recommended Project Structure

```
.planning/testing/
├── README.md                      # Index + how to update scores
├── FUNCTIONALITY-REGISTRY.md      # TFND-01 — 11 groups + full surface map
├── RUBRIC.md                      # TFND-02 — T0–T4 definitions + Level mirror
├── EXISTING-TEST-INVENTORY.md     # TFND-03 — every test file row
├── TESTING-SCORECARD.md           # TFND-04 — baseline scores + evidence
└── SYNTHETIC-TENANT.md            # TFND-06 — sim-* convention

# Unchanged (extend by reference, do not fork):
services/agent-orchestrator/tests/e2e/conftest_prod.py
services/agent-orchestrator/scripts/setup_e2e_anchor.py
.github/workflows/ci.yml           # annotate unit/integration clarity
.github/workflows/e2e-prod.yml     # nightly already present; placeholder for Phase 42
```

### Pattern 1: Primary-group mapping with secondary notes

**What:** Every surface gets exactly one primary group (D-10). Cross-cutting modules get a one-line `also_touches:` note — never a second primary.
**When to use:** Always during registry finalization.

**Collision rule (locked recommendation):**
1. Prefer the group that owns the **user-facing workflow** if the module is a page/route.
2. Prefer the group that owns the **write domain** if the module is a Nest/DB table.
3. Prefer **Platform & Agent Infrastructure (11)** for shared infra: `common/`, `database/`, `idempotency`, `outbox`, `saga_state`, `dead_letter_queue`, health, observability, admin health.
4. Prefer **Identity & Access (1)** for auth/guards/org/team/profile/settings/user prefs.
5. Mobile (`apps/api-gateway/src/mobile`, `apps/mobile`) — map into registry for completeness, mark **campaign-deferred** (D-02); do not plan mobile suites in 36–43.

### Pattern 2: Extend Phase 25 tenant isolation for `sim-*`

**What:** Keep permanent anchors; use prefix namespaces for synthetic restaurants; service-role seed + idempotent teardown; never delete the Phase 25 `e2e-test-restaurant` anchor.
**When to use:** Document now (TFND-06); implement generator in Phase 37.

```python
# Source: services/agent-orchestrator/tests/e2e/conftest_prod.py (teardown pattern)
# Phase 36 documents; Phase 37 implements sim-* variants.

SIM_ID_PREFIX = "sim-"           # restaurant.id / restaurant_id values
SIM_ROW_PREFIX = "sim-"          # deterministic row ids (parallel to e2e-%)
E2E_ANCHOR = "e2e-test-restaurant"  # NEVER deleted; coexistence OK

# Teardown sweep (conceptual extension of E2E_TABLES loop):
# DELETE WHERE restaurant_id LIKE 'sim-%' AND id LIKE 'sim-%'
# OR restaurant_id = <specific sim restaurant> after run
# Failures → Sentry tag e2e-orphan / sim-orphan — NEVER raise
```

### Pattern 3: Honest inventory status columns

**What:** Inventory columns beyond the locked minimum.
**Recommended columns:**

| Column | Values | Rule |
|--------|--------|------|
| `group` | 1–11 id or slug | Required |
| `path` | repo-relative | Required |
| `runner` | jest / vitest / pytest / playwright | Required |
| `layer` | unit / integration / e2e / prod_e2e / unknown | Infer from path + markers |
| `ci_job` | `test-typescript` / `test-python` / `test-e2e` / `e2e-prod` / none | From workflow membership |
| `runs?` | yes / no / unknown | `yes` only if a named CI job invokes that runner on push or schedule |
| `passes?` | yes / no / unknown / stale-suspect | **Never claim yes without a green run artifact or local green evidence from this phase**; default `unknown` |
| `notes` | free text | e.g. duplicate file `test_golden_path_e2e 2.py` |

### Pattern 4: T0–T4 ↔ Agent Level mirror

| Test maturity | Meaning (locked) | Agent Level analogue |
|---------------|------------------|----------------------|
| T0 | Untested | Level 0 — prototype / absent proof |
| T1 | Smoke — happy path runs | Level 1 — basic path works |
| T2 | Contract — happy + key errors + output assertions | Level 2 — behavioral correctness |
| T3 | Resilient — idempotency / concurrency / failure modes | Level 3–4 infra guarantees (BaseAgent already Level 3; Level 4 = idempotency/DLQ/saga) [CITED: .planning/PROJECT.md] |
| T4 | Ground-truth / golden-set verified | Beyond agent Level — requires simulator oracle (Phase 37+) or golden datasets (Phase 42) |

### Anti-Patterns to Avoid

- **Rewriting or deleting failing tests** — violates D-05; inventory + scorecard flag only.
- **Second prod E2E workflow** — violates D-24.
- **Claiming CI green** — main CI recently fails on Black (`studio_routes.py` would reformat) [VERIFIED: gh run 30280099250 2026-07-27].
- **Mapping a surface to two primary groups** — violates D-10; use secondary notes.
- **Implementing SimPOS / generator / eval runners** — Phases 37–42.
- **Assuming `packages/database/src/types/database.types.ts` is complete** — generated types currently list only ~8 tables; migrations define **~130** tables. Registry DB domains must be migration-derived, not types-derived. [VERIFIED: inventory 2026-07-27]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Prod E2E JWT + teardown | New auth/teardown harness | `conftest_prod.py` + `setup_e2e_anchor.py` | Already production-proven patterns |
| Nightly cloud E2E runner | New workflow | `.github/workflows/e2e-prod.yml` | Cron + deploy gate + waves already exist |
| JUnit aggregation | Custom XML serializer | pytest `--junitxml` + existing `cascading_report.py` | Phase 25 standard |
| Scoring framework product | Custom scoring service | Markdown scorecard + rubric | Campaign is agent-led docs-first |
| Tenant isolation library | Ad-hoc delete scripts without registry | Documented `sim-*` convention + service-role sweeps | RLS + orphan risk |

**Key insight:** Phase 36 value is **canonical answers**, not new test machinery. Reuse Phase 25 / existing runners.

## Common Pitfalls

### Pitfall 1: Mapping collisions for shared modules
**What goes wrong:** `common/`, `database/`, `websocket`, analytics-adjacent notifications get double-counted or left unmapped.
**Why it happens:** Cross-cutting code serves many groups.
**How to avoid:** Apply Pattern 1 collision rules; list every Nest top-level dir, every `App.tsx` route, every `agents/*.py`, every DB domain bucket.
**Warning signs:** Registry row count ≠ surface count; duplicate primary groups.

### Pitfall 2: Stale / duplicate / local-only tests inflate perceived maturity
**What goes wrong:** Scorecard jumps to T2 because files exist.
**Why it happens:** Existence ≠ CI green; duplicate `test_golden_path_e2e 2.py` present; many Nest modules have **0** specs. [VERIFIED: inventory]
**How to avoid:** Score from rubric evidence, not file counts; mark `passes?=unknown` until proven; baseline mostly T0/T1 (CONTEXT expectation).

### Pitfall 3: Cloud-only stack assumptions
**What goes wrong:** Plans assume local Docker/Postgres mirrors production behavior.
**Why it happens:** Campaign locked to Vercel + Railway + Supabase Cloud (D-07).
**How to avoid:** Inventory must distinguish local mock E2E (`conftest_e2e.py`, `ci.yml` Playwright) from prod waves (`conftest_prod.py`, `e2e-prod.yml`). `sim-*` seeds target **cloud** Supabase.

### Pitfall 4: RLS / service-role mismatch
**What goes wrong:** Seeds work with service role but fail under user JWT; teardown misses tables.
**Why it happens:** Phase 4 RLS policies exist (`user_restaurant_access`); STATE notes reads still often use service-role; teardown table list in `conftest_prod.py` is partial (`E2E_TABLES` = 8 tables). [VERIFIED: conftest_prod.py + migration 20260708170000]
**How to avoid:** `SYNTHETIC-TENANT.md` must require: (1) membership row in `user_restaurant_access` for sim users, (2) expandable teardown table registry, (3) never delete anchors, (4) orphan → Sentry, never raise.

### Pitfall 5: TFND-05 over-interpreted as “fix CI”
**What goes wrong:** Phase 36 balloons into reformatting/lint debt cleanup.
**Why it happens:** Push CI is currently red on Black.
**How to avoid:** Phase 36 CI work = skeleton clarity (job naming/comments, confirm nightly schedule, Phase 42 placeholder). Optional one-line note in scorecard/README that main CI is red as of research date — **do not** take on Black/ESLint debt unless it blocks documenting the skeleton.

### Pitfall 6: Inventory incompleteness (missed runners)
**What goes wrong:** Only count Nest specs and miss Vitest/Playwright/pytest e2e waves.
**How to avoid:** Use the four-bucket inventory below as the checklist for TFND-03.

## Code Examples

### Existing-test inventory row (recommended)

```markdown
| group | path | runner | layer | ci_job | runs? | passes? | notes |
|-------|------|--------|-------|--------|-------|---------|-------|
| 3-inventory | apps/api-gateway/src/inventory/inventory.service.spec.ts | jest | unit | test-typescript | yes | unknown | |
| 4-pos | services/agent-orchestrator/tests/e2e/wave_d_toast_pipeline.py | pytest | prod_e2e | e2e-prod | yes | unknown | Phase 25 Wave D |
| 2-catalog | apps/web/e2e/studio-flow.spec.ts | playwright | e2e | test-e2e | yes | unknown | local CI Playwright |
| 11-platform | services/agent-orchestrator/tests/test_golden_path_e2e 2.py | pytest | unknown | test-python | yes | stale-suspect | duplicate filename with space |
```

### Scorecard group row (recommended)

```markdown
| # | Group | Score | Evidence | Gaps | Next phase |
|---|-------|-------|----------|------|------------|
| 3 | Inventory Operations | T1 | inventory.service.spec.ts; test_inventory_engine_*; Wave D | No concurrency suite | Phase 39 |
```

### CI skeleton (discretion recommendation — annotate, don't fork)

```yaml
# In ci.yml — clarify TFND-05 without new workflow:
# test-typescript  → unit + integration (Jest api-gateway + Vitest web via turbo)
# test-python      → unit + integration (pytest; markers exist but not filtered today)
# test-e2e         → local Playwright smoke (NOT cloud prod E2E)
# Cloud nightly E2E remains e2e-prod.yml (schedule: 0 2 * * *)

# In e2e-prod.yml header comment only:
# Phase 42 will add a separate weekly eval workflow — do not implement here (D-25).
```

## State of the Art (this repo)

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Ad-hoc tests per feature | 11-group campaign with T0–T4 scorecard | 2026-07-27 lock | Phase 36 creates the skeleton |
| Permanent `e2e-test-restaurant` only | Coexist with `sim-*` synthetic tenants | Phase 36 doc / Phase 37 impl | Enables multi-archetype oracle |
| Agent Level 0–4 hardening language | Parallel T0–T4 test maturity language | Phase 36 | Same vocabulary across agents + suites |
| CI = lint + mixed tests | Explicit unit/integration on push + nightly cloud E2E | Phase 25 + 36 | TFND-05 |

**Deprecated/outdated:**
- Treating `database.types.ts` as the DB domain source of truth — migrations are authoritative.
- Staging-environment E2E as campaign default — Phase 25 + D-07 locked to cloud production/live stack.

## Surface Map Draft (for TFND-01 execution)

> Planner/executor should copy these into `FUNCTIONALITY-REGISTRY.md` and resolve edge notes. Primary assignments below are research recommendations (HIGH confidence for Nest module names / routes / agents as inventory; MEDIUM for nuanced cross-cuts).

### A. api-gateway Nest modules → group

| Module (`apps/api-gateway/src/`) | Specs (count) | Primary group |
|---------------------------------|---------------|---------------|
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
| `inventory-ledger` | 0 | 3 |
| `storage-locations` | 0 | 3 |
| `pos-hub` | 1 | 4 POS & Sales Ingestion |
| `toast` | 0 | 4 |
| `procurement` | 9 | 5 Procurement & Vendors |
| `providers` | 1 | 5 |
| `vendor-catalogue` | 0 | 5 |
| `contacts` | 0 | 5 (also_touches: 6) |
| `communications` | 5 | 6 Communications & Email Intelligence |
| `conversations` | 0 | 6 |
| `calendar` | 1 | 7 Calendar & Scheduling |
| `events` | 0 | 7 |
| `dashboard` | 1 | 8 Analytics, Reports & Insights |
| `reports` | 0 | 8 |
| `analytics` | 8 | 8 |
| `notifications` | 2 | 9 Notifications & Alerts |
| `one-tap-actions` | 0 | 9 |
| `push` | 0 | 9 |
| `websocket` | 0 | 9 (also_touches: 11) |
| `ux-optimizer` | 0 | 10 AI Assistants & Recommendations |
| `mobile` | 0 | 9 (campaign-deferred) |
| `common` | 5 | 11 Platform & Agent Infrastructure |
| `database` | 0 | 11 |
| `__tests__` | 6 | Map per file into owning group |

### B. Web routes (`App.tsx`) → group

| Route | Page | Primary group |
|-------|------|---------------|
| `/login` `/register` `/verify-email` `/invite/:code` `/no-access` `/get-started` `/onboarding` | auth/onboarding | 1 |
| `/profile` `/settings` `/services` `/team` `/help` | profile/settings/team | 1 |
| `/wines` `/studio*` | WineLibrary / Studio | 2 |
| `/inventory` `/inventory-legacy` | InventoryCommandPage / Inventory | 3 |
| `/receiving/:orderId/door` | DoorReceipt | 5 (receiving = procurement loop; also_touches: 3) |
| `/orders` | Orders | 5 |
| `/providers` `/promotions` | Providers / Promotions | 5 / 6 |
| `/communications` | Communications | 6 |
| `/calendar` `/calendar-classic` | CalendarModular / Calendar | 7 |
| `/` `/reports` `/documents-reports` `/recommendations/catalog` | Dashboard / Reports / Documents / InsightCatalog | 8 |
| `/notifications` | Notifications | 9 |
| `/recommendations` `/sommelier` `/wine-agent*` | Recommendations / SommelierAI | 10 |
| `/admin` `/admin/health` `/dev-sandbox` | Admin* / DevSandbox | 11 |

Note: `RecurringOrders.tsx` exists with a Vitest regression test but is **not currently routed** in `App.tsx` — inventory as orphan UI under group 5. [VERIFIED: App.tsx + RecurringOrders.deps.test.tsx]

### C. Orchestrator agents → group

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

### D. Database domains (migration-derived buckets) → group

Map **domains**, not every table row-by-row in the registry body — but the registry must list each domain and assert coverage. Recommended domain buckets:

| DB domain | Example tables | Group |
|-----------|----------------|-------|
| Identity / tenancy | `users`, `user_roles`, `user_restaurant_access`, `organizations`, `organization_*`, `invite_*`, `email_verifications`, `user_oauth_accounts`, `onboarding_*` | 1 |
| Catalog / wine / studio | `master_wine_library`, `menu_items`, `restaurant_menus`, `field_review_queue`, `research_runs`, `producers`, `grape_varieties`, … | 2 |
| Inventory | `restaurant_inventory`, `inventory_*`, `storage_locations`, `pour_events`, `glass_pour_tracking`, `shrinkage_alerts` | 3 |
| POS / sales | `sales_events`, `pos_webhook_logs`, `toast_item_mappings`, `sku_mappings`, `pos_item_mappings` | 4 |
| Procurement / vendors | `providers`, `procurement_*`, `vendor_catalogue`, `rfq_requests`, `recurring_orders`, `invoice_scans`, `contacts` | 5 |
| Communications | `order_interactions`, `procurement_conversations`, `email_prospects`, `conversation_attachments`, `sender_reputation`, `restaurant_inbound_addresses`, `provider_promotions` | 6 |
| Calendar | `calendar_*`, `events`, `provider_important_dates`, `custom_reminders` | 7 |
| Analytics / reports | `generated_reports`, `scheduled_reports`, `analytics_cache`, `budgets`, `export_history`, `manager_report_profiles` | 8 |
| Notifications | `notifications`, `notification_*`, `push_subscriptions`, `one_tap_actions`, `inventory_alert_state` | 9 |
| AI assistants | `sommelier_conversations`, recommendation action tables | 10 |
| Platform | `idempotency_keys`, `outbox`, `saga_state`, `dead_letter_queue`, `decision_log`, `event_store`, `system_audit_log`, `api_spend` | 11 |

~130 tables created across migrations. [VERIFIED: grep CREATE TABLE + sort -u]

## Existing Test Corpus Snapshot (TFND-03 input)

| Bucket | Count | CI membership | Notes |
|--------|-------|---------------|-------|
| api-gateway `*.spec.ts` | 41 | `test-typescript` via `pnpm test` → Jest | Many modules still at 0 specs |
| web `src/**/*.test.*` | 30 | `test-typescript` via Vitest | UI-heavy; reports/comms/orders |
| web `e2e/*.spec.ts` | 4 | `test-e2e` (local) + Wave F uses `prod-smoke` via e2e-prod | `smoke`, `navigation`, `studio-flow`, `prod-smoke` |
| orchestrator `tests/test_*.py` + e2e helpers | ~61 | `test-python` | Includes hardening, golden path, studio, chaos |
| Phase 25 `wave_*.py` | 6 | `e2e-prod` only (not local push) | A–E + G; F is Playwright |
| packages/* tests | 0 | n/a | No package-level unit tests found |
| mobile tests | stub | exits 0 | Deferred |

**Phase 25 harness locations (extend, don't fork):**
- `services/agent-orchestrator/scripts/setup_e2e_anchor.py`
- `services/agent-orchestrator/tests/e2e/conftest_prod.py`
- `services/agent-orchestrator/tests/e2e/wave_{a,b,c,d,e,g}_*.py`
- `services/agent-orchestrator/scripts/cascading_report.py`
- `apps/web/playwright.prod.config.ts`, `apps/web/e2e/prod-smoke.spec.ts`
- `.github/workflows/e2e-prod.yml`

## CI Gap Analysis (TFND-05)

| Requirement | Current state | Gap for Phase 36 |
|-------------|---------------|------------------|
| Unit + integration on push | `ci.yml` runs `pnpm test` (Jest+Vitest) + `pytest tests/` | **Mostly satisfied.** Clarify in comments/job names that these are the unit+integration suites. pytest markers exist but CI does not filter `-m unit/integration`. |
| E2E nightly | `e2e-prod.yml` `cron: '0 2 * * *'` | **Satisfied.** Do not duplicate. |
| Extend Phase 25 patterns | Workflow + conftest exist | Document reference from `.planning/testing/README.md`; optional header comment for Phase 42 weekly evals |
| Local Playwright on push | `ci.yml` `test-e2e` job | Keep; inventory separately from cloud nightly |
| Green CI | Currently failing Black on `studio_routes.py` | Out of scope unless blocking docs; note in scorecard/README |

`deploy.yml` triggers `e2e-prod.yml` post-audit — leave untouched (not TFND scope beyond awareness).

## Proposed `.planning/testing/` Artifact Shapes

### `FUNCTIONALITY-REGISTRY.md`
1. Purpose + how to ask “how tested is X?”
2. 11 group definitions (locked seed text)
3. Mapping rules (Pattern 1)
4. Tables: Nest modules / Web routes / Agents / DB domains
5. Link to inventory + scorecard + rubric

### `RUBRIC.md` (discretion: standalone)
1. T0–T4 definitions (verbatim from success criteria)
2. Agent Level mirror table
3. Evidence standards per tier (what counts)
4. How to promote a group’s score (who updates scorecard)

### `EXISTING-TEST-INVENTORY.md`
1. Methodology (how `runs?`/`passes?` assigned)
2. Summary counts by group + runner
3. Full table of every test file
4. Known anomalies (duplicate golden path file, unrouted RecurringOrders, zero-spec modules)

### `TESTING-SCORECARD.md`
1. One row per group: score, evidence links, gaps, next phase
2. Baseline date + “mostly T0/T1 expected”
3. Legend linking to `RUBRIC.md`

### `SYNTHETIC-TENANT.md`
1. Coexistence of `e2e-test-restaurant` (Phase 25) and `sim-*` (campaign)
2. ID prefixes, RLS membership requirements, seed idempotency
3. Teardown contract (registry + tag sweep + Sentry orphans)
4. Explicit “implemented in Phase 37; convention locked here”

### `README.md`
Index + update protocol for later phases.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Agent Level ↔ T-maturity mirror (esp. T3≈Level 3–4) is the intended analogy | Rubric | Rubric language may need user tweak — definitions of T0–T4 themselves are locked |
| A2 | Receiving door flow primary group = Procurement (5) not Inventory (3) | Surface map | Phase 39/40 ownership of suites shifts |
| A3 | `contacts` primary = Procurement (5) | Surface map | Comms inventory attribution changes |
| A4 | Phase 36 should not fix Black/CI debt | Pitfalls / CI | If planner requires green CI as success criterion, scope expands |

**Empty of factual stack assumptions:** runner versions and file counts were verified in-repo.

## Open Questions

1. **Should Phase 36 touch `ci.yml` at all if jobs already run tests?**
   - What we know: TFND-05 wording requires unit+integration on push + nightly E2E.
   - What's unclear: whether documentation-only + confirming nightly is enough vs mandatory YAML edits.
   - Recommendation: Minimal YAML comment/job-name clarity + README proof links; avoid behavioral CI changes that risk more red X.

2. **How to score groups that have hardening tests for agents but zero Nest/page tests?**
   - What we know: Inventory will show uneven coverage (e.g. inventory agents well-tested; Nest `inventory-ledger` 0 specs).
   - Recommendation: Score the **group** holistically with evidence list; T1 if any automated happy-path exists in any tier; do not average blindly.

3. **Expand `E2E_TABLES` teardown list in Phase 36?**
   - What we know: Convention doc should list the gap; expanding code is closer to Phase 37.
   - Recommendation: Document required teardown registry in `SYNTHETIC-TENANT.md`; code expansion deferred to 37 unless trivial comment-only.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Inventory / CI docs | ✓ | v22.22.2 local (CI uses 20.x) | CI version is source of truth for plans |
| pnpm | TS tests | ✓ | 9.15.9 | — |
| Python | pytest inventory | ✓ | 3.11.0 | — |
| pytest | Orchestrator tests | ✓ | on PATH | — |
| GitHub Actions / `gh` | CI gap verification | ✓ | gh available | — |
| Supabase cloud credentials | Live pass verification | ✗ in this research session | — | Mark `passes?=unknown`; do not claim green |
| Railway / Vercel live | Live E2E | ✗ this session | — | Rely on workflow existence, not run results |

**Missing dependencies with no fallback:** None for Phase 36 doc/CI-skeleton work.

**Missing dependencies with fallback:** Live credentialed runs for `passes?` — default to `unknown`.

## Validation Architecture

> `workflow.nyquist_validation` is `true` in `.planning/config.json`. [VERIFIED: config.json]

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest 29.7 (api-gateway) + Vitest 2.1 (web) + pytest 7.4.4 (orchestrator) + Playwright 1.58 |
| Config file | `apps/api-gateway/package.json#jest`, `apps/web/vitest.config.ts`, `services/agent-orchestrator/pytest.ini`, `apps/web/playwright*.config.ts` |
| Quick run command | `pnpm --filter @wineops/api-gateway test -- --listTests` + `cd services/agent-orchestrator && pytest --collect-only -q` (inventory verification &lt; 30s) |
| Full suite command | `pnpm test` && `cd services/agent-orchestrator && pytest tests/ -q` (local; excludes live prod waves) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TFND-01 | Registry maps all surfaces → exactly one group | doc assertion / scriptable check | `rg -c '^\| ' .planning/testing/FUNCTIONALITY-REGISTRY.md` + manual completeness vs module list | ❌ Wave 0 — create registry |
| TFND-02 | Rubric defines T0–T4 | doc assertion | `rg 'T0|T1|T2|T3|T4' .planning/testing/RUBRIC.md` | ❌ Wave 0 |
| TFND-03 | Every test file catalogued | inventory completeness | Diff `find` outputs vs inventory paths | ❌ Wave 0 |
| TFND-04 | Scorecard baseline per group | doc assertion | `rg -c '^\| [0-9]+' .planning/testing/TESTING-SCORECARD.md` expect 11 | ❌ Wave 0 |
| TFND-05 | Push unit/integration + nightly E2E | workflow assertion | `rg 'cron:|pnpm run test|pytest' .github/workflows/{ci,e2e-prod}.yml` | ✅ workflows exist; may need comments |
| TFND-06 | `sim-*` convention documented | doc assertion | `rg 'sim-\*' .planning/testing/SYNTHETIC-TENANT.md` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** Doc grep checks above + `pytest --collect-only -q` / Jest `--listTests` when inventory changes
- **Per wave merge:** Confirm all six TFND files exist and cross-link
- **Phase gate:** Full TFND-01..06 acceptance greps green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `.planning/testing/FUNCTIONALITY-REGISTRY.md` — TFND-01
- [ ] `.planning/testing/RUBRIC.md` — TFND-02
- [ ] `.planning/testing/EXISTING-TEST-INVENTORY.md` — TFND-03
- [ ] `.planning/testing/TESTING-SCORECARD.md` — TFND-04
- [ ] `.planning/testing/SYNTHETIC-TENANT.md` — TFND-06
- [ ] `.planning/testing/README.md` — index
- [ ] Optional: small `scripts/testing/check-inventory-coverage.sh` comparing `find` paths to inventory (nice-to-have, not required if greps suffice)
- [ ] Optional CI comment annotations for TFND-05 clarity

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (tenant JWT convention) | Supabase Auth REST password grant for service accounts; never log JWT [VERIFIED: conftest_prod.py] |
| V3 Session Management | yes | Session-scoped JWT; &lt;1h suite budget |
| V4 Access Control | yes | RLS via `user_restaurant_access`; service-role only for seed/teardown |
| V5 Input Validation | yes (docs for ID prefixes) | Enforce `sim-*` / `e2e-*` prefix conventions in convention doc |
| V6 Cryptography | no | No new crypto in Phase 36 |

### Known Threat Patterns for testing tenants

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Synthetic tenant data leak into real restaurants | Information Disclosure | Distinct `sim-*` IDs; never reuse production restaurant UUIDs |
| Incomplete teardown orphans | Tampering / Elevation | Tag sweep + Sentry `sim-orphan` / `e2e-orphan`; never raise |
| Service-role key in client | Information Disclosure | Service role only in CI secrets / server scripts — never web |
| RLS bypass assumptions | Elevation of Privilege | Document that JWT paths must include membership rows; service-role tests ≠ user-path proof |
| CI secret exfiltration via test logs | Information Disclosure | Phase 25 rule: never write JWT to disk/JUnit/logs |

## Sources

### Primary (HIGH confidence)
- `.planning/phases/36-testing-foundation-functionality-registry/36-CONTEXT.md` — locked decisions
- `.planning/REQUIREMENTS.md` — TFND-01..06
- `.planning/ROADMAP.md` — Phase 36 success criteria
- `.github/workflows/ci.yml`, `e2e-prod.yml`, `deploy.yml` — CI behavior
- `services/agent-orchestrator/tests/e2e/conftest_prod.py`, `scripts/setup_e2e_anchor.py` — tenant patterns
- Codebase inventory (find/grep) 2026-07-27 — test counts, modules, agents, routes, migrations
- `services/agent-orchestrator/pytest.ini` — markers
- `.planning/config.json` — nyquist_validation true

### Secondary (MEDIUM confidence)
- `.planning/phases/25-production-e2e-test-suite/25-RESEARCH.md` + `25-01-PLAN.md` + `25-07-PLAN.md` — prior E2E design intent
- `.planning/PROJECT.md` — agent Level system language for rubric mirror
- `gh run view` failure log — Black CI debt confirmation

### Tertiary (LOW confidence)
- Exact production pass/fail status of Phase 25 nightly waves — not re-run in this session (`passes?=unknown`)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions and runners verified in package manifests
- Architecture: HIGH — locked CONTEXT + existing Phase 25 harness mapped
- Pitfalls: HIGH — collisions, RLS, stale tests, CI red observed in-repo
- Scorecard baseline numbers: MEDIUM — until inventory `passes?` filled honestly during execution

**Research date:** 2026-07-27
**Valid until:** 2026-08-27 (30 days; CI/tooling pins stable; re-verify if Nest module tree or workflows change materially)
