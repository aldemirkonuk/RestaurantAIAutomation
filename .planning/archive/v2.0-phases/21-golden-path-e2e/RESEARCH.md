# Phase 21: Golden Path E2E — Research

**Researched:** 2026-04-11
**Domain:** Multi-agent event-driven wiring (RabbitMQ, FastAPI, pytest-asyncio, ngrok)
**Confidence:** HIGH — all findings from direct codebase inspection

---

## Summary

Phase 21 wires the full 4-agent pipeline — POSIntegrationAgent → BufferManager → InventoryEngine → NotificationAgent + ReportingAgent — and proves it works with real Toast data. The good news: the RabbitMQ topology is already declared in `MessageBus._setup_exchanges()`, all 4 agents are implemented and registered as CORE tier, and the `BaseAgent.start()` lifecycle correctly calls `_setup_subscriptions()` which declares queues and starts consumers. The bad news: there are three concrete gaps to close before E2E is possible.

**Gap 1 (CRITICAL): No FastAPI webhook route.** `POST /api/v1/pos/webhook/toast` does not exist anywhere in `api/`. The `POSIntegrationAgent.process_toast_webhook()` method is complete, but nothing calls it from HTTP. A new `api/pos_routes.py` file must be created and registered in `main.py`.

**Gap 2 (CRITICAL): `main.py` has no startup lifecycle.** The `AgentOrchestrator` and `MessageBus` are never instantiated on app start. There is no `lifespan` context manager, no `@app.on_event("startup")`, no connection to RabbitMQ. The agents exist as code but never run. A `lifespan` hook must be added to `main.py`.

**Gap 3 (CRITICAL): `config/settings.py` is incomplete.** `orchestrator.py` reads `self.settings.toast_api_url`, `self.settings.mock_pos`, `self.settings.rabbitmq_url`, `self.settings.plivo_auth_id`, etc. — but the 119-line `Settings` class does not define any of these. The class must be extended before the orchestrator can instantiate.

**Gap 4 (ROUTING MISMATCH): InventoryEngine does not subscribe to `pos.events`.** The requirement says `POSSaleCompleted → InventoryEngine decrements stock`. But `InventoryEngine.get_subscribed_routing_keys()` subscribes only to `("stock.events", "stock.evaluated")` — not `pos.events`. The actual path is: POSIntegrationAgent publishes `pos.sale.completed` → **BufferManager** subscribes to it and publishes `stock.evaluated` → InventoryEngine processes it. This is intentional (Buffer Manager is the intermediary) but the E2E-v2-02 requirement must reflect this chain.

**Gap 5 (NOTIFICATION ROUTING MISMATCH): NotificationAgent does not subscribe to `stock.state.changed`.** The requirement says NotificationAgent subscribes to `stock.state.changed`. But `NotificationAgent.get_subscribed_routing_keys()` subscribes to `("stock.events", "stock.threshold.breached")` and `("stock.events", "stock.critical")`. InventoryEngine publishes `stock.state.changed`; the Buffer Manager publishes `stock.threshold.breached`. For the 30-second alert path, the Buffer Manager's threshold breach event is what triggers notifications, not the InventoryEngine's state change.

**Primary recommendation:** Before writing any integration tests, close the three critical gaps in the order: Settings → lifespan → webhook route. Then the integration test simply POSTs a webhook and asserts the chain.

---

## Research Questions — Detailed Findings

### Q1: RabbitMQ Topology — Already Declared, Queues Created on Agent Start

**Where exchanges are declared:** `core/message_bus.py`, `MessageBus._setup_exchanges()`, lines 426–456.

Exchanges declared on `MessageBus.connect()`:
| Exchange | Type | Durable |
|----------|------|---------|
| `pos.events` | TOPIC | yes |
| `stock.events` | TOPIC | yes |
| `procurement.events` | TOPIC | yes |
| `notification.events` | TOPIC | yes |
| `report.events` | TOPIC | yes |
| `system.control` | TOPIC | yes |
| `broadcast` | FANOUT | yes |
| `dlx.main` | TOPIC | yes (DLX) |

Dead-letter infrastructure (DLX + `queue.dead_letters`) is also declared in `_setup_dead_letter_infrastructure()`, lines 458–488.

**Where queues are declared:** Each agent declares its own queues on `agent.start()` via `BaseAgent._setup_subscriptions()` (lines 417–440). Queue naming pattern: `queue.{agent_name}.{routing_key_with_dots_replaced_by_underscores}`.

Example: POSIntegrationAgent subscribes to `("pos.commands", "pos.sync.manual")` → declares queue `queue.pos_integration_agent.pos_commands_pos_sync_manual`.

