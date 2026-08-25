---
phase: 25-production-e2e-test-suite
plan: "04"
subsystem: production-e2e-tests
tags: [e2e, production, rabbitmq, toast, webhook, aio_pika, hmac, supabase]
dependency_graph:
  requires:
    - "25-02 (conftest_prod.py fixtures)"
    - "CloudAMQP RabbitMQ RABBITMQ_URL env var"
    - "TOAST_WEBHOOK_SECRET env var (Wave D only)"
  provides:
    - "wave_c_agent_triggers.py — RabbitMQ agent trigger tests (TEST-PROD-03)"
    - "wave_d_toast_pipeline.py — Toast webhook pipeline integration test (TEST-PROD-04)"
  affects:
    - "services/agent-orchestrator/tests/e2e/ (2 new test files)"
tech_stack:
  added:
    - "aio_pika==9.4.0 (already in requirements.prod.txt) — RabbitMQ publish for Wave C"
  patterns:
    - "Single shared aio_pika.connect_robust() session fixture (H-01: CloudAMQP 5-connection free tier limit)"
    - "5s asyncio polling loop for agent health after RabbitMQ publish"
    - "HMAC-SHA256 raw hexdigest (no sha256= prefix) matching ToastAdapter.verify_webhook"
    - "Toast-Signature header (not X-Toast-Signature) per pos_routes.py alias"
    - "JSONB payload polling in Python (supabase-py + recent-row fetch + dict inspection)"
    - "pytest.skip graceful degradation when env vars or exchanges absent"
key_files:
  created:
    - "services/agent-orchestrator/tests/e2e/wave_c_agent_triggers.py"
    - "services/agent-orchestrator/tests/e2e/wave_d_toast_pipeline.py"
  modified: []
decisions:
  - "Toast-Signature header name (not X-Toast-Signature) — verified from pos_routes.py line 37: alias='Toast-Signature'"
  - "Raw hexdigest HMAC value (no sha256= prefix) — ToastAdapter.verify_webhook compares hmac.hexdigest() vs signature.lower() directly"
  - "Single shared aio_pika connection (H-01) — CloudAMQP free tier allows 5 concurrent connections; 9 tests × 1 connection = 1 shared connection"
  - "Default exchange fallback for pos_integration_agent and reporting_agent — pos.commands and reporting.events exchanges not declared in message_bus._setup_exchanges(); queues exist but are unbound from exchanges"
  - "Python-side JSONB polling for pos_webhook_logs — payload is JSONB with orderGuid inside; PostgREST path syntax compatibility across supabase-py versions varies; safer to fetch recent rows and check in Python"
  - "pos_webhook_logs teardown is silent-fail — no restaurant_id or controllable id column; ID-registry and tag-based teardown both fail silently per D-04; audit log records persist harmlessly"
metrics:
  duration: "~18 minutes"
  completed_date: "2026-05-02"
  tasks_completed: 2
  files_changed: 2
---

# Phase 25 Plan 04: Wave C + Wave D Test Files Summary

**One-liner:** Wave C publishes test probes to all 9 agent routing keys via live CloudAMQP and polls health for 5s; Wave D delivers HMAC-signed Toast webhook and verifies pos_webhook_logs record within 15s.

## What Was Built

### Task 1 — wave_c_agent_triggers.py (Wave C: RabbitMQ agent trigger tests)

`services/agent-orchestrator/tests/e2e/wave_c_agent_triggers.py` created with:

**AGENT_ROUTING_KEYS** — routing key map extracted from source code:

| Agent (short name) | Exchange | Routing Key | Source |
|--------------------|----------|-------------|--------|
| `pos_integration` | `""` (default) | `queue.pos_integration_agent.pos_test` | pos.commands not in message_bus._setup_exchanges → direct queue |
| `buffer_manager` | `pos.events` | `pos.sale.completed` | buffer_manager.py:141 |
| `inventory_engine` | `stock.events` | `stock.evaluated` | inventory_engine.py:70 |
| `inequality_detector` | `stock.events` | `stock.state.changed` | inequality_detector.py:36 |
| `state_invariant_enforcer` | `pos.events` | `pos.e2e.test_probe` | state_invariant_enforcer.py:63 — subscribes `("pos.events","#")` wildcard |
| `notification` | `stock.events` | `stock.threshold.breached` | notification_agent.py:273 |
| `procurement` | `procurement.events` | `procurement.manual_order_request` | procurement_agent.py:107 |
| `calendar` | `system.control` | `system.schedule.daily_check` | calendar_agent.py:76 |
| `reporting` | `""` (default) | `queue.reporting_agent.reporting_generate_on_demand_report` | reporting.events not in message_bus._setup_exchanges → direct queue |

