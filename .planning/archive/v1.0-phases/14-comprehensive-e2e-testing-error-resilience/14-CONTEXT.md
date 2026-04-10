# Phase 14: Comprehensive E2E Testing & Error Resilience — Context

## Background

An existing E2E plan exists at `.cursor/plans/full_e2e_scenario_testing_3b24cc47.plan.md` covering 12 levels of operations testing. Phase 14 improves and replaces it with a framework that covers BOTH:
1. Wine scanning/onboarding pipeline (Phases 1-13 work)
2. Operations pipeline (stock → notifications → orders → email → delivery)

## Critical Finding: Real vs. Aspirational

**Has HTTP routes (can be E2E tested NOW):**
- `onboarding_routes.py`: POST /extract, POST /extract/url
- `studio_routes.py`: 13 endpoints (sessions, overrides, queue, invite, metrics, contributors, me/roles)
- `quality_routes.py`: GET /review-queue, PATCH /review-queue/{id}, GET /wine/{id}/scores
- `analytics_routes.py`: GET /analytics/dashboard, GET /analytics/trends
- `research_routes.py`: POST /research/enrich, GET /research/metrics
- Frontend: /studio, /studio/queue, /studio/certify, /wines, /inventory, /orders

**Aspirational (NO HTTP routes — agent classes only):**
- Stock state changes (inventory_engine.py)
- Notification pipeline (notification_agent.py)
- Order state machine (procurement_agent.py)
- Email send/receive (email_parsing_agent.py, provider_conversation_agent.py)
- Delivery reconciliation
- Recurring orders

Decision: Phase 14 tests what EXISTS. Operations pipeline agents get tested when they get HTTP routes in future phases.

## Architecture Gap Found

Studio→Library promotion: `_apply_override_to_submission()` updates field_confidence on submissions but never promotes to `master_wine_library`. Plan 04 fixes this.

## Decisions

- D-01: Tech stack: pytest (backend), Playwright (frontend), vitest (unit)
- D-02: Mock-based tests (no live Supabase) for CI reliability
- D-03: Operations pipeline Levels 1-12 are out of scope — documented as aspirational
- D-04: JSON error reporting via test-results/e2e-report.json
- D-05: Studio→Library promotion fix is part of this phase
- D-06: Playwright auth via localStorage token injection (matches current app pattern)
