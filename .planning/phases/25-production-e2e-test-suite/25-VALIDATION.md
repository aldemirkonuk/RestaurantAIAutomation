---
phase: 25
slug: production-e2e-test-suite
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-01
---

# Phase 25 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (Python)** | pytest 7.4.4 |
| **Config file** | `services/agent-orchestrator/pytest.ini` (existing, `asyncio_mode = auto`) |
| **Quick run command** | `pytest tests/e2e/wave_a_api_contracts.py -x -q` |
| **Full backend suite** | `pytest tests/e2e/ --junitxml=test-results/e2e-prod.xml -q` |
| **Playwright command** | `cd apps/web && npx playwright test prod-smoke.spec.ts` |
| **Estimated runtime** | < 10 minutes (timeout-minutes: 15 in CI) |

---

## Sampling Rate

- **Per wave:** `pytest {wave_file} --junitxml=results/{wave}.xml -q`
- **After every plan commit:** Run the quick command for the wave just created
- **Phase gate:** All 7 wave XML files green + cascading report generated before `/gsd-verify-work`

---

## Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TEST-PROD-01 | All `/api/v1/` endpoints return expected status codes with valid JWT | integration | `pytest tests/e2e/wave_a_api_contracts.py -x` | ❌ Wave 0 |
| TEST-PROD-02 | 9 agents return `healthy: true` via `/api/v1/health/agents` | integration | `pytest tests/e2e/wave_b_agent_health.py -x` | ❌ Wave 0 |
| TEST-PROD-03 | Each agent can be triggered via RabbitMQ + acknowledges | integration | `pytest tests/e2e/wave_c_agent_triggers.py -x` | ❌ Wave 0 |
| TEST-PROD-04 | Toast webhook → full agent pipeline runs | integration | `pytest tests/e2e/wave_d_toast_pipeline.py -x` | ❌ Wave 0 |
| TEST-PROD-05 | Email send + delivery log confirmed in Supabase | integration | `pytest tests/e2e/wave_e_gmail_pipeline.py -x` | ❌ Wave 0 |
| TEST-PROD-06 | Login, `/admin/health` cards, dashboard, write-flow | e2e (Playwright) | `npx playwright test prod-smoke.spec.ts` | ❌ Wave 0 |
| TEST-PROD-07 | Test calendar event → reminder scheduled (DB assertion) | integration | `pytest tests/e2e/wave_g_calendar.py -x` | ❌ Wave 0 |
| TEST-PROD-08 | JUnit XML exported for all waves | infra | `--junitxml` flag in all wave commands | ❌ Wave 0 |
| TEST-PROD-09 | Sentry alert on test failure | infra | `pytest_runtest_logreport` hook in `conftest_prod.py` | ❌ Wave 0 |
| TEST-PROD-10 | Suite completes in < 10 minutes | performance | GitHub Actions `timeout-minutes: 15` | ❌ Wave 0 |
| TEST-PROD-11 | Nightly cron + deploy-triggered workflow | CI | `.github/workflows/e2e-prod.yml` | ❌ Wave 0 |
| TEST-PROD-12 | Create-and-teardown with permanent anchor + idempotent upserts | infra | Session teardown fixture in `conftest_prod.py` | ❌ Wave 0 |

---

## Wave 0 Gaps (all files to create in this phase)

- [ ] `services/agent-orchestrator/tests/e2e/conftest_prod.py` — session JWT, teardown, Sentry init
- [ ] `services/agent-orchestrator/tests/e2e/wave_a_api_contracts.py`
- [ ] `services/agent-orchestrator/tests/e2e/wave_b_agent_health.py`
- [ ] `services/agent-orchestrator/tests/e2e/wave_c_agent_triggers.py`
- [ ] `services/agent-orchestrator/tests/e2e/wave_d_toast_pipeline.py`
- [ ] `services/agent-orchestrator/tests/e2e/wave_e_gmail_pipeline.py`
- [ ] `services/agent-orchestrator/tests/e2e/wave_g_calendar.py`
- [ ] `apps/web/e2e/prod-smoke.spec.ts`
- [ ] `apps/web/playwright.prod.config.ts`
- [ ] `.github/workflows/e2e-prod.yml`
- [ ] `services/agent-orchestrator/scripts/setup_e2e_anchor.py`
- [ ] `services/agent-orchestrator/scripts/cascading_report.py`
- [ ] `services/agent-orchestrator/requirements.test.txt`

---

## Critical Constraints

- **NEVER set `PYTEST_RUNNING=1`** in `e2e-prod.yml` — it would silence Sentry in the FastAPI app
- JWT token must NEVER appear in JUnit XML output or GitHub Actions logs
- `e2e-test@wineops.internal` service account must be created before first run
- `e2e-test-restaurant` anchor row must exist in Supabase before first run
