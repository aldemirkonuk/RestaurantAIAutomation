---
phase: 32-provider-outbound-communication-engine
plan: "03"
subsystem: agent-orchestrator
tags:
  - agent
  - haiku
  - outbound-drafts
  - constraint-engine
  - python
  - wave-2
dependency_graph:
  requires:
    - 32-01 (schema — procurement_conversations columns, settings constants)
    - 32-02 (constraint_engine.py, fuzzy_matcher.py singletons)
  provides:
    - agents/provider_communication_agent.py → ProviderCommunicationAgent
    - 13 behavioral contract tests
  affects:
    - Wave 3 plans (32-05 through 32-07) that depend on procurement_conversations rows
    - Phase 32 end-to-end flow (procurement.order.created → PENDING_APPROVAL draft)
tech_stack:
  added: []
  patterns:
    - BaseAgent subclass (email_intel_agent.py pattern)
    - Module-level singleton (spend_logger.py pattern)
    - Redis SET NX PX mutex (draft lock)
    - Redis pipeline INCR+EXPIRE (rate limit)
    - Direct Supabase notifications INSERT (status='unread' verified field)
key_files:
  created:
    - services/agent-orchestrator/agents/provider_communication_agent.py
    - services/agent-orchestrator/tests/test_provider_communication_agent.py
  modified:
    - services/agent-orchestrator/core/orchestrator.py
decisions:
  - "Integrated _check_auto_send_gate (Task 4b) directly into Tasks 2+3 — all dependencies available during initial write, avoiding a separate patch pass"
  - "Used status='unread' in notifications INSERT (VERIFIED_NOTIFICATION_FIELD from 32-01-SUMMARY)"
  - "Auto-send gate fails closed on exceptions (returns False → PENDING_APPROVAL) — safety-first per D-32-07"
  - "Draft lock key uses order_id not conversation_id — conversation doesn't exist yet at lock acquisition time"
  - "SpendLogger non-fatal — spend logging failure never crashes the pipeline (TOKENBDGT-03)"
  - "test_order_created_generates_draft_and_notification mocks procurement_orders duplicate check chain to return empty data — avoids truthy MagicMock false-positive for C-10 duplicate block"
metrics:
  duration: ~12 minutes
  completed_date: "2026-05-14"
  tasks_completed: 5
  files_changed: 3
  tests_passing: 13
---

# Phase 32 Plan 03: ProviderCommunicationAgent Summary

**One-liner:** Haiku-driven outbound draft engine — 12-step order pipeline with 20-constraint enforcement, auto-send gate, Redis draft lock, SpendLogger wiring, and PII discrete mode.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Agent skeleton — class, __init__, initialize, routing keys, process_message | 4e8480b | `agents/provider_communication_agent.py` |
| 2 | _handle_order_created + _select_email_type + _build_context_window | 70070a1 | `agents/provider_communication_agent.py` |
| 3 | Helpers: PII classifier, rate limit, draft lock, auto-send gate, _notify, draft handlers | 5209be9 | `agents/provider_communication_agent.py` |
| 4a | Register in orchestrator + 13 behavioral contract tests | 99d5444 | `core/orchestrator.py`, `tests/test_provider_communication_agent.py` |
| 4b | Auto-send gate (integrated during Tasks 2+3) | — | Included in 70070a1 + 5209be9 |

## What Was Built

### ProviderCommunicationAgent (`agents/provider_communication_agent.py` — 742 lines)

**Subscription routing keys:**
- `procurement.events / procurement.order.created` → `_handle_order_created`
- `provider.events / provider.draft.approved` → `_handle_draft_approved`
- `provider.events / provider.draft.discarded` → `_handle_draft_discarded`

**`_handle_order_created` — 12-step pipeline:**
1. **Rate limit** (D-32-04): Redis `negotiation_draft:{restaurant_id}:day` counter, cap=50, TTL=86400
2. **Email type** (D-32-02): `_select_email_type` → PRICE_INQUIRY / DEMAND_OFFER / PROMO_INQUIRY / WINE_INQUIRY
3. **Context window** (D-32-03): Flat ~6k token prompt from provider profile + rolling summary + negotiation facts + order details
4. **Token hard cap** (TOKENBDGT-01): 8,000 input token limit; exceeded → notify + return
5. **Pre-draft constraint check** (D-32-14): `ConstraintEngine.check_hard_constraints` on order text + C-10 duplicate block
6. **Draft lock**: Redis `draft_lock:{order_id}` SET NX PX 30000 (T-32-03-03)
7. **Haiku generation**: `haiku.messages.create(model=haiku_model, max_tokens=512)` under semaphore
8. **SpendLogger** (TOKENBDGT-03): `spend_logger.log(...)` after every API call — never raises
9. **Post-draft constraints**: `check_hard_constraints(draft_body)` + `check_annotating_constraints` + `check_length_cap`; PII check → `is_sensitive` flag
10. **Disclaimer append** (D-32-08): `wineops_disclaimer.format(restaurant_name=...)` → `disclaimer_appended=True`
11. **Auto-send gate** (D-32-07 / OUTBOUND-08): `_check_auto_send_gate` → `final_status = AUTO_SENT | PENDING_APPROVAL`
12. **INSERT + action**: `procurement_conversations` INSERT → if AUTO_SENT publish event; if PENDING_APPROVAL notify manager

**`_classify_message_sensitivity` (GAP-1 — C-08/C-21):**
Regex PII detection: SSN `\d{3}-\d{2}-\d{4}`, routing numbers, Visa/MC/Amex card patterns, SSN phrases. Returns `True` → discrete mode (`is_sensitive=True` in `constraint_flags`).

