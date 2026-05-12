# Roadmap: WineOps Backend Kitchen Architecture

## Overview

v2.0 transforms 24 Level 0-1 agents into Level 4 (Resilient) production agents. The approach: extend BaseAgent (already Level 3) with 6 infrastructure additions, fix all bugs found in the surgical audit, harden Wave 1 agents to Level 4, wire the golden path E2E with real Toast data, then deploy.

**Foundation:** BaseAgent already provides circuit breaker, retry with backoff, timeout enforcement, backpressure handling, metrics collection, health checks, graceful shutdown, auto-restart on crash, lifecycle management, concurrency control.

**Gap to Level 4:** Idempotency, decision logging, structured JSON logging, distributed tracing, dead letter queue, saga state management.

**Wave strategy:** Golden path first (4 agents), then expand to all 24 across 6 waves.

## v1.0 Archive

Phases 1-17 completed (2026-03-30 to 2026-04-08). 90 requirements, all complete. Hybrid extraction pipeline (Claude Vision + Gemini Flash + YOLO 2-class + Haiku enrichment), web verification, ontology, critic scores, temporal intelligence, research agent, dev onboarding UI, E2E testing, storage locations. Phase directories archived to `.planning/archive/v1.0-phases/`.

## v2.0 Phases

- [x] **Phase 18: Infrastructure Foundation** — Build shared infrastructure ALL 24 agents inherit: 6 new PG tables (idempotency_keys, decision_log, outbox, saga_state, event_store, dead_letter_queue) + 6 BaseAgent additions (idempotency mixin, decision logging, structured JSON logging, correlation ID propagation, DLQ on retry exhaustion, saga state helpers) (completed 2026-04-10)
- [x] **Phase 19: Wave 1 Bug Fixes** — Fix every bug found in the surgical audit across 4 agents: InventoryEngine (race condition, dead code), POSIntegrationAgent (hmac, wine detection, signature verification, refund logic), NotificationAgent (rate limit persistence, batch processor), ReportingAgent (self.db crash, stub reports, PDF export) (completed — absorbed into Phase 20 execution)
- [x] **Phase 20: Wave 1 Level 4 Hardening** — Bring 4 golden path agents from Level 1.5 to Level 4 using new BaseAgent infrastructure: wire idempotency, decision logging, event sourcing, delivery tracking, and write 50+ integration tests across all 4 agents (completed 2026-04-11)
- [x] **Phase 21: Golden Path E2E** — Wire the full workflow end-to-end: Toast webhook → POSIntegrationAgent → InventoryEngine → NotificationAgent → ReportingAgent. Integration test with mock Toast data, then real Toast data from friend's restaurant. Chaos testing: kill agents, disconnect RabbitMQ, simulate Supabase outages (completed 2026-04-12)
- [x] **Phase 22: Observability & Deployment** — Sentry error tracking, per-agent health dashboard, structured log aggregation, business metrics. Deploy: Vercel (frontend) + Supabase Cloud (DB) + Railway (Python + NestJS) + CloudAMQP (RabbitMQ) + Upstash (Redis). 9/9 agents live. (completed + deployed 2026-04-13)

## Phase Details

### Phase 18: Infrastructure Foundation
**Goal**: Build the shared infrastructure that ALL 24 agents inherit automatically. After this phase, any agent extending BaseAgent gets idempotency, decision logging, tracing, DLQ, and saga support for free.
**Depends on**: Nothing (first v2.0 phase)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05, INFRA-06, INFRA-07, INFRA-08, INFRA-DB-01, INFRA-DB-02, INFRA-DB-03, INFRA-DB-04, INFRA-DB-05, INFRA-DB-06
**Success Criteria** (what must be TRUE):
  1. `idempotency_keys` table exists in Supabase with message_id PK, agent_name, processed_at, result JSONB, expires_at
  2. `decision_log` table exists with agent_name, decision_type, inputs/reasoning/output JSONB, confidence, correlation_id
  3. `outbox` table exists with event_type, exchange, routing_key, payload, published flag, partial index on unpublished
  4. `saga_state` table exists with saga_type, current_step, status, context JSONB, compensations array, deadline
  5. `event_store` table exists with aggregate_type, aggregate_id, event_type, payload, sequence_number (unique constraint)
  6. `dead_letter_queue` table exists with agent_name, original exchange/routing_key, message, error, retry_count
  7. `BaseAgent._check_idempotency(message_id)` returns True if already processed, False otherwise. Fails open.
  8. `BaseAgent._mark_processed(message_id, result)` inserts into idempotency_keys table
  9. `BaseAgent.log_decision(decision_type, inputs, output, reasoning, confidence)` persists to decision_log
  10. All agent logs emit structured JSON with timestamp, level, logger, message, agent_name, correlation_id
  11. `self._current_correlation_id` set from incoming message, injected into all outgoing publishes
  12. After all retries exhausted, `_send_to_dlq()` persists failed message to dead_letter_queue
  13. `start_saga()`, `advance_saga()`, `complete_saga()`, `compensate_saga()` work end-to-end
  14. Background outbox publisher polls unpublished rows and dispatches to RabbitMQ