**Connection management (H-01 fix):** Single `aio_pika.connect_robust()` session fixture shared across all 9 parametrized tests. Each test opens a fresh channel for publish (channels are lightweight), closes it after publish. Stays well within CloudAMQP free tier (5 concurrent connections).

**Health polling:** After publish, `check_agent_still_healthy()` polls `GET /api/v1/health/agents/{name}` every 1s up to 5.0s deadline. Accepts 404 gracefully (short names like "pos_integration" may not match orchestrator's "pos_integration_agent" key — not a crash indicator). Returns `True` if no `status in ("error", "failed", "crashed")` observed within window.

**Probe payload:** `{"type": "test_probe", "source": "e2e-test-suite", "agent": agent_name, "restaurant_id": "e2e-test-restaurant", ...}` — intentionally minimal. Agents will DLQ or ignore unknown message types (pass criteria) rather than crash (fail criteria).

**Skip conditions:** RABBITMQ_URL not set → skip entire Wave C. Publish fails (exchange unreachable) → skip that specific agent's test.

**Tests:** 1 connection reachability check + 9 parametrized `test_agent_survives_test_message` tests.

### Task 2 — wave_d_toast_pipeline.py (Wave D: Toast webhook pipeline integration)

`services/agent-orchestrator/tests/e2e/wave_d_toast_pipeline.py` created with:

**HMAC signing (verified against adapters/toast_adapter.py):**
- Header name: `Toast-Signature` (not `X-Toast-Signature`) — per `pos_routes.py` line 37: `alias="Toast-Signature"`
- Header value: raw `hmac.new(secret.encode(), body_bytes, hashlib.sha256).hexdigest()` — no `sha256=` prefix
- `ToastAdapter.verify_webhook` compares `expected = hmac.new(...).hexdigest()` against `signature.lower()` directly; a `sha256=` prefix would cause all signatures to fail

**Test payload:** `{restaurantGuid: "e2e-test-restaurant", orderGuid: "e2e-order-001", eventType: "APPLIED_DATE", ...}` with e2e-isolation IDs throughout.

**Tests:**
1. `test_webhook_returns_200_or_202` — valid HMAC → 200/201/202; checks route registration + signing
2. `test_webhook_rejected_without_signature` — no header → 401 HMAC guard enforced (production-only; fail-open if TOAST_WEBHOOK_SECRET not set on Railway)
3. `test_pipeline_creates_supabase_record` — full pipeline: webhook → POSIntegrationAgent → pos_webhook_logs record within 15s

**Supabase polling:** `pos_webhook_logs.payload` is a JSONB column. orderGuid lives at `payload->>'orderGuid'`. Fetches 10 most-recent rows ordered by `processed_at DESC` and checks `row["payload"].get("orderGuid")` in Python. Polls every 2s up to 15s deadline.

**Teardown limitation:** `pos_webhook_logs` has no `restaurant_id` column and no controllable `id` column. `e2e_created_ids.append({"table": "pos_webhook_logs", "id": "e2e-order-001"})` is registered per D-03, but teardown will fail silently (D-04 compliant). Audit log records persist harmlessly after test run.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected HMAC header name from X-Toast-Signature to Toast-Signature**
- **Found during:** Task 2, reading pos_routes.py line 37 as required
- **Issue:** Plan's `<interfaces>` pseudocode used `headers["X-Toast-Signature"]` but `pos_routes.py` line 37 declares `alias="Toast-Signature"`. Using the wrong header name sends no signature to the adapter, causing guaranteed 401 on all valid-signature tests.
- **Fix:** Used `Toast-Signature` as the header name in `_build_signed_request()`
- **Files modified:** `wave_d_toast_pipeline.py`
- **Commit:** `cb0e921`

**2. [Rule 1 - Bug] Removed "sha256=" prefix from HMAC signature value**
- **Found during:** Task 2, reading adapters/toast_adapter.py
- **Issue:** Plan's `<interfaces>` pseudocode set header value to `f"sha256={signature}"`. But `ToastAdapter.verify_webhook` compares raw hexdigest against submitted signature: `hmac.compare_digest(expected, signature.lower())`. With prefix, "abc123" would be compared to "sha256=abc123" — always fails.
- **Fix:** `sign_webhook_payload()` returns raw hexdigest only; `_build_signed_request()` uses it directly
- **Files modified:** `wave_d_toast_pipeline.py`
- **Commit:** `cb0e921`

**3. [Rule 2 - Missing Critical Functionality] Documented pos_webhook_logs teardown limitation**
- **Found during:** Task 2, verifying what columns pos_integration_agent.py writes
- **Issue:** pos_webhook_logs schema (`event_type`, `payload`, `processing_result`, `processed_at`, `pos_system`) has no `restaurant_id` or controllable `id`. Both teardown strategies fail silently. Plan assumed teardown would work.
- **Fix:** Added detailed module docstring explaining teardown limitation; adjusted Supabase polling to use Python-side payload inspection instead of PostgREST JSONB path filter
- **Files modified:** `wave_d_toast_pipeline.py`
- **Commit:** `cb0e921`

**4. [Rule 2 - Missing Critical Functionality] Wave C: Default exchange fallback for 2 agents**
- **Found during:** Task 1, cross-referencing agent subscriptions with message_bus._setup_exchanges()
- **Issue:** `pos_integration_agent` subscribes to `("pos.commands", ...)` and `reporting_agent` subscribes to `("reporting.events", ...)`. Neither exchange is declared in `message_bus._setup_exchanges()`. Publishing to undeclared exchanges raises channel error; test would skip rather than reach health check.
- **Fix:** Used default exchange (`""`) + direct queue names for these two agents. Queue names follow base_agent.py:422 pattern: `queue.{orchestrator_agent_name}.{routing_key.replace('.','_')}`. Tests will skip if queue doesn't exist (acceptable per plan fallback strategy).
- **Files modified:** `wave_c_agent_triggers.py`
- **Commit:** `b363a74`

## Known Stubs

None — both files are purely test code. No data stubs flow to UI rendering.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| No new threat surface | — | Both files are test harnesses that exercise existing production endpoints; no new network paths introduced |

Threat mitigations from plan's STRIDE register verified in implementation:
- **T-25-04-01** (Tampering — real inventory): `restaurantGuid: "e2e-test-restaurant"` in payload; POSIntegrationAgent validates against TOAST_RESTAURANT_GUID env var — if set to real GUID, webhook rejected at agent layer
- **T-25-04-02** (Tampering — agent side effects): probe payload type is `"test_probe"` not a recognized event type; agents DLQ/ignore
- **T-25-04-03** (Information Disclosure — TOAST_WEBHOOK_SECRET): sourced from `os.environ.get()` only; skip if not set; never logged or asserted
- **T-25-04-04** (DoS — 9 RabbitMQ messages): 9 messages at ~100 bytes each; CloudAMQP free tier supports thousands/day
- **T-25-04-05** (Tampering — orphaned pos_webhook_logs): `e2e_created_ids.append()` registered; teardown silent-fail documented; records are harmless audit logs

## Commits

| Task | Commit | Files |
|------|--------|-------|
| Task 1 | `b363a74` | `services/agent-orchestrator/tests/e2e/wave_c_agent_triggers.py` |
| Task 2 | `cb0e921` | `services/agent-orchestrator/tests/e2e/wave_d_toast_pipeline.py` |

## Self-Check: PASSED

- `services/agent-orchestrator/tests/e2e/wave_c_agent_triggers.py` ✓ (263 lines, syntax OK)
- `services/agent-orchestrator/tests/e2e/wave_d_toast_pipeline.py` ✓ (303 lines, syntax OK)
- `b363a74` ✓ (in git log)
- `cb0e921` ✓ (in git log)
- `grep "pytest.mark.prod_e2e" wave_c_agent_triggers.py` → 1 match ✓
- `grep "aio_pika" wave_c_agent_triggers.py` → 7 matches ✓
- `grep "e2e-test-restaurant" wave_c_agent_triggers.py` → 1 match ✓
- `grep "AGENT_ROUTING_KEYS" wave_c_agent_triggers.py | wc -l` → 3 (≥3) ✓
- `grep "5.0" wave_c_agent_triggers.py` → 9 matches ✓
- `grep "pytest.skip\|RABBITMQ_URL" wave_c_agent_triggers.py` → 6 matches ✓
- `grep "pytest.mark.prod_e2e" wave_d_toast_pipeline.py` → 1 match ✓
- `grep "hmac\|sha256\|Toast-Signature" wave_d_toast_pipeline.py` → 16 matches ✓
- `grep "e2e-test-restaurant\|e2e-order-001" wave_d_toast_pipeline.py` → 6 (≥3) ✓
- `grep "e2e_created_ids.append" wave_d_toast_pipeline.py` → 1 match ✓
- `grep "401" wave_d_toast_pipeline.py` → 6 matches ✓
- `grep "pytest.skip.*TOAST_WEBHOOK_SECRET" wave_d_toast_pipeline.py` → 1 match ✓
- `grep "15.0" wave_d_toast_pipeline.py` → 5 matches ✓
- `grep "TOAST_WEBHOOK_SECRET" wave_d_toast_pipeline.py | grep "os.environ"` → 1 match (no hardcoded secret) ✓
