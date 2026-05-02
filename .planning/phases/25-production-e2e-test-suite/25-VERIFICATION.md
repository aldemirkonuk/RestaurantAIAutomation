---
phase: 25-production-e2e-test-suite
verified: 2026-05-02T07:35:00Z
status: gaps_found
score: 11/12 must-haves verified
overrides_applied: 0
gaps:
  - truth: "Wave F pass bar criterion 4: one /studio write-flow creates a studio record and is torn down"
    status: partial
    reason: >
      prod-smoke.spec.ts Wave F-4 only verifies the /studio route loads with the
      'WineOps Studio' header visible. No studio record is created, verified in the
      review queue, or deleted. The required write-flow (create → verify → teardown)
      is not implemented. This is documented in SUMMARY-06 decision T-25-06-04 as
      intentional but it leaves TEST-PROD-06's write-flow criterion unmet.
    artifacts:
      - path: "apps/web/e2e/prod-smoke.spec.ts"
        issue: >
          Wave F-4 test body navigates to /studio and asserts
          page.getByText('WineOps Studio').toBeVisible(). It does not fill any form,
          create a record, or issue any Supabase teardown call. The three preceding
          Wave F tests (login, health cards, dashboard load) are fully implemented.
    missing:
      - "Implement Wave F-4 write-flow: fill /studio submission form with test data (e2e-wine-e2e or similar)"
      - "Assert the created record appears in the review queue UI"
      - "Delete the record via Supabase REST (service_role_key) or through the UI teardown path"
      - "The SUMMARY documents this was delegated to conftest_prod.py Python teardown — but Python teardown cannot assert the UI write succeeded"

human_verification:
  - test: "Run the full suite against live services (pytest tests/e2e/ + Playwright)"
    expected: "Waves A–G complete without unexpected failures; JUnit XML files appear in test-results/"
    why_human: "All wave tests hit live Railway orchestrator, Supabase, CloudAMQP RabbitMQ, and Vercel. Cannot verify network reachability or production service state programmatically."
  - test: "Wave A: GET https://<RAILWAY_ORCHESTRATOR_URL>/health → {status: ok}"
    expected: "200 with {status: ok}; auth-protected routes 401 without credentials"
    why_human: "RAILWAY_ORCHESTRATOR_URL is a GitHub Actions secret; endpoint reachability cannot be verified without credentials."
  - test: "Wave B: GET /api/v1/health/agents with ADMIN_API_KEY → 9 agents, ≥7 healthy"
    expected: "All 9 agents present; healthy count ≥ 7"
    why_human: "Requires ADMIN_API_KEY and live Railway orchestrator to be running."
  - test: "Wave D: POST /api/v1/pos/webhook/toast with Toast-Signature → 200/202, pos_webhook_logs row appears within 15s"
    expected: "Signed webhook accepted; POSIntegrationAgent writes audit log within 15s"
    why_human: "Requires TOAST_WEBHOOK_SECRET and live Railway orchestrator + Supabase connection."
  - test: "Wave E: upsert inventory_stock (quantity=0, threshold=5) → notification_deliveries row with channel='email' within 30s"
    expected: "NotificationAgent fires email and writes row with status='sent'"
    why_human: "Requires GMAIL_USER/GMAIL_PASSWORD on Railway and live email backend."
  - test: "Wave F: Playwright against live Vercel URL → all 4 D-10 criteria pass"
    expected: "Login redirect ✓; ≥7 Active badges ✓; dashboard < 5s ✓; /studio loads with 'WineOps Studio' ✓"
    why_human: "Requires E2E_BASE_URL (live Vercel) and real browser execution."
---

# Phase 25: Production E2E Test Suite — Verification Report

