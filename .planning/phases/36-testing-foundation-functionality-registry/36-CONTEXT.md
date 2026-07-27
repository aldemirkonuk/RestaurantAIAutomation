# Phase 36: Testing Foundation & Functionality Registry - Context

**Gathered:** 2026-07-27
**Status:** Ready for planning
**Source:** ROADMAP Testing Campaign express path (3-round user Q&A locked 2026-07-27) + Phase 36 success criteria

<domain>
## Phase Boundary

Create the shared skeleton every later Testing Campaign phase (37–43) writes into:

1. What the functionality groups are (canonical registry)
2. How coverage is scored (T0–T4 rubric)
3. What tests already exist (inventory — keep as-is, build around)
4. Where results live (TESTING-SCORECARD.md)
5. CI skeleton (unit/integration on push; E2E nightly patterns from Phase 25)
6. Synthetic tenant isolation convention (`sim-*`)

After this phase, **"how tested is X?"** has a single canonical answer.

**Out of scope for Phase 36:**
- Building the synthetic restaurant generator (Phase 37)
- SimPOS / day simulator / control panel (Phase 38)
- Writing breadth-pass suites for groups (Phases 39–40)
- Analytics truth assertions (Phase 41)
- AI eval golden sets (Phase 42)
- Playwright journeys / user manual pathway execution (Phase 43)
- Mobile app testing (deferred campaign-wide)
- Reworking or deleting existing tests

</domain>

<decisions>
## Implementation Decisions

### Campaign posture (locked)
- D-01: Testing Campaign is the foundation for Waves 2–6 — pause agent-wave hardening until Phases 36–43 complete
- D-02: Scope = entire program (web, api-gateway, agent-orchestrator, database); mobile deferred
- D-03: Breadth-first — every group reaches scored bar, then deepen
- D-04: Pass bar = T0–T4 maturity score per functionality group (mirrors agent Level system)
- D-05: Existing tests kept and built around — inventory only in this phase, do not rework
- D-06: Test types in campaign = unit + integration + E2E + structured manual checklists
- D-07: Environment = cloud stack (Vercel + Railway + Supabase Cloud); CI = GitHub Actions
- D-08: Execution = agent-led; user does manual pathway passes with prepared checklists

### Functionality registry (locked seed — finalize mapping in this phase)
- D-09: Exactly **11** broad functionality groups crossing app boundaries:

| # | Group | Seed scope |
|---|-------|------------|
| 1 | Identity & Access | auth, registration, verification, invites, memberships/roles, orgs/chains/locations, profile, settings |
| 2 | Catalog & Extraction | wine library, submissions, menu import (scan/CSV/manual), extraction pipeline, enrichment, ontology, studio |
| 3 | Inventory Operations | stock, ledger, storage locations, counts/corrections, ghost inventory, shrinkage |
| 4 | POS & Sales Ingestion | pos-hub adapters, webhooks, checks, wine detection, sale→stock pipeline |
| 5 | Procurement & Vendors | providers, vendor catalogue, order lifecycle, RFQ, recurring orders, invoice matching |
| 6 | Communications & Email Intelligence | Gmail, triage, promos, provider conversations, drafts, digests, prospects |
| 7 | Calendar & Scheduling | events, recurrence, iCal, reminders, event-driven procurement signals |
| 8 | Analytics, Reports & Insights | dashboard KPIs, reports, insight catalog, analytic answers, exports |
| 9 | Notifications & Alerts | notification agent, SMS/email/push, websocket, one-tap actions, rate limits |
| 10 | AI Assistants & Recommendations | sommelier, recommendations, Ask AI palette |
| 11 | Platform & Agent Infrastructure | BaseAgent guarantees, sagas, DLQ, idempotency, health, observability, admin |

- D-10: Every api-gateway module, web page/route, orchestrator agent, and database domain maps to **exactly one** group
- D-11: Registry lives at `.planning/testing/FUNCTIONALITY-REGISTRY.md`

### Scoring rubric (locked)
- D-12: T0 = untested
- D-13: T1 = smoke (happy path runs)
- D-14: T2 = contract (happy + key errors + assertions on outputs)
- D-15: T3 = resilient (idempotency / concurrency / failure modes)
- D-16: T4 = ground-truth verified (simulator oracle or golden dataset)
- D-17: Scorecard lives at `.planning/testing/TESTING-SCORECARD.md` with baseline score + evidence links per group