**Plans:** 3/3 plans complete
Plans:
- [x] 18-01-PLAN.md — Create 6 infrastructure database migration files + push to Supabase
- [x] 18-02-PLAN.md — Add idempotency, decision logging, DLQ, structured logging, correlation ID to BaseAgent
- [x] 18-03-PLAN.md — Add saga helpers, event store append, and background outbox publisher

### Phase 19: Wave 1 Bug Fixes
**Goal**: Fix every bug found in the surgical audit. No new features — just make existing code correct.
**Depends on**: Phase 18 (infrastructure tables must exist for some fixes)
**Requirements**: BUG-01, BUG-02, BUG-03, BUG-04, BUG-05, BUG-06, BUG-07, BUG-08, BUG-09, BUG-10, BUG-11, BUG-12
**Success Criteria** (what must be TRUE):
  1. InventoryEngine: concurrent stock updates don't lose data (optimistic locking with version column)
  2. InventoryEngine: no dead code (update_queue, batch_size removed)
  3. POSIntegrationAgent: `hmac.HMAC` used (not deprecated `hmac.new`)
  4. POSIntegrationAgent: wine detection works for wines without keywords (e.g., "Caymus", "Opus One")
  5. POSIntegrationAgent: signature verification uses raw payload bytes
  6. POSIntegrationAgent: refunds handled separately from voids (partial amounts, credit tracking)
  7. NotificationAgent: rate limit counters survive restart (Redis-backed)
  8. NotificationAgent: batch processor task monitored in health check
  9. ReportingAgent: `self.database` used everywhere (no `self.db` crash)
  10. ReportingAgent: SMS append only logged when SMS actually sent
  11. ReportingAgent: inventory + sales reports return real data from database
  12. ReportingAgent: PDF export generates actual PDF file via weasyprint
**Plans:** 4 plans
Plans:
- [ ] 19-01-PLAN.md — InventoryEngine: optimistic locking migration + dead code removal (BUG-01, BUG-02)
- [ ] 19-02-PLAN.md — POSIntegrationAgent: hmac, wine detection, signature, refund fixes (BUG-03..06)
- [ ] 19-03-PLAN.md — NotificationAgent: Redis rate limits + batch task monitoring (BUG-07, BUG-08)
- [ ] 19-04-PLAN.md — ReportingAgent: self.db crash, SMS append, real reports, PDF export (BUG-09..12)

### Phase 20: Wave 1 Level 4 Hardening
**Goal**: Bring each Wave 1 agent from Level 1.5 to Level 4 using the new BaseAgent infrastructure. Every agent gets idempotency, decision logging, and comprehensive tests.
**Depends on**: Phase 18 (BaseAgent infrastructure), Phase 19 (bugs fixed)
**Requirements**: HARD-01, HARD-02, HARD-03, HARD-04
**Success Criteria** (what must be TRUE):
  1. InventoryEngine: same message processed twice = single stock update (idempotency verified by test)
  2. InventoryEngine: every stock state change logged in decision_log with full context
  3. InventoryEngine: stock changes appended to event_store (aggregate_type='inventory')
  4. InventoryEngine: 15+ integration tests passing (happy path, idempotency, concurrency, delivery, manual correction, edge cases)
  5. POSIntegrationAgent: duplicate webhook = no duplicate event published (dedup by order_guid + event_type)
  6. POSIntegrationAgent: wine matching decisions logged in decision_log
  7. POSIntegrationAgent: Toast API polling fallback implemented as saga
  8. POSIntegrationAgent: 15+ integration tests passing (webhook, dedup, non-wine, signature, matching, polling)
  9. NotificationAgent: delivery tracked in notification_deliveries table
  10. NotificationAgent: same event_id = single notification (idempotent)
  11. NotificationAgent: failed notifications go to DLQ after 3 retries
  12. NotificationAgent: 10+ integration tests passing (routing, rate limits, delivery, idempotency, fallback)
  13. ReportingAgent: same scheduled trigger = single report (idempotent by restaurant_id + report_type + date)
  14. ReportingAgent: real PDF generated and readable
  15. ReportingAgent: 10+ integration tests passing (scheduled, on-demand, idempotency, timezone, PDF)
