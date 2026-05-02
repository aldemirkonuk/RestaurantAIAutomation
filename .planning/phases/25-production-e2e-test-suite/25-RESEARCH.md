# Phase 25: Production E2E Test Suite — Research

**Researched:** 2026-05-01
**Domain:** Production E2E testing — pytest + aio-pika + Playwright + GitHub Actions
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Tests run against **live production** (Vercel frontend + Railway agent-orchestrator + Supabase production DB), not a staging stack.
- **D-02:** Isolation via a **permanent dedicated test restaurant** — `restaurant_id: "e2e-test-restaurant"` always exists in the DB and is the anchor for all test writes.
- **D-03:** **Create-and-teardown with permanent baseline** — each test run creates fresh records, runs assertions, then deletes them in a teardown hook. The `e2e-test-restaurant` anchor record is never deleted.
- **D-04:** Teardown is mandatory; if teardown fails, log orphaned record IDs to Sentry with tag `e2e-orphan: true`. Do not fail the test suite on teardown failure.
- **D-05:** Tests must be idempotent — use deterministic IDs like `"e2e-wine-001"`, `"e2e-order-001"` with upserts on create.
- **D-06:** Dedicated service account user: `e2e-test@wineops.internal`. Created once, never deleted.
- **D-07:** CI logs in via Supabase Auth REST (`POST /auth/v1/token?grant_type=password`). Credentials in GitHub Actions secrets: `E2E_TEST_EMAIL`, `E2E_TEST_PASSWORD`.
- **D-08:** ADMIN_API_KEY used for admin-only endpoints. Wave A tests use both user JWT and admin key.
- **D-09:** Playwright `@playwright/test`. Runs headless Chromium in CI.
- **D-10:** Wave F pass bar: login redirect succeeds, `/admin/health` shows 9 agent cards (≥7 healthy), dashboard loads within 5s, one data-write flow via `/studio` → review queue → teardown.
- **D-11:** Playwright tests live in `apps/web/e2e/`.
- **D-12:** Nightly cron at 02:00 UTC via GitHub Actions.
- **D-13:** Also triggered on successful production deploy via Vercel deploy hook → GitHub Actions `workflow_dispatch`.
- **D-14:** Nightly = observability only. Deploy-triggered = blocking: fails → Sentry alert `deploy-gate: true` + PR comment.
- **D-15:** Continue-all-waves — all 7 waves run regardless of prior wave failures.
- **D-16:** End-of-suite cascading failure report: groups failures by root cause with `suggested_fix` annotation per cluster, derived from wave dependency graph.
- **D-17:** Wave dependency graph: A→B→C (sequential dependencies); D depends on A+B; E independent; F independent; G depends on E.
- **D-18:** JUnit XML output format, extending `report_generator.py`. Already used in existing test infra.
- **D-19:** Target: full suite completes in < 10 minutes. Waves B, C run in parallel; A, D, E, F, G run sequentially.

### Claude's Discretion
- Internal structure of pytest fixtures for auth token caching (get fresh JWT once per session, not per test)
- Specific retry logic for flaky production network calls (recommend: 3 retries with exponential backoff, 2s base)
- Exact Playwright selector strategy for frontend smoke tests
- How to implement the wave dependency graph in the report generator

### Deferred Ideas (OUT OF SCOPE)
- Automatic rollback on E2E failure — requires separate architectural decision
- Staging environment — decided against for now
- Per-agent load testing — belongs in a future performance phase
</user_constraints>

---

<phase_requirements>
## Phase Requirements

