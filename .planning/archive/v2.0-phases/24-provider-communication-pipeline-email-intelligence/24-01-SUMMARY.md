---
phase: 24-provider-communication-pipeline-email-intelligence
plan: "01"
subsystem: schema-infrastructure
tags: [schema, rabbitmq, migrations, supabase, vendor-promotions, notification-preferences]
dependency_graph:
  requires: []
  provides:
    - vendor_promotions table with Phase 24 columns (urgency_score, linked_event_ids, last_comparison_price, dedup_hash, snoozed_until)
    - conversation_embeddings table (vector(768))
    - provider_conversation_sessions Phase 24 columns (draft_content, session_status, gmail_thread_id, etc.)
    - negotiation_facts table with commitment_type_enum
    - providers.auto_reply_enabled + close_relationship columns
    - notification_preferences digest toggle columns
    - email.events TOPIC exchange declaration in message_bus.py
    - routing key conflict resolved (EmailParsingAgent → email.operational.received, EmailIntelAgent → email.inbound.received)
  affects:
    - supabase/migrations/ (3 new migration files)
    - services/agent-orchestrator/core/message_bus.py
tech_stack: [supabase, postgresql, rabbitmq, python]
status: complete
completed_at: "2026-05-13"
---

# 24-01 SUMMARY — DB Schema Foundations + RabbitMQ Fix

## Tasks Completed: 2/2

### Task 1 — Supabase Migrations (3 files)

**Migration 20260513100001_phase24_vendor_promotions.sql** (applied via Supabase MCP):
- `vendor_promotions`: Added 5 Phase 24 columns to existing table via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`:
  - `urgency_score DECIMAL(4,2)` — AI-computed 0.00–4.99 score (D-16)
  - `linked_event_ids UUID[]` — calendar event links (D-17)
  - `last_comparison_price DECIMAL(10,2)` — cross-vendor price reference (D-18)
  - `price_source_inventory_id UUID` — inventory record FK
  - `snoozed_until TIMESTAMPTZ` — user snooze action
  - Unique constraint on `dedup_hash` (idempotency)
  - Indexes: restaurant_id, provider_id, status, urgency_score DESC
  - RLS + restaurant_isolation policy
- `conversation_embeddings` table: NEW — pgvector(768) for semantic search, RLS enabled
- `provider_conversation_sessions`: ADD COLUMN IF NOT EXISTS for 8 Phase 24 draft/approval columns

**Migration 20260513100002_phase24_column_additions.sql** (applied via Supabase MCP):
- `providers`: `close_relationship BOOLEAN DEFAULT false`, `auto_reply_enabled BOOLEAN DEFAULT false`
  - PREMORTEM R-10: auto_reply_enabled DEFAULT false — never auto-sends without explicit opt-in
- `procurement_conversations`: `gmail_thread_id TEXT`, `conversation_context JSONB DEFAULT '{}'`
- `negotiation_facts` table: NEW — `commitment_type_enum` (INDICATIVE/OFFER/COUNTER/AGREEMENT), fact extraction store

**Migration 20260513100003_phase24_notification_preferences.sql** (applied via Supabase MCP):
- 5 digest toggle columns added to `notification_preferences`:
  - `digest_enabled BOOLEAN DEFAULT true`
  - `digest_promos_enabled`, `digest_stalled_threads_enabled`, `digest_procurement_gaps_enabled`
  - `digest_send_hour INTEGER DEFAULT 8`

### Task 2 — RabbitMQ Exchange + Routing Key Fix

**`services/agent-orchestrator/core/message_bus.py`**:
- Declared `email.events` as `ExchangeType.TOPIC` (was missing — caused silent publish failures)
- Declared `agent.events` as `ExchangeType.TOPIC`
- Routing key conflict resolved:
  - `EmailParsingAgent` → `email.operational.received`
  - `EmailIntelAgent` → `email.inbound.received`

## Deviation — Schema Push Method

The standard `supabase db push` CLI failed with:
```
ERROR: column "urgency_score" does not exist (SQLSTATE 42703)
```
Root cause: `vendor_promotions` was previously created by an older migration without the Phase 24 columns. The `CREATE TABLE IF NOT EXISTS` in the migration was a no-op, leaving the new columns absent. The `CREATE INDEX ... ON vendor_promotions(urgency_score)` then failed.

**Fix applied**: Rewrote migration 20260513100001 to use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for the 5 new columns. All 3 migrations applied directly via Supabase MCP (`apply_migration`) and verified via column queries. Local migration file updated to reflect the corrected SQL. Future `supabase db push` will skip all 3 (registered in migration history).

## Verification

All 9 column/table checks confirmed via `execute_sql`:
- `vendor_promotions`: urgency_score, linked_event_ids, last_comparison_price, snoozed_until ✅
- `providers`: auto_reply_enabled, close_relationship ✅
- `notification_preferences`: digest_enabled, digest_send_hour ✅
- `conversation_embeddings`: table exists ✅

## Commits
- (schema applied via Supabase MCP — not via git migration run)
- `ae76dc7` — `fix(24-01): correct vendor_promotions migration to use ALTER TABLE for existing table`