**E2E-critical routing keys and their current subscriber queues:**

| Publisher | Exchange | Routing Key | Subscriber Agent |
|-----------|----------|-------------|-----------------|
| POSIntegrationAgent | `pos.events` | `pos.sale.completed` | BufferManagerAgent |
| BufferManager | `stock.events` | `stock.evaluated` | InventoryEngineAgent |
| BufferManager | `stock.events` | `stock.threshold.breached` | NotificationAgent |
| InventoryEngine | `stock.events` | `stock.state.changed` | InequalityDetectorAgent, AutoPilotAgent |

**Key finding:** No queue for `stock.state.changed` is bound to NotificationAgent or ReportingAgent. The requirement E2E-v2-03 saying "NotificationAgent subscribes to stock.state.changed" is inaccurate — it subscribes to `stock.threshold.breached`. ReportingAgent subscribes to `("reporting.events", "reporting.generate_scheduled_report")` only — it has no subscription to stock events at all. E2E-v2-04 ("all stock events → ReportingAgent") is also inaccurate as currently implemented.

**No action needed for exchange declaration** — they are created when `MessageBus.connect()` is called. **Queues are created when each agent starts** via `_setup_subscriptions()`. No separate `on_startup` topology script is needed beyond calling `start_all_agents()`.

---

### Q2: FastAPI Webhook Endpoint — Does NOT Exist

**Finding:** No file in `api/` handles POS webhooks. The directory contains:
- `onboarding_routes.py`, `quality_routes.py`, `research_routes.py`, `scan_routes.py`, `analytics_routes.py`, `studio_routes.py`, `admin_routes.py`, `collection_routes.py`, `templates_routes.py`

None contain `pos`, `webhook`, or `toast` references (confirmed by grep of all `api/` files).

**What needs to be created:** `api/pos_routes.py` with a single endpoint:

```python
# api/pos_routes.py
from fastapi import APIRouter, Request, Header, HTTPException
from typing import Optional
from core.orchestrator import get_orchestrator  # singleton accessor needed

router = APIRouter(prefix="/api/v1/pos", tags=["POS Integration"])

@router.post("/webhook/toast")
async def toast_webhook(
    request: Request,
    toast_signature: Optional[str] = Header(None, alias="Toast-Signature"),
):
    raw_payload = await request.body()
    webhook_data = await request.json()
    
    orchestrator = get_orchestrator()
    agent = orchestrator.agents.get("pos_integration_agent")
    if not agent:
        raise HTTPException(503, "POS agent not running")
    
    result = await agent.process_toast_webhook(
        webhook_data=webhook_data,
        signature=toast_signature,
        raw_payload=raw_payload,
    )
    return result
```

Then register in `main.py`:
```python
from api.pos_routes import router as pos_router
app.include_router(pos_router)
```

---

### Q3: Agent Startup Wiring — Orchestrator Exists, lifespan Missing

**What exists:** `core/orchestrator.py` — `AgentOrchestrator` with `initialize()`, `start_all_agents()`, `stop_all_agents()`. All 4 E2E agents are registered as `AgentTier.CORE` in `core/agent_registry.py` `DEFAULT_AGENT_SPECS` (lines 48–57). CORE agents start eagerly via `start_all_agents()`.

**What is missing:** `main.py` has no `lifespan` context manager and no `@app.on_event` hooks. The orchestrator is never instantiated. There is no singleton accessor for the orchestrator. The app runs and serves routes but no agents are active.

**Pattern needed:**

```python
# main.py additions
from contextlib import asynccontextmanager
from core.orchestrator import AgentOrchestrator
from core.message_bus import MessageBus, set_message_bus
from config.settings import get_settings

_orchestrator: Optional[AgentOrchestrator] = None

def get_orchestrator() -> AgentOrchestrator:
    return _orchestrator

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _orchestrator
    settings = get_settings()
    bus = MessageBus(rabbitmq_url=settings.rabbitmq_url)  # needs this attr
    await bus.connect()
    set_message_bus(bus)
    _orchestrator = AgentOrchestrator(message_bus=bus, settings=settings)
    await _orchestrator.initialize()
    await _orchestrator.start_all_agents()
    yield
    await _orchestrator.stop_all_agents()
    await bus.disconnect()

app = FastAPI(..., lifespan=lifespan)
```

**Startup order for the 4 E2E agents** (from `DEFAULT_AGENT_SPECS` dependency graph):
1. `pos_integration_agent` (no deps)
2. `notification_agent` (no deps)
3. `reporting_agent` (no deps)
4. `buffer_manager` (no deps)
5. `inventory_engine` (depends on buffer_manager)