**Plans**: TBD (created by `/gsd-plan-phase 20`)

### Phase 21: Golden Path E2E
**Goal**: Wire the full workflow end-to-end and prove it works with real Toast data. This is the first time all 4 agents operate as a coordinated system.
**Depends on**: Phase 20 (all 4 agents at Level 4)
**Requirements**: E2E-v2-01, E2E-v2-02, E2E-v2-03, E2E-v2-04, E2E-v2-05, E2E-v2-06
**Success Criteria** (what must be TRUE):
  1. FastAPI endpoint `POST /api/v1/pos/webhook/toast` receives webhook and routes to POSIntegrationAgent
  2. RabbitMQ exchanges configured: pos.events → InventoryEngine, stock.events → NotificationAgent + ReportingAgent
  3. Mock Toast webhook → wine detected → stock decremented → notification sent: end-to-end in < 5 seconds
  4. Real Toast data: historical orders imported, inventory levels match Toast records
  5. Live webhook forwarding (ngrok → local) processes real orders in real-time
  6. Chaos test PASS: agent killed mid-flow → saga resumes on restart
  7. Chaos test PASS: RabbitMQ disconnect 30s → messages buffered → processed on reconnect
  8. Chaos test PASS: Supabase 503 → circuit breaker trips → recovery after timeout
  9. Chaos test PASS: malformed webhook → DLQ capture, other agents unaffected
  10. Chaos test PASS: 100 concurrent webhooks → no race conditions, all idempotent
**Plans**: TBD (created by `/gsd-plan-phase 21`)

### Phase 22: Observability & Deployment
**Goal**: Make the system visible and ship it to production. After this phase, the golden path is running live for friend's restaurant.
**Depends on**: Phase 21 (golden path E2E working)
**Requirements**: OBS-01, OBS-02, OBS-03, OBS-04, DEP-01, DEP-02, DEP-03, DEP-04, DEP-05, DEP-06
**Success Criteria** (what must be TRUE):
  1. Sentry SDK initialized in main.py with per-agent tags and alert rules
  2. `GET /api/v1/health/agents` returns health status for all running agents
  3. `GET /api/v1/health/agents/{name}` returns detailed metrics (messages processed, error rate, circuit breaker state)
  4. `GET /api/v1/metrics` returns DLQ size, active sagas, per-agent message counts
  5. React admin page at /admin/health shows agent status cards
  6. Frontend live on Vercel (auto-deploy from git)
  7. Supabase Cloud database with all v1.0 + v2.0 migrations applied
  8. Agent-orchestrator service running on Railway/Fly.io via Docker
  9. RabbitMQ running on CloudAMQP, queues created and bound
  10. Redis running on Upstash with AOF persistence
  11. Toast API credentials configured, webhook URL pointed to production endpoint
  12. Friend's restaurant receiving live inventory alerts
**Plans:** 5/5 plans complete
Plans:
- [x] 22-01-PLAN.md — Sentry init + CORS middleware + requirements.prod.txt + .env.example (Wave 1)
- [x] 22-02-PLAN.md — POS abstraction (POSProvider + ToastAdapter + generic route) + Sentry per-agent tags (Wave 1)
- [x] 22-03-PLAN.md — Health routes (/api/v1/health/agents, /metrics) + Railway Dockerfile + infra checkpoints (Wave 2)
- [x] 22-04-PLAN.md — NestJS api-gateway health proxy controller + OrchestratorModule update (Wave 1)
- [x] 22-05-PLAN.md — AdminHealth.tsx + App.tsx route + vercel.json + Railway/Vercel deployment checkpoint (Wave 2)

