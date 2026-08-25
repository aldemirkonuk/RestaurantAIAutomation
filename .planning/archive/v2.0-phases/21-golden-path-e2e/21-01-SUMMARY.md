---
phase: 21-golden-path-e2e
plan: "01"
subsystem: agent-orchestrator-config
tags: [settings, configuration, rabbitmq, toast-pos, notifications, e2e-unblock]
dependency_graph:
  requires: []
  provides: [settings.rabbitmq_url, settings.toast_api_url, settings.toast_webhook_secret, settings.notification_threshold_pct, settings.buffer_window_minutes]
  affects: [21-02, 21-03, core/orchestrator.py, agents/inventory_engine.py, agents/pos_integration_agent.py, agents/notification_agent.py]
tech_stack:
  added: []
  patterns: [env-var-binding, lru_cache-settings-singleton, optional-str-for-secrets]
key_files:
  created: []
  modified:
    - services/agent-orchestrator/config/settings.py
    - env.example
decisions:
  - "Kept plivo_auth_id/auth_token/phone_number separate from existing gmail_user/gmail_password — no duplication"
  - "supabase_service_role_key alias reads SUPABASE_SERVICE_ROLE_KEY first, falls back to existing self.supabase_key — no new exposure"
  - "rabbitmq_url constructed from individual components when RABBITMQ_URL env var is not explicitly set"
  - "env.example appended rather than rewritten — existing RABBITMQ_URL, TOAST_*, PLIVO_*, BUFFER_WINDOW_MINUTES entries preserved"
metrics:
  duration_minutes: 15
  completed_date: "2026-04-12"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 2
---

# Phase 21 Plan 01: Settings Extension for Golden Path E2E Summary

**One-liner:** Extended Settings class with 29 new env-var-bound attributes (RabbitMQ, Toast POS, inventory buffers, LLM routing, notification backends) that unblock Plans 21-02 and 21-03 from AttributeError on import.

## What Was Built

The `Settings.__init__` in `services/agent-orchestrator/config/settings.py` received 7 new attribute groups (62 lines added) covering every attribute that `core/orchestrator.py` and the 4 golden-path agents read but that the previous 119-line class did not define. All attributes follow the existing pattern: `os.getenv("ENV_VAR", default)` with appropriate type coercion.

`env.example` was extended with a Phase 21 section documenting 18 additional env vars not previously listed (individual RabbitMQ components, EVALUATION_INTERVAL_SECONDS, NOTIFICATION_THRESHOLD_PCT, LLM routing, notification backends). Existing entries for RABBITMQ_URL, TOAST_*, PLIVO_*, BUFFER_WINDOW_MINUTES, DEBUG were preserved.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extend Settings class with all orchestrator-required attributes | 9eb4445 | services/agent-orchestrator/config/settings.py |
| 2 | Document new env vars in env.example | 594c562 | env.example |

## Verification Results

```
PASS — 29 attributes verified
```

All 29 required attributes present on the Settings instance with zero AttributeError. Full verification command from plan passed:

```bash
cd services/agent-orchestrator
python3 -c "from config.settings import get_settings; s = get_settings(); ..."
# PASS — 29 attributes verified
```

`env.example` grep check: 6 matches across RABBITMQ_URL, TOAST_WEBHOOK_SECRET, MOCK_NOTIFICATIONS, BUFFER_WINDOW_MINUTES (threshold = 4).

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written.

**Note:** The plan mentioned checking for `AgentConfig` in `core/orchestrator.py` and adding `model_config = ConfigDict(extra='ignore')` if present. No `AgentConfig` class was found in that file, so this step was correctly skipped.

**Note:** `env.example` already contained entries for RABBITMQ_URL, TOAST_API_URL, TOAST_CLIENT_ID, TOAST_CLIENT_SECRET, TOAST_RESTAURANT_GUID, TOAST_WEBHOOK_SECRET, TOAST_ENVIRONMENT, MOCK_POS, PLIVO_AUTH_ID, PLIVO_AUTH_TOKEN, PLIVO_PHONE_NUMBER, BUFFER_WINDOW_MINUTES, DEFAULT_THRESHOLD_MIN, DEBUG from prior phases. Phase 21 block appended only the missing vars rather than duplicating existing entries, consistent with the plan's "do NOT overwrite existing entries" instruction.

## Known Stubs

None — this plan only adds attribute bindings. No data flows to UI rendering.

## Threat Flags

No new network endpoints, auth paths, or schema changes introduced. The `supabase_service_role_key` alias (T-21-01-03) only aliases an already-present env var — no new exposure. `toast_client_secret`, `plivo_auth_token`, and other sensitive Optional[str] fields default to None and are not logged anywhere in the Settings class.

## Self-Check: PASSED

- `services/agent-orchestrator/config/settings.py` — verified via python3 import + attribute check
- `env.example` — verified via grep count (6 >= 4)
- Commit `9eb4445` — Task 1 (settings extension)
- Commit `594c562` — Task 2 (env.example documentation)
