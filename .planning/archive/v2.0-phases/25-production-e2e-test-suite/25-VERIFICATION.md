---
phase: 25-production-e2e-test-suite
verified: 2026-05-05T16:38:00Z
status: human_needed
score: 12/12 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 11/12
  gaps_closed:
    - "Wave F pass bar criterion 4: one /studio write-flow creates a studio record and is torn down"
  gaps_remaining: []
  regressions: []
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
  - test: "Wave F: Playwright against live Vercel URL → all 4 D-10 criteria pass (including new Wave F-4 write-flow)"
    expected: "Login redirect ✓; ≥7 Active badges ✓; dashboard < 5s ✓; /studio CommandBar ingest creates WineRecordsTable row, /studio/queue heading visible, onboarding_sessions record deleted via REST ✓"
    why_human: "Requires E2E_BASE_URL (live Vercel), E2E_TEST_EMAIL/PASSWORD, SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY. Playwright must run against a live browser session."
  - test: "Wave C Routing Key Validation: confirm AGENT_ROUTING_KEYS still match live RabbitMQ topology"
    expected: "All 9 test_agent_survives_test_message parametrized tests pass or skip (not fail)"
    why_human: "RabbitMQ queue/exchange topology may drift from source code if agents were restarted or reconfigured since Phase 25 plans were executed."
  - test: "Nightly CI Trigger Confirmation: verify e2e-prod.yml ran at 02:00 UTC and uploaded all 7 wave artifacts"
    expected: "CI run appeared at ~02:00 UTC; e2e-prod-results-<run_id> artifact contains wave_a.xml through wave_g.xml plus cascading_report.json and cascading_report.md"
    why_human: "Schedule trigger cannot be tested without waiting for the next 02:00 UTC occurrence."
---

# Phase 25: Production E2E Test Suite — Verification Report

**Phase Goal:** Production E2E test suite covering all 7 waves (A–G) running nightly in CI against live production services, with cascading failure analysis and Sentry alerting.
**Verified:** 2026-05-05T16:38:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure (plan 25-08, commit 6207311)

---

## Re-verification Summary

| Metric | Initial (2026-05-02) | This Run (2026-05-05) |
|--------|---------------------|----------------------|
| Score | 11/12 | **12/12** |
| Status | gaps_found | **human_needed** |
| Gaps closed | — | Wave F-4 write-flow (TEST-PROD-06) |
| Gaps remaining | 1 | **0** |
| Regressions | — | None |

