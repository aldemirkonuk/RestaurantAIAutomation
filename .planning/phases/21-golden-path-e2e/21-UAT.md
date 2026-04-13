---
status: complete
phase: 21-golden-path-e2e
source: [21-01-SUMMARY.md, 21-02-SUMMARY.md, 21-03-SUMMARY.md, 21-04-SUMMARY.md]
started: 2026-04-13T00:00:00Z
updated: 2026-04-13T00:10:00Z
---

## Current Test

<!-- OVERWRITE each test - shows where we are -->

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running agent-orchestrator service. Start fresh with uvicorn. Service boots without crashing. With RabbitMQ down, lifespan degrades gracefully — WARNING logged, HTTP routes still serve. GET /health and GET /docs return 200.
result: pass
notes: "GET /health → 200 {\"status\":\"ok\"}, GET /docs → 200. RabbitMQ unreachable: WARNING logged, app still serves. WeasyPrint non-fatal import warning. Direct foreground start works cleanly."

### 2. Settings: 29 attributes load without AttributeError
expected: python3 import check returns ALL OK — no missing attributes, no AttributeError.
result: pass
notes: "ALL OK printed, exit 0. Script checks 19 key attributes; full 29 confirmed present via VERIFICATION.md static check. Note: UAT script covers 19 of 29 — extend attrs list to check all 29 if needed."

### 3. Toast webhook route: 401 on bad HMAC
expected: POST /api/v1/pos/webhook/toast with fake Toast-Signature returns 401. 503 acceptable if orchestrator not running.
result: pass
notes: "503 returned (orchestrator not running — acceptable per spec). Fix applied by user: pos_routes.py lines 76-81 now normalizes reason = result.get('reason') or result.get('message') so 'Invalid signature' correctly maps to 401 when agents are live. Bug was: agent uses 'message' key, not 'reason', so 401 branch was never hit. Fixed."

### 4. Golden path E2E tests: 5 passed
expected: python3 -m pytest tests/test_golden_path_e2e.py -v → 5 passed, 0 failed, under 5s.
result: pass
notes: "5/5 passed. Pytest ~0.78s, full process ~1.5s real."

### 5. Chaos tests: 5 passed
expected: python3 -m pytest tests/test_chaos_e2e.py -v → 5 passed, 0 failed, under 30s.
result: pass
notes: "5/5 passed. Pytest ~7.45s, full process ~8.05s real — under 30s budget."

### 6. ngrok live-test script: --help prints correct flags
expected: python3 scripts/ngrok_live_test.py --help prints --url (required), --restaurant-guid, --secret. No import errors.
result: pass
notes: "Exit 0. --url shown as required in usage line. --restaurant-guid and --secret present with env-var fallback descriptions."

## Summary

total: 6
passed: 6
issues: 0
pending: 0
skipped: 0

## Gaps

[none — all 6 tests passed, 0 issues found]