**Phase Goal:** Production E2E test suite covering all 7 waves (A–G) running nightly in CI against live production services, with cascading failure analysis and Sentry alerting.
**Verified:** 2026-05-02T07:35:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | Wave A: API contracts — public /health 200, auth-protected 401 without credentials, 200 with JWT/admin-key, zero 500s (TEST-PROD-01) | ✓ VERIFIED | `wave_a_api_contracts.py` — TestPublicEndpoints, TestUnauthenticatedReturns401, TestAuthenticatedEndpoints; all 9 router prefixes covered; `get_with_retry` used; pytest.mark.prod_e2e |
| 2 | Wave B: all 9 agents present in /api/v1/health/agents, ≥7 healthy (TEST-PROD-02) | ✓ VERIFIED | `wave_b_agent_health.py` — EXPECTED_AGENTS list has all 9; `len(healthy_agents) >= 7` assertion; `_agent_is_healthy()` accepts both `healthy:True` and `status:'Active'`/'healthy'/'running' |
| 3 | Wave C: test message published to each agent's routing key via CloudAMQP; agent remains healthy within 5s (TEST-PROD-03) | ✓ VERIFIED | `wave_c_agent_triggers.py` — `AGENT_ROUTING_KEYS` populated with actual routing keys extracted from `core/message_bus.py` and `agents/*.py` (not placeholder values); `check_agent_still_healthy()` polls 5s window; shared connection avoids CloudAMQP free-tier limit |
| 4 | Wave D: HMAC-signed Toast webhook → POSIntegrationAgent → pos_webhook_logs Supabase record within 15s; unsigned webhook rejected 401 (TEST-PROD-04) | ✓ VERIFIED | `wave_d_toast_pipeline.py` — uses `Toast-Signature` header (correct per `pos_routes.py` line 37 alias, NOT `X-Toast-Signature`); HMAC raw hexdigest (no prefix); `e2e_created_ids.append()` for teardown; 15s poll; 401 rejection test present |
| 5 | Wave E: low-stock inventory upsert triggers email delivery; notification_deliveries row with channel='email' within 30s (TEST-PROD-05) | ✓ VERIFIED | `wave_e_gmail_pipeline.py` — `inventory_stock` upsert with current_quantity=0 < minimum_threshold=5; `poll_notification_delivery()` with 30s timeout; status in ('sent','delivered','queued'); GMAIL_USER skip guard; teardown registered |
| 6 | Wave F: login redirect ✓, ≥7 active agent cards ✓, dashboard <5s ✓; **one /studio write-flow creates a record and is torn down** ✗ (TEST-PROD-06) | ✗ PARTIAL | `prod-smoke.spec.ts` — Wave F-1/F-2/F-3 fully verified; Wave F-4 only navigates to /studio and checks `page.getByText('WineOps Studio').toBeVisible()` — NO record created, NO teardown performed. SUMMARY-06 documents this as intentional (T-25-06-04) but leaves the write-flow criterion unmet. |
| 7 | Wave G: calendar_events row with start_date=today+7, id='e2e-cal-001' upserted; DB assertion confirms scheduling row exists (TEST-PROD-07) | ✓ VERIFIED | `wave_g_calendar.py` — uses `start_date` (correct per `calendar_agent.py`, not `event_date` as in requirement text); upsert+M-04 hard assertion on calendar_events row; dual-strategy poll (scheduled_reminders + calendar_events flag); non-fatal skip on timing; teardown registered |
| 8 | All 7 wave results exported as JUnit XML and uploaded as GitHub Actions artifacts (TEST-PROD-08) | ✓ VERIFIED | `e2e-prod.yml` — 7 separate `--junitxml=test-results/wave_{X}.xml` paths; `upload-artifact@v4` uploads `test-results/` + `apps/web/test-results/`; synthetic wave_f.xml guard (M-03) if Playwright crashes |
| 9 | Every production test failure fires `sentry_sdk.capture_message` with e2e-failure and deploy-gate tags (TEST-PROD-09) | ✓ VERIFIED | `conftest_prod.py` — `pytest_runtest_logreport` hook with `tags={"e2e-failure":"true","deploy-gate":triggered_by_deploy}`; Sentry init in TEST RUNNER process (not FastAPI app); PYTEST_RUNNING never set (confirmed: grep returns 0 lines from conftest_prod.py) |
| 10 | Waves B+C run concurrently; timeout-minutes: 15; PYTEST_RUNNING never set in CI env (TEST-PROD-10) | ✓ VERIFIED | `e2e-prod.yml` — Waves B+C run as background shell processes (`& wait`) with separate XMLs (M-02 fix superior to `-n 2`); `timeout-minutes: 15` present; PYTEST_RUNNING appears only in 4 comments, never in any `env:` block |
| 11 | Nightly cron at 02:00 UTC; workflow_dispatch for deploy hook; Sentry deploy-gate tag + PR comment on failure (TEST-PROD-11) | ✓ VERIFIED | `e2e-prod.yml` — `cron: '0 2 * * *'`; `workflow_dispatch` with `triggered_by_deploy` boolean input; deploy gate Sentry step fires on `triggered_by_deploy == true` with `sentry_sdk.flush(2)` (L-01); PR comment via `actions/github-script@v7` if `pr_number` supplied |
| 12 | All test writes use e2e-test-restaurant anchor; deterministic e2e-* IDs; teardown deletes by restaurant_id+id LIKE 'e2e-%'; teardown errors to Sentry, never raised (TEST-PROD-12) | ✓ VERIFIED | `conftest_prod.py` — `teardown_e2e_records` (autouse, session): ID-registry + tag-based sweep across 8 tables; anchor never deleted (explicit `continue` guard); all exceptions caught + Sentry orphan report; all wave files use `E2E_RESTAURANT_ID = "e2e-test-restaurant"` |