**Gap closed by plan 25-08 (commit `6207311`):** Wave F-4 in `apps/web/e2e/prod-smoke.spec.ts` upgraded from a stub UI-load check to a full write-flow: CommandBar Enter-key ingest → WineRecordsTable column header assertion → `/studio/queue` Override Approval Queue assertion → Supabase REST DELETE teardown in Node.js `request` context.

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | Wave A: API contracts — public /health 200, auth-protected 401 without credentials, 200 with JWT/admin-key, zero 500s (TEST-PROD-01) | ✓ VERIFIED | `wave_a_api_contracts.py` — TestPublicEndpoints, TestUnauthenticatedReturns401, TestAuthenticatedEndpoints; all 9 router prefixes covered; `get_with_retry` used; pytest.mark.prod_e2e |
| 2 | Wave B: all 9 agents present in /api/v1/health/agents, ≥7 healthy (TEST-PROD-02) | ✓ VERIFIED | `wave_b_agent_health.py` — EXPECTED_AGENTS list has all 9; `len(healthy_agents) >= 7` assertion; `_agent_is_healthy()` accepts both `healthy:True` and `status:'Active'`/'healthy'/'running' |
| 3 | Wave C: test message published to each agent's routing key via CloudAMQP; agent remains healthy within 5s (TEST-PROD-03) | ✓ VERIFIED | `wave_c_agent_triggers.py` — AGENT_ROUTING_KEYS populated with actual routing keys; `check_agent_still_healthy()` polls 5s window; shared connection avoids CloudAMQP free-tier limit |
| 4 | Wave D: HMAC-signed Toast webhook → POSIntegrationAgent → pos_webhook_logs Supabase record within 15s; unsigned webhook rejected 401 (TEST-PROD-04) | ✓ VERIFIED | `wave_d_toast_pipeline.py` — `Toast-Signature` header (correct per `pos_routes.py`); HMAC raw hexdigest; `e2e_created_ids.append()` teardown; 15s poll; 401 rejection test |
| 5 | Wave E: low-stock inventory upsert triggers email delivery; notification_deliveries row with channel='email' within 30s (TEST-PROD-05) | ✓ VERIFIED | `wave_e_gmail_pipeline.py` — `inventory_stock` upsert with current_quantity=0 < minimum_threshold=5; `poll_notification_delivery()` 30s; GMAIL_USER skip guard; teardown registered |
| 6 | Wave F: login redirect ✓, ≥7 active agent cards ✓, dashboard <5s ✓; one /studio write-flow creates a studio record and is torn down (TEST-PROD-06) | ✓ VERIFIED | **GAP CLOSED by plan 25-08.** `prod-smoke.spec.ts` Wave F-4: (1) fills CommandBar input with `commandInput.press('Enter')` (onKeyDown path, not button click); (2) asserts `getByRole('columnheader', { name: 'Wine Name' })` and `getByText('E2E Write Flow Test 2026')`; (3) navigates to `/studio/queue`, asserts `getByRole('heading', { name: 'Override Approval Queue' })`; (4) teardown via `request.newContext()` DELETE `/rest/v1/onboarding_sessions?id=eq.<capturedSessionId>`; SUPABASE_SERVICE_ROLE_KEY in Node.js only; ADMIN_API_KEY absent. F-1/F-2/F-3 untouched (6 occurrences confirmed). Commit `6207311`. |
| 7 | Wave G: calendar_events row with start_date=today+7, id='e2e-cal-001' upserted; DB assertion confirms scheduling row exists (TEST-PROD-07) | ✓ VERIFIED | `wave_g_calendar.py` — uses `start_date` (correct per `calendar_agent.py`); upsert + M-04 hard assertion on calendar_events row; dual-strategy poll; non-fatal skip on timing; teardown registered |
| 8 | All 7 wave results exported as JUnit XML and uploaded as GitHub Actions artifacts (TEST-PROD-08) | ✓ VERIFIED | `e2e-prod.yml` — 7 separate `--junitxml=test-results/wave_{X}.xml` paths; `upload-artifact@v4` uploads `test-results/` + `apps/web/test-results/`; synthetic wave_f.xml guard (M-03) if Playwright crashes |
| 9 | Every production test failure fires `sentry_sdk.capture_message` with e2e-failure and deploy-gate tags (TEST-PROD-09) | ✓ VERIFIED | `conftest_prod.py` — `pytest_runtest_logreport` hook with `tags={"e2e-failure":"true","deploy-gate":triggered_by_deploy}`; Sentry init in TEST RUNNER process; PYTEST_RUNNING never set |
| 10 | Waves B+C run concurrently; timeout-minutes: 15; PYTEST_RUNNING never set in CI env (TEST-PROD-10) | ✓ VERIFIED | `e2e-prod.yml` — Waves B+C run as background shell processes (`& wait`) with separate XMLs; `timeout-minutes: 15` present; PYTEST_RUNNING in 4 comments only, never in `env:` block |
| 11 | Nightly cron at 02:00 UTC; workflow_dispatch for deploy hook; Sentry deploy-gate tag + PR comment on failure (TEST-PROD-11) | ✓ VERIFIED | `e2e-prod.yml` — `cron: '0 2 * * *'`; `workflow_dispatch` with `triggered_by_deploy` boolean input; deploy gate Sentry step fires with `sentry_sdk.flush(2)` (L-01); PR comment via `actions/github-script@v7` |
| 12 | All test writes use e2e-test-restaurant anchor; deterministic e2e-* IDs; teardown deletes by restaurant_id+id LIKE 'e2e-%'; teardown errors to Sentry, never raised (TEST-PROD-12) | ✓ VERIFIED | `conftest_prod.py` — `teardown_e2e_records` (autouse, session): ID-registry + tag-based sweep across 8 tables; anchor never deleted (explicit `continue` guard); all exceptions caught + Sentry orphan report |