> TEST-PROD-01..12 are not yet written in REQUIREMENTS.md (the file references them but they aren't defined). They are derived here from the ROADMAP success criteria and CONTEXT.md. The planner should add them to REQUIREMENTS.md as part of Plan 25-01.

| ID | Description | Research Support |
|----|-------------|------------------|
| TEST-PROD-01 | Wave A — API contract: all `/api/v1/` endpoints return expected HTTP status codes with valid JWT | `conftest_prod.py` session-scoped JWT; httpx for async HTTP; 9 registered routers in `main.py` |
| TEST-PROD-02 | Wave B — Agent health: each of the 9 agents returns `healthy: true` via `/api/v1/health/agents` | `health_routes.py` `/api/v1/health/agents`; X-Admin-Key auth pattern documented |
| TEST-PROD-03 | Wave C — Agent trigger: each agent can be triggered via a test RabbitMQ message and acknowledges within 5s | `aio-pika` already in `requirements.prod.txt`; RabbitMQ URL in Railway env vars |
| TEST-PROD-04 | Wave D — Toast pipeline: test webhook → POSIntegrationAgent → InventoryEngine → NotificationAgent with staging data | Existing `pos_routes.py`; HMAC signing pattern in `ngrok_live_test.py` |
| TEST-PROD-05 | Wave E — Gmail pipeline: test email send (low stock alert) + delivery confirmed via Supabase log | `notification_deliveries` table; SMTP confirmed via Phase 23 |
| TEST-PROD-06 | Wave F — Frontend smoke (Playwright): login, `/admin/health` cards visible, dashboard loads, one write-flow | Playwright config exists at `apps/web/playwright.config.ts`; auth flow in `auth.setup.ts` |
| TEST-PROD-07 | Wave G — Calendar: create test event → reminder email sent within the next scheduled window | `CalendarAgent` live on Railway; Google Calendar API credential available via Phase 23 |
| TEST-PROD-08 | All test results exported as JUnit XML for CI ingestion | `--junitxml` pytest flag or `report_generator.py` extension; GitHub Actions uploads via `actions/upload-artifact` |
| TEST-PROD-09 | Failures trigger Sentry alert automatically | Sentry already initialized in `main.py`; `e2e-failure` and `deploy-gate` tags via `sentry_sdk.capture_message` |
| TEST-PROD-10 | Test suite runs in < 10 minutes total | Waves B+C parallel via `pytest-xdist` or `asyncio.gather`; 10-min GitHub Actions timeout |
| TEST-PROD-11 | Nightly cron (02:00 UTC) + deploy-triggered blocking run via Vercel hook → `workflow_dispatch` | New `e2e-prod.yml` GitHub Actions workflow; `workflow_dispatch` inputs for `triggered_by` and `deploy_url` |
| TEST-PROD-12 | Create-and-teardown test data with permanent `e2e-test-restaurant` anchor; idempotent via upserts | Supabase upsert pattern with `on_conflict`; session-scoped teardown fixture |
</phase_requirements>

---

## Summary

Phase 25 adds a seven-wave production E2E harness that hits the live Railway + Vercel + Supabase stack with no mocks. The technical work has two distinct parts: (1) a new pytest conftest (`conftest_prod.py`) and seven wave test files in `services/agent-orchestrator/tests/e2e/` that test the backend API and agent pipeline, and (2) updated Playwright tests in `apps/web/e2e/` that hit the production Vercel URL.

The biggest architectural decision is already made: this is a **parallel conftest**. `conftest_prod.py` coexists with `conftest_e2e.py` and is the only file that hits live infrastructure. The existing mock-based tests stay untouched. This avoids contaminating the 627-test mock suite that currently passes cleanly.

The primary runtime patterns are: session-scoped JWT caching (one Supabase Auth REST call per CI session), deterministic test IDs with upserts (idempotent reruns), mandatory-but-non-blocking teardown with Sentry orphan reporting, and a custom cascading failure report that overlays the wave dependency graph onto test results.

**Primary recommendation:** Use pytest's built-in `--junitxml` flag for JUnit XML output rather than extending `report_generator.py` for XML. Extend `report_generator.py` only for the cascading dependency report (JSON/markdown). This avoids duplicating JUnit XML logic that pytest already handles perfectly.

---

## Standard Stack

### Core (Python — Waves A–G backend tests)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `pytest` | 7.4.4 (installed) | Test runner | Already the project test framework |
| `pytest-asyncio` | latest | Async test functions | Required for `asyncio_mode = auto` (already in `pytest.ini`) |
| `httpx` | >=0.27 | Async HTTP client for API calls | Preferred over `requests` for async; production test calls must be async |
| `aio-pika` | 9.4.0 (in `requirements.prod.txt`) | RabbitMQ message publish (Wave C) | Already a project dependency; no new dep needed |
| `sentry-sdk` | >=2.0.0 (in prod) | Capture E2E failure events | Already integrated; just add tags |
| `supabase` | >=2.10.0 (in prod) | Supabase auth REST + DB teardown | Already the project DB client |
| `pyjwt` | installed (in conftest_e2e.py) | JWT decode for assertions | Already used in mock tests |

### Core (TypeScript — Wave F Playwright)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@playwright/test` | `^1.49.1` (in `devDependencies`) | Browser automation | Already installed; project decision D-09 |
| Chromium | bundled with Playwright | Headless browser for CI | Default Playwright browser; CI-compatible |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pytest-xdist` | latest | Parallel wave execution (B+C) | Enables `pytest -n 2` for concurrent agent health + trigger waves |
| `tenacity` | latest | Retry with exponential backoff | Fluent API for 3-retry/2s-backoff pattern on production network calls |
| `junit-xml` | latest | Programmatic JUnit XML from Python | Only if report_generator.py needs to merge multiple wave results into one XML; otherwise use `--junitxml` directly |

**Version verification:** [ASSUMED] for `pytest-xdist` and `tenacity` — install with `pip install pytest-xdist tenacity` to get latest. `httpx` latest is `0.27.x` as of early 2026 [ASSUMED].

**Installation:**
```bash
# In services/agent-orchestrator/
pip install pytest-xdist tenacity httpx

# @playwright/test already in apps/web/devDependencies
# Run browser install in CI:
npx playwright install --with-deps chromium
```

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `httpx` (async) | `requests` (sync) | `requests` would require `asyncio.run()` wrappers in async test functions — more boilerplate |
| `tenacity` for retries | Manual retry loop | `tenacity` gives exponential backoff, jitter, and hooks with 3 lines vs 15; reduces retry bugs |
| `--junitxml` pytest flag | Extending `report_generator.py` to emit XML | `--junitxml` is battle-tested and CI-native; don't hand-roll JUnit XML serialization |

---

## Architecture Patterns

### Recommended Project Structure

```
services/agent-orchestrator/tests/e2e/
├── conftest_e2e.py              # EXISTING — mock-only, DO NOT MODIFY
├── conftest_prod.py             # NEW — live production fixtures (JWT, Supabase, teardown)
├── report_generator.py          # EXISTING — extend for cascading report only
├── wave_a_api_contracts.py      # Wave A: all /api/v1/ endpoints, status codes
├── wave_b_agent_health.py       # Wave B: /api/v1/health/agents per-agent healthy: true
├── wave_c_agent_triggers.py     # Wave C: RabbitMQ publish per agent, ack within 5s
├── wave_d_toast_pipeline.py     # Wave D: webhook → POS → Inventory → Notification chain
├── wave_e_gmail_pipeline.py     # Wave E: email send + delivery confirmation
├── wave_g_calendar.py           # Wave G: test event → reminder email

apps/web/e2e/
├── auth.setup.ts                # EXISTING — mock auth (local dev only)
├── prod-auth.setup.ts           # NEW — real Supabase login for production Playwright run
├── prod-smoke.spec.ts           # NEW — Wave F: login, /admin/health, dashboard, write-flow
├── smoke.spec.ts                # EXISTING — local smoke (untouched)
```

### Pattern 1: Session-Scoped JWT Fixture (conftest_prod.py)

**What:** One Supabase Auth REST call per CI session; JWT stored in fixture scope and shared across all tests.
**When to use:** Every wave that calls an authenticated endpoint.

```python
# Source: Supabase Auth REST documentation (POST /auth/v1/token)
import httpx
import pytest

@pytest.fixture(scope="session")
async def prod_jwt(anyio_backend="asyncio") -> str:
    """Get fresh JWT from Supabase Auth REST once per CI session."""
    import os
    url = f"{os.environ['SUPABASE_URL']}/auth/v1/token?grant_type=password"
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            url,
            json={
                "email": os.environ["E2E_TEST_EMAIL"],
                "password": os.environ["E2E_TEST_PASSWORD"],
            },
            headers={"apikey": os.environ["SUPABASE_ANON_KEY"]},
            timeout=30.0,
        )
        resp.raise_for_status()
    return resp.json()["access_token"]
