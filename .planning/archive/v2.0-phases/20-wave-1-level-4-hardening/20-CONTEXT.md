# Phase 20: Wave 1 Level 4 Hardening — Context

**Gathered:** 2026-04-10
**Status:** Ready for planning
**Source:** /gsd-discuss-phase 20

<domain>
## Phase Boundary

Wire the Phase 18 BaseAgent infrastructure (idempotency, decision logging, event sourcing, DLQ, correlation ID) into all 4 Wave 1 agents, create the notification_deliveries migration, and write 50+ integration tests. No new agent capabilities — only hardening existing agents to Level 4 using methods already available in BaseAgent.

**What this phase is NOT:** E2E wire-up (Phase 21), observability/deployment (Phase 22), or hardening any agent beyond the 4 Wave 1 agents.

</domain>

<decisions>
## Implementation Decisions

### Plan Breakdown (4 plans — one per agent)

- **20-01**: InventoryEngine Level 4 hardening (idempotency + decision logging + event sourcing + 15+ tests)
- **20-02**: POSIntegrationAgent Level 4 hardening (webhook dedup + decision logging + Toast polling saga + 15+ tests)
- **20-03**: NotificationAgent Level 4 hardening (notification_deliveries migration + delivery tracking + idempotency + DLQ + 10+ tests)
- **20-04**: ReportingAgent Level 4 hardening (idempotency + decision logging + 10+ tests)

Each plan owns all three concerns for its agent: infrastructure wiring + migration (if needed) + tests.

### notification_deliveries Table

HARD-03 requires delivery tracking. This table was NOT created in Phase 18. Phase 20 (plan 20-03) must include:
- New migration file: `supabase/migrations/20260410000000_notification_deliveries.sql`
- Schema: `notification_id UUID PK, restaurant_id UUID, event_id TEXT, channel TEXT (sms|email|slack), status TEXT (sent|failed|pending), delivered_at TIMESTAMPTZ, error TEXT, created_at TIMESTAMPTZ`
- Add index on `(event_id, channel)` for idempotency lookups

### Toast API Polling Fallback Saga

**Trigger:** When a Toast webhook arrives but item details are incomplete or empty (e.g., `items` array is null/empty in the payload). This is the only trigger — not for API unavailability or signature failures.

**Saga behavior:**
- `start_saga()` on incomplete webhook receipt
- Poll Toast API up to 3 times with exponential backoff (1s, 2s, 4s)
- On success: complete saga, publish enriched POSSaleCompleted event
- On exhaustion (3 retries failed): `compensate_saga()`, publish `PartialOrderReceived` event with whatever data was available

**Saga type string:** `"toast_order_enrichment"`

### Test Isolation Strategy

Mock Supabase client using `AsyncMock` — same pattern as Phase 19 bug tests (`test_inventory_engine_bugs.py`, etc.).

**What to assert for infrastructure:**
- `self.database.table("idempotency_keys").insert(...)` called on first message
- `self.database.table("idempotency_keys").select(...)` returns existing record on duplicate → handler not called twice
- `self.database.table("decision_log").insert(...)` called with correct `decision_type`, `inputs`, `output`, `confidence`
- `self.database.table("event_store").insert(...)` called for stock changes (InventoryEngine)
- `self.database.table("notification_deliveries").insert(...)` called per notification (NotificationAgent)
- `self.database.table("dead_letter_queue").insert(...)` called after 3 failed retries (NotificationAgent DLQ)

Real Supabase DB is NOT required — reserved for Phase 21 E2E tests.

### BaseAgent Methods Available (Phase 18 — already in base_agent.py)

All 4 agents already extend `BaseAgent`. These methods are ready to call — no new BaseAgent code needed:
- `await self._check_idempotency(message_id: str) -> bool`
- `await self._mark_processed(message_id: str, result: Any = None)`
- `await self.log_decision(decision_type, inputs, output, reasoning, confidence)`
- `await self._send_to_dlq(message, error, exchange, routing_key)`
- `await self.start_saga(saga_type, context, compensations, deadline_seconds)`
- `await self.advance_saga(saga_id, next_step, context_update)`
- `await self.append_event(aggregate_type, aggregate_id, event_type, payload)`
- `self._current_correlation_id` — set automatically from incoming message envelope

