# Mudavym — Autonomous Restaurant Operations Platform

> Formerly framed as **WineOps AI**. Product brand going forward: **Mudavym**.  
> Canonical expansion vision: [FUTURES.md](./FUTURES.md).

## What This Is

Mudavym is a full autonomous backend system for restaurants — inventory, procurement, communications, POS integration, and intelligent agents. Wine is the first vertical and the **quality bar** for deep extraction (producer, vintage, region, ontology, images). The platform expands in locked order: **wine → full beverages → bakery (first food) → rest of kitchen**.

The current codebase and milestone naming may still say WineOps; identity migrates gradually. The ultimate goal does **not** change: kitchen-grade autonomous restaurant operations.

## Core Value

The system is so reliable that an average agent performs flawlessly because the infrastructure carries it — like a Michelin-star kitchen where systems, not genius, produce consistent excellence.

## Product expansion (futures — not current milestone)

See [FUTURES.md](./FUTURES.md). Summary:

| Stage | Scope |
|---|---|
| 0 (now) | Wine — deep extraction, cellar, procurement |
| 1 | Full beverages — wine subtypes, beer, cocktail, hard alcohol, NA; fine features + photos |
| 2 | Food → bakery MVP (ingredients, recipes, finished goods, waste, POS) then full bakery north star |
| 3 | Rest of kitchen food categories |

**Profile types:** restaurant **members** (owner/manager/staff, per-restaurant roles) and — as a futures addition — **guests**: customers who visit these restaurants, with Beli-style ratings and **points earned for sharing/recommending**. Guest signal is demand-side input to the backend, not a standalone social product. See FUTURES.md §7 and ROADMAP backlog 999.1.

**Ask AI:** global entry that **creates allowlisted actions** (draft PO, vendor email, calendar, inventory drafts, nav) with human confirm — eases complexity as the product expands. See FUTURES.md §8 and ROADMAP backlog 999.5.

## Current Milestone: v2.0 Backend Kitchen Architecture — Production-Grade Agent System

**Goal:** Transform 24 Level 0-1 agents into Level 4 (Resilient) production agents, starting with 4 core agents in the golden path workflow, deployed and tested with real Toast POS data from a Turkish restaurant in San Francisco.

**Target features:**
- BaseAgent infrastructure upgrade (6 additions: idempotency, decision logging, structured JSON logging, distributed tracing, dead letter queue, saga state)
- Wave 1 agent hardening: InventoryEngine, POSIntegrationAgent, NotificationAgent, ReportingAgent → Level 4
- Golden path E2E: Toast webhook → POSIntegrationAgent → InventoryEngine → NotificationAgent → Manager gets SMS/email alert
- Infrastructure tables: saga state, transactional outbox, decision log, idempotency dedup, event store
- Observability foundation: Sentry error tracking + structured JSON logs + per-agent health dashboards
- Production deployment: Vercel (frontend) + Supabase Cloud (DB) + Railway/Fly.io (Python services)
- Wave 2-6: Expand all remaining 20 agents to Level 4 following the same pattern

## Requirements

### v1.0 — Completed
All v1.0 requirements validated. See REQUIREMENTS.md for full list (CLVS-01..07, GMFL-01..05, YOLO-01..05, HAIKU-01..05, COST-01..03, QUAL-01..02, IMGX-01..07, CONF-01..08, WEBV-01..05, ONT-01..05, CRIT-01..05, TEMP-01..05, RSRCH-01..06, STUDIO-01..08, E2E-01..10, SLOC-01..03, UNIF-01..04, ALOC-01..08, SLMGR-01..03).

### v2.0 — Active

**Infrastructure (INFRA)**
- [ ] INFRA-01: Idempotency mixin — message_id dedup via Redis/PG in BaseAgent
- [ ] INFRA-02: Decision logging — log_decision() method + decision_log table
- [ ] INFRA-03: Structured JSON logging — swap logger format, add correlation_id
- [ ] INFRA-04: Distributed tracing — correlation_id propagation across agents
- [ ] INFRA-05: Dead letter queue — publish to dlq.{agent_name} after max retries
- [ ] INFRA-06: Saga state helpers — start_saga, advance_saga, compensate_saga + saga table
- [ ] INFRA-07: Transactional outbox table + background publisher worker
- [ ] INFRA-08: Event store table — append-only, for critical aggregates