```

### Pattern 2: Idempotent Upsert + Mandatory Teardown (conftest_prod.py)

**What:** Create test records with deterministic IDs using upserts; track created IDs; delete in teardown hook; orphan-report to Sentry if teardown fails.
**When to use:** Any wave that writes to Supabase (Waves D, E, G, and Wave A studio write).

```python
# Source: Supabase Python client upsert documentation [CITED: supabase.com/docs/reference/python/upsert]
import sentry_sdk
from supabase import create_client

@pytest.fixture(scope="session")
def prod_supabase():
    import os
    return create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

@pytest.fixture(scope="session")
def e2e_created_ids():
    """Registry of (table, id) pairs created this run — used by teardown."""
    return []  # mutable list, populated by individual test fixtures

@pytest.fixture(scope="session", autouse=True)
def teardown_e2e_records(prod_supabase, e2e_created_ids):
    """Session teardown: delete all e2e-created records."""
    yield
    failed_deletes = []
    for table, record_id in e2e_created_ids:
        try:
            prod_supabase.table(table).delete().eq("id", record_id).execute()
        except Exception as exc:
            failed_deletes.append({"table": table, "id": record_id, "error": str(exc)})
    if failed_deletes:
        # D-04: log orphans to Sentry, do NOT raise
        sentry_sdk.capture_message(
            "E2E teardown: orphaned records",
            level="warning",
            tags={"e2e-orphan": "true"},
            extras={"orphaned_records": failed_deletes},
        )
```

### Pattern 3: Retry Decorator for Flaky Production Calls

**What:** Exponential backoff with 3 retries and 2s base delay.
**When to use:** All `httpx` calls in Wave A–D, all RabbitMQ publish/ack checks.

```python
# Source: tenacity docs [CITED: tenacity.readthedocs.io]
from tenacity import retry, stop_after_attempt, wait_exponential

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    reraise=True,
)
async def call_with_retry(client: httpx.AsyncClient, url: str, **kwargs):
    return await client.get(url, **kwargs)
```

### Pattern 4: RabbitMQ Agent Trigger (Wave C)

**What:** Publish a minimal test message to the routing key each agent subscribes to; poll `decision_log` or health endpoint for acknowledgement within 5s.
**When to use:** Wave C only — agent trigger tests.

```python
# Source: aio-pika docs [CITED: aio-pika.readthedocs.io]
import aio_pika, asyncio, json, os

async def trigger_agent(routing_key: str, payload: dict, rabbitmq_url: str):
    connection = await aio_pika.connect_robust(rabbitmq_url, timeout=10)
    async with connection:
        channel = await connection.channel()
        await channel.default_exchange.publish(
            aio_pika.Message(
                body=json.dumps(payload).encode(),
                content_type="application/json",
            ),
            routing_key=routing_key,
        )
```

### Pattern 5: Wave Execution with Continue-All (pytest markers)

**What:** Each wave has a `pytest.mark.wave_X` marker. Waves run as separate test invocations or via marker-based collection. A top-level runner script invokes all waves sequentially (or B+C in parallel) and aggregates results.
**When to use:** The CI GitHub Actions job orchestrates waves; the runner captures exit codes without `--exitfirst` to implement D-15 continue-all-waves.

```bash
# In GitHub Actions step — continue on wave failure, collect all results
pytest tests/e2e/wave_a_api_contracts.py --junitxml=results/wave_a.xml || true
pytest tests/e2e/wave_b_agent_health.py tests/e2e/wave_c_agent_triggers.py \
  -n 2 --junitxml=results/wave_bc.xml || true
pytest tests/e2e/wave_d_toast_pipeline.py --junitxml=results/wave_d.xml || true
pytest tests/e2e/wave_e_gmail_pipeline.py --junitxml=results/wave_e.xml || true
pytest tests/e2e/wave_g_calendar.py --junitxml=results/wave_g.xml || true
# Playwright Wave F runs separately
cd apps/web && npx playwright test prod-smoke.spec.ts \
  --reporter=junit --output=test-results/wave_f.xml || true
```

### Pattern 6: Cascading Failure Report Generation

**What:** Post-suite Python script reads all wave XML results, cross-references the wave dependency graph (D-17), groups failures by cluster, annotates with `suggested_fix`, writes `cascading_report.json` + posts to PR as comment (D-16).

Wave dependency graph (baked into the report script):
```python
WAVE_DEPS = {
    "B": ["A"],       # Agent health depends on API contracts
    "C": ["B"],       # Agent triggers depend on agent health
    "D": ["A", "B"],  # Toast pipeline depends on API + agent health
    "G": ["E"],       # Calendar depends on Gmail
    "A": [],          # Independent
    "E": [],          # Independent
    "F": [],          # Independent
}

