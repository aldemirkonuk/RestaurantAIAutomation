# ARCHIVED - Legacy Migration Files

> **These migration files are READ-ONLY references. Do NOT edit or apply them directly.**

The migrations in `services/database/migrations/` were the original schema definition files
used before the Supabase CLI migration system was adopted. They have been consolidated into
a single baseline migration at:

```
supabase/migrations/20260208024921_new-migration.sql
```

## Single Source of Truth

All future schema changes MUST be created via:

```bash
supabase migration new <migration_name>
```

This generates a timestamped migration file in `supabase/migrations/` which is the
**only** directory the Supabase CLI reads during `supabase db push` or `supabase db reset`.

## Why This Matters

Previously, SQL files in this directory were applied manually, causing:
- Empty Supabase migration files (no tracking)
- Migration faults when schema drifted
- No rollback capability
- No migration ordering guarantees

## File Reference

| Legacy File | Contents |
|-------------|----------|
| 000_migration_tracker.sql | Migration tracking table |
| 001_add_advanced_features.sql | Recurring orders, vendor deadlines, calendar, invoices, profit margins |
| 002_add_one_tap_actions.sql | One-tap action system |
| 003_add_events_table.sql | Event sourcing table |
| 004_add_event_dlq_replay.sql | Dead letter queue + replay for events |
| 005_calendar_recurrence_and_inventory_ledger.sql | Calendar recurrence rules, inventory ledger |
| 006_inventory_auto_logging_triggers.sql | Auto-logging triggers for inventory changes |
| 007_add_toast_guid_columns.sql | Toast POS GUID mapping columns |
| 008_providers_and_reports.sql | Provider performance, reports, budgets |
| 009_p1_agent_tables.sql | Agent feature tables (ghost inventory, compliance, etc.) |
| 010_add_event_types_provider_template.sql | Event types, provider templates |
| 011_add_restaurant_feature_flags.sql | Feature flag system |
| 012_create_users_table.sql | Users and auth tables |
| 013_master_wine_library_dedup_and_events.sql | Wine library dedup, search vectors |
