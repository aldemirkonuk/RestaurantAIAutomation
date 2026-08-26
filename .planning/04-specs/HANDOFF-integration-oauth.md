# Handoff — integration OAuth tables (Drive / Excel)

**Branch:** `fix/integration-oauth-tables` · **Date:** 2026-08-26

This file exists because `OPEN-DECISIONS.md` and `CLAIMS.jsonl` were being written
by several agents at once today and every collision came from those two files.
Nothing here has been applied to either register — **apply centrally**.

> **Before applying:** `OD-94` was the next free id when this was written (highest
> in the register was OD-93). Four other agents were working the same trunk today,
> so re-check for a collision and prefer a gap over reusing a number — CLAUDE.md
> §5b, and git merges duplicate ids in silence.

---

## 1. The defect

`integration_oauth_connections` and `integration_oauth_states` did not exist in
production. `IntegrationsModule` is wired into `AppModule` (`app.module.ts:106`)
and every route under `@Controller("integrations/oauth")` is live and guarded, so
the Drive/Excel connect flow completed the **full round trip at Google or
Microsoft** — real consent screen, real approved scopes — and then failed on the
write at `integrations-oauth.service.ts:145` (state insert) or `:434` (connection
upsert). Nobody had ever successfully connected anything.

Fifth instance in one day of a migration living outside `supabase/migrations/`
that production never saw (`restaurant_feature_flags`, `scheduled_reports`,
`restaurant_inbound_addresses`, `push_subscriptions`, and this).

Measured before writing anything, with a live `GET` using the **service-role**
key — not just anon:

```
integration_oauth_connections  HTTP 404  PGRST205 Could not find the table ... in the schema cache
integration_oauth_states       HTTP 404  PGRST205 Could not find the table ... in the schema cache
```

---

## 2. What the archived migration got right, and what it got wrong

Source: `supabase/migrations_archive/20260730120000_integration_oauth_connections.sql`,
dated before the 2026-08-05 `baseline_from_production` snapshot, so the baseline
never captured it either. It was **not trusted** — it was diffed against all ten
call sites in `apps/api-gateway/src/integrations/integrations-oauth.service.ts`
(lines 146, 323, 435, 465, 478, 512, 534, 586, 632, 651).

### Right — the DDL matches what the code needs

Carried over unchanged. Each of these was checked against production rather than
assumed from the repo's schema files:

| Archive says | Verified |
|---|---|
| FK → `users(user_id)` | production `users` PK **is** `user_id uuid` (`pg_constraint`) |
| FK → `restaurants(id)` | production `restaurants` PK **is** `id uuid` |
| `UNIQUE (user_id, integration_id)`, non-partial | exactly what the PostgREST upsert needs — see below |
| token/expiry columns nullable | required: `disconnect()` NULLs all three (`:534-541`) |
| `provider CHECK IN ('google','microsoft')` | matches `IntegrationProvider` (`integrations-oauth.constants.ts:1`) |
| `integration_id VARCHAR(64)` | fits both `IntegrationId` values (`google_drive`, `excel`) |

The **non-partial unique constraint is the subtle one and must not be "improved".**
`storeConnection` (`:436`) is a PostgREST upsert with
`onConflict: "user_id,integration_id"`, which emits
`ON CONFLICT (user_id, integration_id) DO UPDATE`. Postgres binds that only to a
unique index on exactly those columns **with no predicate**. Since revocation is
soft, `UNIQUE ... WHERE revoked_at IS NULL` looks tidier and would break the
upsert outright — and the disconnect→reconnect path *depends* on the conflict
firing against the revoked row so it can be resurrected with `revoked_at = null`.

### Wrong — it had no security half at all

The archived file ends at `COMMENT ON TABLE`. **No `enable row level security`,
no policy, no `REVOKE`, no assertion block.** Applied as written it would have
created the twelfth RLS-off table in `public` — the exact shape OD-73 spent a
migration closing — and on the worst possible table, since this one stores
`access_token_encrypted` and `refresh_token_encrypted`.

**Being exact about severity rather than overstating it:** OD-72
(`20260825210000`) already ran `alter default privileges in schema public revoke
all on tables from anon, authenticated` for `postgres`, and migrations run as
`postgres` (verified: `current_user = postgres`). So a table created *today*
inherits `{postgres, service_role}` and no anon grant on its own. Had the archive
landed on its original 2026-07-30 date it would have been a **live leak of OAuth
refresh tokens to the publishable anon key**; landing today it is saved by
ordering luck, not by anything in the file. Ordering luck is not a control —
`supabase_admin`'s default ACL still grants anon `arwdDxtm` and cannot be altered
by us.

Fixed by following the OD-72 / OD-73 shape **in the creating migration**: RLS on,
an explicit `service_role` policy (not closed-by-absence), `REVOKE ALL FROM anon,
authenticated`, and a `DO $$` block that asserts its own outcome.

### One deliberate non-change

`integration_oauth_states.restaurant_id` keeps **no** foreign key, unlike its
counterpart on the connections table. The row lives ten minutes and is only a
carrier — its `restaurant_id` is copied into the connections row at `:285`, where
the FK does apply. Adding one would move a stale-JWT tenant id from "fails at the
end of the handshake" to "cannot start the handshake", a behaviour change the
code does not ask for. Recorded so it is not read as an oversight.