SUGGESTED_FIXES = {
    ("A",): "Check JWT validity and ADMIN_API_KEY env var in Railway. Run: GET /health → must return 200.",
    ("B",): "Check if RabbitMQ is connected. GET /api/v1/health/agents should return 9 agents.",
    ("A", "B", "D"): "Wave A auth failure cascaded. Fix Wave A first — Waves B and D likely auto-recover.",
    ("E", "G"): "Gmail SMTP failure (Wave E) blocked calendar reminders (Wave G). Check GMAIL_USER/PASSWORD env vars.",
}
```

### Pattern 7: Playwright Production Config

**What:** A separate Playwright project config (or env-driven override) that sets `baseURL` to the production Vercel URL and uses real Supabase credentials for auth.
**When to use:** Wave F only. The existing `playwright.config.ts` targets `http://127.0.0.1:5173` (local dev). Production run must point to `VERCEL_PRODUCTION_URL`.

```typescript
// apps/web/e2e/prod-smoke.spec.ts — production-targeted Wave F test
// Uses process.env.E2E_BASE_URL set to production Vercel URL in CI
// Existing playwright.config.ts already reads E2E_BASE_URL:
//   baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:5173'
// No new config file needed — just set E2E_BASE_URL in the Actions env.

import { test, expect } from '@playwright/test'

test('Wave F: login redirects successfully', async ({ page }) => {
  // Real Supabase login — credentials from GitHub Actions secrets
  await page.goto('/login')
  await page.fill('[data-testid="email"]', process.env.E2E_TEST_EMAIL!)
  await page.fill('[data-testid="password"]', process.env.E2E_TEST_PASSWORD!)
  await page.click('[data-testid="login-submit"]')
  await expect(page).toHaveURL(/\/(dashboard|admin)?/, { timeout: 10000 })
})
```

### Anti-Patterns to Avoid

- **`PYTEST_RUNNING=1` set during production tests:** Context: `main.py` line 27 — if `PYTEST_RUNNING` is set, Sentry is disabled. Production E2E tests MUST fire Sentry. Never set this env var in `e2e-prod.yml`.
- **Modifying `conftest_e2e.py`:** All production fixtures go in the new `conftest_prod.py`. The 627-test mock suite must stay green.
- **Single JWT shared across wave sessions:** The JWT should be session-scoped (refreshed once per `pytest` invocation), not module-scoped per wave file — otherwise parallel waves B+C might race on token expiry.
- **Failing the suite on teardown error:** D-04 mandates teardown errors go to Sentry silently. `assert` in teardown will propagate as a test failure and hide actual test results.
- **Using real ADMIN_API_KEY in Wave F Playwright tests:** ADMIN_API_KEY must never reach browser JS. Wave F calls through the api-gateway proxy (which adds the key server-side). Playwright tests only set the user JWT in localStorage.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JUnit XML report | Custom XML serializer in `report_generator.py` | `pytest --junitxml=path/report.xml` | pytest's built-in flag is CI-native, handles classpath, timestamps, and failure messages per spec |
| Exponential backoff with jitter | Manual `time.sleep()` loop | `tenacity.retry(wait=wait_exponential(...))` | Edge cases: no jitter → thundering herd; tenacity handles this correctly |
| Parallel test execution | `asyncio.gather()` in a custom runner | `pytest-xdist -n 2` | xdist handles worker isolation, result aggregation, and graceful degradation |
| Playwright Chromium install | Custom browser download script | `npx playwright install --with-deps chromium` | Official Playwright command handles OS dependencies (libgbm, libatk, etc.) on Ubuntu CI runners |
| Supabase JWT auth | Custom PKCE or direct JWT crafting | Supabase Auth REST `POST /auth/v1/token?grant_type=password` | Password grant is the correct flow for service accounts in server-to-server auth contexts |

**Key insight:** The production test harness is entirely infrastructure plumbing — every sub-problem (HTTP client, retry, parallel execution, report format, browser auth) has a battle-tested library. The only custom code required is the wave orchestration logic, the cascading failure report, and the Sentry notification hook.

---

## Common Pitfalls

### Pitfall 1: Sentry Disabled in Production Tests
**What goes wrong:** Tests run, failures occur, but no Sentry alert fires. CI appears to succeed (green) because the suite passes, but the failure notification is silent.
**Why it happens:** `main.py` line 27 suppresses Sentry when `PYTEST_RUNNING` or `PYTEST_CURRENT_TEST` is in `os.environ`. If the CI workflow sets either variable (e.g., from an inherited env or an accidental `PYTEST_RUNNING=1`), Sentry init is skipped.
**How to avoid:** `e2e-prod.yml` must NOT set `PYTEST_RUNNING`. Sentry should be initialized in the test runner process separately — use `sentry_sdk.init()` at the top of `conftest_prod.py` with the production DSN. This is a separate init from the FastAPI app's Sentry (different process, same DSN).
**Warning signs:** `sentry_sdk.Hub.current.client` is None after `conftest_prod.py` loads → Sentry not initialized.

### Pitfall 2: Auth Token Expiry During Long Suite
**What goes wrong:** Wave A passes (JWT valid). By Wave D or E (8-9 minutes in), the token has expired → 401 errors on all subsequent authenticated calls.
**Why it happens:** Supabase JWTs default to 1-hour expiry. If the fixture scope is wrong (e.g., function-scoped), or if tests are long, the token may expire mid-suite.
**How to avoid:** The session-scoped fixture acquires the JWT at session start. Supabase JWTs are 1 hour — the < 10 minute suite guarantee (D-19) means expiry is not a real risk. But: if the 10-minute cap is ever exceeded, implement token refresh in the fixture using `refresh_token` from the auth response.
**Warning signs:** `401 Unauthorized` appearing after Wave A passes cleanly.