- [ ] **Phase 23: Gmail Integration & Calendar Reminder Emails** *(DEFERRED — revisit later)* — Wire Gmail OAuth2 (api-gateway `GmailService`) with `GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN` on Railway. Fix orchestrator SMTP path (`GMAIL_USER/PASSWORD` app-password). Activate calendar reminder emails: CalendarAgent sends reminders at T-7, T-1, T-0 via `email_client.py`. Confirm `scheduled-tasks.service.ts` weekly/daily email reports work end-to-end. Test email pipeline with real credentials. **Status:** Plans 01, 02, 04 complete. Blocked at plan 23-03 (Railway OAuth2 credential gate). Plans 23-03 + 23-06 remain.
- [ ] **Phase 24: Provider Communication Pipeline** *(DEFERRED — revisit later, depends on Phase 23)* — Bring `ProviderConversationAgent` (2,519 lines) and `EmailParsingAgent` (664 lines) to Level 4. Full pipeline: inbound email parsed → `order_interactions` saved → `EmailComposerService` generates reply → outbound sent via GmailService. Conversation summarization: LLM-generated highlights saved to `provider_conversation_summaries`. Sentiment analysis per conversation thread. Gap detection: missing confirmations, price discrepancies, unanswered threads. Dashboard card in frontend showing provider relationship health. **Status:** Test stubs + model_clients.py only (plans 02, 03). Plans 24-01, 24-04, 24-05 not executed.
- [x] **Phase 25: Production E2E Test Suite** — Comprehensive test coverage for the live Vercel + Railway stack. Wave A (API contract tests): every `/api/v1/` endpoint checked against deployed api-gateway with real JWT. Wave B (agent integration): each of the 9 active agents triggered via RabbitMQ publish, response verified. Wave C (cross-service): Toast webhook → POS → Inventory → Notification full pipeline on staging data. Wave D (frontend smoke): Playwright or Puppeteer headless checks — login, `/admin/health`, dashboard load, at least one data-write flow. Failure alerting via Sentry. (completed 2026-05-02)