All 5 start eagerly as CORE. The `AgentOrchestrator.start_all_agents()` already resolves dependency order via `registry.get_startup_order()`.

---

### Q4: Integration Test Approach

**Existing test infrastructure:**
- `pytest.ini`: `asyncio_mode = auto`, `testpaths = tests`
- `tests/conftest.py`: shared fixtures including `mock_supabase_client`, `mock_rabbitmq_connection`, `event_loop` (session-scoped)
- `tests/e2e/` directory exists with `conftest_e2e.py` (currently for studio E2E)
- `pytest-asyncio==0.23.3` installed in venv

**Recommended approach:** In-process mocked integration test (no real RabbitMQ needed for CI).

The existing unit tests in `test_pos_integration_hardening.py` already demonstrate the pattern: mock `message_bus.publish`, mock `_check_idempotency`, call `agent.process_toast_webhook()` directly, assert publish calls.

For a **full pipeline integration test**, the approach is:

1. Create all 4 agents with `AsyncMock` message buses
2. Wire them together: agent A's publish mock calls agent B's `_enqueue_message` directly
3. POST a mock Toast webhook payload to POSIntegrationAgent
4. Assert InventoryEngine received the `stock.evaluated` message
5. Assert NotificationAgent received `stock.threshold.breached`

This approach avoids needing a real RabbitMQ instance and runs in < 5 seconds.

**For real-broker integration tests** (tagged `@pytest.mark.integration`): Use a local RabbitMQ (Docker) and a real `MessageBus` instance. Connect all 4 agents, POST the webhook, use `asyncio.wait_for()` with 5-second timeout to poll for expected database state.

**Sample Toast webhook payload for tests:**
```python
MOCK_TOAST_ORDER = {
    "order_guid": "test-order-001",
    "event_type": "OrderCompleted",
    "eventType": "OrderCompleted",
    "data": {
        "order": {
            "guid": "test-order-001",
            "restaurantGuid": "e5d6d489-25fa-4082-9cad-3e9e74225517",  # from .env
            "closedDate": "2026-04-11T19:30:00Z",
            "selections": [
                {
                    "guid": "sel-001",
                    "itemGroup": {"name": "Opus One 2019"},
                    "menuGroup": {"name": "Bottle Wine", "category": "Bottle Wine"},
                    "quantity": 1,
                    "preDiscountPrice": 45000,  # cents
                    "voided": False,
                }
            ]
        }
    }
}
```

---

### Q5: Chaos Test Approach

**E2E-v2-06 chaos scenarios and test classification:**

| Scenario | Test Type | Approach |
|----------|-----------|---------|
| Kill agent mid-flow → saga resumes | Unit | Mock `complete_saga`, assert `compensate_saga` called; `_handle_incomplete_webhook` already has saga pattern |
| RabbitMQ disconnect 30s → buffer → reconnect | Integration (real broker) | `aio_pika`'s `connect_robust` handles reconnect natively; test: pause Docker container 30s, assert messages processed after reconnect |
| Supabase 503 → circuit breaker trips | Unit | Mock DB to raise HTTPError 3×, assert `CircuitBreaker.state == CircuitState.OPEN` |
| Malformed webhook → DLQ capture | Unit | POST `{"not": "valid"}` to webhook handler, assert returned `{"status": "error"}`, assert no publish called |
| 100 concurrent webhooks → no race conditions | Integration | `asyncio.gather(*[agent.process_toast_webhook(payload_i) for i in range(100)])`, assert idempotency keys prevent duplicates |

**What's already built:**
- Circuit breaker: `core/message_bus.py` `CircuitBreaker` class (lines 151–243), trips at 5 failures
- Saga: `BaseAgent.start_saga()`, `advance_saga()`, `compensate_saga()` — already used in `_handle_incomplete_webhook()`
- DLQ: `MessageBus._setup_dead_letter_infrastructure()` declares `queue.dead_letters` bound to `dlx.main`
- Idempotency: `BaseAgent._check_idempotency()` with Redis-backed dedup
- RabbitMQ reconnect: `aio_pika.connect_robust()` with `reconnect_interval=5` (line 392)

**What needs to be written:** The test file `tests/test_e2e_golden_path.py` with the 6 scenarios above. The chaos tests for saga, circuit breaker, malformed webhook, and concurrent webhooks can all be pure unit/async tests using the existing mock patterns. The reconnect test requires a real broker and should be `@pytest.mark.integration`.

---

### Q6: ngrok Integration for Live Data Test

**ngrok not installed** on this machine (confirmed: `command -v ngrok` returns empty).

**Install options:**
```bash
# macOS via Homebrew
brew install ngrok/ngrok/ngrok
# or download binary: https://ngrok.com/download
```