### Pitfall 3: RabbitMQ Topology Missing on Test Exchanges
**What goes wrong:** Wave C publishes to a routing key, but the exchange/queue binding doesn't exist yet in the production RabbitMQ instance → message silently dropped, `ack` never arrives.
**Why it happens:** Agents only declare their queues on startup when connected to RabbitMQ. If an agent is stopped or has never connected to the production broker, its queue binding doesn't exist.
**How to avoid:** Wave C should be preceded by Wave B (D-17 dependency graph). Wave B confirms all 9 agents are `healthy: true` — which implies they have connected and declared their queues. If Wave B fails, the cascading report correctly flags Wave C as "likely caused by Wave B failure."
**Warning signs:** Wave B reports an agent as not healthy, and that agent's Wave C trigger also fails.

### Pitfall 4: Playwright `webServer` Stanza Starts Dev Server Against Production URL
**What goes wrong:** The existing `playwright.config.ts` has a `webServer` block that runs `pnpm dev`. In CI, if `E2E_BASE_URL` is set to the production Vercel URL but the `webServer` stanza isn't suppressed, Playwright will try to start a local dev server AND run against production simultaneously → port conflicts, false test results.
**Why it happens:** Playwright's `webServer.reuseExistingServer: !process.env.CI` means it tries to start a server when `CI=true`. The existing config unconditionally starts the dev server.
**How to avoid:** The new `e2e-prod.yml` should set `CI=true` (standard) and ensure `E2E_BASE_URL` is set. Update `playwright.config.ts` to skip the `webServer` stanza when `E2E_BASE_URL` points to a non-localhost URL. Alternatively, create a separate `playwright.prod.config.ts` that omits `webServer` entirely.
**Warning signs:** Playwright reports "starting web server" in CI logs when it should be targeting the production URL.

### Pitfall 5: Deterministic IDs Collide with Real Data
**What goes wrong:** An `e2e-wine-001` record already exists from a failed teardown of a previous run → upsert updates it correctly, but the `e2e_created_ids` registry doesn't include it (it was created in a prior session) → teardown skips it → orphaned record persists.
**Why it happens:** D-05 specifies upserts for idempotency, which is correct. But the registry for teardown is session-local.
**How to avoid:** Use a **tag-based teardown** as the primary cleanup mechanism, not just ID-based. All e2e records should have a field like `source: "e2e"` or `restaurant_id: "e2e-test-restaurant"`. End-of-session cleanup does `DELETE WHERE restaurant_id = 'e2e-test-restaurant' AND id LIKE 'e2e-%'` (except the anchor itself). This catches records from failed prior sessions too.
**Warning signs:** Growing count of `e2e-wine-*` records in Supabase between runs.

### Pitfall 6: GitHub Actions `workflow_dispatch` Has No PR Context
**What goes wrong:** Deploy-triggered run fails, and the "post a comment on the triggering PR" step fails because `workflow_dispatch` runs don't inherently have a PR number.
**Why it happens:** Vercel deploy hooks trigger `workflow_dispatch` with custom inputs, not with PR context. The `GITHUB_REF` is the branch, not a PR number.
**How to avoid:** Pass `pr_number` and `deploy_url` as `workflow_dispatch` inputs from the Vercel hook payload. The Vercel deploy hook can include the PR number in the payload body if it's a PR deploy. For production branch deploys (not PRs), skip the PR comment and only fire Sentry + Slack.
**Warning signs:** `Error: Resource not accessible by integration` on the PR comment step.

---

## Code Examples

### JWT Acquisition via Supabase Auth REST

```python
# Source: Supabase Auth REST API [CITED: supabase.com/docs/reference/javascript/auth-signinwithpassword]
import httpx, os

async def get_supabase_jwt() -> str:
    url = f"{os.environ['SUPABASE_URL']}/auth/v1/token?grant_type=password"
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            url,
            json={
                "email": os.environ["E2E_TEST_EMAIL"],
                "password": os.environ["E2E_TEST_PASSWORD"],
            },
            headers={
                "apikey": os.environ["SUPABASE_ANON_KEY"],
                "Content-Type": "application/json",
            },
            timeout=30.0,
        )
        resp.raise_for_status()
    data = resp.json()
    return data["access_token"]
```

### Wave A API Contract Test Pattern

```python
# Source: httpx async client pattern [ASSUMED — standard httpx usage]
import httpx, pytest

@pytest.mark.asyncio
async def test_quality_review_queue_requires_auth(prod_base_url: str):
    """GET /api/v1/quality/review-queue without JWT → 401."""
    async with httpx.AsyncClient(base_url=prod_base_url) as client:
        resp = await client.get("/api/v1/quality/review-queue")
    assert resp.status_code == 401

@pytest.mark.asyncio
async def test_quality_review_queue_with_jwt(prod_base_url: str, prod_jwt: str):
    """GET /api/v1/quality/review-queue with valid JWT → 200."""
    async with httpx.AsyncClient(
        base_url=prod_base_url,
        headers={"Authorization": f"Bearer {prod_jwt}"},
    ) as client:
        resp = await client.get("/api/v1/quality/review-queue")
    assert resp.status_code in (200, 204)
```

### JUnit XML + Sentry Failure Hook

```python
# Source: sentry_sdk capture_message docs [CITED: docs.sentry.io/platforms/python/usage]
# In conftest_prod.py pytest hook:
import sentry_sdk

def pytest_runtest_logreport(report):
    """Fire Sentry on production test failure (TEST-PROD-09)."""
    if report.when == "call" and report.failed:
        sentry_sdk.capture_message(
            f"E2E Production Test Failed: {report.nodeid}",
            level="error",
            tags={
                "e2e-failure": "true",
                "deploy-gate": os.environ.get("TRIGGERED_BY_DEPLOY", "false"),
                "wave": _extract_wave(report.nodeid),
            },
        )
```