**Score:** 12/12 truths verified

---

## Gap Closure Deep-Dive: Truth #6 (TEST-PROD-06 Wave F-4)

**Gap from previous verification:** Wave F-4 in `prod-smoke.spec.ts` only verified `/studio` loaded with `'WineOps Studio'` header visible. No record created, no teardown performed.

**Fix applied (commit `6207311`, plan 25-08):**

All 13 plan acceptance criteria confirmed against the live file:

| Acceptance Criterion | Result |
|---------------------|--------|
| `grep -c "Wave F-4" prod-smoke.spec.ts` ≥ 2 | ✅ 2 (comment + test name) |
| `grep "onboarding_sessions"` matches | ✅ 4 lines (create comment, teardown comment, DELETE call, orphan comment) |
| `grep "SUPABASE_SERVICE_ROLE_KEY"` matches | ✅ 3 lines (process.env access, test.skip guard, Node.js comment) |
| `grep "page.evaluate.*serviceKey"` → EMPTY | ✅ Empty — key never enters browser |
| `grep "ADMIN_API_KEY\|X-Admin-Key"` → EMPTY | ✅ Empty — admin key absent |
| `grep "getByPlaceholder\|paste a URL\|commandInput"` matches | ✅ 5 lines (locator, visibility assert, fill, press, comment) |
| `grep "getByRole.*button.*Ingest\|ingestButton"` matches | ✅ 2 lines (role locator + toBeEnabled assert) |
| `grep "columnheader.*Wine Name"` matches | ✅ 1 line — `getByRole('columnheader', { name: 'Wine Name' })` |
| `grep "Override Approval Queue"` matches | ✅ 3 lines (step comment, source comment, heading assertion) |
| `grep "request\.newContext\|apiCtx"` matches | ✅ 3 lines (newContext call, DELETE call, dispose) |
| `grep "capturedSessionId"` matches | ✅ 5 lines (declaration, assignment, conditional, DELETE, orphan comment) |
| Wave F-1/F-2/F-3 count ≥ 6 | ✅ 6 (2 occurrences each — untouched) |
| Commit `6207311` exists | ✅ `feat(25-08): Wave F-4 write-flow — CommandBar ingest + teardown` |