### Idempotency Key Strategy Per Agent

- **InventoryEngine**: `message_id` from incoming message (standard dedup)
- **POSIntegrationAgent**: composite `f"{order_guid}:{event_type}"` — dedup by (order_guid + event_type) as specified in HARD-02
- **NotificationAgent**: `event_id` from incoming alert message
- **ReportingAgent**: composite `f"{restaurant_id}:{report_type}:{date}"` — idempotent scheduled reports

### Test File Names (new files — don't extend Phase 19 bug test files)

- `test_inventory_engine_hardening.py` — HARD-01 tests
- `test_pos_integration_hardening.py` — HARD-02 tests
- `test_notification_agent_hardening.py` — HARD-03 tests
- `test_reporting_agent_hardening.py` — HARD-04 tests

Phase 19 bug test files stay untouched — they test different concerns (bug correctness, not infrastructure wiring).

### Claude's Discretion

- Exact mock setup patterns (conftest fixtures vs inline mocks) — follow existing conftest.py conventions
- Saga compensation message schema for `PartialOrderReceived` event
- Decision log `confidence` values per decision type — planner should use 0.9 for clear algorithmic decisions, 0.7 for heuristic ones
- Order of method calls within each handler (idempotency check → process → mark_processed → log_decision)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 18 Infrastructure (already built — read to understand available methods)
- `services/agent-orchestrator/core/base_agent.py` — Lines 667–900: all infrastructure methods (_check_idempotency, _mark_processed, log_decision, _send_to_dlq, start_saga, advance_saga, append_event, correlation_id)
- `.planning/phases/18-infrastructure-foundation/18-01-PLAN.md` — DB migration specs (idempotency_keys, decision_log, outbox, saga_state, event_store, dead_letter_queue table schemas)

### Wave 1 Agents (targets for hardening)
- `services/agent-orchestrator/agents/inventory_engine.py` — Current handler methods: _handle_stock_evaluated, _handle_order_delivered, _handle_manual_correction
- `services/agent-orchestrator/agents/pos_integration_agent.py` — Current handler methods: process_toast_webhook, handle_order_refunded, is_wine_item
- `services/agent-orchestrator/agents/notification_agent.py` — Current handler methods, Redis rate limits, batch processor
- `services/agent-orchestrator/agents/reporting_agent.py` — Current handler methods: _generate_inventory_report, _generate_sales_report, _export_to_pdf

### Phase 19 Tests (pattern reference for new hardening tests)
- `services/agent-orchestrator/tests/test_inventory_engine_bugs.py` — Mock pattern reference
- `services/agent-orchestrator/tests/test_pos_integration_bugs.py` — Mock pattern reference
- `services/agent-orchestrator/tests/test_notification_agent_bugs.py` — Mock pattern reference
- `services/agent-orchestrator/tests/test_reporting_agent_bugs.py` — Mock pattern reference

### Requirements
- `.planning/REQUIREMENTS.md` — HARD-01..04 full specs

</canonical_refs>

<specifics>
## Specific Details

- notification_deliveries migration file name: `supabase/migrations/20260410000000_notification_deliveries.sql`
- Toast polling saga type string: `"toast_order_enrichment"`
- Toast retry schedule: 3 attempts, backoff 1s → 2s → 4s
- Compensation event on saga exhaustion: `PartialOrderReceived`
- All 4 new test files go in `services/agent-orchestrator/tests/`
- Test isolation: AsyncMock on `self.database` — no real Supabase required
- Idempotency behavior: fail open (if DB unavailable, proceed and log warning — same as Phase 18 design)

</specifics>

<deferred>
## Deferred Ideas

- Real DB integration tests (reserved for Phase 21 E2E)
- Hardening any Wave 2-6 agents (future milestone)
- Grafana/metrics dashboard wiring (Phase 22)

</deferred>

---

*Phase: 20-wave-1-level-4-hardening*
*Context gathered: 2026-04-10 via /gsd-discuss-phase 20*