**Minimal wiring for real-data test with friend's restaurant:**

1. Start the FastAPI app locally (after closing the gaps above):
   ```bash
   cd services/agent-orchestrator
   uvicorn main:app --host 0.0.0.0 --port 8000
   ```

2. Start ngrok tunnel:
   ```bash
   ngrok http 8000
   ```
   ngrok outputs a public URL like `https://abc123.ngrok.io`

3. Configure Toast webhook in their Toast restaurant dashboard:
   - URL: `https://abc123.ngrok.io/api/v1/pos/webhook/toast`
   - Events: OrderCompleted, OrderItemVoided
   - Secret: Set `TOAST_WEBHOOK_SECRET` in `.env` and in Toast dashboard (for HMAC)

4. For historical order import (E2E-v2-05): use the Toast Orders API directly:
   ```bash
   curl -X GET "https://ws-api.toasttab.com/orders/v2/ordersBulk" \
     -H "Authorization: Bearer {token}" \
     -H "Toast-Restaurant-External-ID: e5d6d489-25fa-4082-9cad-3e9e74225517"
   ```
   Then POST each order to the local webhook endpoint to simulate ingestion.

**ngrok free tier limitation:** tunnel URLs are ephemeral and change on restart. For a demo, this is fine. The restaurant needs to update the Toast webhook URL each session.

**Alternative without ngrok:** Use Toast sandbox environment (`mock_mode: false`, `toast_environment: sandbox` from `.env`) and trigger test orders from Toast Developer Portal.

---

### Q7: Gaps to Close — Prioritized List

**Gap 1: `config/settings.py` is missing 15+ attributes.** [CRITICAL — blocks all other gaps]

`orchestrator.py` reads these attributes that do not exist in `Settings`:
- `settings.rabbitmq_url`
- `settings.supabase_service_role_key`
- `settings.environment`
- `settings.debug`
- `settings.toast_api_url`
- `settings.toast_client_id`
- `settings.toast_client_secret`
- `settings.toast_restaurant_guid`
- `settings.toast_webhook_secret`
- `settings.toast_environment`
- `settings.mock_pos`
- `settings.buffer_window_minutes`
- `settings.default_threshold_min`
- `settings.llm_primary_model`
- `settings.llm_temperature`
- `settings.plivo_auth_id`, `plivo_auth_token`, `plivo_phone_number`
- `settings.email_backend`, `gmail_user`, `gmail_password`, `sendgrid_api_key`, `from_email`
- `settings.vapid_private_key`, `vapid_public_key`, `vapid_email`, `fcm_server_key`
- `settings.mock_notifications`

All values exist in `.env` — they just need `os.getenv()` bindings in `Settings.__init__()`.

**Gap 2: `main.py` has no lifespan hook.** [CRITICAL — agents never start]

The entire `AgentOrchestrator` + `MessageBus` startup sequence is absent. No route currently has access to agent instances.

**Gap 3: No `POST /api/v1/pos/webhook/toast` route.** [CRITICAL — E2E-v2-01 cannot be triggered]

`api/pos_routes.py` does not exist. Must be created and registered.

**Gap 4: No singleton accessor for orchestrator.** [Needed for webhook route]

The webhook route needs to get the running `POSIntegrationAgent` instance. An `_orchestrator` module-level singleton with a `get_orchestrator()` function is the clean pattern.

**Gap 5: E2E test file does not exist.** [Required for E2E-v2-05 and E2E-v2-06]

`tests/test_e2e_golden_path.py` does not exist. Must be created with the 6 requirement scenarios.

**Gap 6: Routing mismatch in requirements.** [Documentation only — no code change]

- E2E-v2-02 says "InventoryEngine subscribes to pos.events" — it subscribes to `stock.evaluated` via BufferManager intermediary. The full chain is: POSIntegrationAgent → `pos.sale.completed` → BufferManagerAgent → `stock.evaluated` → InventoryEngineAgent.
- E2E-v2-03 says "stock.state.changed → NotificationAgent". Actually: BufferManager → `stock.threshold.breached` → NotificationAgent.
- E2E-v2-04 says ReportingAgent subscribes to stock events. It does not — it only handles scheduled report generation triggers.

---

## Standard Stack

### Core
| Library | Version | Purpose |
|---------|---------|---------|
| aio-pika | 9.4.0 | RabbitMQ async client — already in venv |
| fastapi | (in venv) | HTTP layer for webhook endpoint |
| pytest-asyncio | 0.23.3 | Async test runner — already configured |
| redis | 5.0.1 | Idempotency persistence — already in venv |

