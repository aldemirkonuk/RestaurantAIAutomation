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

### 13 ghost tables — live in the database, named in no migration

```
_migrations              event_replay_jobs        negotiation_facts
conversation_embeddings  event_schema_registry    restaurant_providers
enrichment_queue         inventory_events         vendor_promotions
event_dead_letters       keyboard_shortcuts       wine_aliases
                         manager_preferences
```

A fresh environment will not have these, so anything depending on them works in
production and fails locally. `_migrations` is probably a leftover from an older
tooling choice and may just be droppable; the rest need capturing.

**How to capture one** (the pattern used for `procurement_order_items` in
`20260727144415_procurement_document_spine.sql`): read its real definition out of
`information_schema` and `pg_constraint`, write it into a migration as
`CREATE TABLE IF NOT EXISTS`, which is a no-op where it already stands and
correct on a fresh database. Do not guess the definition from the code that uses
it — that is how the drift got here.

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
