---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Phases
status: active
last_updated: "2026-05-10T21:00:00.000Z"
progress:
  total_phases: 11
  completed_phases: 7
  total_plans: 63
  completed_plans: 46
  percent: 78
---

# Project State: WineOps Backend Kitchen Architecture

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-09)

**Core value:** The system is so reliable that an average agent performs flawlessly because the infrastructure carries it — like a Michelin-star kitchen where systems, not genius, produce consistent excellence.
**Current focus:** Phase 27 — Vendor Search & Discovery (gap closure needed before UAT approval)

---

## Current Position

Phase: 27 (vendor-search-discovery) — EXECUTED, GAP CLOSURE PENDING
**Last completed:** Phase 26 — Multi-tenant onboarding, restaurant hierarchy, branch switcher, chain/location management all live. All 8 UAT tests passed 2026-05-10.
**Phases complete (v2.0):** 18, 19, 20, 21, 22, 25, 26
**Phases deferred:** 23 (Gmail Integration), 24 (Provider Comms Pipeline) — both `[ ]` in ROADMAP, intentionally deferred, will revisit later
- Phase 23: ~60% done (plans 01, 02, 04 complete); blocked on Railway OAuth2 credentials gate (plan 23-03). Plans 23-03 and 23-06 remain.
- Phase 24: ~20% done (test stubs + model_clients.py only); plans 24-01, 24-04, 24-05 not executed. Blocked on Phase 23 being live.

### Phase 27 — EXECUTED (2026-05-10), gap closure required before complete

**Plans done:** 27-01 (DB schema + seed), 27-02 (NestJS API), 27-03 (Frontend search modal), 27-04 (Branch transfer + order guard)
**Code review:** 4 criticals fixed (telemetry leak, SQL injection, order guard inversion, localStorage JWT), 4 warnings fixed. REVIEW.md committed.
**Verification:** 36/36 must-haves passed. Status: human_needed.
**Blocking gap (GAP-01):** `ProvidersService.listProviders()` has no `restaurant_id` filter — all tenants see each other's providers. Must fix before UAT approval.

**Next action:**
1. `/gsd-plan-phase 27 --gaps` — plan the provider scoping fix
2. `/gsd-execute-phase 27 --gaps-only` — execute the fix
3. Run human UAT (5 tests in 27-HUMAN-UAT.md) — then mark phase complete

### Phase 22 — COMPLETE (Deployed to Production 2026-04-13)

| Artifact | Status |
|----------|--------|
| 22-01: Sentry + CORS + requirements.prod.txt | ✅ Complete |
| 22-02: POS abstraction (POSProvider + ToastAdapter) | ✅ Complete |
| 22-03: Health routes + Railway Dockerfile | ✅ Complete |
| 22-04: NestJS health proxy controller | ✅ Complete |
| 22-05: AdminHealth.tsx + vercel.json + deploy | ✅ Complete |
| Railway deploy: agent-orchestrator (9/9 agents Active) | ✅ Live |
| Railway deploy: api-gateway (NestJS, JWT+Redis+RabbitMQ) | ✅ Live |
| Vercel deploy: frontend (admin health UI working) | ✅ Live |
| CloudAMQP: RabbitMQ connected | ✅ Live |
| Upstash: Redis TLS connected | ✅ Live |

**Remaining Phase 22 ops checkpoints (non-blocking, user-driven):**

- [ ] Supabase db push (v1.0 + v2.0 migrations on cloud project)
- [ ] Toast webhook URL pointed at production api-gateway endpoint
- [ ] JWT_REFRESH_SECRET set on api-gateway Railway service
- [ ] CORS_ORIGINS on orchestrator updated to include final Vercel URL(s)

### Phase 22 Plans Summary

| Plan | Wave | Depends On | Focus | Key Files |
|------|------|------------|-------|-----------|
| 22-01 | 1 | — | Python infra | requirements.txt (sentry upgrade), requirements.prod.txt, settings.py, .env.example |
| 22-02 | 1 | — | POS abstraction | core/pos_provider.py, adapters/toast_adapter.py |
| 22-03 | 2 | 22-01, 22-02 | FastAPI wiring | main.py (Sentry+CORS), api/health_routes.py, api/pos_routes.py (generic) |
| 22-04 | 2 | 22-01 | Docker/Railway | services/agent-orchestrator/Dockerfile, .dockerignore |
| 22-05 | 3 | 22-03 | NestJS+Frontend | health-proxy.controller.ts, AdminHealth.tsx, vercel.json |

### Phase 22 Context — COMPLETE (2026-04-13)

**Discussion Summary (4 locked decisions + 5 gray areas explored):**

1. **Auth (3-layer)** — `GET /health` public · API endpoints `X-Admin-Key` · `/admin/health` ProtectedRoute
2. **Sentry init** — Fail at startup in `production` if no DSN · warn + continue in `development`
3. **POS abstraction** — `POST /api/v1/pos/webhook/{provider}` + `POSProvider` protocol + `ToastAdapter`
4. **Railway deploy** — GitHub auto-deploy on push to main · Dockerfile in `services/agent-orchestrator/`
5. **Toast DEP-06** — Production creds → Railway dashboard (never git) · read-only connectivity test

**Audit (6 gaps found and fixed):**

1. **CORS** — No CORSMiddleware existed; added with defense-in-depth + Vercel rewrites eliminate CORS in production
2. **Frontend API key** — ADMIN_API_KEY would be exposed in browser JS; fixed: frontend calls api-gateway (JWT auth), gateway adds X-Admin-Key server-side
3. **Frontend URL clarity** — Undefined how AdminHealth.tsx reaches orchestrator; locked: all calls through `VITE_API_GATEWAY_URL`, api-gateway proxies
4. **env.example missing** — CONTEXT claimed it existed (Phase 21 note was wrong); corrected: create `.env.example` (only `.env` exists today)
5. **vercel.json missing** — No monorepo build config; added: `vercel.json` at repo root with framework preset, build dir, `/api/*` rewrites
6. **admin_routes auth pattern unclear** — "same pattern as other routes" was vague; corrected: auth pattern from `research_routes.py:35` specifically

**Scope changes:**

- Added INFRA-01..04 (CORS, vercel.json, .env.example, api-gateway proxy)
- Added "Network Architecture" decision section (API gateway pattern)
- Scope slightly expanded but all user-intentional (POS abstraction + public /health endpoint)

**22-CONTEXT.md ready for planning** — no false assumptions, no security gaps, clear auth flow from browser to backend, network architecture locked.

### Phase 21 Closure — COMPLETE (2026-04-13)

| Artifact | Status |
|----------|--------|
| 21-SECURITY.md | 14/14 threats closed |
| 21-VALIDATION.md | Nyquist compliant — 10 tests, 0 gaps |
| 21-UAT.md | 6/6 passed, 0 issues (1 fix: pos_routes.py reason/message normalization) |
| 21-VERIFICATION.md | 8/10 verified (2 require live Toast credentials — by design) |