### For ngrok live test
| Tool | Version | Install |
|------|---------|---------|
| ngrok | latest | `brew install ngrok/ngrok/ngrok` |

---

## Architecture Patterns

### Agent Event Chain (actual, not as-stated in requirements)

```
HTTP POST /api/v1/pos/webhook/toast
    ↓
POSIntegrationAgent.process_toast_webhook()
    ↓ publish pos.sale.completed → pos.events
BufferManagerAgent (accumulates in 30-min window)
    ↓ on window evaluation: publish stock.evaluated → stock.events
InventoryEngineAgent._handle_stock_evaluated()
    ↓ UPDATE inventory_stock SET stock_live = ?
    ↓ publish stock.state.changed → stock.events  [consumed by InequalityDetector, AutoPilot]
    
ALSO (parallel from BufferManager):
BufferManagerAgent (when stock < threshold_min):
    ↓ publish stock.threshold.breached → stock.events
NotificationAgent._handle_stock_threshold_breached()
    ↓ SMS/email alert within 30s of threshold breach
```

### Lifespan Pattern

```python
# main.py
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    settings = get_settings()
    bus = MessageBus(rabbitmq_url=settings.rabbitmq_url)
    await bus.connect()
    set_message_bus(bus)
    _orchestrator = AgentOrchestrator(bus, settings)
    await _orchestrator.initialize()
    await _orchestrator.start_all_agents()
    app.state.orchestrator = _orchestrator
    yield
    # Shutdown
    await _orchestrator.stop_all_agents()
    await bus.disconnect()
```

### Queue Naming Convention (from BaseAgent._setup_subscriptions)

```
queue.{agent_name}.{routing_key.replace('.', '_')}
```

Example: InventoryEngineAgent subscribing to `stock.evaluated` from `stock.events`:
→ queue name: `queue.inventory_engine.stock_evaluated`

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| RabbitMQ reconnect | Manual reconnect loop | `aio_pika.connect_robust()` — already used |
| Message retry | Custom retry counter | `MessageBus.consume()` already tracks `x-retry-count` header, dead-letters at 3 attempts |
| Circuit breaker | Custom failure counter | `CircuitBreaker` in `message_bus.py` — already wired to MessageBus.publish |
| Idempotency | Custom dict | `BaseAgent._check_idempotency()` + Redis — already built |
| Saga state | Custom state machine | `BaseAgent.start_saga()` / `advance_saga()` / `compensate_saga()` — already built |
| Webhook HMAC | Custom signature check | `POSIntegrationAgent.verify_webhook_signature()` — already built |

---

## Common Pitfalls

### Pitfall 1: Forgetting BufferManager as intermediary
**What goes wrong:** Writing a test that expects `InventoryEngine` to react immediately to `pos.sale.completed`. It won't — BufferManager batches sales over a 30-minute window before publishing `stock.evaluated`.
**How to avoid:** In integration tests, either (a) mock BufferManager to flush immediately by calling `_evaluate_buffer()` directly, or (b) configure `buffer_window_minutes=0` in test config.

### Pitfall 2: Settings class AttributeError at orchestrator init
**What goes wrong:** `AgentOrchestrator.__init__` calls `_build_feature_flags(settings)` which checks `hasattr(settings, 'features')` — that attribute doesn't exist in current `Settings`. Then `_get_agent_config()` reads `self.settings.toast_api_url` etc. causing `AttributeError` at runtime.
**How to avoid:** Extend `config/settings.py` first, in Wave 0, before any other work.

### Pitfall 3: AgentConfig rejects unknown keys
**What goes wrong:** `BaseAgent.__init__` does `self.config = AgentConfig(name=agent_name, **config)`. If the `config` dict passed by `_get_agent_config()` contains keys not defined in `AgentConfig` (e.g., `toast_api_url`), Pydantic will raise a `ValidationError`.
**How to avoid:** `AgentConfig` uses `model_config = ConfigDict(extra='ignore')` — verify this is set, or add it. The `POSIntegrationAgent.__init__` separately reads the raw `config` dict before calling `super().__init__()`, which is safe.

### Pitfall 4: mock_mode=True skips HMAC verification
**What goes wrong:** `POSIntegrationAgent.process_toast_webhook()` only verifies the signature when `mock_mode=False` (line 178). In the real-data test with a live Toast restaurant, you must set `MOCK_POS=false` in `.env`.
**How to avoid:** Explicitly set `mock_mode=False` in the E2E real-data test config, and provide `TOAST_WEBHOOK_SECRET`.

