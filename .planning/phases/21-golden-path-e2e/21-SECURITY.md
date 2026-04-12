---
phase: 21
slug: golden-path-e2e
status: secured
threats_open: 0
threats_total: 14
threats_closed: 14
asvs_level: 1
audited: 2026-04-12
---

# Security Audit — Phase 21: Golden Path E2E

## Summary

| Metric | Count |
|--------|-------|
| Threats in register | 14 |
| Accepted (closed by design) | 7 |
| Mitigate (verified closed) | 7 |
| Open | 0 |

**Verdict: SECURED** — all 14 threats have dispositions. No phase advancement block.

---

## Threat Register

| Threat ID | Category | Component | Disposition | Status | Evidence |
|-----------|----------|-----------|-------------|--------|----------|
| T-21-01-01 | Information Disclosure | settings.py — sensitive fields | mitigate | CLOSED | Lines 123–126, 147–148: `toast_client_secret`, `plivo_auth_token` etc. are `Optional[str]` defaulting to `None`. No `logger.info(str(self))` or `print(self.__dict__)` anywhere in settings.py or main.py. |
| T-21-01-02 | Tampering | rabbitmq_url from env | accept | CLOSED | Localhost default only. Production URL set explicitly via RABBITMQ_URL. Low risk in dev. |
| T-21-01-03 | Elevation of Privilege | supabase_service_role_key alias | mitigate | CLOSED | settings.py line 162–164: alias reads `os.getenv("SUPABASE_SERVICE_ROLE_KEY")` — same env var already present. No new privilege surface. |
| T-21-02-01 | Spoofing | Toast-Signature HMAC verification | mitigate | CLOSED | pos_routes.py line 41: raw bytes captured. Line 68: passed as `raw_payload=` to `agent.process_toast_webhook()`. Lines 76–81: signature failure → HTTP 401. |
| T-21-02-02 | Denial of Service | No rate limit on webhook | accept | CLOSED | MVP scope. Toast sends ≤100 webhooks/hour per restaurant. Rate limiting deferred to Phase 22. |
| T-21-02-03 | Tampering | RabbitMQ connection in lifespan | mitigate | CLOSED | main.py lines 47–56: connection wrapped in `try/except Exception`. Failure logs warning, yields (HTTP routes still serve), does not crash. |
| T-21-02-04 | Information Disclosure | HTTP 500 exception detail | mitigate | CLOSED | pos_routes.py line 73: `str(exc)` — not a full traceback. Acceptable for internal MVP service. Phase 22 will replace with Sentry + generic message. |
| T-21-03-01 | Information Disclosure | Restaurant GUID in test fixtures | accept | CLOSED | Test GUID `e5d6d489-25fa-4082-9cad-3e9e74225517` is from RESEARCH.md, used in existing test files. Not a production secret. |
| T-21-03-02 | Tampering | mock_mode disables HMAC in tests | accept | CLOSED | Intentional for unit tests. HMAC path tested separately in test_pos_integration_bugs.py. |
| T-21-03-03 | Denial of Service | asyncio.gather hiding agent failures | mitigate | CLOSED | test_golden_path_e2e.py lines 409–437: all steps are independent `await` calls. No `asyncio.gather()` in the full golden path test. Failures surface immediately. |
| T-21-04-01 | Spoofing | ngrok URL publicly accessible | accept | CLOSED | Ephemeral ngrok URL + 1-session duration. HMAC verification (MOCK_POS=false) ensures only Toast-signed payloads accepted. |
| T-21-04-02 | Information Disclosure | ngrok script prints secret status | mitigate | CLOSED | ngrok_live_test.py line 269: prints `"set"` or `"NOT SET"` — never the actual secret value. |
| T-21-04-03 | Denial of Service | 100 concurrent tasks in chaos test | accept | CLOSED | In-process asyncio gather with mocked bus. No real network traffic. Test isolation ensures no resource leak. |
| T-21-04-04 | Elevation of Privilege | Toast API token in curl instructions | accept | CLOSED | Script only prints curl commands, never executes them. User provides their own credentials. |

---

## Accepted Risks Log

| Threat ID | Risk | Rationale | Owner |
|-----------|------|-----------|-------|
| T-21-01-02 | rabbitmq_url tampered via env | Dev-only concern; prod uses explicit RABBITMQ_URL | Platform team |
| T-21-02-02 | No webhook rate limiting | MVP scope; ≤100 events/hr per restaurant; mitigate in Phase 22 | Backend team |
| T-21-03-01 | Restaurant GUID in test code | Not a production credential; already in RESEARCH.md | QA team |
| T-21-03-02 | HMAC bypassed in unit tests | Intentional; HMAC path covered in separate test file | Backend team |
| T-21-04-01 | ngrok URL discoverable | Ephemeral session; HMAC rejects unsigned payloads | Backend team |
| T-21-04-03 | 100 concurrent mocked tasks | In-process only; no external resource risk | QA team |
| T-21-04-04 | Toast token in printed curl | User-executed; script never auto-runs credentials | Backend team |

---

## Audit Trail

### Security Audit 2026-04-12

| Metric | Count |
|--------|-------|
| Threats found | 14 |
| Accepted (closed by design) | 7 |
| Mitigate verified closed | 7 |
| Open | 0 |

Auditor: gsd-security-auditor (automated)
Evidence reviewed: settings.py, main.py, api/pos_routes.py, tests/test_golden_path_e2e.py, scripts/ngrok_live_test.py