### Phase 21 Plans — COMPLETE

| Plan | What | Key Files | Tests | Commits |
|------|------|-----------|-------|---------|
| 21-01 | Extend Settings with 29 new attributes (7 groups) | `config/settings.py` (+62 lines), `env.example` (+18 vars) | — | 9eb4445, 594c562, 2132c88 |
| 21-02 | FastAPI lifespan hook + `POST /api/v1/pos/webhook/toast` | `main.py` (lifespan, get_orchestrator), `api/pos_routes.py` (83 lines) | — | f1d83b7, 4e4de0b, eb7f7cd |
| 21-03 | 5 golden-path E2E integration tests | `tests/test_golden_path_e2e.py` (450 lines) | 5/5 pass (0.48s) | c3b5eb8, c19bf42 |
| 21-04 | 5 chaos tests + ngrok live-test script | `tests/test_chaos_e2e.py` (351 lines), `scripts/ngrok_live_test.py` (296 lines) | 5/5 pass (7.41s) | 22edd3f, a72c1ab, f5f88b6 |

### Phase 20 Wave 2 Plans — COMPLETE (archived context)

| Plan | Agent | Fix | Result |
|------|-------|-----|--------|
| 20-05 | NotificationAgent | DLQ re-trigger guard (`_dlq_escalated` set) | 16/16 tests pass |
| 20-06 | InventoryEngine | Per-aggregate monotonic `sequence_number` via `_next_sequence()` | 22/22 tests pass |
| 20-07 | ReportingAgent | UTC midnight warning log + `date_source` audit field in `log_decision` | 16/16 tests pass |
| 20-08 | POS + Inventory | Top-level `items` saga fallback; dedup key fallback chain | 42/42 tests pass |

---

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260413-ow5 | Close Phase 22, update STATE/ROADMAP, add Phases 23-25 (Gmail, Comms Agent, Prod Tests) | 2026-04-13 | — | [260413-ow5-close-phase-22-update-state-and-roadmap-](./quick/260413-ow5-close-phase-22-update-state-and-roadmap-/) |

---

## v1.0 Archive

v1.0 session history (Sessions 1-11) archived with milestone completion on 2026-04-08. See git history for full details.

---

### Session 13 — 2026-04-13 (Phase 22: Observability & Deployment — Executed Live)

**Completed this session:**

- Deployed all three services to production and confirmed 9/9 agents healthy
- **API Gateway (Railway)**: Fixed Redis TLS (`redis://` → `rediss://` for Upstash), fixed Redis infinite retry loop in `CacheService`, fixed NestJS `start` script to `node dist/main` (was running `nest start` dev mode), fixed double-prefix on health controller (`api/health` → `health`), wired `ADMIN_API_KEY` + `AGENT_ORCHESTRATOR_URL` + `RABBITMQ_URL` + `JWT_SECRET` env vars
- **Agent Orchestrator (Railway)**: Added `api_gateway_url`, `frontend_url`, `allowed_origins` to `Settings`, resolved all `ModuleNotFoundError` crashes (celery, aiosmtplib, asyncpg, sqlalchemy, kombu, apscheduler, prometheus-client, openai, python-slugify, unidecode, rich, pywebpush, jinja2), fixed `database.py` Redis TLS normalization
- **Frontend (Vercel)**: Fixed Sentry `@sentry/tracing` deprecated import → `Sentry.browserTracingIntegration()`, added `export default` to `Settings.tsx`, fixed `vercel.json` placement (moved to `apps/web/`), fixed SPA fallback rewrite, fixed `VITE_API_GATEWAY_URL` not baked in (triggered cache-busting redeploy), fixed `AdminHealth.tsx` API path `/api/health/agents` → `/api/v1/health/agents`
- **GitHub CI**: Rewrote `.github/workflows/deploy.yml` (removed Fly.io/Slack/Railway CLI steps → frontend build check only), fixed TypeScript build (`vite build` only, `tsc` in separate `build:check` script), fixed `dtrace-provider` native compile issue (added to `pnpm.neverBuiltDependencies`)
- **End state**: Login successful on Vercel, `/admin/health` shows 9/9 Active agents (pos integration, buffer manager, inventory engine, inequality detector, state invariant enforcer, notification, procurement, calendar, reporting)

**Key Railway env vars set this session:**

