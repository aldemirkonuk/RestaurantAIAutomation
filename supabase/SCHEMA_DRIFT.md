# Schema drift — findings and how to check

**Last checked:** 2026-07-27 against project `exzueerziesmczwlhomd`.

## Why this file exists

While building the procurement document spine, reading the migration files
produced three wrong assumptions in a row that only surfaced when DDL actually
ran against production:

- `procurement_order_items` **existed in the database, in no migration file**, and
  was referenced by no application code. A parallel `procurement_order_lines`
  table was one command away from being created next to it.
- `procurement_orders.wine_name` is in `20260208024921_baseline_schema.sql` and
  is **not in the database**.
- `public.users` is keyed on `user_id`; a `REFERENCES users(id)` written from the
  migrations fails outright.

None of that is exotic — it is what happens to any project where DDL is
sometimes applied by hand. The cost is specific and compounding: **"read the
migrations" stops being a safe way to learn the schema**, and every subsequent
change is built on that assumption.

## Current findings

### 13 ghost tables — CAPTURED 2026-07-28 ✅

All 13, plus **4 enums that were also ghosts** (`event_type`, `source_page`,
`dlq_status`, `replay_job_status` — the drift was never limited to tables), are
now in `20260731164610_capture_ghost_tables.sql`.

Every definition was read out of the live catalog — `pg_attribute`,
`pg_constraint`, `pg_indexes`, `pg_enum` — never inferred from the application
code that uses these tables. Inferring is how the drift arrived: code shows which
columns are *written*, never which are NOT NULL, defaulted, generated or
constrained. The `notifications` table proved the cost of guessing, where three
NOT NULL columns no code path mentioned were rejecting every insert.

Verified by applying it: a clean no-op against production (`{"success":true}`),
with the two tables holding live data unchanged — `event_schema_registry` still 9
rows, `restaurant_providers` still 8.

Two things the capture surfaced that were not in the original finding:

- **FK ordering holds.** All five referenced tables (`events`,
  `master_wine_library`, `procurement_conversations`, `providers`, `restaurants`)
  are in the baseline, which runs first — so this migration works on an empty
  database, not just as a production no-op.
- **Ten duplicate index pairs**, byte-identical under two names
  (`idx_dlq_error_code` / `idx_event_dlq_error_code` and nine more), presumably a
  migration applied twice under different naming conventions. Each costs write
  throughput on every insert. **Reproduced deliberately**, because this file's
  contract is "a fresh environment matches production"; dropping them is a
  separate change that must land in both places at once. Tracked as v3.0 task
  44.3e.

### Version skew — fixed 2026-07-27

Three migrations applied through the management API were stamped with the API's
own timestamp rather than the filename's, so local files and the tracked versions
disagreed. Renamed to match:

| Was | Now (matches tracked version) |
|---|---|
| `20260727120000_procurement_document_spine.sql` | `20260727144415_…` |
| `20260727150000_document_intake_dedupe.sql` | `20260727150608_…` |
| `20260727170000_vendor_credit_ledger.sql` | `20260727151432_…` |

Also renamed `20260208024921_new-migration.sql` → `_baseline_schema.sql` (it is
the 700-line foundation schema, not a nameless one-off) and updated the `name` in
`supabase_migrations.schema_migrations` to match.

**Applying migrations through the management API stamps its own version.** Either
apply through the CLI, or rename the file to the returned version afterwards.

## How to check

The project is linked (`supabase/.temp/linked-project.json` → `exzueerziesmczwlhomd`).

```bash
npm run db:drift
```

That runs `supabase migration list`, which shows local versus remote side by
side; any row with a value in one column and not the other is skew.

For a full structural comparison — the thing that actually catches ghost columns
and changed types, not just missing tables:

```bash
supabase db diff --linked --schema public
```

Non-empty output is drift. Ideally that is empty and this file is deleted.

## The rule going forward

Before writing a migration that touches an existing table, **read the live schema,
not the migration files**. `information_schema.columns` for shape,
`pg_constraint` for keys and checks, and `is_generated` for generated columns —
`procurement_order_items.total_bottles` is `GENERATED ALWAYS` and rejects an
explicit insert, which no migration file mentions.
