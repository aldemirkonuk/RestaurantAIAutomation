---
phase: 24-provider-communication-pipeline-email-intelligence
plan: "01"
subsystem: database-schema + message-bus
tags: [migrations, supabase, rabbitmq, infrastructure]
dependency_graph:
  requires: []
  provides:
    - vendor_promotions table with urgency_score, linked_event_ids[], last_comparison_price, snoozed_until, dedup_hash
    - conversation_embeddings table (vector(768))
    - provider_conversation_sessions Phase-24 columns (gmail_thread_id, draft approval flow)
    - providers.auto_reply_enabled (DEFAULT false), providers.close_relationship
    - procurement_conversations.gmail_thread_id, conversation_context
    - negotiation_facts table with commitment_type enum
    - notification_preferences digest toggle columns (5)
    - email.events TOPIC exchange in message_bus.py
    - agent.events TOPIC exchange in message_bus.py (cross-agent coordination)
  affects:
    - services/agent-orchestrator/core/message_bus.py
tech_stack:
  added: []
  patterns:
    - CREATE TABLE IF NOT EXISTS + ALTER TABLE ADD COLUMN IF NOT EXISTS for idempotent migrations
    - DROP POLICY IF EXISTS before CREATE POLICY for re-runnable RLS setup
    - DO $$ BEGIN IF NOT EXISTS ... END $$ for safe enum creation
key_files:
  created:
    - supabase/migrations/20260513100001_phase24_vendor_promotions.sql
    - supabase/migrations/20260513100002_phase24_column_additions.sql
    - supabase/migrations/20260513100003_phase24_notification_preferences.sql
  modified:
    - services/agent-orchestrator/core/message_bus.py
decisions:
  - providers.auto_reply_enabled DEFAULT false enforced in SQL (premortem R-10 safety — wrong default enables auto-send without consent)
  - negotiation_facts table created in migration 2 (not just ALTER TABLE) since no prior migration defined it
  - provider_conversation_sessions Phase-24 columns added via ALTER TABLE because base table already existed from 20260304010000
metrics:
  duration: "6 minutes"
  completed: "2026-05-14T00:46:00Z"
  tasks_completed: 4
  files_created: 3
  files_modified: 1
---

# Phase 24 Plan 01: Schema Foundations + Infrastructure Fix Summary

**One-liner:** 3 idempotent Supabase migrations create Phase 24 tables (vendor_promotions with urgency scoring, conversation_embeddings with vector(768), negotiation_facts with commitment_type enum) and fix the blocking `email.events` missing exchange in message_bus.py.

---

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Create Phase 24 vendor_promotions + conversation tables | 2d771bd | supabase/migrations/20260513100001_phase24_vendor_promotions.sql |
| 2 | Create column additions migration (providers + procurement) | f655b30 | supabase/migrations/20260513100002_phase24_column_additions.sql |
| 3 | Create notification_preferences digest columns migration | 427196c | supabase/migrations/20260513100003_phase24_notification_preferences.sql |
| 4 | Fix email.events exchange in message_bus.py [BLOCKING bug] | b7bf4e4 | services/agent-orchestrator/core/message_bus.py |

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Existing Table] provider_conversation_sessions already existed**
- **Found during:** Task 1
- **Issue:** `provider_conversation_sessions` was created in `20260304010000_missing_tables_consolidation.sql` with a different schema (session_type, status, initiated_by, intent, context, topic_stack, approval_pending, pending_message, messages_count, started_at, etc.). The plan's `CREATE TABLE IF NOT EXISTS` would be a no-op, leaving Phase-24-specific columns absent.
- **Fix:** Added `ALTER TABLE provider_conversation_sessions ADD COLUMN IF NOT EXISTS ...` for all Phase-24-specific columns after the no-op CREATE TABLE: `gmail_thread_id`, `session_status`, `draft_content`, `draft_created_at`, `draft_approved_at`, `draft_discarded_at`, `reminder_sent_at`, `conversation_context`.
- **Files modified:** `supabase/migrations/20260513100001_phase24_vendor_promotions.sql`
- **Commit:** 2d771bd

**2. [Rule 2 - Missing Critical Functionality] negotiation_facts table absent from all migrations**
- **Found during:** Task 2
- **Issue:** `ALTER TABLE negotiation_facts ADD COLUMN IF NOT EXISTS commitment_type` would fail with "relation does not exist". `negotiation_facts` existed in no prior Supabase migration. Plan 24-05 queries it with `providers.notes` as fallback.
- **Fix:** Added `CREATE TABLE IF NOT EXISTS negotiation_facts` with full schema (provider_id, restaurant_id, conversation_id, fact_field, fact_value, commitment_type, confidence, source_message_id, valid_from, valid_until) + 3 indexes. The ALTER TABLE that follows is idempotent in case the table existed in the live DB without this column.
- **Files modified:** `supabase/migrations/20260513100002_phase24_column_additions.sql`
- **Commit:** f655b30