- api-gateway: `JWT_SECRET`, `REDIS_URL` (rediss://), `RABBITMQ_URL` (amqps://), `ADMIN_API_KEY`, `AGENT_ORCHESTRATOR_URL`, `FRONTEND_URL`, `NODE_ENV=production`
- agent-orchestrator: `ADMIN_API_KEY`, `API_GATEWAY_URL`, `CORS_ORIGINS`

**Files changed this session:**

- `apps/api-gateway/src/common/cache/cache.service.ts` — Redis TLS normalization + retry cap + graceful fallback
- `apps/api-gateway/src/main.ts` — CORS dynamic Vercel origins
- `apps/api-gateway/src/common/orchestrator/health-proxy.controller.ts` — remove double `api/` prefix
- `apps/api-gateway/package.json` — `start: node dist/main`
- `apps/api-gateway/Dockerfile` — WORKDIR to apps/api-gateway before CMD
- `apps/web/src/lib/error-tracking.ts` — Sentry browserTracingIntegration()
- `apps/web/src/pages/Settings.tsx` — export default
- `apps/web/src/pages/AdminHealth.tsx` — /api/v1/health/agents path fix
- `apps/web/vercel.json` — SPA fallback rewrite + moved from root
- `services/agent-orchestrator/config/settings.py` — api_gateway_url, frontend_url, allowed_origins
- `services/agent-orchestrator/core/database.py` — redis:// → rediss:// for Upstash
- `services/agent-orchestrator/requirements.prod.txt` — all missing production deps
- `.github/workflows/deploy.yml` — clean frontend-build-check only
- `package.json` (root) — dtrace-provider neverBuiltDependencies

---

### Session 12 — 2026-04-12 (Phase 21: Golden Path E2E)

**Completed this session:**

- Executed Phase 21 (golden-path-e2e) — all 4 plans across 3 waves, full security audit
- **21-01**: Extended `config/settings.py` from 119 to 181 lines with 29 new orchestrator-required attributes across 7 groups:
  - RabbitMQ connection: `rabbitmq_url`, `rabbitmq_host`, `rabbitmq_port`, `rabbitmq_user`, `rabbitmq_password`, `rabbitmq_vhost`
  - App environment: `environment`, `debug`
  - Toast POS: `toast_api_url`, `toast_client_id`, `toast_client_secret`, `toast_restaurant_guid`, `toast_webhook_secret`, `toast_environment`, `mock_pos`
  - Inventory/buffer config: `buffer_window_minutes`, `evaluation_interval_seconds`, `default_threshold_min`, `notification_threshold_pct`
  - LLM routing: `llm_primary_model`, `llm_temperature`
  - Notification backends: `plivo_auth_id`, `plivo_auth_token`, `plivo_phone_number`, `email_backend`, `from_email`, `sendgrid_api_key`, `mock_notifications`
  - Supabase: `supabase_service_role_key` (alias of existing env var)
  - `env.example` extended with 18 previously undocumented env vars in a Phase 21 section
- **21-02**: Added FastAPI `lifespan` async context manager to `main.py` — calls `start_all_agents()` on boot, wraps RabbitMQ connect in try/except so failure degrades gracefully (HTTP routes still serve). Added `get_orchestrator()` singleton. Created `api/pos_routes.py` (83 lines) with `POST /api/v1/pos/webhook/toast`: captures raw bytes for HMAC passthrough, delegates to `POSIntegrationAgent.process_toast_webhook()`, returns HTTP 401 on signature failure, HTTP 503 when orchestrator not running.
- **21-03**: Created `tests/test_golden_path_e2e.py` (450 lines) with 5 async integration tests using in-process mocks (no real RabbitMQ, no real Supabase):
  - `test_e2e_01_webhook_to_pos_event` — webhook → POS agent publishes pos.event
  - `test_e2e_02_pos_event_to_inventory_decrement` — POS event → InventoryEngine decrements stock
  - `test_e2e_03_stock_threshold_to_notification` — threshold breach → NotificationAgent fires
  - `test_e2e_04_stock_event_to_reporting` — stock change → ReportingAgent generates report
  - `test_e2e_full_golden_path` — full pipeline webhook → all 4 agents, sequential awaits
  - All 5 passed in 0.48s. Key fixes: POS agent uses `exchange=` kwarg; InventoryEngine uses custom async methods; ReportingAgent routes on `message.get("type")`; NotificationAgent internal methods needed AsyncMock patches.
- **21-04**: Created `tests/test_chaos_e2e.py` (351 lines) with 5 chaos tests:
  - `test_chaos_01_agent_killed_mid_saga` — agent killed mid-saga; `_handle_incomplete_webhook(order_guid, payload)` called correctly
  - `test_chaos_02_rabbitmq_disconnect_reconnect` — `connect_robust` patched at `core.message_bus.connect_robust`; reconnection verified
  - `test_chaos_03_supabase_503_circuit_breaker` — `record_failure()` × 3 drives circuit breaker state; agent falls back gracefully
  - `test_chaos_04_malformed_webhook_dlq` — malformed webhook returns `"ignored"` or `"error"` (both accepted)
  - `test_chaos_05_100_concurrent_webhooks` — 100 concurrent asyncio tasks via gather; no resource leak
  - All 5 passed in 7.41s.
  - Created `scripts/ngrok_live_test.py` (296 lines): HMAC signing, step-by-step ngrok setup, `--help` CLI, prints secret availability as "set"/"NOT SET" only (never actual value).
- **Security audit**: 14 threats audited — 7 accepted (design), 7 mitigate verified CLOSED. Wrote `21-SECURITY.md`. Key verifications: no settings secrets in logs (lines 123–126, 147–148); HMAC raw bytes passthrough (pos_routes.py:41,68 → 401 on failure); RabbitMQ degradation (main.py:47–56 try/except); sequential test awaits (test_e2e_full_golden_path: no asyncio.gather).

**Key deviations auto-fixed (no impact on correctness):**

- 21-03: `exchange=` kwarg (not `exchange_name=`); InventoryEngine uses `update_inventory_stock()`/`get_inventory_item()` (not raw supabase chaining); ReportingAgent routes on `message.get("type")` (not `routing_key`)
- 21-04: `CircuitBreaker.call()` doesn't exist → used `record_failure()` × 3; `connect_robust` patched at module import path; `_handle_incomplete_webhook` takes `(order_guid, payload)` not `(payload,)`

**Files changed this session:**

- `services/agent-orchestrator/config/settings.py` — 29 new attributes (+62 lines)
- `env.example` — Phase 21 section (+18 env vars)
- `services/agent-orchestrator/main.py` — lifespan hook, get_orchestrator() singleton, pos_router registration
- `services/agent-orchestrator/api/pos_routes.py` — new: POST /api/v1/pos/webhook/toast (83 lines)
- `services/agent-orchestrator/tests/test_golden_path_e2e.py` — new: 5 E2E integration tests (450 lines)
- `services/agent-orchestrator/tests/test_chaos_e2e.py` — new: 5 chaos tests (351 lines)
- `services/agent-orchestrator/scripts/ngrok_live_test.py` — new: ngrok live-test harness (296 lines)
- `.planning/phases/21-golden-path-e2e/21-01-SUMMARY.md` — new
- `.planning/phases/21-golden-path-e2e/21-02-SUMMARY.md` — new
- `.planning/phases/21-golden-path-e2e/21-03-SUMMARY.md` — new
- `.planning/phases/21-golden-path-e2e/21-04-SUMMARY.md` — new
- `.planning/phases/21-golden-path-e2e/21-VERIFICATION.md` — new (8/10 must-haves verified)
- `.planning/phases/21-golden-path-e2e/21-SECURITY.md` — new (14/14 threats closed)

**Human verification still needed:**

- Run `pytest tests/test_golden_path_e2e.py tests/test_chaos_e2e.py -v` → expect 10 passed
- Live Toast test via `python scripts/ngrok_live_test.py` with friend's restaurant credentials (E2E-v2-05)

---

## Phase 20 UAT Notes (2026-04-11)

**Scope clarification — POSIntegrationAgent (plan 20-02):**
`append_event` is NOT in scope for POSIntegrationAgent. The 20-02 PLAN.md specifies only
`_check_idempotency`, `_mark_processed`, `log_decision`, and saga methods. Wine outcomes are
correctly propagated via `publish()` to `pos.events` exchange — not via event store.
The 20-02-SUMMARY.md had a false `[x] append_event` checkbox; corrected on 2026-04-11.

**5 test failures fixed before UAT (committed 12b7fad):**

- `inventory_engine.py`: spurious `await` on sync supabase chain in `_handle_manual_correction`
- `pos_integration_agent.py`: `metrics.errors_count` → `metrics.record_error()`
- `notification_agent.py`: idempotency exception not fail-open
- `test_pos_integration_hardening.py`: `args[1]` IndexError fixed to `len(args) > 1`

---

## Session History

### Session 1 (v2.0) — 2026-04-09

**Completed this session:**

- Surgical audit of 4 Wave 1 agents + BaseAgent (deep code review, bug lists, maturity levels)
- Discovered BaseAgent is already Level 3 (circuit breaker, retry, backpressure, metrics, health, shutdown, auto-restart)
- Identified 6 gaps to Level 4: idempotency, decision logging, structured JSON logging, distributed tracing, DLQ, saga state
- Defined all v2.0 REQ-IDs: INFRA-01..08, BUG-01..12, HARD-01..04, E2E-v2-01..06, OBS-01..04, DEP-01..06
- Phase sequencing: 18 (infra) → 19 (bug fixes) → 20 (hardening) → 21 (golden path E2E) → 22 (observability + deploy)
- Updated PROJECT.md, STATE.md, REQUIREMENTS.md for v2.0 milestone
- v2.0 milestone setup workflow (Steps 4-11)

**Key findings:**

- BaseAgent Level 3 surprise: no need to build ResilienceAgent from scratch — extend existing
- InventoryEngine: race condition (read-then-write without locking), unused dead code
- POSIntegrationAgent: deprecated hmac.new, keyword-only wine detection, broken signature verification
- NotificationAgent: in-memory rate limits lost on restart, no delivery persistence
- ReportingAgent: 3/4 report types are stubs, all exports are mocks, self.db bug

---

### Session 10 (v1.0) — 2026-04-05

**Completed this session:**

- Executed Phase 06 Plans 01, 02, 03 (Waves 1, 2, 3) — Phase 6 COMPLETE
- Wave 1: Added extract_pdf() to ClaudeVisionExtractor (native Anthropic document content block); added image_menu_detected: bool = False to CrawlResult; added source_type: str = "crawled" param to _persist_crawled_wines()
- Wave 2: Added 4 private methods to WebCrawlerService (_take_viewport_chunks, _is_image_menu, _handle_image_menu, _handle_pdf_vision); wired 3 integration hooks into crawl_restaurant(); added import base64 + get_claude_vision_extractor
- Wave 3: Created test_image_menu.py (7 tests, all IMGX-01–06 covered + extract_pdf document block); added Tredita to e2e_restaurants.json with expect_image_menu=true; extended e2e_crawl_harness.py with image_menu_pass assertion + report column

**Key decisions:**

- extract_pdf() uses native Anthropic document content block (no new deps, single API call per PDF)
- Viewport chunks: 1280×900px, max 10, JPEG 85 quality — cost ceiling ~$0.15/restaurant
- _is_image_menu() differs from _check_image_menu(): uses naturalWidth > 400 + absence of wine patterns
- All Vision-extracted wines flow through existing _wine_is_duplicate() + _persist_crawled_wines() pipeline
- source_type tags: "image_menu" (screenshot path) | "pdf_vision_fallback" (PDF path) | "crawled" (Gemini path, unchanged)

**Files changed:**

- `services/agent-orchestrator/services/claude_vision_extractor.py` — extract_pdf() method added
- `services/agent-orchestrator/services/web_crawler.py` — 4 new methods + 3 integration hooks + imports
- `services/agent-orchestrator/tests/test_image_menu.py` — new file (7 tests)
- `scripts/e2e_restaurants.json` — Tredita entry added
- `scripts/e2e_crawl_harness.py` — image_menu_pass assertion + report column + dry-run note

---

### Session 9 — 2026-04-05

**Completed this session:**

- Executed Phase 05 Plans 02, 03, 04 (Wave 2 + Wave 3) — Phase 5 COMPLETE
- Wired SpendLogger into claude_vision_extractor.py, haiku_enrichment_service.py, vlm_extraction_service.py
- Created jobs/spend_tasks.py: monthly_cap_check_task Celery beat (hourly, idempotent per provider/month, Gmail SMTP alert)
- Patched celery_app.py: added jobs.spend_tasks import + beat schedule entry
- Added _preflight_cap_check() + _send_cap_alert_email() + PER_RESTAURANT_CAP_USD=2.00 to onboarding_routes.py
- Added AUTO_BLOCK_THRESHOLD=0.3 gate on submission insert (auto_blocked=True when completeness < 0.3)
- Created api/quality_routes.py: GET /review-queue + PATCH /review-queue/{id} with field_corrections logging + auto-promotion
- Registered quality_router in main.py
- All 4 plan SUMMARY files written

**Key decisions:**

- All SpendLogger calls wrapped in separate try/except — spend logging can never interrupt extraction
- Gemini token counts via getattr(response, "usage_metadata") — graceful fallback to 0
- Per-restaurant cap check fails open (returns 0.0 on query error) — infra failure never blocks extraction
- master_wine_library promotion failure is fatal (503) — data integrity cannot be silently dropped

**Files changed:**

- `services/agent-orchestrator/services/claude_vision_extractor.py` — SpendLogger import + log call
- `services/agent-orchestrator/services/haiku_enrichment_service.py` — SpendLogger import + log call + cost calc
- `services/agent-orchestrator/services/vlm_extraction_service.py` — SpendLogger import + log call
- `services/agent-orchestrator/jobs/spend_tasks.py` — new: monthly_cap_check_task
- `services/agent-orchestrator/jobs/celery_app.py` — spend_tasks import + beat schedule
- `services/agent-orchestrator/api/onboarding_routes.py` — preflight cap check + auto_blocked gate
- `services/agent-orchestrator/api/quality_routes.py` — new: GET/PATCH review queue
- `services/agent-orchestrator/main.py` — quality_router registration
- `.planning/phases/05-cost-quality-guardrails/05-02-SUMMARY.md` — new
- `.planning/phases/05-cost-quality-guardrails/05-03-SUMMARY.md` — new
- `.planning/phases/05-cost-quality-guardrails/05-04-SUMMARY.md` — new

---

### Session 8 — 2026-04-05

**Completed this session:**

- Executed Phase 05 Plan 01: Cost & Quality Guardrails Foundation
- Created `supabase/migrations/20260404000000_api_spend.sql`: api_spend table (7 cols: provider, model, input_tokens, output_tokens, cost_usd, restaurant_id, timestamp) + spend_alert_state table for idempotent monthly alert dedup
- Created `supabase/migrations/20260404000001_auto_blocked_column.sql`: ALTER TABLE adds auto_blocked BOOLEAN NOT NULL DEFAULT FALSE to master_wine_library_submissions
- Created `supabase/migrations/20260404000002_field_corrections.sql`: field_corrections table (submission_id, field_name, original_value, corrected_value, corrected_at, corrected_by)
- Created `services/agent-orchestrator/services/spend_logger.py`: SpendLogger class with log() never-raise contract + get_spend_logger() singleton
- Patched `services/agent-orchestrator/config/settings.py`: added manager_email, gmail_user, gmail_password attributes from MANAGER_EMAIL, GMAIL_USER, GMAIL_PASSWORD env vars
- Created `services/agent-orchestrator/tests/test_spend_logger.py`: 5 unit tests (TDD)

**Key decisions:**

- SpendLogger is synchronous (not async) — supabase-py is sync, < 50ms acceptable per RESEARCH.md
- log() wraps everything in try/except Exception — spend logging failure must NEVER crash extraction pipeline
- Singleton via module-level global — consistent with existing settings pattern

**Files changed:**

- `supabase/migrations/20260404000000_api_spend.sql` — new
- `supabase/migrations/20260404000001_auto_blocked_column.sql` — new
- `supabase/migrations/20260404000002_field_corrections.sql` — new
- `services/agent-orchestrator/services/spend_logger.py` — new
- `services/agent-orchestrator/tests/test_spend_logger.py` — new
- `services/agent-orchestrator/config/settings.py` — patched (+3 email attrs)
- `.planning/phases/05-cost-quality-guardrails/05-01-SUMMARY.md` — new

---

### Session 7 — 2026-04-03

**Completed this session:**

- Executed Phase 03 Plan 02: YOLO 2-class Preview Endpoint (Wave 2)
- Added `router_preview = APIRouter(prefix="/api/v1/preview")` to scan_routes.py — separate from /api/v1/scan
- Added `PreviewDetectRequest`, `BoundingBox`, `PreviewDetectResponse` Pydantic models to scan_routes.py
- Added `@router_preview.post("/detect")` endpoint calling `agent.detect_boxes()` only — firewalled from extraction
- Fixed `_get_yolo_model()` — removed `yolov8n.pt` fallback, added `Path.exists()` check + warning
- Registered `preview_router` in `main.py` — `/api/v1/preview/detect` now resolves (not 404)
- Auto-fix: Removed `"yolov8n.pt"` default from `MenuAnalyzerAgent.__init__` config.get() — replaced with best.pt path (03-01 left this behind)

**Key decisions:**

- Separate APIRouter prefix pattern: `/api/v1/preview` vs `/api/v1/scan` — clean resource separation
- Firewall enforcement: detect endpoint returns boxes only, zero connection to process_menu_image or extraction
- auto-fix logged: 03-01 summary claimed yolov8n.pt removal but config.get() default was not updated

**Files changed:**

- `services/agent-orchestrator/api/scan_routes.py` — router_preview, models, POST /detect, _get_yolo_model fix
- `services/agent-orchestrator/main.py` — preview_router import + include_router registration
- `services/agent-orchestrator/agents/menu_analyzer_agent.py` — yolov8n.pt default replaced
- `.planning/phases/03-surya-ocr-tuning/03-02-SUMMARY.md` — plan summary

---

### Session 6 — 2026-04-03

**Completed this session:**

- Executed Phase 03 Plan 01: YOLO 2-class Preview Foundation
- Patched Settings to add cv_menu_model_path, cv_yolov8_mock_mode=False, yolo_model_path (YOLO_MODEL_PATH env var)
- Fixed AttributeError in scan_routes.py line 220 (settings.cv_menu_model_path missing)
- Replaced 13-class MENU_CLASS_NAMES with 2-entry map {0: wine_entry, 1: section_header}
- Removed mock_mode gate from YOLO loading in initialize() per D-07
- Removed yolov8n.pt fallback — missing model now logs warning + sets yolo_model=None
- Added detect_boxes() async method to MenuAnalyzerAgent (run_in_executor, firewalled from extraction)
- Created tests/test_yolo_preview.py with 5 tests (YOLO-01 through YOLO-05)

**Key decisions:**

- D-07 enforced: YOLO loads unconditionally (mock_mode only gates Surya OCR + Gemini Pro)
- detect_boxes() is a standalone method — zero connection to _get_field_parser or _get_wine_matcher
- Graceful degradation: missing best.pt → yolo_model=None → detect_boxes returns []

**Files changed:**

- `services/agent-orchestrator/config/settings.py` — 3 new YOLO attributes
- `services/agent-orchestrator/agents/menu_analyzer_agent.py` — class map, initialize(), detect_boxes()
- `services/agent-orchestrator/tests/test_yolo_preview.py` — new test file
- `env.example` — YOLO_MODEL_PATH entry
- `.planning/phases/03-surya-ocr-tuning/03-01-SUMMARY.md` — plan summary

---

### Session 4 — 2026-03-31

**Completed this session:**

- Diagnosed 2-class training failure (bjrsn1lgn): stale `wine_menus/labels/train.cache` + `val.cache` caused ultralytics to load 13-class labels, rejecting 115/182 train images as "corrupt" and reducing val to ~6 instances
- 2-class training result: mAP50 0.34 (best 0.40) — unreliable, discarded
- Deleted stale cache files
- Launched correct 13-class training via `python datasets/scripts/train_model.py` (PID 39849)
- Confirmed correct training: val set = 51 images, 1474 instances (vs 6 in failed run)
- OCR baseline benchmark (Phase 3 prerequisite) also running in parallel

**Key findings:**

- Stale ultralytics cache files can silently load wrong labels — always delete before new dataset training
- 13-class training uses 182 train images / 51 val images, ~23 batches/epoch
- OCR benchmark complete: `datasets/ocr_benchmark_results.json` (334 images, mode=baseline)
- OCR baseline results: screenshots avg 0.9111, pdf_pages avg 0.8939, overall avg 0.8954
- 2 complete failures: aba_Wine_Menu_p2.png + p7.png (0.0 confidence — no text detected)
- `datasets/OCR_CONFIDENCE_REPORT.md` written with baseline table and tuning placeholder
- Fixed file path bug: benchmark was called with `--preprocessing none` (positional arg misuse); results written to `--preprocessing` at project root, moved and mode corrected to `baseline`

**Files changed:**

- `.planning/STATE.md` — updated session notes
- Deleted: `datasets/wine_menus/labels/train.cache`, `datasets/wine_menus/labels/val.cache`

---

### Session 3 — 2026-03-31

**Completed this session:**

- Executed Phase 1 Plan 03: Generate dataset_stats.json with class distribution and augmentation config
- Verified all 13 class IDs (0-12) present across train/val/test label files
- Computed class distribution from all .txt label files: wine_entry=2000 train, section_header=16 train
- Documented Section Header imbalance (125:1 ratio vs wine_entry) as AT RISK for Phase 2 mAP
- Recorded DATA-05 augmentation hyperparameters (fliplr=0.5, degrees=10, hsv_v=0.4, mosaic=1.0)
- Gemini annotation coverage confirmed at 87.6% (2392/2731)
- All 5 Phase 1 ROADMAP success criteria verified and passing
- Phase 1 complete

**Key findings:**

- section_header has only 16 train / 0 val / 3 test instances — near-zero mAP expected in Phase 2
- serving_type also very sparse: 11 train / 7 val / 3 test
- Total train annotations: 8,373 boxes across 13 classes

**Files changed:**

- `datasets/wine_menus/dataset_stats.json` — new stats file

---

### Session 2 — 2026-03-30

**Completed this session:**

- Executed Phase 1 Plan 01: Label Studio → YOLO dataset conversion
- Fixed data.yaml path bug (path: datasets/wine_menus → path: wine_menus)
- Wrote datasets/scripts/convert_labels.py with ls_to_yolo, parse_task, stratified_split, main
- 262 images copied to train/val/test with matching YOLO label files
- 2750 bounding boxes written (2731 Wine Entry + 19 Section Header)
- 86 empty label files created for unannotated images

**Key findings:**

- Stratified 70/20/10 split by source type yields 182/51/29 (not 183/52/27 as estimated — rounding across two groups)
- data.yaml path bug confirmed and fixed: DATASETS_DIR was already .../datasets
- All 262 annotation tasks accounted for, no missing images

**Files changed:**

- `datasets/wine_menus/data.yaml` — path bug fix
- `datasets/scripts/convert_labels.py` — new conversion script

---

### Session 1 — 2026-03-30

**Completed this session:**

- Diagnosed OCR fallback root cause: EasyOCR CPU performance → low confidence → Gemini TEXT fallback
- Replaced EasyOCR with Surya OCR in `menu_analyzer_agent.py`
- Added `_preprocess_for_ocr()` method (RGB normalize, 1200px upscale, 1.3× contrast)
- All smoke tests passing
- Initialized GSD project planning

**Key findings:**

- `datasets/wine_menus/images/` is empty — needs Label Studio → YOLO conversion
- Only 2 classes annotated (Wine Entry + Section Header) out of 13
- 262 labeled images, 8,462 bounding boxes
- 334 images available in `annotation_images/` for OCR benchmarking
- YOLO is using base `yolov8n.pt` (untrained on menus) — always falls to full-image mode

**Files changed:**

- `services/agent-orchestrator/agents/menu_analyzer_agent.py` — EasyOCR → Surya swap

---

## Decisions Log

| Date | Decision | Reason |
|------|----------|--------|
| 2026-03-30 | EasyOCR → Surya in screenshot path | CPU performance, proven in PDF path |
| 2026-03-30 | Add image preprocessing before OCR | Low-res/dark screenshots fail without it |
| 2026-03-30 | 13-class model (not 2-class) | User wants full sub-field detection eventually |
| 2026-03-30 | Auto-annotate sub-fields via Gemini Vision | No human labels for 11 classes; Wine Entry boxes are known |
| 2026-03-30 | Start with YOLOv8s | CPU-deployable, sufficient for 13-class detection |
| 2026-03-30 | Surya target: maximize + report actual | Hard 0.99 target unrealistic for complex menus |
| 2026-03-30 | Stratified split yields 182/51/29, not 183/52/27 | Rounding with int() across two source groups (28+234); total still 262 |
| 2026-03-30 | Empty .txt files for unannotated images | Ultralytics silently skips missing label files; empty file is correct behavior |
| 2026-03-31 | section_header imbalance documented as AT RISK | 16 train instances (125:1 ratio vs wine_entry); mAP >= 0.90 target not achievable without more data |
| 2026-03-31 | Augmentation is ultralytics built-in, no disk pre-augmentation | DATA-05 params recorded in dataset_stats.json for Phase 2 training call |
| 2026-03-31 | Delete ultralytics .cache files before any new dataset training | Stale train.cache/val.cache caused 2-class run to load 13-class labels; 115/182 train images rejected; mAP50 0.34 instead of expected ~0.8+ |
| 2026-03-31 | 2-class training experiment discarded | Produced unreliable best.pt due to cache bug; proceeding directly with 13-class per plan 02-01 |
| 2026-04-02 | Switch to Haiku (claude-haiku-4-5-20251001) conditional on MAX_TOKENS=8192 re-run | Live benchmark: Haiku is 3.8x cheaper ($0.13 vs $0.49/restaurant), 2.1x faster at p50, identical wine extraction quality. Parse errors in benchmark were MAX_TOKENS=4096 truncation artifacts — production uses 8192. |
| 2026-04-05 | SpendLogger is synchronous | supabase-py client is sync; blocking for < 50ms is acceptable for MVP; avoids asyncio complexity in Celery tasks |
| 2026-04-05 | SpendLogger.log() never re-raises | Spend logging failure must NEVER interrupt extraction pipeline — all exceptions caught and logged as warnings |
| 2026-04-05 | auto_blocked uses ADD COLUMN IF NOT EXISTS | Safe migration for existing master_wine_library_submissions table — idempotent |
| 2026-04-12 | supabase_service_role_key is alias only | Reads SUPABASE_SERVICE_ROLE_KEY env var — same var already present. No new privilege surface. Avoids AttributeError without new exposure. |
| 2026-04-12 | RabbitMQ connection failure in lifespan degrades gracefully | HTTP routes still serve; agents just don't start. Try/except in lifespan hook (main.py:47-56). Production health check will surface the state. |
| 2026-04-12 | str(exc) in HTTP 500 detail is acceptable for MVP | pos_routes.py is an internal orchestration endpoint, not public-facing. Phase 22 will replace with Sentry + generic message. |
| 2026-04-12 | Chaos tests use record_failure() × 3 instead of CircuitBreaker.call() | CircuitBreaker.call() doesn't exist in the implementation; record_failure() drives state transitions correctly. |
| 2026-04-12 | connect_robust patched at core.message_bus module path | Direct aio_pika import path missed the already-imported reference; module-level patch is the correct approach. |
| 2026-04-12 | No rate limit on Toast webhook (T-21-02-02 accepted) | Toast sends ≤100 webhooks/hour per restaurant. MVP scope. Rate limiting deferred to Phase 22. |
| 2026-04-12 | ngrok live-test script prints "set"/"NOT SET" only | Secret availability check uses ternary to string literal — actual TOAST_WEBHOOK_SECRET value never printed or logged. |

---

## Open Issues

- [ ] `menu_analyzer_agent` `mock_mode` defaults to `True` — production config must override
- [ ] Sub-field auto-annotations via Gemini Vision will need quality review
- [x] data.yaml path bug fixed — now `path: wine_menus` (resolves correctly via DATASETS_DIR)

---

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260401-wps | run live Supabase integration test for POST /api/v1/onboarding/extract — insert real wines into master_wine_library_submissions, verify rows, check submitted_by column type | 2026-04-02 | ced67f4 | [260401-wps-run-live-supabase-integration-test-for-p](./quick/260401-wps-run-live-supabase-integration-test-for-p/) |
| 260401-x24 | Benchmark claude-haiku-4-5-20251001 vs claude-sonnet-4-20250514 on 10 Phase 1 menu images — field completeness, latency, cost; produce model-selection recommendation | 2026-04-02 | 29158b3 | [260401-x24-investigate-whether-haiku-or-sonnet-haik](./quick/260401-x24-investigate-whether-haiku-or-sonnet-haik/) |
| 260402-kj0 | Build Phase 2 E2E test harness: crawl real restaurant URLs via WebCrawlerService, score wine field completeness, validate JSONL schema, confirm dedup, write REPORT.md | 2026-04-02 | 740b748 | [260402-kj0-build-phase-2-e2e-test-harness-crawl-rea](./quick/260402-kj0-build-phase-2-e2e-test-harness-crawl-rea/) |
| 260403-dgf | Update crawler JSONL output schema to Supabase-aligned 23-field format: rewrite _persist_crawled_wines, update CRAWL_TEXT_PROMPT (primary_type/price_reference), align e2e harness SCORED_FIELDS and validate_schema | 2026-04-03 | 891f5f8 | [260403-dgf-update-crawler-jsonl-output-schema-to-su](./quick/260403-dgf-update-crawler-jsonl-output-schema-to-su/) |
| 260406-2hy | try phase 8 with live API call, no mock data | 2026-04-06 | ec83274 | [260406-2hy-try-phase-8-with-live-api-call-no-mock-d](./quick/260406-2hy-try-phase-8-with-live-api-call-no-mock-d/) |
| 260406-329 | Improve concordance engine: add color synonym mapping and substring matching for grape varieties to reduce false contradictions | 2026-04-06 | c6b3683 | [260406-329-improve-concordance-engine-add-color-syn](./quick/260406-329-improve-concordance-engine-add-color-syn/) |
| 260407-pd8 | improve producer extraction — strip vintage prefix and separate region/country from producer strings | 2026-04-07 | eadd449 | [260407-pd8-improve-producer-extraction-strip-vintag](./quick/260407-pd8-improve-producer-extraction-strip-vintag/) |
| 260407-q0y | fix citation input always visible when editing + add production_method and lees_contact_months to Haiku winemaking_details enrichment | 2026-04-07 | 4532d5e | [260407-q0y-fix-citation-input-always-visible-when-e](./quick/260407-q0y-fix-citation-input-always-visible-when-e/) |
| 260407-qpw | fix override submission_id — backend returns real Supabase UUID per wine in extract response, frontend uses it instead of String(i) | 2026-04-07 | d199ec6 | [260407-qpw-fix-override-submission-id-backend-retur](./quick/260407-qpw-fix-override-submission-id-backend-retur/) |
| 260407-h3k | fix PGRST116 — replace `.single()` with `.maybe_single()` on studio routes + override_service so 0 rows return 404/null instead of PostgREST coerce error | 2026-04-07 | c35d52f | [260407-h3k-fix-pgrst116-studio-maybe-single](./quick/260407-h3k-fix-pgrst116-studio-maybe-single/) |
| 260407-q4r | fix /studio/queue access — add developer to allowed roles in App.tsx route guard and GET /queue backend dependency | 2026-04-07 | 73d3f8e | — |
| 260407-rdb | fix studio 403 — require_studio_role DB fallback when JWT app_metadata.roles is empty; open /studio/certify and GET /contributors to developer | 2026-04-07 | b10d40e | — |
| 260407-nav | Phase 13 gap closure: developer nav tabs (Queue + Certify), all 3 VERIFICATION gaps confirmed closed, UAT human-test instructions added | 2026-04-07 | 6b308de | — |
| 260408-02o | fix lucide-react TS2786 JSX component errors across codebase — pinned @types/react@18.2.47 + typescript@5.3.3 workspace-wide via pnpm.overrides | 2026-04-08 | — | [260408-02o-fix-lucide-react-ts2786-jsx-component-er](./quick/260408-02o-fix-lucide-react-ts2786-jsx-component-er/) |
| 260502-00z | analyze phase 25 plans for mistakes and future problems | 2026-05-02 | — | [260502-00z-analyze-phase-25-plans-for-mistakes-and-](./quick/260502-00z-analyze-phase-25-plans-for-mistakes-and-/) |
| 260502-06m | fix phase 25 execution issues from analysis 260502-00z | 2026-05-02 | — | [260502-06m-fix-phase-25-execution-issues-from-analy](./quick/260502-06m-fix-phase-25-execution-issues-from-analy/) |
| 260509-ui | Phase 26 UI polish — responsive path selector (feature cards desktop / bold-primary mobile), trust card invite code input, left-rail restaurant form (3 panels), VerifyEmail step list | 2026-05-09 | 06b25e3 | .planning/sketches/004-full-flow-synthesis/ |

---

## Todos

- [ ] Phase 2 Wave 2: run `datasets/scripts/eval_model.py` once 2-class best.pt is ready → write `eval_report.md`
- [x] Phase 3 Wave 1: OCR baseline complete — avg 0.8954 overall (screenshots 0.9111, pdf_pages 0.8939)
- [ ] Phase 3 Wave 2: run `datasets/scripts/ocr_tune_preprocessing.py`, write `OCR_CONFIDENCE_REPORT.md`, update `_preprocess_for_ocr()` if improvements found 
- [ ] Phase 4: wire 2-class best.pt into `menu_analyzer_agent.py`, E2E validation

---
---

### Session 5 — 2026-04-03

**Completed this session:**

- Built Phase 2 E2E crawl harness (`scripts/e2e_crawl_harness.py`) with live PASS: 87.3% aggregate completeness, 0 dedup failures, 0 schema violations
- Fixed GeminiFlashCrawlerExtractor: `AsyncClient → genai.Client`, upgraded model to `gemini-2.5-flash`
- Fixed dedup proxy logic: same content_hash = real Supabase dedup would catch it → PASS
- Added Phase 6 to ROADMAP: Image Menu Extraction via Claude Vision (deferred from Phase 2, IMGX-01→07)
- Locked E2E test suite: The Tailors Son (57 wines, 96.8%), Chicago Winery, BLVD Steakhouse, The Albert Chicago
- Completed 25-feature analysis across 3 tiers (Extracted / Derived / Haiku enrichment)
- **260403-dgf COMPLETE**: Rewrote `_persist_crawled_wines` to full 23-field Supabase-aligned schema:
  - Renames: `wine_type → primary_type`, `price → price_reference`
  - New derived: `bottle_size`, `is_blend`, `vintage_age`, `price_tier`
  - New dedup: `signature_hash` (md5), `normalized_name`, `normalized_producer`
  - Metadata folded into `data_enrichment` JSONB: source_url, source_type, restaurant_name, crawled_at, confidence, extraction_model
  - Phase 4 stubs: `color=None`, `sweetness_level=None`, `food_pairing=None`
  - Updated `CRAWL_TEXT_PROMPT` and `TEXT_FALLBACK_PROMPT` in vlm_extraction_service.py
  - E2E harness SCORED_FIELDS and validate_schema updated to new field names
- Analyzed `library/restaurant_wine_dataset.jsonl` (200 records) vs crawler schema:
  - Library = target enriched state; crawler JSONL = correct intake/staging format
  - Our schema is architecturally superior: no fabricated data, has signature_hash/dedup fields, tracks provenance
  - **6 JSONB stubs to add** in next session: `grape_family`, `wine_structure`, `practical_attributes`, `sensory_profile`, `ml_derived_features`, `region_hierarchy`

**Next actions:**

- Add 6 JSONB stubs to `_persist_crawled_wines` (quick task)
- Wire Supabase insert: populate `restaurant_id` + `submitted_by` → flow into `master_wine_library_submissions`
- PDF extraction path (Phase 6 prerequisite for ABA, BLVD, Mano)

---

---

### Session 11 — 2026-04-06

**Completed this session:**

- Ran `/gsd-validate-phase 6` — Phase 6 Nyquist validation complete, 06-VALIDATION.md written
- Fixed IMGX-07 live E2E (was ⚠️ manual, now ✅ automated):
  - Replaced dead Tredita URL (405) with **Siena Tavern** (`sienatavern.com/menus/`) in `e2e_restaurants.json`
  - Fixed `_check_image_menu()` miss: `_is_image_menu()` now runs as fallback in crawl_restaurant()
  - Fixed `_take_viewport_chunks()` height eval: `Math.max(body.scrollHeight, documentElement.scrollHeight, window.innerHeight)`
  - Fixed `_download_pdf()`: added `aiohttp` fallback with `User-Agent` header for CDN PDFs served as downloads
  - Fixed E2E harness filter: now accepts both `"image_menu"` and `"pdf_vision_fallback"` source types
  - Added `import aiohttp` + `import ssl` to web_crawler.py
- Live E2E result: Siena Tavern extracted **46 wines via pdf_vision_fallback** — IMGX-07 PASS
- Ran `/gsd-audit-milestone v1.0` — all 34/34 requirements satisfied, 6/6 phases verified, Nyquist 5/6 compliant
- Validated Haiku expanded enrichment: tested prompt returning 11/11 fields for "Canard-Duchêne Cuvee Leonie":
  - producer, region, sub_region, appellation, country, grape_variety, color, primary_type, sweetness_level, food_pairing, producer_bio
  - Cost: ~$0.0005/wine (270 in + 203 out tokens at Haiku pricing)

**Key findings:**

- Siena Tavern JSONL: 207 records, 23 fields per record — currently 8–11 fields populated per wine
- Zero-filled fields (producer, color, primary_type, sweetness_level, food_pairing) are all answerable by Haiku from wine_name + vintage alone — no web search required
- Haiku's training knowledge covers these fields with high accuracy — verified live on Champagne wine

**Next action — Haiku enrichment expansion (ready to implement):**

1. Expand `EnrichmentResult` dataclass in `haiku_enrichment_service.py` — add 7 new fields: `producer`, `color`, `primary_type`, `sweetness_level`, `food_pairing`, `sub_region`, `appellation`
2. Update prompt — ask for all 11 fields (currently only asks for 4)
3. Increase `MAX_TOKENS` from 512 → 1024
4. Update `haiku_tasks.py` — write new fields to Supabase `master_wine_library` update payload
5. Add DB migration for new columns (`color`, `primary_type`, `sweetness_level`, `food_pairing`, `sub_region`, `appellation`) if not already present

**Files changed this session:**

- `services/agent-orchestrator/services/web_crawler.py` — aiohttp import, _is_image_menu fallback, _take_viewport_chunks height fix, _download_pdf aiohttp fallback with User-Agent
- `scripts/e2e_restaurants.json` — Tredita → Siena Tavern
- `scripts/e2e_crawl_harness.py` — vision_source_types set accepts pdf_vision_fallback
- `.planning/phases/06-image-menu-extraction/06-VALIDATION.md` — IMGX-07 updated to COVERED, Manual-Only cleared, 7/7 automated

---

### Roadmap Evolution

- Phase 12.1 inserted after Phase 12: Research Agent SOTA Redesign — Three-Layer Architecture (INSERTED)
  - Addresses 10 critical bugs in Phase 12 code, 4 unimplemented features, 9 SOTA architectural gaps
  - Three-layer architecture: deterministic inference (Phase 9 ontology) → cascade LLM enrichment → deep research with Reflexion

---

### Session 14 — 2026-05-10 (Phase 26: Human UAT — All 8 Tests Passed)

**Completed this session:**

- Ran all 8 Phase 26 human UAT tests on https://restaurant-ai-automation-web.vercel.app — all passed
- Fixed `restaurants.slug NOT NULL` constraint crashing `POST /organizations/locations` (400): auto-generate `{name-kebab}-{8-char-uuid}` in `createLocation()`
- Applied DB migration: `restaurants.email` → nullable (legacy single-restaurant field, not needed for sub-locations)
- Fixed `EditLocationChainDialog` appearing in lower-right corner: Framer Motion `animate={{ y:0 }}` sets `style="transform:none"` which overrides Tailwind `-translate-x/y-1/2` classes. Fixed by moving centering into `style={{ x:'-50%', y:'-50%' }}` on the motion element
- Applied same Framer Motion centering fix to `CreateChainDialog` and new `AssignToChainDialog`
- Replaced `CreateChainDialog` single-checkbox with full standalone-locations checklist (multi-select, assigns all selected via parallel PATCH)
- Added `AssignToChainDialog`: "Add one →" under empty chain now shows standalones picker + "Create brand-new location" escape hatch
- Added `max-h + flex-col + overflow-y-auto` structure to `EditLocationChainDialog` and `CreateChainDialog` so footer Save/Cancel buttons are always pinned visible
- Finalized all Phase 26 planning artifacts: 26-HUMAN-UAT.md (status: passed 8/8), 26-VERIFICATION.md (status: passed 21/21), ROADMAP.md (all 9 plans [x], phase complete)

**Key commits:**

- `ae8f506` — fix: slug auto-generate + email nullable migration
- `663453a` — fix: EditLocationChainDialog scrollable body + pinned footer
- `b81f526` — fix: Framer Motion centering (x/y style props)
- `5682030` — feat: CreateChainDialog shows all standalones as checklist
- `fcf5ede` — feat: Add one → opens AssignToChainDialog
- `1e52f77` — chore: finalize Phase 26 planning artifacts

**Files changed this session:**

- `apps/api-gateway/src/organizations/organizations.service.ts` — slug auto-gen + `randomUUID` import
- `apps/web/src/components/locations/EditLocationChainDialog.tsx` — flex-col layout + Framer Motion centering
- `apps/web/src/components/locations/CreateChainDialog.tsx` — full standalone checklist
- `apps/web/src/components/locations/AssignToChainDialog.tsx` — NEW: chain assignment picker
- `apps/web/src/pages/Settings.tsx` — wire AssignToChainDialog + pass standaloneLocations
- `.planning/phases/26-*/26-HUMAN-UAT.md` — status: passed, 8/8
- `.planning/phases/26-*/26-VERIFICATION.md` — status: passed, 21/21
- `.planning/ROADMAP.md` — Phase 26 all plans [x]
- `supabase` migration — `make_restaurants_email_slug_nullable` applied via MCP

**Ready for next session:** Phase 27 — Vendor Search & Discovery. See ROADMAP.md for goal and success criteria.

---

*State initialized: 2026-03-30*
*Last updated: 2026-05-10 — Phase 26 fully complete. All 8 UAT tests passed. Phase 27 (Vendor Search & Discovery) is next.*
