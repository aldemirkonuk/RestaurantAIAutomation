---
plan: 20-07
status: complete
committed: true
---

# Plan 20-07 Summary: ReportingAgent UTC Midnight Idempotency Boundary Fix

## What was built

Added caller-date awareness to `ReportingAgent.process_message` so that schedulers operating near a UTC midnight boundary no longer silently produce duplicate reports. When no `date` is supplied by the caller the agent now emits a WARNING log (operator-visible signal of a misconfigured scheduler) and records `date_source: "utc_default"` in the `log_decision` audit trail. When the caller supplies an explicit date, `date_source: "caller"` is recorded instead.

## Files changed

- `services/agent-orchestrator/agents/reporting_agent.py` — split single-line date extraction into conditional block; added `date_source` variable; added `logger.warning` on missing date; added `date_source` to `log_decision` output dict; added docstring contract on scheduler responsibility.
- `services/agent-orchestrator/tests/test_reporting_agent_hardening.py` — added 3 tests to `TestHARD04EdgeCases`: `test_missing_date_logs_warning`, `test_explicit_date_overrides_utc`, `test_log_decision_output_includes_date_source`.

## Verification

```
16 passed in 0.60s
```

All 13 pre-existing tests continued to pass. All 3 new tests passed on first run.

## Key decisions

- Chose Option A (caller-supplied date with warning) over Option B (force-require date field and reject messages without it) to remain backward-compatible with existing schedulers while making the misconfiguration loudly visible in logs.
- `date_source` is placed in the `output` dict of `log_decision` (not `inputs`) because it describes what the agent did, not what it received — consistent with the existing output schema pattern in the codebase.
- The WARNING message includes both the `restaurant_id` and the UTC date string so operators can correlate the warning with the specific report key that was generated.
