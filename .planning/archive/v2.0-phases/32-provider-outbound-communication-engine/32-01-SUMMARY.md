---
phase: 32-provider-outbound-communication-engine
plan: "01"
subsystem: schema-migration
tags: [migration, supabase, schema, settings, python]
dependency_graph:
  requires: []
  provides:
    - providers.profile_foundational JSONB column
    - providers.profile_dynamic JSONB column
    - procurement_conversations Phase 32 columns (6 new)
    - Phase 32 runtime constants in settings.py
    - rapidfuzz>=3.0.0 dependency
  affects:
    - All Phase 32 plans (32-02 through 32-07) depend on this schema
tech_stack:
  added:
    - rapidfuzz>=3.6.0 (already present in requirements.txt before this plan)
  patterns:
    - Supabase MCP apply_migration for DDL
    - ADD COLUMN IF NOT EXISTS idempotent migrations
    - GIN indexes on JSONB columns with partial filter
key_files:
  created:
    - supabase/migrations/20260514000000_phase32_schema.sql
  modified:
    - services/agent-orchestrator/config/settings.py
decisions:
  - Used Supabase MCP apply_migration instead of supabase db push (no CLI available in agent context)
  - Removed idx_conv_status_restaurant partial index: procurement_conversations has no 'status' column (uses delivery_status); index would have failed schema push
  - restaurant_id column already existed on procurement_conversations — ADD COLUMN IF NOT EXISTS was a safe no-op
  - rapidfuzz>=3.6.0 already in requirements.txt (satisfies >=3.0.0 requirement); no change needed
metrics:
  duration: ~8 minutes
  completed_date: "2026-05-14"
  tasks_completed: 4
  files_changed: 2
---

# Phase 32 Plan 01: Phase 32 Schema Migration + Settings Summary

**One-liner:** Phase 32 schema foundation — JSONB provider intelligence columns, 6 procurement_conversations additions, and 8 runtime constants pushed to live Supabase DB.

## Verified Facts (Task 1 — Carried Forward)

```
VERIFIED_NOTIFICATION_FIELD = "status"  # notifications table uses status='unread', NOT is_read
VERIFIED: providers.relationship_health_score EXISTS in live DB
```

All Phase 32 plans (32-03, 32-06) using notification inserts **MUST use** `"status": "unread"`, NOT `"is_read": False`.

## What Was Built

### Task 2: Schema Migration (`supabase/migrations/20260514000000_phase32_schema.sql`)

Applied to live DB (`exzueerziesmczwlhomd` — Restaurant_Wine_Ops, us-west-2) via Supabase MCP.

**providers table additions:**
| Column | Type | Default |
|--------|------|---------|
| profile_foundational | JSONB | '{}' |
| profile_dynamic | JSONB | '{}' |

GIN indexes: `idx_providers_profile_foundational`, `idx_providers_profile_dynamic` (partial, WHERE != '{}')

**procurement_conversations table additions:**
| Column | Type | Default |
|--------|------|---------|
| restaurant_id | UUID → restaurants(id) ON DELETE CASCADE | — |
| outbound_email_type | VARCHAR(20) | — |
| round_count | INTEGER | 0 |
| constraint_flags | JSONB | '{}' |
| disclaimer_appended | BOOLEAN | false |
| rolling_summary | TEXT | — |

Simple index: `idx_conv_restaurant_id ON procurement_conversations(restaurant_id)`

CHECK constraint: `chk_outbound_email_type` — values must be NULL or one of PRICE_INQUIRY, DEMAND_OFFER, PROMO_INQUIRY, WINE_INQUIRY.

Backfill: `restaurant_id` populated from `procurement_orders` join for existing rows.

### Task 3: Config + Dependencies

**settings.py Phase 32 block (8 constants):**

| Setting | Env Var | Default |
|---------|---------|---------|
| hard_round_cap | HARD_ROUND_CAP | 6 |
| max_round_cap | MAX_ROUND_CAP | 12 |
| negotiation_draft_daily_cap | NEGOTIATION_DRAFT_DAILY_CAP | 50 |
| email_classify_daily_cap | EMAIL_CLASSIFY_DAILY_CAP | 500 |
| auto_send_health_threshold | AUTO_SEND_HEALTH_THRESHOLD | 0.80 |
| draft_token_budget | DRAFT_TOKEN_BUDGET | 6000 |
| draft_input_token_hard_cap | DRAFT_INPUT_TOKEN_HARD_CAP | 8000 |
| wineops_disclaimer | — | "—\nThis message was drafted by WineOps AI on behalf of {restaurant_name}." |

**requirements.txt:** `rapidfuzz>=3.6.0` was already present (satisfies >=3.0.0). No change needed.

### Task 4: Migration Push (via Supabase MCP)

Applied successfully to live DB. Post-push verification confirmed:
- `providers`: 2 rows returned for profile_foundational, profile_dynamic ✓
- `procurement_conversations`: 6 rows returned for all new columns ✓

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed partial index referencing non-existent `status` column**
- **Found during:** Task 4 (first migration apply attempt)
- **Issue:** Plan included `CREATE INDEX idx_conv_status_restaurant ON procurement_conversations(restaurant_id, status) WHERE status = 'PENDING_APPROVAL'` but `procurement_conversations` has no `status` column — it uses `delivery_status`. Migration failed with `ERROR: 42703: column "status" does not exist`.
- **Fix:** Removed the `idx_conv_status_restaurant` index from the migration. Simple `idx_conv_restaurant_id` index retained.
- **Files modified:** `supabase/migrations/20260514000000_phase32_schema.sql`
- **Commit:** `80f409c`

### No-op Observations (documented, no fix needed)

**1. restaurant_id already exists on procurement_conversations**
- Pre-existing column; `ADD COLUMN IF NOT EXISTS` was a safe no-op. No FK constraint was added to the existing column, but the column is present and usable.

**2. rapidfuzz already at >=3.6.0**
- requirements.txt already had `rapidfuzz>=3.6.0` (added in a prior plan). No change needed; requirement of >=3.0.0 is satisfied.

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 790ce84 | feat | add Phase 32 schema migration SQL |
| cd1f53d | feat | add Phase 32 runtime constants to settings.py |
| 80f409c | fix | remove partial index on non-existent status column |

## Known Stubs

None — this plan is purely schema/config with no UI-rendering code.

## Threat Flags

None — migration is idempotent DDL with no user-supplied values at trust boundaries.

## Self-Check: PASSED

- [x] `supabase/migrations/20260514000000_phase32_schema.sql` exists and committed
- [x] `services/agent-orchestrator/config/settings.py` has all 8 Phase 32 constants
- [x] `providers.profile_foundational` and `profile_dynamic` exist in live DB (2 rows verified)
- [x] `procurement_conversations` has all 6 new columns (6 rows verified)
- [x] Commits 790ce84, cd1f53d, 80f409c present in git log
- [x] VERIFIED_NOTIFICATION_FIELD = "status" documented
