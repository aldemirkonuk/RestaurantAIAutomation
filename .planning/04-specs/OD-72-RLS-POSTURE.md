---
id: OD-72-RLS-POSTURE
status: evidence + recommendation, undecided
measured: 2026-08-26 against production
supersedes: nothing — extends .planning/decisions/OD-72-rls-census.md with a fresh measurement
related: "[[0012-reports-through-the-gateway]], OD-73, supabase/migrations/20260825200000_od73_close_anon_dml.sql"
---

# OD-72 — RLS posture: policies, gateway-only, or off?

Nothing here is applied. No migration written (OD-73's agent owns `supabase/migrations/`).
Every number re-measured 2026-08-26 against production as `postgres`; the register's
figures are corrected in §7.

## 1. Headline

| | n | rows |
|---|---:|---:|
| public tables (`relkind in ('r','p')`) | **206** | |
| RLS on, **zero** policies ("naked") | **142** | 1,690 |
| … of which hold rows | **43** | 1,690 |
| … of which are empty | **99** | 0 |
| … granting DML to `anon` **and** `authenticated` | **142 / 142** | — |
| RLS on, ≥1 policy | 52 | |
| RLS **off** (→ OD-73) | 12 | |
| public views + materialized views | 23 + 3 | |
| tables with `relforcerowsecurity` | **0** | |

`anon`, `authenticated`, `authenticator`: `rolbypassrls = false`. `service_role` and
`postgres`: `rolbypassrls = true`, `rolsuper = false`. All 142 carry the identical grant
string `DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE` to both client roles —
**203 of 206 tables do**; only three (`neural_footprint_event`, `nf_verdict`,
`guest_identifiers`) have ever been revoked.

## 2. What closed-by-absence actually buys — probed with the real public anon key

`GET /rest/v1/<t>?select=*&limit=1`, `Prefer: count=exact`:

| table | posture | result |
|---|---|---|
| `notifications` (478) | RLS on, 0 pol, anon granted | `200` `[]`, `count */0` |
| `users` (10), `restaurants` (10), `team_members` (11), `api_spend` (185) | same | `200` `[]` each |
| `master_wine_library` (4094) | RLS on, **1 policy** | **`206`, 4094 rows returned** |
| `training_datasets` (8) | RLS on, policy `roles={public}` `USING(true)` | **`206`, 8 rows** |
| `organization_invites` (2) | same | **`206`, 2 rows** |
| `wine_repair_log` (1086) | RLS **off** (OD-73) | **`206`, 1086 rows** |
| `neural_footprint_event` (9) | RLS on + **grants revoked** | **`401` permission denied** |

Two things fall out. Naked RLS **does** hold for a direct table read — and it fails
*silently* (`200 []`), which is the OD-45/sommelier failure mode, not a security signal.
And the only posture in this database that fails **loudly and correctly** already exists:
`neural_footprint_event`, RLS-on + explicit `service_role` policy + `REVOKE ALL`.

## 3. The hole — 16 owner-run views bypass it today

Absence is not a boundary. **16 postgres-owned relations (13 views + 3 materialized views) have `security_invoker = false`**
(they execute as `postgres`, `rolbypassrls = true`) **and `anon` holds SELECT on all 16.**
Probed live:

| view | anon result | base tables (`*` = one of the 142) |
|---|---|---|
| `v_restaurant_sku_reference` | **206, 72 rows** incl. `restaurant_name: "Meyhouse Palo Alto"` | `restaurants*`, `restaurant_inventory`, `master_wine_library` |
| `v_active_inventory` / `v_low_stock_items` | **206, 64 rows** each, with `restaurant_id` | `restaurant_inventory`, `restaurants*`, `providers` |
| `inventory_analytics` | **206, 64 rows** | `restaurant_inventory`, `inventory_transactions` |
| `inventory_lot_rollup` | **206, 2 rows** = all of `inventory_lots` | `inventory_lots*` |

**7 of the 142 are already anon-readable through a view**: `restaurants`, `inventory_lots`,
`one_tap_actions`, `procurement_orders`, `sales_events`, `toast_item_mappings`,
`wine_consumption_log`. The other 10 leaky views return empty only because their base
tables are empty. Also: 2 `SECURITY DEFINER` functions are `EXECUTE`-able by `anon` —
`seed_sim_restaurant` and `increment_trust_counter` (both write primitives).

## 4. The comparison group — 52 policied tables, 74 policies

| policy shape | n | what it does from this product |
|---|---:|---|
| references `auth.uid()` / `auth.jwt()` | **52 of 74** | **nothing** — no Supabase Auth session exists, `auth.uid()` is permanently NULL |
| `user_restaurant_access` join (also via `auth.uid()`) | 25 | same; the join is correct, the anchor is NULL |
| bare `USING (true)` | 19 | of these, 10 target `{service_role}` (decorative — bypassrls); **6 target `{public}`/`{anon}` and are live anon exposure**; 3 target `{authenticated}` |
| other | 3 | |

The canonical tenant policy, verbatim from `restaurant_inventory`:

```sql
-- policy "Managers can view their restaurant data", SELECT, roles={public}
USING (restaurant_id IN (
  SELECT user_restaurant_access.restaurant_id
  FROM user_restaurant_access
  WHERE user_restaurant_access.user_id = auth.uid()))
```

It is the right shape and it returns nothing, because `auth.uid()` is NULL for every real
caller. **The 52 policied tables are not a working convention the 142 fell out of** — they
are the same failure with an extra step, plus 6 tables where the policy actively opened the
door (`master_wine_library` 4094 rows, `training_datasets` 8, `organization_invites` 2,
`calendar_event_types`, `crawl_log`, `restaurant_directory`).

## 5. The 142, classified

Reference counts are `grep -c '["\`'"'"']<table>["\`'"'"']'` over `apps/api-gateway/src` and `services/`.
No group has a browser path: `apps/web` has exactly one anon-key client
(`apps/web/src/lib/supabase.ts:16`), one importer (`useSommelierQueries.ts`, which reads
`sommelier_conversations` — *not* in the 142), and `apps/mobile` has **zero** Supabase
references.

| group | n | rows | non-empty | no server ref | posture implied |
|---|---:|---:|---:|---:|---|
| **G1 identity / PII** — `users`, `restaurants`, `team_members`, `user_preferences`, `contacts`, `contact_addresses`, `provider_contacts`, `password_resets`, `notification_preferences`, `mobile_devices`, `restaurant_providers` | 11 | 60 | 9 | 1 | never client-readable; gateway-only, permanently |
| **G2 tenant operational data** — `notifications` (478), `field_review_queue` (198), `master_wine_library_submissions` (191), `analytics_insight_prefs` (150), `storage_locations` (87), `inventory_alert_state` (66), `pos_checks` (66), `pos_*`, `procurement_orders`, `schedules`/`shifts`/`team_*`, `one_tap_actions`, `generated_reports` | 68 | 1,330 | 18 | 19 | a surface will want these; today all served by gateway endpoints |
| **G3 agent + platform telemetry** — `api_spend` (185), `decision_log` (26), `event_store`, `outbox`, `saga_state`, `dead_letter_queue`, `idempotency_keys`, `research_*`, `ux_*`, `drift_findings`, `sim_*`, `simpos_*`, `_migrations` | 48 | 272 | 12 | 10 | no client will ever read these; revoke and forget |
| **G4 reference / catalogue** — `unit_conversions` (17), `grape_varieties` (7), `wine_regions`, `appellation_rules`, `vintage_rules`, `producers`, `message_templates` | 15 | 28 | 4 | 3 | arguably public, but nothing reads them from a browser today |

**33 of the 142 have no gateway *and* no Python reference at all**; 31 of those 33 are
empty. `_migrations` (13 rows) and `restaurant_providers` (8) are the exceptions.
`simpos_*` (4 tables, 0 rows) sits behind `app.module.ts:89`, which excludes the module in
production (OD-35). These are drop-or-archive candidates, not secure-them candidates — but
that is a schema decision, not this one.

## 6. The three options, costed

| | what it is | cost today | cost later | verdict |
|---|---|---|---|---|
| **(a) per-table policies** | write RLS policies for 142 tables | **very high, and it does not work**: every existing tenant policy anchors on `auth.uid()`, which is NULL here. A correct policy needs Supabase Auth (or Supabase-signed JWTs) first — rebuilding login to serve zero current call sites. `USING (true)` is not a policy; §4 shows what it does. | correct destination *if* a direct-read client is ever wanted | **reject now** |
| **(b) gateway-only: `REVOKE ALL … FROM anon, authenticated`** | remove the 142 from the PostgREST surface; keep RLS on with an explicit `service_role` policy | **near zero.** The gateway holds the service-role key and `service_role` keeps its grants. The one anon-key client touches none of the 142. Cost is one migration. | the day a client needs direct reads: re-grant + write a real policy for **that one table** — the same work (a) demands, deferred to when it is justified | **recommend** |
| **(c) turn RLS off where decorative** | `disable row level security` on the gateway-only tables | honest about the theatre, but **catastrophic if done alone**: RLS is the only thing standing between the public anon key and `notifications`/`users`/`restaurants`. Requires the revoke from (b) *first*, at which point RLS-off buys nothing but removes the second gate | leaves one gate where there were two | **reject** |

**Recommend (b), applied to all 142 plus the 16 leaky views plus the 2 anon-executable
`SECURITY DEFINER` functions.** Reasoning: it is the only option whose cost is proportional
to the evidence. There is no client that reads these tables and no plan on record that
needs one; (a) prices in an auth migration to serve nobody, and (c) trades the working gate
for the failed one. (b) also converts a silent `200 []` into a loud `401`, which is the
difference between OD-45 shipping broken for months and failing on the first request. The
shape is not novel here — `20260825200000_od73_close_anon_dml.sql:123-140` already argues
for exactly this three-part form (RLS on + explicit `service_role` policy + `REVOKE`),
copied from `20260824153600_nf_a_readout.sql:79` and the guest-identity migration. OD-72 is
the same migration at 142 tables instead of 11.

**What (b) costs the day it bites:** a product surface that wants a direct browser read of,
say, `notifications` gets a `401` instead of an empty list, and must either route through
the gateway (as OD-45 did for `generated_reports`) or earn a `GRANT` + a real policy in an
ADR. That is the intended friction, not a regression.

## 7. The trap — and why it is not hypothetical

**RLS-enabled-with-no-policy is closed only by ABSENCE.** The default-deny holds until
someone writes the *first* policy on that table, at which point the table opens to whatever
that policy admits — with no diff signal that a boundary changed, because the boundary was
never written down.

This is not a thought experiment in this database. It has already happened five times:
`master_wine_library` (one `SELECT USING (true)` to `{anon,authenticated}` → **4094 rows
live to the public key**), `training_datasets`, `organization_invites`,
`calendar_event_types`, `crawl_log`, `restaurant_directory`. Every one was a table someone
"added a policy to."

Any recommendation must therefore make the grant, not the policy, the load-bearing gate:

1. **`REVOKE` is the boundary; the policy is documentation.** A revoked table cannot be
   opened by adding a policy — it takes an explicit `GRANT`, which is visible in a
   migration diff and reads as a decision.
2. **Write the `service_role` policy explicitly** even though `service_role` bypasses RLS.
   It converts the policy set from empty to stated, so the next policy is an *addition to*
   a named set rather than a *redefinition of* nothing.
3. **A CI guard, or the class returns.** Assert against production that no table in the
   revoked set has grants to `anon`/`authenticated`, that no public view has
   `security_invoker = false` with an anon grant, and that no policy names `roles={public}`
   with `USING (true)`. The three checks correspond exactly to the three ways this database
   is currently open. Without the guard the next `CREATE TABLE` re-enters the 142 by
   default, since Supabase's default grants are what put all 203 tables there.

## 8. Register corrections

| register says | measured 2026-08-26 | note |
|---|---|---|
| "142 of **205** public tables" | **206** | `nf_verdict` (OD-59) landed after the census |
| "52 of **73** existing policies reference `auth.*`" | 52 of **74** | +1 = `nf_verdict_service_role`; the 52 is exact |
| "the 51 'policied' tables" | **52** | same off-by-one |
| "exactly **two** files import it — `useReportQueries.ts` … and `useSommelierQueries.ts`" | **one** | OD-45 already ported `useReportQueries`; `reports.ts:90` records the removal |
| 142 naked / 43 with rows / 12 RLS-off / `notifications` | confirmed; `notifications` is **478**, not 470 | rows accrued since |
| — | **not in the register:** 16 anon-readable owner-run views bypass RLS on 7 of the 142; 2 `SECURITY DEFINER` functions are anon-executable | §3 |

## 9. Method

`scripts`-free, read-only: `psycopg2` on `SUPABASE_POOLER_URL`, session `readonly=True`, as
`postgres`. `pg_class.relrowsecurity` / `relforcerowsecurity`, `pg_policy` counts,
`pg_policies` for definitions, exact `count(*)` per table (not `reltuples`),
`information_schema.role_table_grants` cross-checked against `pg_class.relacl`,
`pg_options_to_table(reloptions)` for `security_invoker`, `pg_depend`/`pg_rewrite` for
view→base-table edges. Live probes are unauthenticated `GET`s to `/rest/v1/` with the
production `SUPABASE_ANON_KEY` — reads only, no writes attempted, nothing mutated.

**Not done:** no write-probe with the anon key (an `INSERT` would have proven the DML
grants are live rather than inferred from `relacl`; not attempted against production). No
audit of the 26 views' column-level exposure beyond the 16 that bypass RLS. The G1–G4
classification is a judgement over measured reference counts, not a measurement.