### Synthetic tenant convention (locked)
- D-18: Prefix `sim-*` for synthetic restaurant_id (extends Phase 25 `e2e-test-restaurant` pattern)
- D-19: RLS-safe seeding required
- D-20: Idempotent teardown required
- D-21: Document the convention in `.planning/testing/` (name at Claude's discretion — e.g. `SYNTHETIC-TENANT.md` or section inside registry)

### CI skeleton (locked)
- D-22: Unit + integration suites run on push
- D-23: Nightly E2E workflow scheduled — reuse Phase 25 `.github/workflows/e2e-prod.yml` patterns
- D-24: Do not invent a second production E2E paradigm; extend/wire existing Phase 25 harness
- D-25: Weekly AI evals are Phase 42 — Phase 36 only needs the skeleton hooks / placeholders if any; do not implement eval runners here

### Downstream campaign decisions (context only — do not implement in Phase 36)
- D-26: SimPOS via pos-hub generic abstraction (not Toast-only mock) — Phase 38
- D-27: Accelerated controllable simulated time + web control panel — Phase 38
- D-28: Analytics/insights exactness is #1 eval priority — Phase 41
- D-29: AI eval order: analytics answers → wine extraction → agent decisions → email intel — Phase 42
- D-30: Manual pathways: web all pages, scanner, admin; mobile last/deferred — Phase 43

### Claude's Discretion
- Exact inventory file format (table columns beyond group / path / runs? / passes?)
- Whether T0–T4 rubric is a standalone `.planning/testing/RUBRIC.md` or a section of the registry/scorecard
- How deeply to probe "runs?/passes?" for existing tests in CI vs local-only (document honestly; do not claim green without evidence)
- Whether CI skeleton is a new workflow file, edits to `ci.yml` + schedule on `e2e-prod.yml`, or both
- Mapping edge cases (shared utilities, cross-cutting modules) — pick a primary group + note secondary references
- Directory layout under `.planning/testing/` beyond the two mandated files

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase / campaign
- `.planning/ROADMAP.md` — Testing Campaign section (Phases 36–43) + Phase 36 success criteria
- `.planning/REQUIREMENTS.md` — TFND-01..06
- `.planning/STATE.md` — current focus = Testing Campaign
- `.planning/PROJECT.md` — product / Mudavym context

### Prior testing patterns (reuse, don't reinvent)
- `.planning/phases/25-production-e2e-test-suite/25-RESEARCH.md` — production E2E research
- `.planning/phases/25-production-e2e-test-suite/25-01-PLAN.md` — TEST-PROD requirements + setup scripts
- `.planning/phases/25-production-e2e-test-suite/25-02-PLAN.md` — conftest_prod / JWT / teardown / Sentry
- `.planning/phases/25-production-e2e-test-suite/25-07-PLAN.md` — GitHub Actions e2e-prod.yml
- `.github/workflows/e2e-prod.yml` — live nightly/prod E2E workflow
- `.github/workflows/ci.yml` — existing push CI
- `.github/workflows/deploy.yml` — deploy checks

### Surfaces to map into the registry
- `apps/api-gateway/src/` — NestJS modules
- `apps/web/src/pages/` (+ `apps/web/src/app/` if present) — web surfaces
- `services/agent-orchestrator/agents/` — agents
- `packages/database/` / `supabase/migrations/` — DB domains
- Existing `*.spec.ts`, `*.test.*`, `test_*.py`, Playwright configs — inventory inputs

</canonical_refs>

<specifics>
## Specific Ideas

- Registry should make later phases trivial: Phase 39/40 pick groups 1–4 / 5–7+9 and know exactly which files/tests belong there
- Scorecard baseline will mostly be T0/T1 until breadth passes — that is expected and useful
- Phase 25 already defined `e2e-test-restaurant` teardown patterns — `sim-*` should extend, not fork, that isolation model
- User chose "more info is better" for CONTEXT — prefer documenting edge-case mapping rules in the registry over leaving them implicit

</specifics>

<deferred>
## Deferred Ideas

- Synthetic restaurant generator, ground-truth ledger — Phase 37
- SimPOS provider, day simulator, control panel, Railway deploy — Phase 38
- Breadth Pass A/B suites + manual checklists — Phases 39–40
- Analytics truth suite — Phase 41
- AI eval suites + weekly cost-capped runs — Phase 42
- Playwright journeys, scanner/admin verification, user manual passes, final scorecard — Phase 43
- Mobile app testing
- Reworking legacy/stale tests (inventory only; fix later if scorecard flags them)

</deferred>

---

*Phase: 36-testing-foundation-functionality-registry*
*Context gathered: 2026-07-27 via ROADMAP Testing Campaign express path*
