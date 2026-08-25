---
plan: 18-01
phase: 18-infrastructure-foundation
status: completed
completed_at: 2026-04-10
---

# Summary: Database Infrastructure Migrations

## What Was Built
6 Supabase SQL migration files providing the persistence layer for BaseAgent Level 4 infrastructure.

## Key Files Created
- `supabase/migrations/20260414000000_idempotency_keys.sql` — duplicate message detection table (PK=message_id, 24h TTL, agent_name index)
- `supabase/migrations/20260414000001_decision_log.sql` — agent decision audit log (UUID PK, confidence FLOAT, correlation_id, restaurant_id FK)
- `supabase/migrations/20260414000002_outbox.sql` — transactional outbox (BIGSERIAL PK, partial index WHERE published = FALSE)
- `supabase/migrations/20260414000003_saga_state.sql` — saga state machine (UUID PK, compensations JSONB array, deadline_at)
- `supabase/migrations/20260414000004_event_store.sql` — append-only event store (unique constraint on aggregate+sequence)
- `supabase/migrations/20260414000005_dead_letter_queue.sql` — DLQ for exhausted retries (retry_count, resolved_at, resolved_by)

## Decisions Made
- Used `CREATE TABLE IF NOT EXISTS` throughout for idempotent migration re-runs
- `outbox` uses partial index `WHERE published = FALSE` for efficient publisher polling
- `event_store` enforces append-only via unique constraint (no UPDATE/DELETE methods in code)
- `idempotency_keys` defaults to 24h TTL via `expires_at` column

## Verification
- All 6 files accepted criteria checks (grep pattern matching)
- `supabase db push` run locally — all 6 tables confirmed in Supabase

## Commit
`fb58e8d` — feat(18-01): create 6 infrastructure DB migration files for BaseAgent Level 4