---

## 3. Applied and verified in production

Applied with `supabase db push` so the file on disk is byte-for-byte what
production got (md5 confirmed), and the ledger stayed consistent —
`schema_migrations` now has `20260826170000` as its max, so a future `db push` is
a no-op.

The migration's own assertion fired on the way in:

```
NOTICE: integration OAuth tables created, RLS on, anon/authenticated revoked,
        gateway column contract satisfied.
```

**Anon-key probe — the required evidence:**

| | service-role | anon key |
|---|---|---|
| `integration_oauth_connections` SELECT | **200** | **401** `42501 permission denied` |
| `integration_oauth_states` SELECT | **200** | **401** `42501 permission denied` |
| `integration_oauth_connections` INSERT | — | **401** `42501 permission denied` |
| `integration_oauth_states` INSERT | — | **401** `42501 permission denied` |
| `user_oauth_accounts` (control, locked by OD-73) | 200 | 401 `42501` |

Catalogue state matches the control exactly:

```
relacl   = {postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
rls_on   = true      policies = 1 (service_role)
anon_select = false  anon_insert = false  authenticated_select = false
```

**Functional round trip** against the real schema, run inside a `DO` block that
raises at the end so every write rolled back (production residue re-checked
afterwards: **0 rows in both tables**):

```
state_insert=OK | consume_first=google_drive | replay_rows=0 (want 0) |
connect_insert=OK | disconnect=OK | reconnect_same_row=true rows=1 (want 1) |
live_after_reconnect=1 (want 1) | connected_at_preserved=true |
provider_check=enforced | purge=OK
```

`reconnect_same_row=true rows=1` is the one that matters: the upsert binds to the
unique constraint and resurrects the revoked row instead of duplicating it.

---

## 4. Tests

`apps/api-gateway/src/integrations/integrations-oauth.service.spec.ts` — 17 tests.
The module had **no spec file of any kind** before this.

Stated plainly, because it is the point: **a mocked unit test cannot catch this
defect.** The service was always correct; production lacked the table. A fake
Supabase client passes identically either way — which is why this shipped broken
and stayed broken. So the first block does not mock the database at all: it
asserts that every table the service `.from()`s is created by a migration under
`supabase/migrations/`, with RLS and the anon revoke, and that the unique
constraint is non-partial. The rest cover logic seams that had zero coverage
(open-redirect rejection on `returnPath`, state replay, callback-never-throws).

Each assertion was proved to fail against a revert:

| Revert | Result |
|---|---|
| 0. real migration | 17 passed |
| 1. migration deleted (**the original defect**) | 6 failed |
| 2. security half stripped (**the archive's actual shape**) | 2 failed |
| 3. `UNIQUE` made partial | 1 failed |
| 4. `access_token_encrypted` made `NOT NULL` | 1 failed |
| 5. table renamed in the migration only | 2 failed |

Revert 3 initially passed — **the assertion was being satisfied by the
migration's own prose header, which quotes the constraint while explaining it,
and then by the `RAISE EXCEPTION` string inside its own assertion block.** Fixed
by stripping `--` comments and scoping the match to the `CREATE TABLE` body.
Exactly the vacuous-grep trap CLAUDE.md §5b names; it only surfaced because the
revert was actually run.

Gateway suite: **1203 → 1220 passing** (91 suites, 11 skipped, 0 failures).
`npx tsc --noEmit` clean.

---

## 5. Proposed register row — do not let me write this, apply it centrally

For the **resolved** table in `OPEN-DECISIONS.md` (`| ID | Resolved as | Date |`):

```
| OD-94 | ✅ **Resolved 2026-08-26 — `integration_oauth_connections` / `integration_oauth_states` never existed in production, so the Drive/Excel connect flow completed the full OAuth round trip at Google and then 404'd on the write.** Fifth instance in one day of a migration outside `supabase/migrations/` that production never saw. The archived file (`migrations_archive/20260730120000`) predates the 2026-08-05 `baseline_from_production` snapshot, so the baseline missed it too. **Its DDL was right and was carried over unchanged** — FKs verified against production's real PKs (`users.user_id`, `restaurants.id`), and `UNIQUE (user_id, integration_id)` must stay **non-partial** because `storeConnection`'s PostgREST upsert emits `ON CONFLICT (user_id, integration_id)`, which Postgres binds only to an unpredicated index; the tidier `WHERE revoked_at IS NULL` would break reconnect-after-disconnect. **What it got wrong was having no security half at all** — no RLS, no policy, no REVOKE, no assertion — on a table storing `access_token_encrypted` and `refresh_token_encrypted`. Precise severity: OD-72 had already revoked `postgres`'s default table grants, so a table created *today* gets no anon grant on its own; on its original 2026-07-30 date this would have been a live leak of refresh tokens to the publishable key. Ordering luck, not a control — `supabase_admin`'s default still grants anon and we cannot alter it. Shipped with the OD-72/73 shape in the **creating** migration and a `DO $$` block asserting its own outcome, including the gateway's column contract. Verified in production: **200 to service-role, 401 `42501` to the anon key** on SELECT *and* INSERT for both tables, `relacl = {postgres, service_role}`, plus a rolled-back functional round trip proving the upsert resurrects a revoked row rather than duplicating it. 17 new tests (the module had none); each proved to fail against 5 reverts. **One of those reverts caught a vacuous assertion in my own test** — the migration's prose header and its `RAISE EXCEPTION` string both quote the DDL, so matching the raw file passed while the DDL said the opposite. | 2026-08-26 |
```

## 6. Proposed `CLAIMS.jsonl` lines

Generated programmatically, then each one **parsed back out of the JSON and
executed** — all five exit 0 from the repo root. C2 and C4 were additionally run
against the archived file as negative controls and both fail there, so neither is
vacuous.

```jsonl
{"id": "OD-94", "status": "resolved", "claim": "integration_oauth_connections and integration_oauth_states are created by a migration in supabase/migrations/, the directory that is applied, not only in migrations_archive/ which is not", "verify": "grep -rqiE \"create table (if not exists )?(public\\.)?integration_oauth_connections\" supabase/migrations/ && grep -rqiE \"create table (if not exists )?(public\\.)?integration_oauth_states\" supabase/migrations/", "verified": "2026-08-26"}
{"id": "OD-94", "status": "resolved", "claim": "RLS and the anon/authenticated REVOKE live in the SAME migration that creates each table, not a follow-up - these tables hold OAuth refresh tokens", "verify": "test -n \"$(grep -rliE \"create table (if not exists )?public\\.integration_oauth_connections\" supabase/migrations/)\" && test \"$(grep -rliE \"create table (if not exists )?public\\.integration_oauth_connections\" supabase/migrations/)\" = \"$(grep -rliE \"revoke all on public\\.integration_oauth_connections from anon, authenticated\" supabase/migrations/)\" && test \"$(grep -rliE \"create table (if not exists )?public\\.integration_oauth_states\" supabase/migrations/)\" = \"$(grep -rliE \"revoke all on public\\.integration_oauth_states from anon, authenticated\" supabase/migrations/)\"", "verified": "2026-08-26"}
{"id": "OD-94", "status": "resolved", "claim": "UNIQUE (user_id, integration_id) has no WHERE predicate, so storeConnection's PostgREST upsert onConflict can bind to it (comments stripped first, so the header prose explaining the rule cannot satisfy the grep)", "verify": "sed \"s/--.*//\" supabase/migrations/20260826170000_integration_oauth_tables.sql | grep -qE \"UNIQUE \\(user_id, integration_id\\)[[:space:]]*$\"", "verified": "2026-08-26"}
{"id": "OD-94", "status": "resolved", "claim": "the creating migration asserts its own outcome in a DO block, including that anon holds no privilege on either table", "verify": "grep -q \"RAISE EXCEPTION\" supabase/migrations/20260826170000_integration_oauth_tables.sql && grep -qi \"has_table_privilege..anon\" supabase/migrations/20260826170000_integration_oauth_tables.sql", "verified": "2026-08-26"}
{"id": "OD-94", "status": "resolved", "claim": "the integrations module has a spec that binds every table the service queries to an applied migration, and it fails when that migration is absent", "verify": "test -f apps/api-gateway/src/integrations/integrations-oauth.service.spec.ts && grep -q \"backed by an applied migration\" apps/api-gateway/src/integrations/integrations-oauth.service.spec.ts", "verified": "2026-08-26"}
```

---

## 7. Found in passing — not fixed here, each needs a decision

1. **The connect flow has never been exercised end to end.** This change makes the
   write succeed; it does **not** prove Google/Microsoft credentials are
   configured on the deployment. `availability()` hides the connect button unless
   `GOOGLE_CLIENT_ID`/`SECRET` (or the Microsoft pair) **and** the token
   encryption key are all present. Worth confirming those are set in Railway
   before telling anyone the feature works.
2. **`connected_at` survives a disconnect→reconnect cycle**, so Settings would
   show the *original* connect date after a user reconnects. Confirmed live
   (`connected_at_preserved=true`). PostgREST's upsert only updates columns in
   the payload, and `storeConnection` omits `connected_at`. Arguably correct for
   a re-auth that refreshes scopes, arguably wrong after an explicit disconnect.
   A one-line payload change; left alone because it is a product call.
3. **`purgeExpiredStates()` (`:649`) has no caller.** It is documented as "safe to
   call from a cron" but nothing schedules it, so consumed and expired state rows
   accumulate forever. Low volume, but it is dead housekeeping code today.
4. **The archived file was left in place**, matching the precedent set by the
   other promotions (`20260708160000_p1_restaurant_inbound_addresses.sql` is still
   in `migrations_archive/` after the same treatment). Five instances in one day
   suggests `migrations_archive/` holding live-looking DDL that production never
   saw is itself worth a register entry and a policy — mark promoted files, or
   delete them.

**Retire-to-write (CLAUDE.md §4):** this file is a transient handoff and should be
deleted once §5 and §6 are merged into the two registers. It is not a document to
keep.
