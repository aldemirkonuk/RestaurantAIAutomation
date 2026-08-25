---
plan: 20-03
phase: 20-wave-1-level-4-hardening
status: checkpoint-pending
checkpoint_type: human-action
---

# Summary: NotificationAgent Level-4 Hardening

## What Was Built
Created `notification_deliveries` migration, wired delivery tracking + idempotency + DLQ into `NotificationAgent`. 13 integration tests written and committed.

## Key Files
### Created
- `supabase/migrations/20260415000001_notification_deliveries.sql` — DDL: 8-column table, CHECK constraints, indexes on (event_id, channel) and (restaurant_id, created_at)
- `services/agent-orchestrator/tests/test_notification_agent_hardening.py` — 13 integration tests (437 lines)

### Modified
- `services/agent-orchestrator/agents/notification_agent.py` — +156 lines: delivery tracking, idempotency, DLQ after 3 retries

## Must-Have Verification
- [x] `_check_idempotency` called before every send
- [x] `notification_deliveries` table insert on every attempt
- [x] `_send_to_dlq` triggered after 3 failed retries
- [x] 13 integration tests (exceeds 10+ requirement)

## CHECKPOINT: Supabase Migration Push Required
**Action needed:** Run the following from the project root:
```bash
supabase db push
```
This will apply `20260415000001_notification_deliveries.sql` to your Supabase instance.

Note: Migration filename was changed from `20260410000000` to `20260415000001` because `20260410000000_phase10_pricing.sql` already exists (auto-fix deviation).

## Deviations
- Migration timestamp: `20260410000000` → `20260415000001` (timestamp conflict with existing migration)