### Pitfall 5: Duplicate queue declarations on restart
**What goes wrong:** `MessageBus.declare_queue()` checks `if queue_name in self.queues` and skips if already declared. But if the agent restarts (new `MessageBus` instance), queues are re-declared — this is fine because RabbitMQ is idempotent for `durable=True` queues with same arguments.
**Warning signs:** `aio_pika.exceptions.ChannelPreconditionFailed` if queue args differ between restarts (e.g., `x-max-priority` changed).

### Pitfall 6: ReportingAgent does not subscribe to stock events
**What goes wrong:** Implementing E2E-v2-04 by publishing `stock.state.changed` and expecting ReportingAgent to react. It won't — its subscriptions are only `reporting.events.*`.
**How to avoid:** Either add `("stock.events", "stock.state.changed")` to `ReportingAgent.get_subscribed_routing_keys()` and a handler, OR satisfy the requirement differently (e.g., the dashboard reads from the database directly — which is already updated by InventoryEngine).

---

## Code Examples

### Toast Webhook Test Payload (from `test_pos_integration_bugs.py` patterns)

```python
# Verified pattern — matches the shape POSIntegrationAgent.handle_order_completed() expects
GOLDEN_PATH_WEBHOOK = {
    "order_guid": "gp-order-001",
    "event_type": "OrderCompleted",
    "eventType": "OrderCompleted",
    "restaurant_id": "rest-001",
    "data": {
        "order": {
            "guid": "gp-order-001",
            "restaurantGuid": "e5d6d489-25fa-4082-9cad-3e9e74225517",
            "closedDate": "2026-04-11T19:30:00Z",
            "selections": [
                {
                    "guid": "sel-001",
                    "itemGroup": {"name": "Caymus Cabernet 2021"},
                    "menuGroup": {
                        "name": "Bottle Wine",
                        "category": "Bottle Wine",  # category takes priority for wine detection
                    },
                    "quantity": 1,
                    "preDiscountPrice": 12000,  # $120.00 in cents
                    "voided": False,
                }
            ]
        }
    }
}
```

### Integration Test Skeleton (in-process, no real broker)

```python
# tests/test_e2e_golden_path.py
import pytest
from unittest.mock import AsyncMock, MagicMock

@pytest.fixture
def pos_agent():
    bus = MagicMock()
    bus.publish = AsyncMock(return_value=True)
    db = MagicMock()
    db.supabase = MagicMock()
    agent = POSIntegrationAgent("pos_integration_agent", bus, db, {
        "mock_mode": True,
        "toast_webhook_secret": "test-secret",
    })
    agent._check_idempotency = AsyncMock(return_value=False)
    agent._mark_processed = AsyncMock()
    agent.log_decision = AsyncMock()
    agent.log_webhook_event = AsyncMock()
    agent.match_wine_to_library = AsyncMock(return_value="wine-uuid-001")
    agent.get_restaurant_id = AsyncMock(return_value="rest-uuid-001")
    return agent

@pytest.mark.asyncio
async def test_e2e_v2_01_pos_sale_completed_published(pos_agent):
    """E2E-v2-01: webhook → POSSaleCompleted published to pos.events"""
    result = await pos_agent.process_toast_webhook(GOLDEN_PATH_WEBHOOK)
    assert result["status"] == "success"
    pos_agent.message_bus.publish.assert_called_once()
    call_kwargs = pos_agent.message_bus.publish.call_args
    assert call_kwargs.kwargs["exchange_name"] == "pos.events"
    assert call_kwargs.kwargs["routing_key"] == "pos.sale.completed"
```

### Settings Extension Pattern

