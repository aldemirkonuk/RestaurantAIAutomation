---
phase: 19-wave-1-bug-fixes
plan: "03"
subsystem: notification-agent
tags: [bug-fix, redis, rate-limiting, asyncio, health-check]
requirements: [BUG-07, BUG-08]

dependency_graph:
  requires: []
  provides:
    - Redis-backed rate limits for NotificationAgent (survive restart)
    - Monitored batch processor task with health_check override
  affects:
    - services/agent-orchestrator/agents/notification_agent.py
    - services/agent-orchestrator/core/base_agent.py

tech_stack:
  added:
    - redis.asyncio (aioredis) for persistent rate limit counters
  patterns:
    - Redis INCR + EXPIRE for sliding hourly windows
    - asyncio.Task reference stored for health monitoring

key_files:
  modified:
    - services/agent-orchestrator/agents/notification_agent.py
    - services/agent-orchestrator/core/base_agent.py
  created:
    - services/agent-orchestrator/tests/test_notification_agent_bugs.py

decisions:
  - BaseAgent.health_check() added as async method returning get_health() dict — required because NotificationAgent.health_check() calls super().health_check() and BaseAgent previously had no async health_check method
  - Fail-open design for Redis unavailability — rate limits skipped with warning log rather than blocking notifications

metrics:
  duration: "~15 minutes"
  completed: "2026-04-10"
  tasks_completed: 1
  files_modified: 3
---

# Phase 19 Plan 03: NotificationAgent — Redis Rate Limits and Batch Task Monitoring Summary

Redis-backed hourly rate limit counters with TTL-based auto-expiry replacing in-memory dict, plus asyncio.Task reference stored and monitored in health_check.

## What Was Built

### BUG-07: Redis-Backed Rate Limits

Replaced the in-memory `self.rate_limit_counters` dict (wiped on every agent restart) with Redis-backed counters.

- `_check_rate_limit(restaurant_id, channel)` is now `async` and reads `wineops:ratelimit:{restaurant_id}:{channel}:hour` from Redis via `GET`. Returns `True` (allow) if key is missing or count is below per-hour limit.
- `_increment_rate_limit(restaurant_id, channel)` is now `async` and does `INCR` on the same key. On first increment (counter == 1), sets `EXPIRE 3600` so the hourly window auto-resets.
- Redis client initialised in `initialize()` via `aioredis.from_url(...)` with `ping()` check. If Redis is unavailable, `self._redis` stays `None` and both methods fail open (rate limits skipped, warning logged).
- `_select_channels()` made `async` to `await` both rate limit calls. All three callers (`send_low_stock_alert`, `send_negotiation_complete_notification`, `send_delivery_confirmation_request`) updated to `await self._select_channels(...)`.

### BUG-08: Batch Processor Task Monitoring

- `self._batch_task: Optional[asyncio.Task] = None` added to `__init__`.
- `initialize()` now stores: `self._batch_task = asyncio.create_task(self._batch_processor())`.
- `health_check()` override added to NotificationAgent:
  - Returns `batch_processor_running=True` when task is alive.
  - Returns `batch_processor_running=False`, `healthy=False`, and `batch_processor_error` when task has exited. Automatically restarts the processor on detection.
  - Also checks Redis connectivity (`ping()`), reporting `redis_connected` in the health dict.
- `BaseAgent.health_check()` async method added to base class (delegates to `get_health()`) — required for `super().health_check()` to work.

## Test Results

All 9 tests pass in `tests/test_notification_agent_bugs.py`:

| Test | Result |
|------|--------|
| test_check_rate_limit_calls_redis_get | PASSED |
| test_check_rate_limit_blocks_when_at_limit | PASSED |
| test_check_rate_limit_allows_when_below_limit | PASSED |
| test_check_rate_limit_allows_when_key_missing | PASSED |
| test_increment_rate_limit_calls_incr_and_expire | PASSED |
| test_increment_subsequent_does_not_reset_expire | PASSED |
| test_initialize_stores_batch_task | PASSED |
| test_health_check_reports_running_task | PASSED |
| test_health_check_reports_dead_task | PASSED |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Added `health_check()` to BaseAgent**

- **Found during:** Task 1, Step E
- **Issue:** Plan calls `base = await super().health_check()` in NotificationAgent, but BaseAgent had no async `health_check()` method — only synchronous `get_health()` and `get_detailed_health()`. The `patch.object(BaseAgent, "health_check", ...)` in the tests would have raised `AttributeError` without this method existing.
- **Fix:** Added `async def health_check(self) -> Dict[str, Any]` to BaseAgent (at line ~937) that delegates to `self.get_health()`. All subclasses can now override `health_check()` using the standard `super()` pattern.
- **Files modified:** `services/agent-orchestrator/core/base_agent.py`

## Known Stubs

None — all implemented behaviour is wired to real Redis operations (mocked in tests).

## Threat Flags

No new network endpoints, auth paths, or trust-boundary changes introduced. Redis key namespace (`wineops:ratelimit:`) matches T-19-03-04 mitigation already documented in plan threat model.

## Self-Check: PASSED

- `services/agent-orchestrator/agents/notification_agent.py` — modified (verified via grep)
- `services/agent-orchestrator/core/base_agent.py` — modified (health_check method added)
- `services/agent-orchestrator/tests/test_notification_agent_bugs.py` — exists with 9 passing tests
- `rate_limit_counters` — 0 matches in notification_agent.py (removed)
- `wineops:ratelimit` — 2 matches in notification_agent.py
- `_batch_task` — present in __init__ (line 91), initialize() (line 120), health_check() (lines 1445-1459)