### Phase 23: Gmail Integration & Calendar Reminder Emails
**Goal**: Make every email path in the system actually send. Two Gmail subsystems exist (OAuth2 API in api-gateway, SMTP app-password in orchestrator) — both need credentials wired and verified end-to-end.
**Depends on**: Phase 22 (deployed infrastructure)
**Research note**: Before planning, read `gmail.service.ts`, `gmail-watch.service.ts`, `email_client.py`, `scheduled-tasks.service.ts`, `notification_agent.py`, and `calendar agent`. Explain design to user then ask: (1) Should calendar reminders go through the api-gateway GmailService or the orchestrator EmailClient? (2) Which Gmail account should send (restaurant owner's account or a dedicated WineOps account)? (3) Should incoming emails (vendor replies) be processed via Gmail Watch + Pub/Sub, or polling?
**Requirements**: GMAIL-01..06, CAL-EMAIL-01..03
**Success Criteria** (what must be TRUE):
  1. `GmailService.isConfigured = true` on api-gateway startup (Railway env vars set)
  2. Weekly report email delivered to `MANAGER_EMAIL` every Monday 9am
  3. Daily summary email delivered every day
  4. Calendar reminder emails sent at T-7 days, T-1 day, T-0 (event day)
  5. `scheduled-tasks.service.ts` low stock midday report working
  6. Orchestrator `EmailClient` sends via SMTP (app-password path) for agent-triggered alerts
  7. `GmailWatchService` subscribes to inbox if `GMAIL_PUBSUB_TOPIC` set (optional for Phase 23)
  8. All email types tested with real credentials — delivery confirmed

### Phase 24: Provider Communication Pipeline + Email Intelligence Agent
**Goal**: Full manager↔provider communication loop with a new `EmailIntelAgent` handling inbox triage, promotional email intelligence, and daily digests. Surface relationship health + deal opportunities in the frontend.
**Depends on**: Phase 23 (Gmail working, inbox accessible)
**Requirements**: COMMS-01..08, SENTIMENT-01..03, INTEL-01..06
**Success Criteria** (what must be TRUE):
  1. `ProviderConversationAgent` upgraded to Level 4 (idempotency, decision logging, DLQ)
  2. `EmailParsingAgent` upgraded to Level 4 — all inbound vendor emails parsed + saved to `order_interactions`
  3. Outbound replies generated by `EmailComposerService` and sent via GmailService
  4. Thread linking: `gmail_thread_id` connects inbound + outbound messages
  5. Conversation summaries: LLM generates highlights for each provider thread, saved to DB
  6. Sentiment analysis: positive/neutral/negative scored per message + per provider aggregate
  7. Gap detection: flags unanswered threads > 48h, missing order confirmations, price discrepancies
  8. **`EmailIntelAgent` (new)**: classifies every inbound email as OPERATIONAL / PROMO / NOISE
  9. OPERATIONAL emails → routed to ProviderConversationAgent (existing path)
  10. PROMO emails → LLM extracts: product, discount %, valid-until date, vendor — saved to `vendor_promotions` table
  11. High-relevance promos → nudge `ProcurementAgent` ("Burgundy 20% off, stock low")
  12. Daily digest at 8am: LLM-generated promo summary emailed to `MANAGER_EMAIL` ("3 deals yesterday…")
  13. Promo deduplication: same deal from same vendor within 7 days → suppress re-alert
  14. Expiry tracking: "expiring today" surfaced in digest
  15. Frontend: Provider Comms card (health score, last contact, open threads) + Deals card (active promos count)
  16. 20+ integration tests covering: classify → route → extract → digest → sentiment pipeline

### Phase 25: Production E2E Test Suite
**Goal**: Prove every agent and every process works against the live Vercel + Railway production stack. No mocks — real JWT, real RabbitMQ, real Supabase.
**Depends on**: Phases 22, 23 (all services live)
**Requirements**: TEST-PROD-01..12
**Success Criteria** (what must be TRUE):
  1. Wave A — API contract: all `/api/v1/` endpoints return expected status codes with valid JWT
  2. Wave B — Agent health: each of the 9 agents returns `healthy: true` via `/api/v1/health/agents`
  3. Wave C — Agent trigger: each agent can be triggered via a test RabbitMQ message + acknowledges
  4. Wave D — Toast pipeline: test webhook → POSIntegrationAgent → InventoryEngine → NotificationAgent (staging data)
  5. Wave E — Gmail pipeline: test email send (low stock alert) + delivery confirmed
  6. Wave F — Frontend smoke (Playwright): login, `/admin/health` cards visible, dashboard loads
  7. Wave G — Calendar: create test event → reminder email sent at correct time
  8. All test results exported as JUnit XML for CI
  9. Failures trigger Sentry alert automatically
  10. Test suite runs in < 10 minutes total

**Plans:** 8/8 plans complete
Plans:
- [x] 25-01-PLAN.md — Requirements (TEST-PROD-01..12) + production setup scripts (Wave 1)
- [x] 25-02-PLAN.md — conftest_prod.py: JWT session fixture, teardown, Sentry hook, retry (Wave 2)
- [x] 25-03-PLAN.md — Wave A (API contracts) + Wave B (agent health) [parallel] (Wave 3)
- [x] 25-04-PLAN.md — Wave C (RabbitMQ triggers) + Wave D (Toast pipeline) [parallel] (Wave 3)
- [x] 25-05-PLAN.md — Wave E (Gmail pipeline) + Wave G (Calendar DB assertion) [parallel] (Wave 3)
- [x] 25-06-PLAN.md — Playwright prod config + Wave F smoke tests (Wave 3)
- [x] 25-07-PLAN.md — GitHub Actions e2e-prod.yml + cascading_report.py + report_generator extension (Wave 4)
- [x] 25-08-PLAN.md — [GAP CLOSURE] Wave F-4 write-flow: CommandBar ingest → WineRecordsTable verify → teardown (Wave 1)

### Phase 26: Multi-Tenant Onboarding & Restaurant Hierarchy ✓ COMPLETE (2026-05-10)
**Goal**: Fix broken registration and add multi-location support. New owners can self-register and create a restaurant in one flow. Existing owners can add branches (locations) under one organization and switch between them from the top nav. Staff join via invite code.
**Depends on**: Phase 22 (auth infrastructure live), Phase 25 (production verified)
**Requirements**: ONBOARD-01..08
**Success Criteria** (what must be TRUE):
  1. New restaurant owner can register and access dashboard without admin involvement
  2. Staff can join an existing restaurant via 8-char invite code
  3. Invite codes expire after 7 days and are single-use
  4. Owner with multiple locations can switch active branch from top nav
  5. All agent data remains scoped to restaurant_id (no cross-location data leakage)
  6. `organizations` and `organization_invites` tables exist in Supabase with RLS policies
  7. Register page shows two clear paths: "Create New Restaurant" and "Join Existing"
  8. Email verification required for Path B (new restaurant), skipped for Path A (invite)
**Plans:** 9 plans (9 waves) — all complete
Plans:
- [x] 26-01-PLAN.md — 5 DB migrations: organizations, org_invites, email_verifications, restaurants schema, restaurant_chains (Wave 1) [ONBOARD-06, ORG-01..03, CHAIN-01..02]
- [x] 26-02-PLAN.md — Auth backend: 6 new endpoints incl. register/restaurant, join, invite, verify-email (Wave 2) [ONBOARD-05, 07, INVITE-01..03]
- [x] 26-03-PLAN.md — OrganizationsModule: branches+chains+locations endpoints + AppModule (Wave 2) [ORG-04..05, CHAIN-03]
- [x] 26-04-PLAN.md — AuthContext RestaurantBranch (chain fields) + Header chain-grouped switcher (Wave 3) [ORG-05, CHAIN-04]
- [x] 26-05-PLAN.md — Register.tsx two-path wizard + ?type= routing + VerifyEmail.tsx + ProtectedRoute (Wave 4) [ONBOARD-01..04, 07..08, INVITE-02]
- [x] 26-06-PLAN.md — Settings → Team invite + Locations/Chains management tab (Wave 5) [INVITE-01, 04, CHAIN-04]
- [x] 26-07-PLAN.md — Backend: PATCH locations/:id + createChain auto-assign + getUserOrgIdsWithFallback DRY (Wave 7) [CHAIN-05]
- [x] 26-08-PLAN.md — Frontend: AuthContext refreshBranches + EditLocationChainDialog + Create Chain checkbox (Wave 8, depends on 26-07) [CHAIN-06]
- [x] 26-09-PLAN.md — Settings UX overhaul: chain rename/delete API + tree-view Locations + sticky nav (Wave 9)

### Phase 27: Vendor Search & Discovery ✓ COMPLETE (2026-05-11)
**Goal**: New users can discover, search, and add wine vendors to their restaurant from an admin-curated global catalogue (or add custom vendors). Providers page shows a search-first empty state. Order creation is gated behind having at least one vendor (free tier: hard block; paid tier: LLM-powered vendor suggestions stub).
**Depends on**: Phase 26 (restaurant + organization model live)
**Requirements**: VENDOR-01..10
**Success Criteria** (what must be TRUE):
  1. `vendor_catalogue` table exists (admin-curated, not restaurant-scoped) seeded with 20+ US distributors
  2. `providers` table has `catalogue_vendor_id` (nullable FK) and `is_custom BOOLEAN DEFAULT TRUE`
  3. `GET /api/v1/vendor-catalogue/search?q=&country=` returns fuzzy-matched results
  4. `POST /api/v1/providers` accepts both catalogue selection and fully custom vendor creation
  5. Providers page empty state: search bar + "Browse Catalogue" + "Add Custom" options visible immediately
  6. VendorSearchModal: search → results list with vendor details → "Add to my Providers" → row created in `providers`
  7. When a new branch location is added in Settings, a modal asks: "Transfer vendors to [Branch Name]?" with pre-selected checkboxes (user unchecks to exclude)
  8. Order creation: if `providers` is empty → hard block modal "Add a vendor to place orders" with link to /providers
  9. Custom vendors stored with `is_custom = true`, `catalogue_vendor_id = null` (admin can promote later)
  10. All new DB tables have RLS policies scoped to `restaurant_id`
**Plans:** 4 plans (4 waves)
Plans:
- [x] 27-01-PLAN.md — DB: `vendor_catalogue` table + `providers` schema update + seed data migration (Wave 1) [VENDOR-01..03]
- [x] 27-02-PLAN.md — Backend: vendor catalogue search API + providers CRUD + order guard endpoint (Wave 2) [VENDOR-04..06]
- [x] 27-03-PLAN.md — Frontend: Providers empty state + VendorSearchModal + catalogue browsing UI (Wave 3) [VENDOR-07..09]
- [x] 27-04-PLAN.md — Frontend: Branch provider transfer modal + order creation guard popup (Wave 4) [VENDOR-10]
**UAT**: All 5 tests passed 2026-05-11. Phase complete.

### Phase 30: Calendar Operations Hub
**Goal**: Make the calendar fully functional and operationally connected. Fix 5 critical bugs (column name mismatch, status enum divergence, color/endTime persistence, unimplemented recurrence scope). Fix dashboard "Add Event" to open the modal in-context. Add iCal subscription feed so operators can subscribe WineOps events directly into Outlook/Apple Calendar/Google Calendar in one URL — zero OAuth, zero friction.
**Depends on**: Phase 28 (registration + dashboard complete)
**Requirements**: CAL-FIX-01..05, CAL-UX-01..02, CAL-ICAL-01..03
**Success Criteria** (what must be TRUE):
  1. Editing a calendar event saves all fields correctly (title, status, color, endTime, description, recurrence)
  2. Status dropdown accepts: pending, approved, confirmed (mapped→approved), completed, cancelled — no mutation error
  3. Color is persisted to DB and restored on page reload
  4. End time is persisted to DB and restored on page reload
  5. Dashboard "Add Event" button opens the EventModal in-context (no redirect to /calendar)
  6. `GET /api/v1/calendar/feed/:restaurantToken.ics` returns a valid RFC 5545 iCal document with all restaurant events
  7. iCal token is generated per-restaurant (HMAC-based) and shown in Settings → Calendar
  8. Subscribing the URL in Outlook/Apple Calendar/Google Calendar shows WineOps events
  9. `start_date`/`end_date`/`start_time`/`end_time` column names are consistent between migration and service code
  10. "this_and_future" recurring update scope is implemented (splits recurrence rule at given date)
**Plans:** 6 plans
Plans:
- [x] 30-01-PLAN.md — Comprehensive DB schema migration (calendar_events + recurrence tables + generate_recurring_events RPC + restaurants.calendar_ical_token)
- [x] 30-02-PLAN.md — Backend service column alignment (D-01), color persistence (D-03), endTime wiring (D-04)
- [x] 30-03-PLAN.md — iCal feed backend: ical-generator install, feed endpoint (@Public), token generation/regeneration endpoints
- [ ] 30-04-PLAN.md — Frontend bug fixes: status enum (D-02), endTime payload (D-04), Dashboard Add Event modal navigation (D-06), CalendarPage openModal param
- [ ] 30-05-PLAN.md — Frontend iCal UI: Settings calendar subscription section (D-10) + dashboard subscribe shortcut (D-11)
- [ ] 30-06-PLAN.md — this_and_future recurring update scope implementation (D-05)

### Phase 31: Event-Driven Procurement Signals
**Goal**: Connect the calendar to inventory and procurement. When a wine-related event (wine_tasting, private_dinner, special_event) is created or confirmed, the system performs a lightweight inventory adequacy check and surfaces a non-blocking procurement suggestion if stock may be insufficient for the event.
**Depends on**: Phase 30 (calendar fully functional), Phase 27 (vendor model)
**Requirements**: CALDRIVE-01..05
**Success Criteria** (what must be TRUE):
  1. Creating/confirming an event of type wine_tasting/private_dinner/special_event triggers an inventory adequacy check
  2. Check compares current stock of wines tagged to the event's type against a heuristic (guest_count × avg_pour or configurable threshold)
  3. If stock is below threshold, a dismissable in-modal prompt appears: "X bottle(s) of Y may run low — create procurement order?"
  4. User can dismiss (no-op) or click "Create Order" (pre-fills order with suggested wines/quantity)
  5. Procurement suggestion logged to `agent_activity_logs`
**Plans:** TBD (created by `/gsd-plan-phase 31`)

### Phase 29: Autonomous Vendor Discovery (Paid Tier)
**Goal**: Paid-tier restaurants can place orders even with zero pre-configured vendors. On order creation with no providers, instead of a hard block, the LLM autonomously web-searches for matching wine distributors — finds contact info, operating region, specialties — and presents a ranked shortlist the manager can approve. Approved vendors are auto-created in `providers` and the order proceeds.
**Depends on**: Phase 27 (provider model + order guard in place), Phase 28 (activation checklist)
**Requirements**: AUTOPROCURE-01..08
**Success Criteria** (what must be TRUE):
  1. Paid tier flag (`restaurant_feature_flags.autonomous_vendor_discovery = true`) gates the feature; free tier still sees the hard block modal
  2. Order creation with 0 providers on paid tier opens `AutonomousVendorSearchModal` instead of `OrderGuardModal`
  3. LLM (Claude) web-searches for US wine distributors matching the wine type, vintage region, and restaurant location
  4. Returns a ranked list of ≤5 candidates with: name, website, estimated contact email, phone, distribution region
  5. Manager can approve 1+ candidates → auto-created in `providers` table with `is_custom = true`, `ai_discovered = true`
  6. Order proceeds immediately after at least one vendor is approved
  7. Fallback to manual entry form if LLM search returns 0 results
  8. Discovery action logged to `agent_activity_logs` with cost estimate for the Claude call

### Phase 28: Onboarding Reform + Menu Import ✓ COMPLETE (2026-05-11)
**Goal**: Replace the 9-step onboarding wizard with a focused post-registration "Import your menu" screen (skippable), followed by a dashboard-embedded 3-task activation checklist. Menu uploads feed directly into `master_wine_library_submissions` via the LLM enrichment pipeline, creating a data flywheel. This is the most impactful onboarding improvement for both conversion and AI data quality.
**Depends on**: Phase 26 (registration flow complete), Phase 27 (vendors discoverable)
**Requirements**: MENU-01..08, ACTIVATION-01..05
**Success Criteria** (what must be TRUE):
  1. After email verification, user is redirected to `/get-started` (new page) instead of `/onboarding`
  2. `/get-started` offers 3 menu import methods: photo scan (camera/file), CSV/Excel upload, manual entry
  3. "Skip for now" link is present and frictionless — no guilt-trip copy
  4. Each wine item extracted from a menu upload is submitted to `master_wine_library_submissions` via the existing LLM enrichment pipeline
  5. Extracted wines are simultaneously added to the restaurant's `inventory` table (source = 'menu_import')
  6. Dashboard shows a persistent "Setup Checklist" card: ① Upload menu ② Add a vendor ③ Invite your team — disappears when all 3 are complete
  7. `user_onboarding_progress` table tracks per-user completion of all 3 activation tasks
  8. The old `/onboarding` 9-step wizard is replaced: wizard steps that duplicate Registration (restaurant profile, manager profile, review) are removed; remaining useful steps (POS connection) are preserved as optional deep-settings links
  9. Menu import accepts beverage menus today; schema is extensible to food menus in future phases
  10. All 3 upload methods funnel into the same extraction + submission pipeline
**Plans:** 5 plans (5 waves)
Plans:
- [x] 28-01-PLAN.md — DB: `user_onboarding_progress` + `restaurant_menus` + `menu_items` tables (Wave 1) [ACTIVATION-01, MENU-01]
- [x] 28-02-PLAN.md — Backend: menu import API (scan/CSV/manual) + master_wine_library_submissions bridge (Wave 2) [MENU-02..05]
- [x] 28-03-PLAN.md — Frontend: `/get-started` MenuImportOnboarding page — 3 methods, frictionless skip (Wave 3) [MENU-06..07]
- [x] 28-04-PLAN.md — Frontend: Sidebar Variant B checklist (badge + slide-in panel) + backend auto-triggers (Wave 4) [ACTIVATION-02..05]
- [x] 28-05-PLAN.md — Frontend: Retire 9-step wizard → slim redirect; fix post-verify redirect to /get-started (Wave 5) [MENU-08]

---

## Future: Waves 2-6

After Phases 23-25 complete, expand to remaining agents:

**Wave 2 — Communication Layer (4 agents):**
- EmailParsingAgent (664 lines) → Level 4
- ProviderConversationAgent (2,519 lines — the beast) → Level 4
- ProcurementAgent (854 lines) → Level 4
- BufferManager (477 lines) → Level 4

**Wave 3 — Intelligence Layer (4 agents):**
- RecurringOrderAgent (388 lines), RFQAgent (736 lines), SommelierAgent (708 lines), MenuAnalyzerAgent (911 lines)

**Wave 4 — Support Layer (4 agents):**
- CalendarAgent (297 lines), VisualVerificationAgent (1,051 lines), StateInvariantEnforcer (246 lines), DatasetCreatorAgent (275 lines)

**Wave 5 — Stubs (rebuild from scratch, 5 agents):**
- GhostInventoryAgent (35 lines), NegotiationPlaybookAgent (34 lines), AutoPilotAgent (34 lines), ShrinkageDetective (33 lines), ComplianceAgent (33 lines)

**Wave 6 — Specialty (3 agents):**
- InequalityDetector (105 lines), BookScraperAgent (113 lines), POSIntegrationAgent v2 (multi-POS: Square, Clover)

---
*Roadmap created: 2026-04-09 — v2.0 Backend Kitchen Architecture*
*v1.0 roadmap archived (Phases 1-17, 2026-03-30 to 2026-04-08)*
