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

- [ ] **Phase 23: Gmail Integration & Calendar Reminder Emails** — Wire Gmail OAuth2 (api-gateway `GmailService`) with `GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN` on Railway. Fix orchestrator SMTP path (`GMAIL_USER/PASSWORD` app-password). Activate calendar reminder emails: CalendarAgent sends reminders at T-7, T-1, T-0 via `email_client.py`. Confirm `scheduled-tasks.service.ts` weekly/daily email reports work end-to-end. Test email pipeline with real credentials. *(Research-first — ask user how the flow should work after explaining code design)*
- [ ] **Phase 24: Provider Communication Pipeline** — Bring `ProviderConversationAgent` (2,519 lines) and `EmailParsingAgent` (664 lines) to Level 4. Full pipeline: inbound email parsed → `order_interactions` saved → `EmailComposerService` generates reply → outbound sent via GmailService. Conversation summarization: LLM-generated highlights saved to `provider_conversation_summaries`. Sentiment analysis per conversation thread. Gap detection: missing confirmations, price discrepancies, unanswered threads. Dashboard card in frontend showing provider relationship health.
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

### Phase 26: Multi-Tenant Onboarding & Restaurant Hierarchy
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
**Plans:** 6 plans
Plans:
- [ ] 26-01-PLAN.md — 4 DB migrations: organizations, org_invites, email_verifications, restaurants schema (Wave 1)
- [ ] 26-02-PLAN.md — Auth backend: 6 new endpoints incl. register/restaurant, join, invite, verify-email (Wave 2)
- [ ] 26-03-PLAN.md — OrganizationsModule: GET /organizations/branches + AppModule registration (Wave 2)
- [ ] 26-04-PLAN.md — AuthContext RestaurantBranch type + Header.tsx branch switcher upgrade (Wave 3)
- [ ] 26-05-PLAN.md — Register.tsx two-path wizard + VerifyEmail.tsx + ProtectedRoute email gate (Wave 3)
- [ ] 26-06-PLAN.md — Settings → Team section + InviteTeamDialog with copy-able invite URL (Wave 4)

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