**Score:** 11/12 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `.planning/REQUIREMENTS.md` | TEST-PROD-01..12 in `### Production E2E (Phase 25)` section | ✓ VERIFIED | 12 requirements at lines 333–344; coverage count `Production E2E (Phase 25): 12 requirements — TEST-PROD-01..12` at line 352; `Unmapped: 0 ✓` |
| `services/agent-orchestrator/requirements.test.txt` | httpx>=0.27, tenacity>=8.2, pytest-xdist>=3.5, pytest-asyncio>=0.23 | ✓ VERIFIED | All 4 test-only deps present with correct minimum versions; 7 lines |
| `services/agent-orchestrator/scripts/setup_e2e_anchor.py` | Idempotent; reads all creds from env; never logs password | ✓ VERIFIED | `check_env()` calls `sys.exit(1)` on missing vars; `create_e2e_service_account()` handles 422 "already registered" as success; `"DO NOT print it here"` enforced in main(); password parameter name only, never printed value |
| `services/agent-orchestrator/tests/e2e/conftest_prod.py` | Session-scoped fixtures: prod_jwt, prod_base_url, prod_admin_headers, prod_supabase, e2e_created_ids, teardown; Sentry hook; PYTEST_RUNNING never set | ✓ VERIFIED | All fixtures session-scoped; `pytest_runtest_logreport` hook; `_sentry_dsn` guard; PYTEST_RUNNING not referenced; `get_with_retry`/`post_with_retry` helpers present |
| `services/agent-orchestrator/tests/e2e/conftest.py` | Imports prod_ fixtures from conftest_prod; existing mock fixtures preserved | ✓ VERIFIED | Lines 42–57 import `prod_base_url`, `prod_jwt`, `prod_admin_headers`, `prod_supabase`, `e2e_created_ids`, `teardown_e2e_records` + `import e2e.conftest_prod` for module-level hooks |
| `services/agent-orchestrator/tests/e2e/wave_a_api_contracts.py` | Wave A API contract tests; pytest.mark.prod_e2e | ✓ VERIFIED | 154 lines; 3 test classes; 11 test methods; all use prod_base_url/prod_jwt/prod_admin_headers |
| `services/agent-orchestrator/tests/e2e/wave_b_agent_health.py` | Wave B agent health; 9 agents; ≥7 pass bar | ✓ VERIFIED | EXPECTED_AGENTS list 9 agents; `test_minimum_7_agents_healthy` asserts `>= 7`; parametrized per-agent detail test |
| `services/agent-orchestrator/tests/e2e/wave_c_agent_triggers.py` | Wave C RabbitMQ triggers; actual routing keys; 5s health check | ✓ VERIFIED | AGENT_ROUTING_KEYS populated from source (e.g. `"buffer_manager": ("pos.events", "pos.sale.completed")`); `check_agent_still_healthy()` 5s window; shared connection (H-01) |
| `services/agent-orchestrator/tests/e2e/wave_d_toast_pipeline.py` | Wave D Toast pipeline; HMAC-SHA256; Toast-Signature; Supabase poll 15s | ✓ VERIFIED | `sign_webhook_payload()` returns raw hexdigest (no prefix); `Toast-Signature` header (correct per pos_routes.py); `poll_supabase_for_webhook_record()` 15s; teardown registered with documented limitation |
| `services/agent-orchestrator/tests/e2e/wave_e_gmail_pipeline.py` | Wave E Gmail pipeline; notification_deliveries; 30s poll | ✓ VERIFIED | `DELIVERIES_TABLE = "notification_deliveries"`; `poll_notification_delivery()` 30s; GMAIL_USER skip guard; `test_email_delivery_registered_for_teardown` asserts table in E2E_TABLES |
| `services/agent-orchestrator/tests/e2e/wave_g_calendar.py` | Wave G Calendar DB assertion; start_date=today+7; e2e-cal-001 | ✓ VERIFIED | Uses `start_date` (not `event_date`); two-strategy poll; M-04 hard assert on upsert; non-fatal skip on timing |
| `apps/web/playwright.prod.config.ts` | No webServer; E2E_BASE_URL required; throws on localhost; JUnit XML | ✓ VERIFIED | Zero `webServer` occurrences; `throw new Error(...)` when E2E_BASE_URL unset; localhost guard with `// guard` annotation; `['junit', { outputFile: 'test-results/wave_f.xml' }]` reporter |
| `apps/web/e2e/prod-smoke.spec.ts` | 4 Wave F tests; real Supabase login; ≥7 active cards; dashboard <5s; write-flow | ✗ PARTIAL | F-1 (login redirect), F-2 (≥7 Active badges via getByText), F-3 (5s load + no console errors) all implemented and substantive. F-4: navigates to /studio, checks 'WineOps Studio' visible — **no write-flow, no teardown** |
| `.github/workflows/e2e-prod.yml` | Nightly cron; workflow_dispatch; all 7 waves; continue-all; timeout 15; JUnit artifacts; deploy gate | ✓ VERIFIED | cron '0 2 * * *'; workflow_dispatch with triggered_by_deploy; 11 `|| true` instances; PYTEST_RUNNING in comments only; timeout-minutes: 15; upload-artifact@v4; Sentry flush(2) + PR comment |
| `services/agent-orchestrator/scripts/cascading_report.py` | WAVE_DEPS graph (D-17); SUGGESTED_FIXES; JSON+Markdown output | ✓ VERIFIED | WAVE_DEPS: B→[A], C→[B], D→[A,B], G→[E]; 9 SUGGESTED_FIXES frozenset entries; `parse_junit_xml`, `collect_wave_results`, `determine_root_causes`, `generate_markdown`; CLI `--results-dir`/`--output-dir` |
| `services/agent-orchestrator/tests/e2e/report_generator.py` | wave field added to test result entries; `_extract_wave_from_nodeid` helper | ✓ VERIFIED | `_extract_wave_from_nodeid()` static method at line 29; `"wave": self._extract_wave_from_nodeid(item.nodeid)` at line 65; E2EReportGenerator class and pytest_sessionfinish preserved |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `conftest_prod.py prod_jwt` | Supabase Auth REST POST /auth/v1/token | `httpx.AsyncClient POST with E2E_TEST_EMAIL/PASSWORD` | ✓ WIRED | Line 139: `url = f"{supabase_url}/auth/v1/token?grant_type=password"`; `data["access_token"]` returned; `# Never log this value` |
| `conftest_prod.py teardown_e2e_records` | Supabase production DB tables | `supabase DELETE WHERE restaurant_id='e2e-test-restaurant' AND id LIKE 'e2e-%'` | ✓ WIRED | Two-step: ID-registry delete then tag-based sweep across 8 tables; exceptions caught + Sentry orphan report |
| `conftest_prod.py pytest_runtest_logreport` | Sentry production project | `sentry_sdk.capture_message with e2e-failure tag` | ✓ WIRED | Lines 72–87; `_sentry_dsn` guard; `TRIGGERED_BY_DEPLOY` env var for deploy-gate tag |
| `conftest.py` | `conftest_prod.py fixtures` | `from e2e.conftest_prod import (prod_base_url, prod_jwt, ...)` | ✓ WIRED | Lines 45–57; all 6 session fixtures imported; `import e2e.conftest_prod` for module-level hook registration |
| `wave_a_api_contracts.py` | Live Railway /api/v1/* | `httpx.AsyncClient(base_url=prod_base_url)` with JWT/admin-key | ✓ WIRED | All 3 test classes use prod_base_url fixture; `get_with_retry` used for retried GETs |
| `wave_b_agent_health.py` | GET /api/v1/health/agents | `httpx with X-Admin-Key from prod_admin_headers` | ✓ WIRED | Lines 65–68 (endpoint returns 200); agent JSON extracted via `_extract_agents()` |
| `wave_c_agent_triggers.py` | CloudAMQP RabbitMQ exchanges | `aio_pika.connect_robust(rabbitmq_url)` + publish to AGENT_ROUTING_KEYS | ✓ WIRED | Session-scoped `rabbitmq_connection` fixture; channel-per-publish with close; 5s health poll after publish |
| `wave_d_toast_pipeline.py` | POST /api/v1/pos/webhook/toast | `httpx POST with Toast-Signature header` | ✓ WIRED | `_build_signed_request()` returns `(body_bytes, {"Toast-Signature": signature})`; `post_with_retry` used |
| `e2e-prod.yml cron trigger` | GitHub Actions runner 02:00 UTC | `cron: '0 2 * * *'` | ✓ WIRED | Lines 18–19 |
| `e2e-prod.yml pip install` | requirements.test.txt | `pip install -r requirements.test.txt` | ✓ WIRED | Lines 85–86; cache-dependency-path includes requirements.test.txt |
| `cascading_report.py WAVE_DEPS` | wave_*.xml JUnit outputs | `xml.etree.ElementTree parse → cluster by failed waves → WAVE_DEPS lookup` | ✓ WIRED | `collect_wave_results()` reads 7 XMLs; `determine_root_causes()` applies WAVE_DEPS; both JSON+MD written |
| `e2e-prod.yml deploy-gate` | Sentry + PR comment | `check_failures step → Sentry alert + github-script@v7` | ✓ WIRED | `sentry_sdk.flush(2)` guards short-lived process (L-01); PR comment only when `pr_number != ''` |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `wave_a_api_contracts.py` | `resp.status_code`, `resp.json()` | Live Railway HTTP responses | Yes — real production endpoint responses | ✓ FLOWING |
| `wave_b_agent_health.py` | `agents` list from `/api/v1/health/agents` | `_extract_agents(resp.json())` from live endpoint | Yes — actual agent health state | ✓ FLOWING |
| `wave_c_agent_triggers.py` | `still_healthy` boolean | `check_agent_still_healthy()` polls live Railway | Yes — real agent status post-trigger | ✓ FLOWING |
| `wave_d_toast_pipeline.py` | `found` boolean from Supabase poll | `poll_supabase_for_webhook_record()` queries production DB | Yes — real pos_webhook_logs rows | ✓ FLOWING |
| `wave_e_gmail_pipeline.py` | `delivery_row` from notification_deliveries | `poll_notification_delivery()` queries production Supabase | Yes — real notification delivery records | ✓ FLOWING |
| `prod-smoke.spec.ts` F-4 | `WineOps Studio` text on /studio | `page.getByText('WineOps Studio')` checks rendered DOM | Partial — UI load confirmed, but no data write path | ⚠️ PARTIAL — no write-flow data |

---

## Behavioral Spot-Checks

| Behavior | Check | Result | Status |
|----------|-------|--------|--------|
| `setup_e2e_anchor.py` exits with error on missing env vars | `python setup_e2e_anchor.py` without env vars | Prints `ERROR: Missing required environment variables: [...]` to stderr; exits code 1 | ✓ PASS (code verified via Read) |
| `requirements.test.txt` has 4 deps with version pins | File read | httpx>=0.27.0, tenacity>=8.2.0, pytest-xdist>=3.5.0, pytest-asyncio>=0.23.0 | ✓ PASS |
| `conftest_prod.py` Python syntax valid | AST parse-equivalent (Read + analysis) | No syntax errors identifiable; imports, fixtures, hook all properly structured | ✓ PASS |
| `cascading_report.py` CLI produces help | `python scripts/cascading_report.py --help` expected to show usage | SKIP — cannot run CLI without shell access to the orchestrator environment | ? SKIP |
| `e2e-prod.yml` YAML valid | YAML structure verified via Read | Steps, triggers, env blocks, jobs all properly structured | ✓ PASS |
| Wave F-4 write-flow execution | Navigate /studio → create record → verify → teardown | NOT IMPLEMENTED — only page load verified | ✗ FAIL |

---

## Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| TEST-PROD-01 | 25-01, 25-03 | Wave A API contracts | ✓ SATISFIED | `wave_a_api_contracts.py` — public /health, 401 without auth, 200 with auth, no 500s |
| TEST-PROD-02 | 25-01, 25-03 | Wave B agent health — 9 agents, ≥7 healthy | ✓ SATISFIED | `wave_b_agent_health.py` — EXPECTED_AGENTS list, `>= 7` assertion |
| TEST-PROD-03 | 25-01, 25-04 | Wave C RabbitMQ triggers — 9 agents survive 5s | ✓ SATISFIED | `wave_c_agent_triggers.py` — actual routing keys, health poll |
| TEST-PROD-04 | 25-01, 25-04 | Wave D Toast pipeline — HMAC webhook → Supabase | ✓ SATISFIED | `wave_d_toast_pipeline.py` — correct HMAC, Toast-Signature header, 15s poll |
| TEST-PROD-05 | 25-01, 25-05 | Wave E Gmail pipeline — notification_deliveries 30s | ✓ SATISFIED | `wave_e_gmail_pipeline.py` — inventory_stock trigger, 30s poll, channel='email' |
| TEST-PROD-06 | 25-01, 25-06 | Wave F frontend smoke — login, health, dashboard, **write-flow** | ✗ PARTIAL | Wave F-4 missing write-flow: only page load + header visibility check |
| TEST-PROD-07 | 25-01, 25-05 | Wave G Calendar — calendar_events today+7, scheduling DB assertion | ✓ SATISFIED | `wave_g_calendar.py` — start_date=today+7, e2e-cal-001, dual-strategy poll |
| TEST-PROD-08 | 25-01, 25-07 | JUnit XML for all 7 waves + artifact upload | ✓ SATISFIED | `e2e-prod.yml` — 7 XML paths, upload-artifact@v4 |
| TEST-PROD-09 | 25-01, 25-02 | Sentry capture_message on every failure | ✓ SATISFIED | `conftest_prod.py` — pytest_runtest_logreport hook; e2e-failure + deploy-gate tags |
| TEST-PROD-10 | 25-01, 25-07 | Suite < 10 min; B+C parallel; timeout-minutes: 15; PYTEST_RUNNING never set | ✓ SATISFIED | `e2e-prod.yml` — timeout-minutes: 15; B+C background processes; PYTEST_RUNNING in comments only |
| TEST-PROD-11 | 25-01, 25-07 | Nightly cron 02:00 UTC; deploy webhook; Sentry deploy-gate; PR comment | ✓ SATISFIED | `e2e-prod.yml` — cron '0 2 * * *'; workflow_dispatch; deploy-gate Sentry + PR comment |
| TEST-PROD-12 | 25-01, 25-02 | e2e-test-restaurant anchor; deterministic IDs; teardown; orphan Sentry | ✓ SATISFIED | `conftest_prod.py` — teardown_e2e_records; anchor guard; all wave files use e2e-test-restaurant |

---

## Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `apps/web/e2e/prod-smoke.spec.ts` (Wave F-4) | `await expect(page.getByText('WineOps Studio')).toBeVisible()` — no write-flow executed | 🛑 Blocker | TEST-PROD-06 write-flow criterion unmet; the test cannot confirm the studio submission pipeline works end-to-end |
| `wave_d_toast_pipeline.py` (known) | pos_webhook_logs has no restaurant_id column — teardown will fail silently | ℹ️ Info | Documented in module docstring; D-04 compliant (Sentry orphan report, never raised); audit log record persists harmlessly |
| `wave_g_calendar.py` | `SCHEDULED_REMINDERS_TABLE = "scheduled_reminders"` — agent doesn't write this table | ℹ️ Info | Documented in module: CalendarAgent publishes via RabbitMQ, not DB write; Strategy 2 (calendar_events row check) compensates correctly |

---

## Human Verification Required

### 1. Full Suite Integration Run

**Test:** Execute the complete suite: `pytest tests/e2e/ --junitxml=test-results/e2e-prod.xml -q` from `services/agent-orchestrator/` and `npx playwright test --config playwright.prod.config.ts` from `apps/web/` — both against live production services with all GitHub Actions secrets set.
**Expected:** All waves pass or skip gracefully (no unexpected failures); 7 JUnit XML files produced; cascading_report.md generated.
**Why human:** Cannot run tests without live credentials (RAILWAY_ORCHESTRATOR_URL, ADMIN_API_KEY, SUPABASE_URL, RABBITMQ_URL, TOAST_WEBHOOK_SECRET, GMAIL_USER, VERCEL_PRODUCTION_URL, SENTRY_DSN).

### 2. Wave C Routing Key Validation

**Test:** Confirm that Wave C's `AGENT_ROUTING_KEYS` (extracted from source at time of execution) still match the running production RabbitMQ topology. Specifically verify that `queue.pos_integration_agent.pos_test` and `queue.reporting_agent.reporting_generate_on_demand_report` (default exchange, direct routing) are reachable.
**Expected:** All 9 `test_agent_survives_test_message` parametrized tests pass or skip (not fail) — skip is acceptable when the exchange/queue can't receive the probe.
**Why human:** RabbitMQ queue/exchange topology may drift from source code if agents were restarted or reconfigured since Phase 25 plans were executed.

### 3. Wave F-4 Write-Flow (Gap Closure)

**Test:** After implementing the Wave F-4 write-flow (see Gaps Summary), verify that a /studio form submission creates a record visible in the review queue, and that the Supabase REST delete teardown succeeds.
**Expected:** Test passes end-to-end; no orphaned records remain after suite completion.
**Why human:** Requires implementation work first (the gap); then requires live Vercel session and Supabase REST call to confirm.

### 4. Nightly CI Trigger Confirmation

**Test:** After the first 02:00 UTC run, check GitHub Actions run history for `e2e-prod.yml` to confirm the nightly schedule triggered correctly and all 7 wave result artifacts were uploaded.
**Expected:** CI run appeared at ~02:00 UTC; `e2e-prod-results-<run_id>` artifact contains wave_a.xml through wave_g.xml plus cascading_report.json and cascading_report.md.
**Why human:** Schedule trigger cannot be tested without waiting for the next 02:00 UTC occurrence.

---

## Gaps Summary

One gap blocking full goal achievement:

**GAP: Wave F-4 write-flow not implemented (TEST-PROD-06 partial)**

The `/studio` write-flow requirement in TEST-PROD-06 states: "one `/studio` write-flow completes and is torn down." The implementation (Wave F-4 in `prod-smoke.spec.ts`) only verifies the /studio page loads with the 'WineOps Studio' header visible. No form submission, record creation, or teardown is performed.

Three of the four Wave F pass-bar criteria from D-10 are fully implemented (login redirect, ≥7 active agent cards, dashboard <5s). Only criterion 4 (write-flow) is missing.

**Root cause:** SUMMARY-06 documents the deliberate decision to delegate DB teardown to `conftest_prod.py` Python session teardown (T-25-06-04). However, this rationale only addresses teardown — it doesn't explain why the UI write itself was omitted. The human checkpoint in Plan 06 Task 2 asked about studio form selectors; the resolution confirmed `/studio` renders 'WineOps Studio' but the write-flow UI path was not implemented.

**To close this gap:** Implement Wave F-4 as originally specified in the plan:
```typescript
test('Wave F-4: /studio write-flow completes and is torn down', async ({ page }) => {
  await loginWithRealCredentials(page)
  // Navigate to studio
  await page.goto('/studio', { waitUntil: 'networkidle', timeout: 20_000 })
  await expect(page.getByText('WineOps Studio')).toBeVisible({ timeout: 10_000 })
  
  // Fill form with test data (selectors need human verification)
  // Submit the form
  // Assert record appears in review queue
  
  // Teardown via Supabase REST with service_role_key
  // (fetch from page context or env var)
})
```

**Structured gap in frontmatter** — ready for `/gsd-plan-phase --gaps` to generate a closure plan.

---

## Notable Deviations (Not Gaps)

These are implementation improvements that satisfy the spirit of requirements while deviating from literal wording:

1. **TEST-PROD-10 says "pytest -n 2" but implementation uses background processes (`& wait`):** The M-02 fix intentionally uses separate pytest processes to produce separate wave_b.xml and wave_c.xml JUnit files, enabling precise cascading attribution. This exceeds the requirement's intent. ✓ Acceptable.

2. **TEST-PROD-07 says `event_date` column but implementation uses `start_date`:** The requirement text reflects the assumed column name at the time it was written. The executor read `calendar_agent.py` source and found the actual column is `start_date`. The implementation is correct; the requirement text has a minor inaccuracy. ✓ Acceptable.

3. **Wave D uses `Toast-Signature` header (not `X-Toast-Signature` as in plan template):** The executor read `pos_routes.py` and found `alias="Toast-Signature"`. The implementation matches the actual API contract. ✓ Correct.

4. **PYTEST_RUNNING appears in e2e-prod.yml comments but is never set as an env var:** The file has 4 comment lines explaining why PYTEST_RUNNING is intentionally absent. The critical constraint (never set as env var) is satisfied. ✓ Acceptable.

---

_Verified: 2026-05-02T07:35:00Z_
_Verifier: Claude (gsd-verifier)_