```python
# config/settings.py additions to Settings.__init__()
# Infrastructure
self.rabbitmq_url: str = os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/")
self.environment: str = os.getenv("ENVIRONMENT", "development")
self.debug: bool = os.getenv("DEBUG", "false").lower() == "true"
# Toast POS
self.toast_api_url: str = os.getenv("TOAST_API_URL", "https://ws-api.toasttab.com")
self.toast_client_id: Optional[str] = os.getenv("TOAST_CLIENT_ID")
self.toast_client_secret: Optional[str] = os.getenv("TOAST_CLIENT_SECRET")
self.toast_restaurant_guid: Optional[str] = os.getenv("TOAST_RESTAURANT_GUID")
self.toast_webhook_secret: Optional[str] = os.getenv("TOAST_WEBHOOK_SECRET")
self.toast_environment: str = os.getenv("TOAST_ENVIRONMENT", "sandbox")
self.mock_pos: bool = os.getenv("MOCK_POS", "true").lower() == "true"
# Agent config
self.buffer_window_minutes: int = int(os.getenv("BUFFER_WINDOW_MINUTES", "30"))
self.default_threshold_min: int = int(os.getenv("DEFAULT_THRESHOLD_MIN", "5"))
self.llm_primary_model: str = os.getenv("LLM_PRIMARY_MODEL", "gemini-2.5-flash")
self.llm_temperature: float = float(os.getenv("LLM_TEMPERATURE", "0.7"))
# Notifications
self.plivo_auth_id: Optional[str] = os.getenv("PLIVO_AUTH_ID")
self.plivo_auth_token: Optional[str] = os.getenv("PLIVO_AUTH_TOKEN")
self.plivo_phone_number: Optional[str] = os.getenv("PLIVO_PHONE_NUMBER")
self.email_backend: str = os.getenv("EMAIL_BACKEND", "gmail")
self.from_email: Optional[str] = os.getenv("FROM_EMAIL")
self.sendgrid_api_key: Optional[str] = os.getenv("SENDGRID_API_KEY")
self.vapid_private_key: Optional[str] = os.getenv("VAPID_PRIVATE_KEY")
self.vapid_public_key: Optional[str] = os.getenv("VAPID_PUBLIC_KEY")
self.vapid_email: Optional[str] = os.getenv("VAPID_EMAIL")
self.fcm_server_key: Optional[str] = os.getenv("FCM_SERVER_KEY")
self.mock_notifications: bool = os.getenv("MOCK_SMS", "true").lower() == "true"
self.supabase_service_role_key: Optional[str] = (
    os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
)
self.api_gateway_url: str = os.getenv("API_GATEWAY_URL", "http://localhost:4000")
```

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Redis | Idempotency, rate limiting | Yes | PONG response | In-memory dict fallback already built |
| RabbitMQ (local) | Message routing | Unknown (Docker not running in shell) | — | Mock bus for unit tests |
| aio-pika | MessageBus | Yes (venv) | 9.4.0 | — |
| pytest-asyncio | Integration tests | Yes (venv) | 0.23.3 | — |
| ngrok | Live Toast data test | NOT INSTALLED | — | Toast sandbox environment |
| Toast API credentials | Live test | Yes (in .env) | — | Mock mode |

**Missing dependencies with no fallback:**
- ngrok (for E2E-v2-05 live test) — install via `brew install ngrok/ngrok/ngrok` or use Toast sandbox

**Missing dependencies with fallback:**
- RabbitMQ local Docker — if not running, unit tests work with mock bus; integration tests require real broker

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest 7.4.4 + pytest-asyncio 0.23.3 |
| Config file | `services/agent-orchestrator/pytest.ini` |
| Quick run command | `pytest tests/test_e2e_golden_path.py -v -x` |
| Full suite command | `pytest tests/ -v --tb=short` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| E2E-v2-01 | Webhook → POSSaleCompleted published | unit/async | `pytest tests/test_e2e_golden_path.py::test_e2e_v2_01` | No — Wave 0 |
| E2E-v2-02 | POSSaleCompleted → BufferManager → stock.evaluated → InventoryEngine decrements | unit/async | `pytest tests/test_e2e_golden_path.py::test_e2e_v2_02` | No — Wave 0 |
| E2E-v2-03 | stock.threshold.breached → NotificationAgent → SMS within 30s | unit/async | `pytest tests/test_e2e_golden_path.py::test_e2e_v2_03` | No — Wave 0 |
| E2E-v2-04 | Stock events → ReportingAgent updates dashboard | unit/async | `pytest tests/test_e2e_golden_path.py::test_e2e_v2_04` | No — Wave 0 |
| E2E-v2-05 | Full golden path with real Toast data | manual | ngrok + curl | No — requires live setup |
| E2E-v2-06 chaos: kill agent | unit/async | `pytest tests/test_e2e_golden_path.py::test_chaos_saga_resume` | No — Wave 0 |
| E2E-v2-06 chaos: RabbitMQ disconnect | integration | `pytest tests/test_e2e_golden_path.py -m integration` | No — Wave 0 |
| E2E-v2-06 chaos: Supabase 503 | unit/async | `pytest tests/test_e2e_golden_path.py::test_chaos_circuit_breaker` | No — Wave 0 |
| E2E-v2-06 chaos: malformed webhook | unit/async | `pytest tests/test_e2e_golden_path.py::test_chaos_malformed_dlq` | No — Wave 0 |
| E2E-v2-06 chaos: 100 concurrent | unit/async | `pytest tests/test_e2e_golden_path.py::test_chaos_concurrent_100` | No — Wave 0 |

### Wave 0 Gaps
- [ ] `tests/test_e2e_golden_path.py` — covers all E2E-v2-* requirements
- [ ] `api/pos_routes.py` — the HTTP webhook receiver
- [ ] `config/settings.py` extended with 20+ missing attributes