**`_check_auto_send_gate` (D-32-07):**
Three-gate check:
1. `restaurant_feature_flags.auto_send_enabled = True`
2. `providers.relationship_health_score >= auto_send_health_threshold` (0.80)
3. `providers.auto_reply_enabled = True`
Fails closed on any exception (returns False → PENDING_APPROVAL).

**Notification schema:** `status='unread'` (VERIFIED_NOTIFICATION_FIELD from Plan 32-01 — NOT `is_read`).

### Orchestrator Registration

`core/orchestrator.py`:
- Import: `from agents.provider_communication_agent import ProviderCommunicationAgent`
- Dict entry: `"provider_communication_agent": ProviderCommunicationAgent`

### Tests (`tests/test_provider_communication_agent.py` — 13 tests, all pass)

| Test | Covers |
|------|--------|
| test_email_type_selection_price_inquiry_when_no_target_price | D-32-02 email type logic |
| test_email_type_selection_demand_offer_when_price_set | D-32-02 |
| test_classify_message_sensitivity_detects_ssn | GAP-1 / C-21 PII |
| test_classify_message_sensitivity_clean_text_passes | GAP-1 negative case |
| test_daily_rate_limit_blocks_at_cap | D-32-04 Redis cap enforcement |
| test_daily_rate_limit_allows_under_cap | D-32-04 allow path |
| test_draft_lock_acquired_when_redis_returns_true | T-32-03-03 mutex |
| test_draft_lock_fails_when_already_held | T-32-03-03 duplicate guard |
| test_token_hard_cap_exceeded_triggers_notification | TOKENBDGT-01 |
| test_order_created_generates_draft_and_notification | Happy-path E2E |
| test_auto_send_gate_returns_false_when_feature_flag_off | OUTBOUND-08 gate 1 |
| test_auto_send_gate_returns_false_when_health_below_threshold | OUTBOUND-08 gate 2 |
| test_auto_send_gate_returns_true_when_all_conditions_met | OUTBOUND-08 all gates |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] test_order_created mock for C-10 duplicate check**
- **Found during:** Task 4a test run
- **Issue:** `mock_db` fixture created a generic chain for all table queries. The `procurement_orders` duplicate check (C-10) used `.in_().neq().limit()` chaining that returned a truthy `MagicMock()` instead of `data=[]`, causing a false C-10 block in the happy-path test.
- **Fix:** Added explicit mock for the `.in_.return_value.neq.return_value.limit.return_value` chain in `test_order_created_generates_draft_and_notification` to return `MagicMock(data=[])`.
- **Files modified:** `tests/test_provider_communication_agent.py`
- **Commit:** 99d5444

### Architectural Integrations (No-op deviations)

**1. Task 4b (auto-send gate) integrated in Tasks 2+3**
- The plan's Task 4b was described as a separate "modify `_handle_order_created` to add gate" pass.
- Since all dependencies were available during the initial write, the gate was integrated from the start (step 10 in `_handle_order_created`), avoiding a double-edit.
- All acceptance criteria for Task 4b are met (grep counts verified, 3 gate tests pass).

## Verification Results

```
1. Import: from agents.provider_communication_agent import ProviderCommunicationAgent → OK
2. grep -c "provider_communication_agent" orchestrator.py → 2 (≥ 2) ✓
3. 13 tests → 13 passed ✓
4. grep -c "_classify_message_sensitivity" agent.py → 2 (≥ 2) ✓
5. grep -c "disclaimer_appended" agent.py → 1 (≥ 1) ✓
6. grep -c "PENDING_APPROVAL" agent.py → 4 (≥ 1) ✓
7. grep -c "_check_auto_send_gate" agent.py → 2 (≥ 2) ✓
8. grep -c "AUTO_SENT" agent.py → 3 (≥ 1) ✓
9. Line count: 742 lines (≥ 400 min_lines) ✓
```

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 4e8480b | feat | ProviderCommunicationAgent skeleton |
| 70070a1 | feat | _handle_order_created + email type + context window |
| 5209be9 | feat | helpers — PII classifier, rate limit, draft lock, notify, auto-send gate |
| 99d5444 | feat | register ProviderCommunicationAgent + 13 behavioral contract tests |

## Known Stubs

None. All methods are fully implemented with real logic wired to Supabase and Redis. No placeholder values, no TODO comments, no hardcoded mock data in production code.

## Threat Flags

No new threat surface beyond the plan's `<threat_model>`. All 6 STRIDE threats mitigated:
- T-32-03-01: `log_decision()` called on every draft generate/approve/discard ✓
- T-32-03-02: `check_hard_constraints(draft_body)` post-draft check before INSERT ✓
- T-32-03-03: `draft_lock:{order_id}` SET NX PX 30000 + idempotency key ✓
- T-32-03-04: `_classify_message_sensitivity()` + `is_sensitive` in `constraint_flags` ✓
- T-32-03-05: `haiku_semaphore` + Redis daily cap before any API call ✓
- T-32-03-06: Redis key uses `restaurant_id` from JWT-validated RabbitMQ payload ✓

## Self-Check: PASSED

- [x] `services/agent-orchestrator/agents/provider_communication_agent.py` — FOUND (742 lines)
- [x] `services/agent-orchestrator/tests/test_provider_communication_agent.py` — FOUND (13 tests, all pass)
- [x] `services/agent-orchestrator/core/orchestrator.py` modified — FOUND (2 occurrences of provider_communication_agent)
- [x] Commit 4e8480b (feat 32-03: skeleton) — FOUND in git log
- [x] Commit 70070a1 (feat 32-03: order handler) — FOUND in git log
- [x] Commit 5209be9 (feat 32-03: helpers) — FOUND in git log
- [x] Commit 99d5444 (feat 32-03: register + tests) — FOUND in git log