**Bug Fixes (BUG)**
- [ ] BUG-01: InventoryEngine race condition — add optimistic locking
- [ ] BUG-02: InventoryEngine dead code removal (update_queue, batch_size)
- [ ] BUG-03: POSIntegrationAgent hmac.new → hmac.HMAC fix
- [ ] BUG-04: POSIntegrationAgent wine detection beyond keywords
- [ ] BUG-05: POSIntegrationAgent signature verification raw payload fix
- [ ] BUG-06: POSIntegrationAgent refund logic separation from void
- [ ] BUG-07: NotificationAgent persist rate limit counters in Redis
- [ ] BUG-08: NotificationAgent store batch processor task reference
- [ ] BUG-09: ReportingAgent self.db → self.database fix
- [ ] BUG-10: ReportingAgent SMS append outside if-block fix
- [ ] BUG-11: ReportingAgent implement real inventory + sales reports
- [ ] BUG-12: ReportingAgent implement PDF export

**Hardening (HARD)**
- [ ] HARD-01: InventoryEngine to Level 4 (idempotency, decision log, optimistic lock, tests)
- [ ] HARD-02: POSIntegrationAgent to Level 4 (webhook dedup, Toast polling fallback, tests)
- [ ] HARD-03: NotificationAgent to Level 4 (delivery tracking, DLQ, persisted rate limits, tests)
- [ ] HARD-04: ReportingAgent to Level 4 (real reports, real export, idempotent scheduling, tests)

**Golden Path E2E (E2E-v2)**
- [ ] E2E-v2-01: Toast webhook → POSIntegrationAgent → wine sale event published
- [ ] E2E-v2-02: Wine sale event → InventoryEngine → stock decremented + state changed
- [ ] E2E-v2-03: Stock threshold breach → NotificationAgent → manager gets SMS/email
- [ ] E2E-v2-04: All events → ReportingAgent → dashboard data updated
- [ ] E2E-v2-05: Full path integration test with real Toast data
- [ ] E2E-v2-06: Chaos test — kill agent mid-flow → verify recovery

**Observability (OBS)**
- [ ] OBS-01: Sentry integration for error tracking
- [ ] OBS-02: Per-agent health dashboard endpoint
- [ ] OBS-03: Structured JSON log aggregation
- [ ] OBS-04: Business metrics (stock updates/sec, notification delivery rate)

**Deployment (DEP)**
- [ ] DEP-01: Frontend deployed to Vercel
- [ ] DEP-02: Supabase Cloud database with migrations applied
- [ ] DEP-03: Python services on Railway/Fly.io (Docker)
- [ ] DEP-04: RabbitMQ on CloudAMQP
- [ ] DEP-05: Redis on Upstash
- [ ] DEP-06: Toast API credentials configured for friend's restaurant

### Out of Scope (v2.0)
- Waves 2-6 agent hardening (20 remaining agents) — future milestone
- Multi-POS support (Square, Clover) — future
- Invoice OCR pipeline — separate pipeline
- Mudavym beverage / bakery / kitchen expansion — see FUTURES.md + ROADMAP backlog 999.2–999.4
- Guest profiles / points — see FUTURES.md §7 + ROADMAP backlog 999.1
- Ask AI action creation — see FUTURES.md §8 + ROADMAP backlog 999.5

## Context

**v1.0 completed (2026-04-08):** 17 phases, 73 plans, 96% completion. Hybrid extraction pipeline (Claude Vision + Gemini Flash + YOLO 2-class + Haiku enrichment) fully operational with web verification, ontology validation, critic scores, temporal intelligence, research agent, and dev onboarding UI.

**v2.0 motivation:** 24 agents exist but all are Level 0-1 (prototype quality). BaseAgent already provides Level 3 infrastructure (circuit breaker, retry, backpressure, metrics, health checks, graceful shutdown). Gap to Level 4 is 6 additions to BaseAgent + per-agent bug fixes and hardening.

