---
phase: 22-observability-deployment
plan: "02"
subsystem: pos-abstraction
tags: [pos, abstraction, protocol, toast, sentry, observability]
dependency_graph:
  requires: []
  provides: [POSProvider, POSEvent, ToastAdapter, generic-webhook-route, sentry-agent-tags]
  affects: [pos_routes.py, pos_integration_agent.py, base_agent.py]
tech_stack:
  added: [adapters package, POSProvider Protocol, POSEvent Pydantic model]
  patterns: [Protocol runtime_checkable, adapter pattern, lazy provider registry]
key_files:
  created:
    - services/agent-orchestrator/core/pos_provider.py
    - services/agent-orchestrator/adapters/__init__.py
    - services/agent-orchestrator/adapters/toast_adapter.py
    - services/agent-orchestrator/tests/test_pos_abstraction.py
  modified:
    - services/agent-orchestrator/api/pos_routes.py
    - services/agent-orchestrator/agents/pos_integration_agent.py
    - services/agent-orchestrator/core/base_agent.py
decisions:
  - "ToastAdapter._secret defaults to empty string (not None) to simplify HMAC guard logic"
  - "process_pos_event delegates to process_toast_webhook with signature=None (adapter already verified)"
  - "_get_providers() instantiated lazily per-request to avoid import-time settings loading"
  - "Sentry tags added in _process_with_retry before retry loop for per-message attribution"
metrics:
  duration: ~15 minutes
  completed_date: "2026-04-13"
  tasks_completed: 2
  files_changed: 7
---

# Phase 22 Plan 02: POS Provider Abstraction + Sentry Agent Tags Summary

**One-liner:** POSProvider Protocol + ToastAdapter with HMAC-SHA256 + generic `{provider}` webhook route + Sentry per-agent scope tags.

## What Was Built

### Task 1: POSProvider abstraction layer (TDD)

**Files created:**
- `core/pos_provider.py` — `POSProvider` Protocol (`@runtime_checkable`) and `POSEvent` Pydantic model
- `adapters/__init__.py` — package init for POS provider adapters
- `adapters/toast_adapter.py` — `ToastAdapter(webhook_secret)` implementing `POSProvider`:
  - `verify_webhook(raw, signature)` — HMAC-SHA256 with `hmac.compare_digest` (constant-time)
  - `normalize_event(raw)` — converts Toast JSON dict to `POSEvent`, handles missing fields gracefully
- `tests/test_pos_abstraction.py` — 6 tests covering all contract requirements

**TDD execution:** Tests written first (red: ImportError), then implementation (green: 6 passed).

### Task 2: Generic webhook route + agent method + Sentry tags

**`api/pos_routes.py` rewritten:**
- Old route: `POST /webhook/toast` (Toast-specific)
- New route: `POST /webhook/{provider}` (generic)
- `_get_providers()` returns dict of registered adapters (lazy instantiation)
- Unknown provider → 404 with registered providers listed
- Flow: registry lookup → HMAC verify → normalize → `process_pos_event()`

**`agents/pos_integration_agent.py`:**
- Added `process_pos_event(event: POSEvent) -> dict` — provider-agnostic entry point
- Delegates to `process_toast_webhook(signature=None)` — signature pre-verified by adapter
- Original `process_toast_webhook()` kept intact for backward compatibility

**`core/base_agent.py`:**
- Added `sentry_sdk.set_tag("agent", self.agent_name)` in `_process_with_retry()`
- Also tags `correlation_id` when present
- Wrapped in `try/except ImportError` guard

## Test Results

```
tests/test_pos_abstraction.py ......   (6/6 new tests)
tests/test_golden_path_e2e.py .....   (5/5 Phase 21 backward compat)
tests/test_chaos_e2e.py .....         (5/5 Phase 21 backward compat)
16 passed in 7.90s
```

## Commits

| Hash | Description |
|------|-------------|
| b89bb0f | feat(22-02): add POSProvider Protocol, POSEvent, and ToastAdapter abstraction |
| 4f199a9 | feat(22-02): generic provider webhook route, process_pos_event, Sentry agent tags |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — no stubs or placeholders introduced.

## Threat Surface

All threats from plan's `<threat_model>` mitigated as designed:
- T-22-02-01: Provider whitelist via `_get_providers()` registry — unknown providers return 404
- T-22-02-02: `hmac.compare_digest` used for constant-time HMAC comparison
- T-22-02-03: `ToastAdapter` never logs `_secret` — only logs error messages
- T-22-02-04: `signature=None` in `process_pos_event` is intentional — documented with inline comment
