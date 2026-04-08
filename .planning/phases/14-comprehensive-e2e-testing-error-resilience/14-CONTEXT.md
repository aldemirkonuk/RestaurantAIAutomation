# Phase 14 Context: Comprehensive E2E Testing & Error Resilience

## Origin

User reviewed the existing E2E plan at `.cursor/plans/full_e2e_scenario_testing_3b24cc47.plan.md` — a 12-level, 300-scenario operations-focused test framework — and identified critical gaps:

1. **Missing wine scanning/onboarding pipeline** — Phases 1–13 built a complete extraction → enrichment → studio → review pipeline with 6 registered API routers and 20+ endpoints. The existing plan ignores all of this.
2. **Missing tech stack** — no mention of pytest (FastAPI backend), Playwright (frontend), or vitest (React).
3. **Missing DB seed/teardown strategy** — no test isolation approach.
4. **No phasing** — 300 scenarios at once is impractical.
5. **Operations pipeline is aspirational** — the 12-level plan (stock → notifications → orders → email → delivery) references agents that exist as Python classes but have NO HTTP endpoints registered in `main.py`. Cannot E2E-test what isn't wired.

## Codebase Reality Assessment

### Actually Implemented (has HTTP routes in main.py)

| Router | Prefix | Endpoints | Phase |
|--------|--------|-----------|-------|
| onboarding_router | /api/v1/onboarding | POST /extract | 1, 7 |
| quality_router | /api/v1/quality | GET /review-queue, PATCH /review-queue/{id}, GET /calibration | 5, 7 |
| research_router | /api/v1/research | GET /metrics, GET /runs, GET /conflicts, GET /challenges, POST /trigger | 12, 12.1 |
| preview_router | /api/v1/preview | POST /detect | 3 |
| analytics_router | /api/v1/analytics | GET /wine/{id}/scores, GET /trends, GET /wine/{id}/timeline | 10, 11 |
| studio_router | /api/v1/studio | 13 endpoints (sessions, overrides, queue, invite, metrics, roles, contributors) | 13 |
| health | / | GET /health | — |

**Total: ~25 HTTP endpoints across 6 routers + health**

### NOT Implemented as HTTP routes (agents only — no E2E coverage possible)

NotificationAgent, ProcurementAgent, EmailParsingAgent, ProviderConversationAgent, BufferManagerAgent, CalendarAgent, RecurringOrderAgent, POSIntegrationAgent, InventoryEngineAgent, RFQAgent, SommelierAgent, etc.

These are Python agent classes with no FastAPI router registration. The existing E2E plan's Levels 1–12 (stock, notifications, orders, email, delivery, recurring) would test these — but they aren't accessible via HTTP API.

### Frontend Routes (from App.tsx)

| Route | Component | Auth Required |
|-------|-----------|---------------|
| /login | Login | No |
| /register | Register | No |
| /studio | Studio | studioRole: dev/cc/admin |
| /studio/queue | StudioApprovalQueue | studioRole: dev/admin |
| /studio/certify | StudioCertify | studioRole: dev/admin |
| / | Dashboard | Yes |
| /inventory | Inventory | Yes |
| /orders | Orders | Yes |
| /wines | WineLibrary | Yes |
| /reports | Reports | Yes |
| /providers | Providers | Yes |
| /calendar | Calendar | Yes |
| /communications | Communications | Yes |
| /notifications | Notifications | Yes |
| /settings | Settings | Yes |
| /sommelier | SommelierAI | Yes |
| /admin | AdminPanel | Yes |

### Existing Test Patterns

- **33 pytest test files** in `services/agent-orchestrator/tests/`
- **conftest.py** with: `test_client` (FastAPI TestClient with httpx shim), `mock_supabase_client`, `mock_redis_client`, `mock_rabbitmq_connection`, sample data fixtures
- **test_studio_e2e.py** — mock-based E2E pattern: patches `_get_supabase`, uses JWT auth headers
- **Playwright**: minimal `smoke.spec.ts` (login page render check), `playwright.config.ts` with Vite dev server

### Known Architectural Gap

**Studio → Library promotion path is incomplete.** Wine records approved in the Studio override flow (`_apply_override_to_submission`) update `field_confidence` on `master_wine_library_submissions` but do NOT trigger promotion to `master_wine_library`. The `quality_routes.py` PATCH endpoint handles promotion from the field review queue, but the Studio override path bypasses this. A wine can be fully approved by a review_admin in Studio and still never appear in the Wine Library.

## Decisions

### D-01: Test tech stack
pytest for all backend E2E tests, Playwright for frontend E2E tests. No vitest E2E (vitest for unit tests only — already in project).

### D-02: Mock vs. live database
All backend E2E tests use Supabase mocks (consistent with existing test_studio_e2e.py pattern). No live database dependency — tests must run in CI without Supabase credentials.

### D-03: Operations pipeline scope
Do NOT test unregistered agent classes as E2E. Document which agents lack HTTP endpoints in the gap report. Focus E2E coverage on the 25+ HTTP endpoints that actually exist.

### D-04: JSON error reporting
Every test failure logged to `test-results/e2e-report.json` with: test name, step, error message, stack trace, timestamp, duration.

### D-05: Studio→Library promotion fix
Add promotion trigger to Studio override path when all fields are approved and not auto_blocked. Mirror the logic in `quality_routes.py` PATCH.

### D-06: Playwright authentication
Use Supabase auth via API to get JWT, store in `storageState` for Playwright tests. Mock backend responses where live backend unavailable.

### D-07: Coverage report
Generate `test-results/coverage-map.md` mapping every HTTP endpoint to its E2E test(s). Identify any untested endpoints.

## Deferred Ideas

- Live Supabase integration tests (requires test DB provisioning)
- Operations agent E2E tests (requires wiring agents to HTTP endpoints — future phases)
- Load/stress testing
- CI pipeline integration (can be added after tests are working locally)