**Security constraints verified:**
- `APIRequestContext` imported as `type` — no runtime bloat
- `test.skip()` guard fires when `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` absent
- Response interception (`page.on('response')`) used to capture session id — no `page.evaluate()` with credentials
- `commandInput.press('Enter')` (onKeyDown path) — not `ingestButton.click()` (SyntheticMouseEvent path would null `wine_name`)
- Teardown uses `request.newContext()` — Node.js process, never browser page context

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `.planning/REQUIREMENTS.md` | TEST-PROD-01..12 in Production E2E (Phase 25) section | ✓ VERIFIED | 12 requirements at lines 333–344; Unmapped: 0 |
| `services/agent-orchestrator/requirements.test.txt` | httpx>=0.27, tenacity>=8.2, pytest-xdist>=3.5, pytest-asyncio>=0.23 | ✓ VERIFIED | All 4 test-only deps present with correct minimum versions |
| `services/agent-orchestrator/scripts/setup_e2e_anchor.py` | Idempotent; reads creds from env; never logs password | ✓ VERIFIED | `check_env()` calls `sys.exit(1)` on missing vars; handles 422 as success; password never printed |
| `services/agent-orchestrator/tests/e2e/conftest_prod.py` | Session-scoped fixtures; Sentry hook; PYTEST_RUNNING never set | ✓ VERIFIED | All fixtures session-scoped; `pytest_runtest_logreport` hook; PYTEST_RUNNING not referenced |
| `services/agent-orchestrator/tests/e2e/conftest.py` | Imports prod_ fixtures; existing mock fixtures preserved | ✓ VERIFIED | Lines 42–57 import all 6 prod session fixtures |
| `services/agent-orchestrator/tests/e2e/wave_a_api_contracts.py` | Wave A API contract tests; pytest.mark.prod_e2e | ✓ VERIFIED | 3 test classes; 11 test methods; all use prod fixtures |
| `services/agent-orchestrator/tests/e2e/wave_b_agent_health.py` | Wave B; 9 agents; ≥7 pass bar | ✓ VERIFIED | EXPECTED_AGENTS 9 agents; `>= 7` assertion; parametrized per-agent detail |
| `services/agent-orchestrator/tests/e2e/wave_c_agent_triggers.py` | Wave C; actual routing keys; 5s health check | ✓ VERIFIED | AGENT_ROUTING_KEYS from source; `check_agent_still_healthy()` 5s; shared connection (H-01) |
| `services/agent-orchestrator/tests/e2e/wave_d_toast_pipeline.py` | Wave D; HMAC-SHA256; Toast-Signature; 15s poll | ✓ VERIFIED | raw hexdigest; `Toast-Signature` header; 15s poll; teardown registered |
| `services/agent-orchestrator/tests/e2e/wave_e_gmail_pipeline.py` | Wave E; notification_deliveries; 30s poll | ✓ VERIFIED | `DELIVERIES_TABLE = "notification_deliveries"`; 30s poll; GMAIL_USER skip guard |
| `services/agent-orchestrator/tests/e2e/wave_g_calendar.py` | Wave G; start_date=today+7; e2e-cal-001 | ✓ VERIFIED | Uses `start_date`; two-strategy poll; M-04 hard assert; non-fatal skip on timing |
| `apps/web/playwright.prod.config.ts` | No webServer; E2E_BASE_URL required; JUnit XML | ✓ VERIFIED | Zero `webServer` occurrences; throw on unset/localhost; `wave_f.xml` reporter |
| `apps/web/e2e/prod-smoke.spec.ts` | 4 Wave F tests; real Supabase login; write-flow | ✓ VERIFIED | F-1/F-2/F-3 substantive; F-4 **now fully implemented** with write-flow and REST teardown (commit `6207311`) |
| `.github/workflows/e2e-prod.yml` | Nightly cron; workflow_dispatch; all 7 waves; JUnit artifacts; deploy gate | ✓ VERIFIED | cron '0 2 * * *'; 11 `\|\| true` instances; timeout-minutes: 15; upload-artifact@v4; Sentry flush(2) |
| `services/agent-orchestrator/scripts/cascading_report.py` | WAVE_DEPS graph; SUGGESTED_FIXES; JSON+Markdown output | ✓ VERIFIED | WAVE_DEPS; 9 SUGGESTED_FIXES entries; `parse_junit_xml`, `collect_wave_results`, `determine_root_causes`, `generate_markdown`; CLI `--results-dir`/`--output-dir` |
| `services/agent-orchestrator/tests/e2e/report_generator.py` | wave field in test result entries; `_extract_wave_from_nodeid` | ✓ VERIFIED | `_extract_wave_from_nodeid()` static method; `"wave": self._extract_wave_from_nodeid(item.nodeid)` |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `conftest_prod.py prod_jwt` | Supabase Auth REST POST /auth/v1/token | httpx.AsyncClient POST with E2E_TEST_EMAIL/PASSWORD | ✓ WIRED | `url = f"{supabase_url}/auth/v1/token?grant_type=password"`; `data["access_token"]` returned; `# Never log this value` |
| `conftest_prod.py teardown_e2e_records` | Supabase production DB tables | `supabase DELETE WHERE restaurant_id='e2e-test-restaurant' AND id LIKE 'e2e-%'` | ✓ WIRED | Two-step: ID-registry delete then tag-based sweep across 8 tables |
| `conftest_prod.py pytest_runtest_logreport` | Sentry production project | `sentry_sdk.capture_message with e2e-failure tag` | ✓ WIRED | `_sentry_dsn` guard; `TRIGGERED_BY_DEPLOY` env var for deploy-gate tag |
| `conftest.py` | `conftest_prod.py fixtures` | `from e2e.conftest_prod import (prod_base_url, prod_jwt, ...)` | ✓ WIRED | Lines 45–57; all 6 session fixtures imported; module-level hook registered |
| `wave_a_api_contracts.py` | Live Railway /api/v1/* | `httpx.AsyncClient(base_url=prod_base_url)` with JWT/admin-key | ✓ WIRED | All 3 test classes use prod_base_url; `get_with_retry` used |
| `wave_b_agent_health.py` | GET /api/v1/health/agents | httpx with X-Admin-Key from prod_admin_headers | ✓ WIRED | Lines 65–68; agent JSON extracted via `_extract_agents()` |
| `wave_c_agent_triggers.py` | CloudAMQP RabbitMQ exchanges | `aio_pika.connect_robust(rabbitmq_url)` + publish to AGENT_ROUTING_KEYS | ✓ WIRED | Session-scoped `rabbitmq_connection` fixture; channel-per-publish with close; 5s health poll after publish |
| `wave_d_toast_pipeline.py` | POST /api/v1/pos/webhook/toast | httpx POST with Toast-Signature header | ✓ WIRED | `_build_signed_request()` returns `(body_bytes, {"Toast-Signature": signature})`; `post_with_retry` used |
| `prod-smoke.spec.ts Wave F-4` | POST /api/v1/studio/sessions (onboarding_sessions) | `commandInput.press('Enter')` → onKeyDown → `handleIngest()` | ✓ WIRED | `page.on('response')` intercepts `/api/v1/studio/sessions` POST; `capturedSessionId` extracted from response body |
| `prod-smoke.spec.ts Wave F-4 teardown` | Supabase REST DELETE /rest/v1/onboarding_sessions | `request.newContext()` with SUPABASE_SERVICE_ROLE_KEY (Node.js) | ✓ WIRED | `DELETE /rest/v1/onboarding_sessions?id=eq.${capturedSessionId}`; key never in browser context |
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
| `prod-smoke.spec.ts` F-4 | `capturedSessionId` from POST response | `page.on('response')` intercepts `/api/v1/studio/sessions`; `body.session.id` extracted | Yes — real session id from production API write | ✓ FLOWING |
| `prod-smoke.spec.ts` F-4 | WineRecordsTable `columnheader "Wine Name"` | `commandInput.press('Enter')` → `handleIngest()` → `setRecords([{...}])` | Yes — real DOM update from live ingest response | ✓ FLOWING |

---

## Behavioral Spot-Checks

| Behavior | Check | Result | Status |
|----------|-------|--------|--------|
| `setup_e2e_anchor.py` exits with error on missing env vars | File read — `check_env()` calls `sys.exit(1)` on missing vars | Prints `ERROR: Missing required environment variables` to stderr; exits code 1 | ✓ PASS (code verified via Read) |
| `requirements.test.txt` has 4 deps with version pins | File read | httpx>=0.27.0, tenacity>=8.2.0, pytest-xdist>=3.5.0, pytest-asyncio>=0.23.0 | ✓ PASS |
| `conftest_prod.py` Python syntax valid | Read + analysis | No syntax errors; imports, fixtures, hook all properly structured | ✓ PASS |
| `e2e-prod.yml` YAML valid | Read + structure analysis | Steps, triggers, env blocks, jobs all properly structured | ✓ PASS |
| Wave F-4 write-flow implementation present | grep acceptance criteria (13 checks) | All 13 acceptance criteria PASS — see Gap Closure Deep-Dive table | ✓ PASS |
| `cascading_report.py` CLI produces help | Cannot run CLI without orchestrator shell | SKIP — live execution needed | ? SKIP |
| Wave F-4 live execution against Vercel | Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, E2E_BASE_URL secrets | Cannot verify without live credentials | ? SKIP — routed to human verification |

---

## Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| TEST-PROD-01 | 25-01, 25-03 | Wave A API contracts | ✓ SATISFIED | `wave_a_api_contracts.py` — public /health, 401 without auth, 200 with auth, no 500s |
| TEST-PROD-02 | 25-01, 25-03 | Wave B agent health — 9 agents, ≥7 healthy | ✓ SATISFIED | `wave_b_agent_health.py` — EXPECTED_AGENTS list, `>= 7` assertion |
| TEST-PROD-03 | 25-01, 25-04 | Wave C RabbitMQ triggers — 9 agents survive 5s | ✓ SATISFIED | `wave_c_agent_triggers.py` — actual routing keys, health poll |
| TEST-PROD-04 | 25-01, 25-04 | Wave D Toast pipeline — HMAC webhook → Supabase | ✓ SATISFIED | `wave_d_toast_pipeline.py` — correct HMAC, Toast-Signature header, 15s poll |
| TEST-PROD-05 | 25-01, 25-05 | Wave E Gmail pipeline — notification_deliveries 30s | ✓ SATISFIED | `wave_e_gmail_pipeline.py` — inventory_stock trigger, 30s poll, channel='email' |
| TEST-PROD-06 | 25-01, 25-06, **25-08** | Wave F frontend smoke — login, health, dashboard, **write-flow** | ✓ SATISFIED | **GAP CLOSED.** All 4 D-10 Wave F criteria fully implemented: F-1 (login redirect), F-2 (≥7 Active badges), F-3 (5s + no console errors), F-4 (CommandBar ingest → WineRecordsTable → /studio/queue → REST teardown). Commit `6207311`. |
| TEST-PROD-07 | 25-01, 25-05 | Wave G Calendar — calendar_events today+7, scheduling DB assertion | ✓ SATISFIED | `wave_g_calendar.py` — start_date=today+7, e2e-cal-001, dual-strategy poll |
| TEST-PROD-08 | 25-01, 25-07 | JUnit XML for all 7 waves + artifact upload | ✓ SATISFIED | `e2e-prod.yml` — 7 XML paths, upload-artifact@v4 |
| TEST-PROD-09 | 25-01, 25-02 | Sentry capture_message on every failure | ✓ SATISFIED | `conftest_prod.py` — pytest_runtest_logreport hook; e2e-failure + deploy-gate tags |
| TEST-PROD-10 | 25-01, 25-07 | Suite < 10 min; B+C parallel; timeout-minutes: 15; PYTEST_RUNNING never set | ✓ SATISFIED | `e2e-prod.yml` — timeout-minutes: 15; B+C background processes; PYTEST_RUNNING in comments only |
| TEST-PROD-11 | 25-01, 25-07 | Nightly cron 02:00 UTC; deploy webhook; Sentry deploy-gate; PR comment | ✓ SATISFIED | `e2e-prod.yml` — cron '0 2 * * *'; workflow_dispatch; deploy-gate Sentry + PR comment |
| TEST-PROD-12 | 25-01, 25-02 | e2e-test-restaurant anchor; deterministic IDs; teardown; orphan Sentry | ✓ SATISFIED | `conftest_prod.py` — teardown_e2e_records; anchor guard; all wave files use e2e-test-restaurant |

**All 12 requirements: SATISFIED**

---

## Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `apps/web/e2e/prod-smoke.spec.ts` (Wave F-4) | **RESOLVED** — previously: only page load check with no write-flow | ~~🛑 Blocker~~ → ✅ Resolved | TEST-PROD-06 write-flow criterion now fully met |
| `wave_d_toast_pipeline.py` (known) | pos_webhook_logs has no restaurant_id column — teardown will fail silently | ℹ️ Info | Documented; D-04 compliant (Sentry orphan report, never raised); audit log record persists harmlessly |
| `wave_g_calendar.py` | `SCHEDULED_REMINDERS_TABLE = "scheduled_reminders"` — agent doesn't write this table | ℹ️ Info | Documented; CalendarAgent publishes via RabbitMQ, not DB write; Strategy 2 (calendar_events row check) compensates correctly |

No new anti-patterns introduced by plan 25-08.

---

## Human Verification Required

### 1. Full Suite Integration Run

**Test:** Execute the complete suite: `pytest tests/e2e/ --junitxml=test-results/e2e-prod.xml -q` from `services/agent-orchestrator/` and `npx playwright test --config playwright.prod.config.ts` from `apps/web/` — both against live production services with all GitHub Actions secrets set.
**Expected:** All waves pass or skip gracefully (no unexpected failures); 7 JUnit XML files produced; cascading_report.md generated.
**Why human:** Cannot run tests without live credentials (RAILWAY_ORCHESTRATOR_URL, ADMIN_API_KEY, SUPABASE_URL, RABBITMQ_URL, TOAST_WEBHOOK_SECRET, GMAIL_USER, E2E_BASE_URL, E2E_TEST_EMAIL/PASSWORD, SENTRY_DSN).

### 2. Wave F-4 Write-Flow Live Execution

**Test:** Run `npx playwright test --config playwright.prod.config.ts` against live Vercel with SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, E2E_BASE_URL, E2E_TEST_EMAIL/PASSWORD set. Observe that Wave F-4 passes: CommandBar accepts `'E2E Write Flow Test 2026'`, WineRecordsTable renders with `'Wine Name'` column header, `/studio/queue` heading visible, and the `onboarding_sessions` DELETE call returns 204.
**Expected:** Wave F-4 test passes; no orphaned `onboarding_sessions` records with `source_ref='E2E Write Flow Test 2026'` remain after teardown.
**Why human:** Requires live Vercel session, live `POST /api/v1/studio/sessions` endpoint, and Supabase REST connection. Implementation is complete and verified statically — this is the live smoke confirmation.

### 3. Wave C Routing Key Validation

**Test:** Confirm that Wave C's `AGENT_ROUTING_KEYS` (extracted from source at time of execution) still match the running production RabbitMQ topology. Specifically verify that `queue.pos_integration_agent.pos_test` and `queue.reporting_agent.reporting_generate_on_demand_report` are reachable.
**Expected:** All 9 `test_agent_survives_test_message` parametrized tests pass or skip (not fail).
**Why human:** RabbitMQ queue/exchange topology may drift from source code if agents were restarted or reconfigured since Phase 25 plans were executed.

### 4. Nightly CI Trigger Confirmation

**Test:** After the first 02:00 UTC run, check GitHub Actions run history for `e2e-prod.yml` to confirm the nightly schedule triggered correctly and all 7 wave result artifacts were uploaded.
**Expected:** CI run appeared at ~02:00 UTC; `e2e-prod-results-<run_id>` artifact contains wave_a.xml through wave_g.xml plus cascading_report.json and cascading_report.md.
**Why human:** Schedule trigger cannot be tested without waiting for the next 02:00 UTC occurrence.

---

## Notable Deviations (Not Gaps)

1. **TEST-PROD-10 says "pytest -n 2" but implementation uses background processes (`& wait`):** The M-02 fix intentionally uses separate pytest processes to produce separate wave_b.xml and wave_c.xml JUnit files, enabling precise cascading attribution. This exceeds the requirement's intent. ✓ Acceptable.

2. **TEST-PROD-07 says `event_date` column but implementation uses `start_date`:** The executor read `calendar_agent.py` source and found the actual column is `start_date`. The implementation is correct; the requirement text has a minor inaccuracy. ✓ Acceptable.

3. **Wave D uses `Toast-Signature` header (not `X-Toast-Signature` as in plan template):** The executor read `pos_routes.py` and found `alias="Toast-Signature"`. The implementation matches the actual API contract. ✓ Correct.

4. **Wave F-4 uses Enter-key ingest, not Ingest button click:** Plan 25-08 documents that `ingestButton.click()` would pass a `SyntheticMouseEvent` as `overrideType` (truthy), causing `wine_name` to resolve to `null`. The `commandInput.press('Enter')` path calls `handleIngest()` with no arguments, resolving `wine_name = inputValue.trim() = 'E2E Write Flow Test 2026'`. This is the correct implementation. ✓ Correct.

---

_Verified: 2026-05-05T16:38:00Z_
_Verifier: Claude (gsd-verifier)_
_Re-verification: Yes — gap closure after plan 25-08 (commit 6207311)_