### GitHub Actions Workflow Structure (e2e-prod.yml)

```yaml
name: Production E2E Tests

on:
  schedule:
    - cron: '0 2 * * *'       # D-12: nightly 02:00 UTC
  workflow_dispatch:            # D-13: triggered by Vercel deploy hook
    inputs:
      triggered_by_deploy:
        type: boolean
        default: false
      deploy_url:
        type: string
        default: ''
      pr_number:
        type: string
        default: ''

jobs:
  e2e-prod:
    runs-on: ubuntu-latest
    timeout-minutes: 15         # Hard cap — Sentry fires e2e-timeout if exceeded
    env:
      SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
      SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
      SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
      E2E_TEST_EMAIL: ${{ secrets.E2E_TEST_EMAIL }}
      E2E_TEST_PASSWORD: ${{ secrets.E2E_TEST_PASSWORD }}
      ADMIN_API_KEY: ${{ secrets.ADMIN_API_KEY }}
      RAILWAY_ORCHESTRATOR_URL: ${{ secrets.RAILWAY_ORCHESTRATOR_URL }}
      RABBITMQ_URL: ${{ secrets.RABBITMQ_URL }}
      SENTRY_DSN: ${{ secrets.SENTRY_DSN }}
      E2E_BASE_URL: ${{ secrets.VERCEL_PRODUCTION_URL }}
      TRIGGERED_BY_DEPLOY: ${{ inputs.triggered_by_deploy }}
      # CRITICAL: DO NOT set PYTEST_RUNNING here — disables Sentry in app
```

---

## Runtime State Inventory

> This phase is greenfield test infrastructure addition. No renames, refactors, or migrations.

**Skip condition applied:** Phase 25 adds new files only. The permanent `e2e-test-restaurant` anchor record does not yet exist in production Supabase — this is a **one-time setup task** that Plan 25-01 must include.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `e2e-test-restaurant` anchor record — does NOT yet exist in production `restaurants` table (or equivalent) | Plan 25-01 must include a migration or setup script to insert the anchor record |
| Live service config | `e2e-test@wineops.internal` Supabase Auth user — does NOT yet exist in production Supabase Auth | Plan 25-01 must include a one-time user creation script (Supabase Admin API or Dashboard) |
| OS-registered state | None — no new OS-level registrations | None |
| Secrets/env vars | `E2E_TEST_EMAIL`, `E2E_TEST_PASSWORD` — must be added as GitHub Actions secrets | Add to repo secrets before first CI run |
| Build artifacts | None — no compiled artifacts | None |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3.11 | pytest backend waves | ✓ | 3.11.0 | — |
| pytest | All backend waves | ✓ | 7.4.4 | — |
| httpx | Waves A–D (async HTTP) | ✗ | — | Install: `pip install httpx` |
| aio-pika | Wave C (RabbitMQ trigger) | ✓ | 9.4.0 (requirements.prod.txt) | — |
| tenacity | Retry logic | ✗ | — | Install: `pip install tenacity` |
| pytest-xdist | Waves B+C parallel | ✗ | — | Install: `pip install pytest-xdist` |
| @playwright/test | Wave F (frontend smoke) | ✓ | ^1.49.1 (devDependencies) | — |
| Chromium (Playwright) | Wave F | ✗ (not yet installed in CI) | — | CI step: `npx playwright install --with-deps chromium` |
| supabase-py | Fixture teardown | ✓ | >=2.10.0 (requirements.prod.txt) | — |
| sentry-sdk | E2E failure reporting | ✓ | >=2.0.0 (requirements.prod.txt) | — |
| Production Supabase | All waves | ✓ (Phase 22 live) | Cloud | — |
| Railway orchestrator | Waves A–D, G | ✓ (Phase 22 live) | 9/9 agents active | — |
| CloudAMQP RabbitMQ | Wave C | ✓ (Phase 22 live) | amqps:// | — |
| Vercel frontend | Wave F | ✓ (Phase 22 live) | latest deploy | — |
| Gmail SMTP | Wave E | ✓ (Phase 23 live) | wineops.ai@gmail.com | — |
| Google Calendar API | Wave G | ✓ (Phase 23 live) | OAuth2 refresh token | — |

**Missing dependencies requiring install steps:**
- `httpx` — needed by all backend waves; add to `requirements.test.txt` or install in CI
- `tenacity` — retry logic; same
- `pytest-xdist` — parallel B+C execution; same