**3. [Rule 2 - Security Hardening] RLS policies use DROP POLICY IF EXISTS before CREATE**
- **Found during:** Task 1
- **Issue:** Repeated `supabase db push` calls would fail with "policy already exists" on the new tables.
- **Fix:** Added `DROP POLICY IF EXISTS ... ON ...` before each `CREATE POLICY` statement in migration 1.
- **Files modified:** `supabase/migrations/20260513100001_phase24_vendor_promotions.sql`
- **Commit:** 2d771bd

---

## Verification Results

```bash
# Migration 1 checks — all PASS
grep -c "CREATE TABLE IF NOT EXISTS vendor_promotions" ...  → 1 ✅
grep -c "urgency_score DECIMAL" ...                         → 1 ✅
grep -c "linked_event_ids UUID\[\]" ...                     → 1 ✅
grep -c "last_comparison_price DECIMAL" ...                 → 1 ✅
grep -c "snoozed_until TIMESTAMPTZ" ...                     → 1 ✅
grep -c "CREATE TABLE IF NOT EXISTS conversation_embeddings" → 1 ✅
grep -c "vector(768)" ...                                   → 1 ✅
grep -c "CREATE TABLE IF NOT EXISTS provider_conversation_sessions" → 1 ✅
grep -c "ENABLE ROW LEVEL SECURITY" ...                     → 3 ✅

# Migration 2 checks — all PASS
grep -c "auto_reply_enabled BOOLEAN DEFAULT false" ...      → 1 ✅
grep -c "close_relationship BOOLEAN DEFAULT false" ...      → 1 ✅
grep -c "gmail_thread_id TEXT" ...                          → 1 ✅
grep -c "commitment_type_enum" ...                          → 4 ✅ (≥2 required)
grep -c "ADD COLUMN IF NOT EXISTS" ...                      → 6 ✅ (≥4 required)

# Migration 3 checks — all PASS
grep -c "digest_enabled BOOLEAN DEFAULT true" ...           → 1 ✅
grep -c "digest_send_hour INTEGER DEFAULT 8" ...            → 1 ✅
grep -c "ADD COLUMN IF NOT EXISTS" ...                      → 5 ✅

# message_bus.py checks — all PASS
grep -c '"email.events"' services/agent-orchestrator/core/message_bus.py  → 1 ✅
grep -n '"email.events"' ...  → line 439 inside _setup_exchanges() ✅
grep -c 'ExchangeType.TOPIC' services/agent-orchestrator/core/message_bus.py → 13 ✅ (was 11, +2)
python3 -c "from core.message_bus import MessageBus; print('import ok')" → import ok ✅
```

---

## Must-Haves Checklist

- [x] `vendor_promotions` table has: urgency_score, linked_event_ids[], last_comparison_price, snoozed_until, dedup_hash (all in migration SQL)
- [x] `providers.auto_reply_enabled = BOOLEAN DEFAULT false` (grep-verified)
- [x] `notification_preferences` has 5 new digest columns (grep-verified)
- [x] `message_bus.py` has `("email.events", ExchangeType.TOPIC, True)` in `_setup_exchanges()`
- [x] 3 SQL migration files exist in `supabase/migrations/` with 20260513100001/2/3 prefixes

---

## Known Stubs

None — all migrations are pure DDL with no placeholder values.

---

## Threat Surface Scan

No new network endpoints, auth paths, or file access patterns introduced. Schema changes are scoped to RLS-protected tables using `restaurant_id = (SELECT restaurant_id FROM users WHERE id = auth.uid())`.

The `email.events` and `agent.events` exchanges are infrastructure-level (same auth model as all other exchanges — T-24-01-03 accepted in threat model).

---

## Self-Check: PASSED

```
supabase/migrations/20260513100001_phase24_vendor_promotions.sql — FOUND ✅
supabase/migrations/20260513100002_phase24_column_additions.sql — FOUND ✅
supabase/migrations/20260513100003_phase24_notification_preferences.sql — FOUND ✅
services/agent-orchestrator/core/message_bus.py (email.events line 439) — FOUND ✅
git log: 2d771bd, f655b30, 427196c, b7bf4e4 — all FOUND ✅
```

---

## Next Step

**Checkpoint: human-verify** — Run `supabase db push` to apply the 3 migrations, then verify schema in Supabase Studio or via `supabase db diff`. Resume with "schema pushed" once complete.