**Agent system architecture:**
- `services/agent-orchestrator/core/base_agent.py` — BaseAgent with circuit breaker, retry, backpressure, lifecycle management (already Level 3)
- `services/agent-orchestrator/agents/` — 24 agents, all Level 0-1
- Infrastructure: Docker Compose (Postgres, RabbitMQ, Redis)
- Wave 1 agents (golden path): InventoryEngine (326 lines, Level 1.5), POSIntegrationAgent (520 lines, Level 1.5), NotificationAgent (1,761 lines, Level 2), ReportingAgent (682 lines, Level 0.5)

**Surgical audit completed (2026-04-09):** Deep code review of all 4 Wave 1 agents + BaseAgent. Bug lists, maturity levels, gap-to-Level-4 documented. See memory: `agent_surgical_audit.md`.

**First user:** Friend's Turkish restaurant in SF using Toast POS. Full API access available.

**Deployment target:** Vercel (frontend) + Supabase Cloud (DB) + Railway/Fly.io (Python, ~$10-20/mo) + CloudAMQP (RabbitMQ) + Upstash (Redis).

## Constraints

- **Quality target**: Level 4 (Resilient) for all agents — not demo-ware, not happy-path-only
- **Solo founder**: Founder + Claude = 2-3 focused things per week
- **No revenue pressure**: Build right, not fast
- **Deployment budget**: ~$10-20/month (Vercel free + Supabase free + Railway $5-10 + CloudAMQP free + Upstash free)
- **Architectural defaults locked**: RabbitMQ+saga, PG events, Redis, Sentry+logs, Diamond testing
- **Backward compatibility**: v2.0 infrastructure must not break v1.0 extraction pipeline
- **Real data**: All E2E testing against real Toast data from friend's restaurant
- **Expansion quality bar**: Non-wine categories must meet wine-depth extraction + photos (FUTURES.md); no thin SKU rows

## Current State

v1.0 complete (2026-04-08) — 17 phases, 73 plans, 96% completion. All extraction, enrichment, verification, ontology, research, and UI phases done. v2.0 milestone setup in progress — surgical audit of Wave 1 agents complete, requirements defined, phase sequencing planned (Phases 18-22+). Product futures locked 2026-07-26 as **Mudavym** (see FUTURES.md).

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Brand: Mudavym | Broader than wine; autonomous restaurant backend | Locked 2026-07-26 — FUTURES.md |
| Expansion sequence A | Wine → beverages → bakery → kitchen | Locked 2026-07-26 |
| Wine = extraction quality bar | Other categories must match finest-feature + photo depth | Locked 2026-07-26 |
| Bakery first food vertical | Clearest recipe/inventory loop; MVP then north star | Locked 2026-07-26 |
| Extend BaseAgent, not rebuild | BaseAgent already Level 3 (circuit breaker, retry, backpressure, metrics, health, shutdown) | — v2.0 |
| Workflow-first agent hardening | Identify first E2E workflow → bring its agents to Level 4 → expand | — v2.0 |
| Wave sequencing (6 waves, 24 agents) | Golden path first, then communication, intelligence, support, stubs, specialty | — v2.0 |
| C→A→B approach | Audit agents → build infrastructure → wire golden path E2E | — v2.0 |
| 7 core principles | Determinism, idempotency, replayability, observability, isolation, temporal reasoning, evolvability | — v2.0 |
| Real Toast data from day 1 | Friend's restaurant in SF — no mock-only testing | — v2.0 |

### v1.0 Decisions (archived)
| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Claude Vision: extraction brain | Categorically solves abbreviation/layout failures | ✓ Validated |
| Gemini Flash: crawling brain | 10x cheaper than Claude Vision for bulk crawling | ✓ Validated |
| YOLO 2-class: UX preview only | Sufficient for box drawing | ✓ Good |
| Claude Haiku: enrichment | $0.01/wine background enrichment | ✓ Validated |

---
*Last updated: 2026-07-26 — Mudavym brand + futures vision linked; v2.0 milestone unchanged*