**Missing dependencies with setup steps (one-time):**
- `e2e-test@wineops.internal` Supabase Auth user — create once in production
- `e2e-test-restaurant` anchor record in Supabase
- GitHub Actions secrets: `E2E_TEST_EMAIL`, `E2E_TEST_PASSWORD`

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework (Python) | pytest 7.4.4 |
| Config file | `services/agent-orchestrator/pytest.ini` (existing, `asyncio_mode = auto`) |
| Quick run command | `pytest tests/e2e/wave_a_api_contracts.py -x -q` |
| Full backend suite | `pytest tests/e2e/ --junitxml=test-results/e2e-prod.xml -q` |
| Playwright command | `cd apps/web && npx playwright test prod-smoke.spec.ts` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TEST-PROD-01 | All `/api/v1/` endpoints return expected status codes with valid JWT | integration | `pytest tests/e2e/wave_a_api_contracts.py -x` | ❌ Wave 0 |
| TEST-PROD-02 | 9 agents return `healthy: true` via `/api/v1/health/agents` | integration | `pytest tests/e2e/wave_b_agent_health.py -x` | ❌ Wave 0 |
| TEST-PROD-03 | Each agent can be triggered via RabbitMQ + acknowledges | integration | `pytest tests/e2e/wave_c_agent_triggers.py -x` | ❌ Wave 0 |
| TEST-PROD-04 | Toast webhook → full agent pipeline runs | integration | `pytest tests/e2e/wave_d_toast_pipeline.py -x` | ❌ Wave 0 |
| TEST-PROD-05 | Email send + delivery log confirmed in Supabase | integration | `pytest tests/e2e/wave_e_gmail_pipeline.py -x` | ❌ Wave 0 |
| TEST-PROD-06 | Login, `/admin/health` cards, dashboard, write-flow | e2e (Playwright) | `npx playwright test prod-smoke.spec.ts` | ❌ Wave 0 |
| TEST-PROD-07 | Test calendar event → reminder email sent | integration | `pytest tests/e2e/wave_g_calendar.py -x` | ❌ Wave 0 |
| TEST-PROD-08 | JUnit XML exported for all waves | infra | included in all wave commands via `--junitxml` | ❌ Wave 0 |
| TEST-PROD-09 | Sentry alert on test failure | infra | `pytest_runtest_logreport` hook in `conftest_prod.py` | ❌ Wave 0 |
| TEST-PROD-10 | Suite completes in < 10 minutes | performance | GitHub Actions `timeout-minutes: 15` + Sentry on timeout | ❌ Wave 0 |
| TEST-PROD-11 | Nightly cron + deploy-triggered workflow | CI | `.github/workflows/e2e-prod.yml` | ❌ Wave 0 |
| TEST-PROD-12 | Create-and-teardown with permanent anchor + idempotent upserts | infra | Session teardown fixture in `conftest_prod.py` | ❌ Wave 0 |

### Sampling Rate
- **Per wave:** `pytest {wave_file} --junitxml=results/{wave}.xml -q`
- **Phase gate:** All 7 wave XML files green + cascading report generated before `/gsd-verify-work`

### Wave 0 Gaps (all files to create)
- [ ] `services/agent-orchestrator/tests/e2e/conftest_prod.py` — session JWT, teardown, Sentry init
- [ ] `services/agent-orchestrator/tests/e2e/wave_a_api_contracts.py` — covers TEST-PROD-01
- [ ] `services/agent-orchestrator/tests/e2e/wave_b_agent_health.py` — covers TEST-PROD-02
- [ ] `services/agent-orchestrator/tests/e2e/wave_c_agent_triggers.py` — covers TEST-PROD-03
- [ ] `services/agent-orchestrator/tests/e2e/wave_d_toast_pipeline.py` — covers TEST-PROD-04
- [ ] `services/agent-orchestrator/tests/e2e/wave_e_gmail_pipeline.py` — covers TEST-PROD-05
- [ ] `services/agent-orchestrator/tests/e2e/wave_g_calendar.py` — covers TEST-PROD-07
- [ ] `apps/web/e2e/prod-smoke.spec.ts` — covers TEST-PROD-06 (Wave F Playwright)
- [ ] `apps/web/playwright.prod.config.ts` — production baseURL, no webServer stanza
- [ ] `.github/workflows/e2e-prod.yml` — covers TEST-PROD-11
- [ ] `services/agent-orchestrator/scripts/setup_e2e_anchor.py` — one-time: create `e2e-test-restaurant` anchor + `e2e-test@wineops.internal` service account
- [ ] `services/agent-orchestrator/scripts/cascading_report.py` — covers TEST-PROD-16 (cascading failure report with `suggested_fix`)
- [ ] `services/agent-orchestrator/requirements.test.txt` (or update `requirements.prod.txt`) — add `httpx`, `tenacity`, `pytest-xdist`

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase Auth REST password grant; service account with least privilege |
| V3 Session Management | yes | JWT session-scoped fixture; no token persistence to disk |
| V4 Access Control | yes | `ADMIN_API_KEY` stored only in GitHub Actions secrets; never in test code |
| V5 Input Validation | no | Test harness sends valid payloads by design |
| V6 Cryptography | no | No custom crypto; Supabase/HMAC handles crypto |

### Known Threat Patterns for E2E Production Test Harness

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| GitHub Actions secret leakage | Information Disclosure | Use `${{ secrets.X }}` syntax; never echo secrets; mask via `::add-mask::` |
| JWT stored in test artifacts | Information Disclosure | Never include `Authorization` headers in JUnit XML output (existing `report_generator.py` T-14-01 already does this) |
| Production data contamination | Tampering | `restaurant_id: "e2e-test-restaurant"` anchor + deterministic `e2e-*` ID prefix isolates all test records |
| Sentry DSN exposed in logs | Information Disclosure | SENTRY_DSN read from env var only; never hardcoded in test files |
| `e2e-test@wineops.internal` over-privileged | Elevation of Privilege | Service account should have the minimum role required for Wave A–G tests; review required role set before creating the account |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Mock-based E2E (`conftest_e2e.py`) | Live production tests (`conftest_prod.py`) | Phase 25 | Catches production deployment regressions not visible in mock tests |
| JSON report only (`report_generator.py`) | JUnit XML via `--junitxml` + cascading JSON report | Phase 25 | CI systems (GitHub Actions, Datadog CI Visibility) consume JUnit natively |
| No nightly CI health check | Nightly 02:00 UTC cron E2E | Phase 25 | Proactive detection of production drift between deploys |
| Manual post-deploy verification | Automated blocking deploy-gate E2E | Phase 25 | Regressions caught before users see them |