---

## Open Questions

1. **ReportingAgent and E2E-v2-04**
   - What we know: ReportingAgent currently has no subscription to any stock exchange. Its subscriptions are `reporting.events.*` only.
   - What's unclear: Should E2E-v2-04 mean (a) add `("stock.events", "stock.state.changed")` subscription + handler to ReportingAgent, or (b) consider the requirement satisfied because InventoryEngine already writes to `inventory_stock` table which is what the dashboard queries?
   - Recommendation: Satisfy via (b) — dashboard reads from database, not from events. Update the requirement description to reflect this. Avoids adding a new subscription that's not in the agent's designed scope.

2. **Buffer window for E2E testing**
   - What we know: `buffer_window_minutes=30` from `.env`. The Buffer Manager holds sales for 30 minutes before evaluating.
   - What's unclear: Integration tests will hang for 30 minutes if using real Buffer Manager with default config.
   - Recommendation: Add `buffer_window_minutes` as an overridable config in `_get_agent_config()`, and in the integration test fixture set it to 0 or 1 second. The BufferManager has a `evaluation_interval_seconds=60` setting in orchestrator config that can be tuned.

3. **AgentConfig Pydantic validation with extra fields**
   - What we know: `BaseAgent.__init__` does `AgentConfig(name=agent_name, **config)` where config may contain agent-specific keys like `toast_api_url`.
   - What's unclear: Does `AgentConfig` have `model_config = ConfigDict(extra='ignore')`?
   - Recommendation: Verify this before Wave 1. If not, the orchestrator will fail on startup with a Pydantic `ValidationError`. Add `model_config = ConfigDict(extra='ignore')` to `AgentConfig` if missing.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `AgentConfig` accepts extra fields (extra='ignore') | Gap 3, Open Q3 | Orchestrator crashes on start with ValidationError; fix is one line |
| A2 | BufferManager flushes on configurable interval | Open Q2 | Integration tests hang 30 min; requires source inspection of buffer flush logic |

---

## Sources

### Primary (HIGH confidence — direct codebase inspection)
- `services/agent-orchestrator/core/message_bus.py` — exchange declarations, queue setup, circuit breaker, consume loop
- `services/agent-orchestrator/core/orchestrator.py` — agent registration, startup sequence, settings attribute references
- `services/agent-orchestrator/core/agent_registry.py` — CORE/ON_DEMAND tiers, dependency order
- `services/agent-orchestrator/core/base_agent.py` — `_setup_subscriptions()`, `start()` lifecycle, `_check_idempotency()`
- `services/agent-orchestrator/agents/pos_integration_agent.py` — `process_toast_webhook()`, `publish_wine_sale_event()`
- `services/agent-orchestrator/agents/inventory_engine.py` — `get_subscribed_routing_keys()` subscribes to `stock.evaluated` not `pos.events`
- `services/agent-orchestrator/agents/notification_agent.py` — `get_subscribed_routing_keys()` subscribes to `stock.threshold.breached` not `stock.state.changed`
- `services/agent-orchestrator/agents/reporting_agent.py` — `get_subscribed_routing_keys()` only `reporting.events.*`
- `services/agent-orchestrator/agents/buffer_manager.py` — subscribes to `pos.sale.completed`, publishes `stock.evaluated` and `stock.threshold.breached`
- `services/agent-orchestrator/main.py` — confirms NO lifespan, NO orchestrator instantiation, NO pos routes
- `services/agent-orchestrator/config/settings.py` — confirms missing attributes
- `services/agent-orchestrator/.env` — confirms RABBITMQ_URL, TOAST_API_URL, MOCK_POS=false present
- `services/agent-orchestrator/pytest.ini` — asyncio_mode=auto, testpaths=tests
- `services/agent-orchestrator/tests/conftest.py` — existing mock patterns
- `services/agent-orchestrator/tests/test_pos_integration_hardening.py` — test fixture patterns

### Secondary (MEDIUM confidence)
- `command -v redis-cli ping` → PONG — Redis available locally
- `venv/lib/python3.11/site-packages/` — aio_pika 9.4.0, pytest-asyncio 0.23.3 confirmed installed

---

## Metadata

**Confidence breakdown:**
- Gap identification: HIGH — confirmed by direct file inspection
- Routing chain: HIGH — traced through all 4 agents' `get_subscribed_routing_keys()`
- Test approach: HIGH — follows patterns in existing `test_pos_integration_hardening.py`
- ngrok wiring: MEDIUM — standard ngrok usage, not verified in this project before

**Research date:** 2026-04-11
**Valid until:** 2026-05-11 (stable stack, no fast-moving dependencies)