**Deprecated/outdated:**
- `conftest_e2e.py` `E2E_JWT_SECRET = "e2e-secret"` pattern: correct for mock tests, never use for production tests. Production fixtures always call Supabase Auth REST.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `httpx` latest stable is `0.27.x` as of 2026-05 | Standard Stack | Install gets newer version — no regression risk, httpx is stable |
| A2 | Supabase `e2e-test-restaurant` will be a row in a `restaurants` table (or equivalent) | Runtime State Inventory | If the anchor table name is different, setup script needs adjustment |
| A3 | `e2e-test@wineops.internal` service account needs only the "user" role (not admin) for Waves A, E, F, G | Security Domain | If some endpoints require elevated roles, conftest needs to handle both JWT and ADMIN_API_KEY more carefully |
| A4 | Wave G (Calendar) can create a test event whose reminder fires within a reasonable polling window (< 5 min) | Validation Architecture | CalendarAgent fires reminders at T-7, T-2, T-1 days. Wave G may need to use a backdated event or stub the calendar trigger rather than wait for a real reminder |
| A5 | `pytest-xdist` is compatible with `asyncio_mode = auto` from existing `pytest.ini` | Standard Stack | Some versions of pytest-xdist conflict with asyncio_mode=auto; may need `@pytest.mark.asyncio` explicitly on parallel tests |
| A6 | `notification_deliveries` Supabase table tracks email sends for Wave E verification | Code Examples | If delivery logging is not in Supabase but only in logs, Wave E must poll logs instead |
| A7 | Toast pipeline test (Wave D) can use a test HMAC-signed webhook without the real Toast restaurant GUID | Common Pitfalls | The real `TOAST_RESTAURANT_GUID` is the friend's restaurant (DEP-06). Wave D needs a test GUID or must use the production one carefully |

---

## Open Questions

1. **Wave G Calendar timing — how to verify a reminder was sent without waiting 7 days?**
   - What we know: `CalendarAgent` fires reminders at T-7, T-2, T-1 relative to event date.
   - What's unclear: Wave G can't wait 7 days in a 10-minute test suite.
   - Recommendation: Create a test event dated `today + 7 days` so a T-7 reminder is due immediately, OR call an internal `CalendarAgent` trigger endpoint if one exists, OR verify the reminder was scheduled (row in `calendar_events` table) rather than actually delivered. Flag this for the planner to resolve via a `GET /api/v1/health/agents/calendar_agent` check with a test event assertion.

2. **Wave D Toast webhook — which TOAST_RESTAURANT_GUID to use?**
   - What we know: The live restaurant GUID belongs to the friend's restaurant (DEP-06 confirmed). A test webhook with the wrong GUID may be rejected.
   - What's unclear: Whether `POSIntegrationAgent` validates the restaurant GUID against the Toast API or just processes the event structure.
   - Recommendation: Use `restaurant_id: "e2e-test-restaurant"` in the webhook payload body and bypass the GUID validation, OR create a test GUID in the Railway env vars. Planner should check `pos_integration_agent.py` to see if GUID validation is structural.

3. **TEST-PROD-01..12 not defined in REQUIREMENTS.md**
   - What we know: They're referenced in `ROADMAP.md` but not written out in `REQUIREMENTS.md`.
   - What's unclear: Whether the planner should add them to REQUIREMENTS.md as Plan 25-01 or treat CONTEXT.md success criteria as sufficient.
   - Recommendation: Plan 25-01 should add TEST-PROD-01..12 to REQUIREMENTS.md (copy from ROADMAP + CONTEXT) so traceability is maintained.

---

## Sources

### Primary (HIGH confidence)
- `services/agent-orchestrator/main.py` — FastAPI app entry, Sentry init guard, all 9 routers confirmed
- `services/agent-orchestrator/api/health_routes.py` — X-Admin-Key auth pattern, `/api/v1/health/agents` response shape
- `services/agent-orchestrator/tests/e2e/conftest_e2e.py` — existing fixture patterns to mirror in `conftest_prod.py`
- `services/agent-orchestrator/tests/e2e/report_generator.py` — JSON report plugin structure to extend
- `apps/web/playwright.config.ts` — existing Playwright setup, `E2E_BASE_URL` already supported
- `apps/web/package.json` — `@playwright/test ^1.49.1` confirmed in devDependencies
- `.github/workflows/deploy.yml` — existing CI structure to extend
- `.planning/STATE.md` — 9 agent names confirmed: pos integration, buffer manager, inventory engine, inequality detector, state invariant enforcer, notification, procurement, calendar, reporting

### Secondary (MEDIUM confidence)
- Supabase Auth REST `POST /auth/v1/token?grant_type=password` — standard service account auth pattern per Supabase documentation [CITED: supabase.com/docs/reference/javascript/auth-signinwithpassword]
- aio-pika async publish pattern — confirmed via `requirements.prod.txt` version 9.4.0 and existing `MessageBus` usage in `core/message_bus.py` [ASSUMED usage pattern based on aio-pika docs]

### Tertiary (LOW confidence)
- `pytest-xdist` compatibility with `asyncio_mode = auto` — [ASSUMED] based on general pytest ecosystem knowledge; needs verification before Wave 0
- Wave G calendar timing workaround — [ASSUMED] based on CalendarAgent behavior described in Phase 23; confirm actual reminder schedule logic before implementing Wave G

---

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — all libraries verified against project files and known versions
- Architecture: HIGH — derived directly from locked CONTEXT.md decisions and existing code patterns
- Pitfalls: MEDIUM — Pitfalls 1, 2, 4 are HIGH (verified from code); Pitfalls 3, 5, 6 are MEDIUM (architectural reasoning)
- Wave G implementation: LOW — timing strategy unresolved (Open Question 1)

**Research date:** 2026-05-01
**Valid until:** 2026-06-01 (stable library ecosystem; Supabase/Railway/Vercel API surface stable)
